// Terminal manager - handles spawning and managing Claude Code sessions
// Uses Bun's native spawn API with --print mode for each message

import { EventEmitter } from 'events';
import { homedir } from 'os';
import { join, isAbsolute } from 'path';
import { existsSync, statSync } from 'fs';
import type { Subprocess } from 'bun';
import type {
  TerminalInfo,
  TerminalStatus,
  TerminalType,
  SpawnOptions,
  PermissionMode,
  ClaudeMessage,
} from '../shared/types';
import { MAX_TERMINALS } from '../shared/constants';
import { terminalLogger as log } from './logger';

interface Terminal {
  id: string;
  cwd: string;
  sessionId?: string;
  permissionMode: PermissionMode;
  status: TerminalStatus;
  model: string;
  type: TerminalType;
  buffer: string[];
  createdAt: number;
  messageBuffer: string;
  currentProc?: Subprocess<'ignore', 'pipe', 'pipe'>;
  lastMessageHash?: string; // For deduplication
}

export class TerminalManager extends EventEmitter {
  private terminals: Map<string, Terminal> = new Map();
  private idCounter = 0;
  private claudePath: string;

  constructor() {
    super();
    this.claudePath = join(homedir(), '.claude', 'local', 'claude');
  }

  spawn(options: SpawnOptions): TerminalInfo {
    if (this.terminals.size >= MAX_TERMINALS) {
      throw new Error(`Maximum of ${MAX_TERMINALS} terminals allowed`);
    }

    // Validate the working directory
    const cwd = options.cwd;

    if (!cwd || cwd.trim() === '') {
      throw new Error('Working directory cannot be empty');
    }

    if (!isAbsolute(cwd)) {
      throw new Error(`Path must be absolute: ${cwd}`);
    }

    if (!existsSync(cwd)) {
      throw new Error(`Directory does not exist: ${cwd}`);
    }

    try {
      const stats = statSync(cwd);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${cwd}`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EACCES') {
        throw new Error(`Permission denied: ${cwd}`);
      }
      throw err;
    }

    const id = `terminal-${++this.idCounter}`;

    const terminal: Terminal = {
      id,
      cwd: options.cwd,
      sessionId: options.resumeSessionId,
      permissionMode: options.permissionMode || 'bypassPermissions',
      status: 'idle',
      model: options.model || (options.type === 'gemini' ? 'gemini-2.5-flash' : 'sonnet'),
      type: options.type || 'claude',
      buffer: [],
      createdAt: Date.now(),
      messageBuffer: '',
    };

    this.terminals.set(id, terminal);
    log.info('Terminal created', { id, cwd: options.cwd, type: terminal.type, model: terminal.model, permissionMode: terminal.permissionMode });

    const info = this.getInfo(id)!;
    this.emit('spawned', info);
    return info;
  }

  async send(id: string, input: string): Promise<void> {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      log.error('Terminal not found for send', { id });
      throw new Error(`Terminal ${id} not found`);
    }

    // Build command and arguments based on terminal type
    const command = terminal.type === 'gemini' ? 'gemini' : this.claudePath;
    const args = terminal.type === 'gemini'
      ? this.buildGeminiArgs(terminal, input)
      : this.buildClaudeArgs(terminal, input);

    log.info('Sending to terminal', { id, type: terminal.type, inputPreview: input.slice(0, 100), argsCount: args.length, args: JSON.stringify(args) });

    // Update status to thinking
    this.updateStatus(id, 'thinking');

    // Spawn CLI with the prompt as argument
    const proc = Bun.spawn([command, ...args], {
      cwd: terminal.cwd,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    terminal.currentProc = proc;
    log.debug('Claude process spawned', { id, pid: proc.pid });

    // Read stdout
    this.readStream(id, proc.stdout, 'stdout');

    // Read stderr
    this.readStream(id, proc.stderr, 'stderr');

    // Handle process exit
    proc.exited.then((exitCode) => {
      log.info('Claude process exited', { id, exitCode });
      terminal.currentProc = undefined;
      this.updateStatus(id, 'idle');
    });
  }

  private buildClaudeArgs(terminal: Terminal, prompt: string): string[] {
    const args: string[] = [];

    // Use streaming JSON format for programmatic interaction
    args.push('--print');
    args.push('--output-format', 'stream-json');
    args.push('--verbose'); // Required for stream-json with --print

    // Resume session if we have one
    if (terminal.sessionId) {
      args.push('--resume', terminal.sessionId);
    }

    // Model selection
    if (terminal.model) {
      args.push('--model', terminal.model);
    }

    // Permission mode
    if (terminal.permissionMode && terminal.permissionMode !== 'default') {
      if (terminal.permissionMode === 'plan') {
        args.push('--permission-mode', 'plan');
      } else if (terminal.permissionMode === 'bypassPermissions') {
        args.push('--dangerously-skip-permissions');
      }
    }

    // Add the prompt as the final argument
    args.push(prompt);

    return args;
  }

  private buildGeminiArgs(terminal: Terminal, prompt: string): string[] {
    const args: string[] = [];

    // Use headless mode with streaming JSON format
    // -p requires the prompt as its value
    args.push('-p', prompt);
    args.push('--output-format', 'stream-json');

    // Model selection (skip if empty - let CLI use default)
    if (terminal.model && terminal.model.trim() !== '') {
      args.push('-m', terminal.model);
    }

    return args;
  }

  private async readStream(
    id: string,
    stream: ReadableStream<Uint8Array>,
    streamType: 'stdout' | 'stderr'
  ): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        this.handleOutput(id, text, streamType);
      }
    } catch (error) {
      log.error('Error reading stream', { id, streamType, error: String(error) });
    }
  }

  private handleOutput(id: string, data: string, streamType: 'stdout' | 'stderr'): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;

    // Add to buffer for overseer
    terminal.buffer.push(data);
    if (terminal.buffer.length > 1000) {
      terminal.buffer.shift();
    }

    // Emit raw output
    this.emit('output', id, data);

    // For stdout, try to parse streaming JSON messages
    if (streamType === 'stdout') {
      terminal.messageBuffer += data;
      this.parseMessages(id);
    } else {
      // Stderr - might contain errors
      log.warn('Terminal stderr', { id, data: data.slice(0, 500) });
    }
  }

  private parseMessages(id: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;

    // Split by newlines and try to parse each line as JSON
    const lines = terminal.messageBuffer.split('\n');
    terminal.messageBuffer = lines.pop() || ''; // Keep incomplete line

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const msg = JSON.parse(line);
        log.debug('Parsed JSON message', { id, type: terminal.type, msgType: msg.type, msgRole: msg.role });
        this.handleClaudeMessage(id, msg);
      } catch {
        // Not JSON, might be raw output - log for debugging
        log.debug('Non-JSON line received', { id, line: line.slice(0, 200) });
      }
    }
  }

  private handleClaudeMessage(id: string, msg: Record<string, unknown>): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;

    // Route to appropriate handler based on terminal type
    if (terminal.type === 'gemini') {
      this.handleGeminiMessage(id, msg);
    } else {
      this.handleClaudeFormatMessage(id, msg);
    }
  }

  private handleGeminiMessage(id: string, msg: Record<string, unknown>): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;

    log.debug('handleGeminiMessage', { id, msgType: msg.type, msgRole: msg.role, hasContent: !!msg.content });

    // Handle Gemini init message (capture session_id)
    if (msg.type === 'init') {
      log.debug('Gemini init message', { id, sessionId: msg.session_id });
      if (msg.session_id) {
        terminal.sessionId = msg.session_id as string;
      }
      return;
    }

    // Handle Gemini result message
    if (msg.type === 'result') {
      log.debug('Gemini result message', { id, status: msg.status });
      this.updateStatus(id, 'idle');
      // Capture session ID if present
      if (msg.session_id) {
        terminal.sessionId = msg.session_id as string;
      }
      return;
    }

    // Handle Gemini message format: {"type":"message","role":"assistant","content":"...","delta":true}
    if (msg.type === 'message' && msg.role === 'assistant') {
      this.updateStatus(id, 'thinking');

      const content = msg.content;
      log.debug('Gemini assistant message', { id, contentType: typeof content, contentLen: typeof content === 'string' ? content.length : 'N/A', delta: msg.delta });

      if (typeof content === 'string' && content.length > 0) {
        // For delta messages, we emit each piece as it arrives
        // The content is already a string in Gemini format
        const claudeMessage: ClaudeMessage = {
          type: 'assistant',
          content: [{ type: 'text', text: content }],
          timestamp: Date.now(),
        };

        log.debug('Emitting Gemini message', { id, delta: msg.delta, textPreview: content.slice(0, 50) });

        // For delta messages, don't deduplicate - each delta is a new piece
        if (msg.delta === true) {
          this.emit('message', id, claudeMessage);
        } else {
          // For non-delta messages, apply deduplication
          const contentHash = JSON.stringify(claudeMessage.content);
          if (contentHash !== terminal.lastMessageHash) {
            terminal.lastMessageHash = contentHash;
            this.emit('message', id, claudeMessage);
          }
        }
      }
    }
  }

  private handleClaudeFormatMessage(id: string, msg: Record<string, unknown>): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;

    // Handle result messages (for session ID capture)
    if (msg.type === 'result') {
      this.updateStatus(id, 'idle');
      // Capture session ID for continuation
      if (msg.session_id) {
        terminal.sessionId = msg.session_id as string;
      }
      // Don't emit result messages as they don't have user-facing content
      return;
    }

    // Skip system messages - they don't have user-facing content
    if (msg.type === 'system') {
      return;
    }

    // Only process assistant messages with actual content
    if (msg.type === 'assistant' && msg.message) {
      const messageContent = (msg.message as Record<string, unknown>).content;
      if (Array.isArray(messageContent)) {
        for (const block of messageContent) {
          if (block.type === 'tool_use') {
            this.updateStatus(id, 'running_tool');
          } else if (block.type === 'text') {
            this.updateStatus(id, 'thinking');
          }
        }
      }

      // Extract and emit the content (with deduplication)
      const content = this.extractContent(msg);
      if (content.length > 0) {
        // Simple hash for deduplication
        const contentHash = JSON.stringify(content);
        if (contentHash === terminal.lastMessageHash) {
          return;
        }
        terminal.lastMessageHash = contentHash;

        const claudeMessage: ClaudeMessage = {
          type: 'assistant',
          content,
          timestamp: Date.now(),
        };
        this.emit('message', id, claudeMessage);
      }
    }
  }

  private extractContent(msg: Record<string, unknown>): ClaudeMessage['content'] {
    const content: ClaudeMessage['content'] = [];

    if (msg.message && typeof msg.message === 'object') {
      const messageContent = (msg.message as Record<string, unknown>).content;
      if (Array.isArray(messageContent)) {
        for (const block of messageContent) {
          if (block.type === 'text' && block.text) {
            content.push({ type: 'text', text: block.text });
          } else if (block.type === 'thinking' && block.thinking) {
            content.push({ type: 'thinking', thinking: block.thinking });
          } else if (block.type === 'tool_use') {
            content.push({
              type: 'tool_use',
              id: block.id,
              name: block.name,
              input: block.input,
            });
          } else if (block.type === 'tool_result') {
            content.push({
              type: 'tool_result',
              tool_use_id: block.tool_use_id,
              content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
              is_error: block.is_error,
            });
          }
        }
      }
    }

    return content;
  }

  private updateStatus(id: string, status: TerminalStatus): void {
    const terminal = this.terminals.get(id);
    if (terminal && terminal.status !== status) {
      terminal.status = status;
      this.emit('status', id, status);
    }
  }

  sendKey(id: string, key: string): void {
    // Not supported in --print mode
    log.warn('sendKey not supported in --print mode', { id, key });
  }

  sendRaw(id: string, data: string): void {
    // Not supported in --print mode
    log.warn('sendRaw not supported in --print mode', { id });
  }

  kill(id: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      log.warn('Attempted to kill non-existent terminal', { id });
      return;
    }

    log.info('Killing terminal', { id, hadProcess: !!terminal.currentProc });
    if (terminal.currentProc) {
      terminal.currentProc.kill();
    }
    this.terminals.delete(id);
    this.emit('killed', id);
  }

  resize(id: string, cols: number, rows: number): void {
    // Not supported in --print mode
    log.warn('resize not supported in --print mode', { id, cols, rows });
  }

  setPermissionMode(id: string, mode: PermissionMode): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;

    terminal.permissionMode = mode;
    this.emit('mode', id, mode);
  }

  getInfo(id: string): TerminalInfo | undefined {
    const terminal = this.terminals.get(id);
    if (!terminal) return undefined;

    return {
      id: terminal.id,
      cwd: terminal.cwd,
      sessionId: terminal.sessionId,
      permissionMode: terminal.permissionMode,
      status: terminal.status,
      model: terminal.model,
      type: terminal.type,
      createdAt: terminal.createdAt,
    };
  }

  getBuffer(id: string, lines = 100): string[] {
    const terminal = this.terminals.get(id);
    if (!terminal) return [];

    return terminal.buffer.slice(-lines);
  }

  list(): TerminalInfo[] {
    return Array.from(this.terminals.values()).map((t) => ({
      id: t.id,
      cwd: t.cwd,
      sessionId: t.sessionId,
      permissionMode: t.permissionMode,
      status: t.status,
      model: t.model,
      type: t.type,
      createdAt: t.createdAt,
    }));
  }

  getStatus(id: string): TerminalStatus | undefined {
    return this.terminals.get(id)?.status;
  }

  shutdown(): void {
    log.info('Shutting down terminal manager', { terminalCount: this.terminals.size });
    for (const [id] of this.terminals) {
      this.kill(id);
    }
    log.info('Terminal manager shutdown complete');
  }
}
