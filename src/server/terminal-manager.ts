// Terminal manager - handles spawning and managing Claude Code sessions
// Uses Bun's native spawn API with --print mode for each message

import { EventEmitter } from 'events';
import { homedir } from 'os';
import { join } from 'path';
import type { Subprocess } from 'bun';
import type {
  TerminalInfo,
  TerminalStatus,
  SpawnOptions,
  PermissionMode,
  ClaudeMessage,
} from '../shared/types';
import { MAX_TERMINALS } from '../shared/constants';

interface Terminal {
  id: string;
  cwd: string;
  sessionId?: string;
  permissionMode: PermissionMode;
  status: TerminalStatus;
  model: string;
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

    const id = `terminal-${++this.idCounter}`;

    const terminal: Terminal = {
      id,
      cwd: options.cwd,
      sessionId: options.resumeSessionId,
      permissionMode: options.permissionMode || 'default',
      status: 'idle',
      model: options.model || 'sonnet',
      buffer: [],
      createdAt: Date.now(),
      messageBuffer: '',
    };

    this.terminals.set(id, terminal);
    console.log(`Created terminal ${id} for cwd: ${options.cwd}`);

    const info = this.getInfo(id)!;
    this.emit('spawned', info);
    return info;
  }

  async send(id: string, input: string): Promise<void> {
    const terminal = this.terminals.get(id);
    if (!terminal) throw new Error(`Terminal ${id} not found`);

    // Build command arguments
    const args = this.buildClaudeArgs(terminal, input);


    // Update status to thinking
    this.updateStatus(id, 'thinking');

    // Spawn claude with the prompt as argument
    const proc = Bun.spawn([this.claudePath, ...args], {
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

    // Read stdout
    this.readStream(id, proc.stdout, 'stdout');

    // Read stderr
    this.readStream(id, proc.stderr, 'stderr');

    // Handle process exit
    proc.exited.then((exitCode) => {
      console.log(`Claude process for terminal ${id} exited with code ${exitCode}`);
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
      console.error(`Error reading ${streamType} for terminal ${id}:`, error);
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
      console.log(`Terminal ${id} stderr:`, data);
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
        this.handleClaudeMessage(id, msg);
      } catch {
        // Not JSON, might be raw output - ignore
      }
    }
  }

  private handleClaudeMessage(id: string, msg: Record<string, unknown>): void {
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
    console.warn(`sendKey not supported in --print mode: ${key}`);
  }

  sendRaw(id: string, data: string): void {
    // Not supported in --print mode
    console.warn(`sendRaw not supported in --print mode`);
  }

  kill(id: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;

    if (terminal.currentProc) {
      terminal.currentProc.kill();
    }
    this.terminals.delete(id);
    this.emit('killed', id);
  }

  resize(id: string, cols: number, rows: number): void {
    // Not supported in --print mode
    console.warn(`resize not supported in --print mode: ${cols}x${rows}`);
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
      createdAt: t.createdAt,
    }));
  }

  getStatus(id: string): TerminalStatus | undefined {
    return this.terminals.get(id)?.status;
  }

  shutdown(): void {
    console.log(`Shutting down ${this.terminals.size} terminals...`);
    for (const [id] of this.terminals) {
      this.kill(id);
    }
  }
}
