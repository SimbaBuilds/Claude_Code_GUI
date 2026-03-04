// Overseer Agent - monitors and controls Claude Code terminals

import Anthropic from '@anthropic-ai/sdk';
import { EventEmitter } from 'events';
import { existsSync, readdirSync, statSync } from 'fs';
import { resolve, isAbsolute, join } from 'path';
import type { TerminalManager } from './terminal-manager';
import type { HistoryService } from './history-service';
import type {
  OverseerMessage,
  OverseerStatus,
  OverseerThread,
  OverseerThreadSource,
  WakeCondition,
  SpawnOptions,
  PermissionMode,
} from '../shared/types';
import { overseerLogger as log } from './logger';

const PROJECTS_DIR = '/Users/cameronhightower/Software_Projects';

function getProjectDirectories(): string[] {
  try {
    const entries = readdirSync(PROJECTS_DIR);
    return entries
      .map(entry => join(PROJECTS_DIR, entry))
      .filter(fullPath => {
        try {
          return statSync(fullPath).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

function buildSystemPrompt(): string {
  const projectDirs = getProjectDirectories();
  const dirList = projectDirs.length > 0
    ? projectDirs.map(dir => `- ${dir}`).join('\n')
    : '(No directories found)';

  return `You are an overseer agent managing multiple Claude Code terminal sessions in a GUI application.  

Notes::
- You will eventually act as Cameron Hightower's assistant though your actions are limited to managing CLuade Code terminals fro now. 
- Your source code is in /Users/cameronhightower/Software_Projects/Claude_Code_GUI and you can spawn a Claude Code terminal in this path to make changes to yourself.
- You can only see and control terminals that were opened through this GUI.
- Claude Code sessions running in VS Code, Cursor, or other terminals are not visible to you.

The user's projects are located in: ${PROJECTS_DIR}
When spawning terminals, always use FULL ABSOLUTE PATHS. If the user says "SKMD directory", use "${PROJECTS_DIR}/SKMD".
Docuspa_njs, skmd_wellness,njs, and skmd_fastapi are all in the SKMD directory.

AVAILABLE PROJECT DIRECTORIES:
${dirList}

You have access to these tools to monitor and control the terminals:

1. list_terminals - Get status of all active terminals (only shows GUI-managed terminals)
2. get_terminal_buffer - Read recent output from a specific terminal
3. send_to_terminal - Send a message or command to a terminal
4. spawn_terminal - Create a new Claude Code terminal (must use absolute paths)
5. kill_terminal - Terminate a terminal
6. set_permission_mode - Change a terminal's permission mode (default, acceptEdits, bypassPermissions, plan)
7. search_history - Search past chat sessions
8. sleep - Pause your execution and wait for conditions to be met

Your responsibilities:
1. Monitor ongoing work across all terminals
2. Coordinate tasks when the user asks
3. Summarize progress across terminals
4. Alert if something seems stuck or errored

Workflow for terminal tasks:
After sending work to a terminal, always use the sleep tool to wait for results:

1. Provide a brief status update (e.g., "Running tests in terminal-1, checking back in 30 seconds...")
2. Call sleep with the best wait mechanism, defaulting to timeout_ms
   - For multiple terminals: use timeout_ms only, then check all terminals after waking
   - For single terminal: timeout_ms is usually sufficient, optionally add wake_on_terminal_complete
3. After waking, call get_terminal_buffer or list_terminals to check results
4. Report results to the user. If work is incomplete, sleep again and keep checking.

Important style note: match the style of the user's request.  Use direct imperatives in your instructions to the agent.  Instead of 'Help me refactor the backend' say 'Please refactor the backend'.
`;
}

interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const TOOLS: Tool[] = [
  {
    name: 'list_terminals',
    description: 'Get status of all active Claude Code terminals',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_terminal_buffer',
    description: 'Read recent output from a specific terminal',
    input_schema: {
      type: 'object',
      properties: {
        terminal_id: { type: 'string', description: 'The terminal ID' },
        lines: { type: 'number', description: 'Number of lines to retrieve (default 50)' },
      },
      required: ['terminal_id'],
    },
  },
  {
    name: 'send_to_terminal',
    description: 'Send a message or command to a terminal',
    input_schema: {
      type: 'object',
      properties: {
        terminal_id: { type: 'string', description: 'The terminal ID' },
        message: { type: 'string', description: 'The message or command to send' },
      },
      required: ['terminal_id', 'message'],
    },
  },
  {
    name: 'spawn_terminal',
    description: 'Create a new Claude Code terminal',
    input_schema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Working directory for the terminal' },
        model: { type: 'string', description: 'Model to use (opus, sonnet, haiku)' },
        permission_mode: {
          type: 'string',
          enum: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
          description: 'Permission mode',
        },
        dangerously_skip_permissions: {
          type: 'boolean',
          description: 'Skip all permission checks (use with caution)',
        },
      },
      required: ['cwd'],
    },
  },
  {
    name: 'kill_terminal',
    description: 'Terminate a terminal',
    input_schema: {
      type: 'object',
      properties: {
        terminal_id: { type: 'string', description: 'The terminal ID to kill' },
      },
      required: ['terminal_id'],
    },
  },
  {
    name: 'set_permission_mode',
    description: 'Change a terminal\'s permission mode',
    input_schema: {
      type: 'object',
      properties: {
        terminal_id: { type: 'string', description: 'The terminal ID' },
        mode: {
          type: 'string',
          enum: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
          description: 'The permission mode to set',
        },
      },
      required: ['terminal_id', 'mode'],
    },
  },
  {
    name: 'search_history',
    description: 'Search past Claude Code chat sessions',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'sleep',
    description: 'Pause execution and wait for terminal work to complete. Use timeout_ms as your primary wait mechanism - estimate how long the task will take and sleep for that duration. After waking, check terminal status. For multiple terminals, use timeout only (not individual wake conditions).',
    input_schema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number', description: 'Duration to sleep in milliseconds. Primary wait mechanism. Estimate: 5000ms for quick commands, 30000-60000ms for tests/builds, 120000ms for long operations.' },
        wake_on_terminal_complete: {
          type: 'string',
          description: 'Optional: Terminal ID to wake early when it completes (use with single terminal only)',
        },
        wake_on_terminal_error: {
          type: 'string',
          description: 'Optional: Terminal ID to wake early when it errors (use with single terminal only)',
        },
        wake_on_terminal_input: {
          type: 'string',
          description: 'Optional: Terminal ID to wake early when it needs input (use with single terminal only)',
        },
      },
    },
  },
];

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

interface OverseerThreadData {
  metadata: OverseerThread;
  conversationHistory: Anthropic.MessageParam[];
  displayMessages: OverseerMessage[];
}

export class OverseerAgent extends EventEmitter {
  private client: Anthropic;
  private terminalManager: TerminalManager;
  private historyService: HistoryService;
  private conversationHistory: Anthropic.MessageParam[] = [];
  private status: OverseerStatus = 'idle';
  private sleeping = false;
  private wakeConditions: WakeCondition[] = [];
  private wakeResolver: (() => void) | null = null;
  private abortController: AbortController | null = null;
  private isAborted = false;
  private model: string = DEFAULT_MODEL;
  private agentLoopPromise: Promise<void> | null = null;

  // Thread management
  private threads: Map<string, OverseerThreadData> = new Map();
  private activeThreadId: string | null = null;

  constructor(
    terminalManager: TerminalManager,
    historyService: HistoryService
  ) {
    super();
    this.client = new Anthropic();
    this.terminalManager = terminalManager;
    this.historyService = historyService;

    // Listen for terminal events to check wake conditions
    this.terminalManager.on('status', this.checkWakeConditions.bind(this));
    this.terminalManager.on('exit', this.checkWakeConditions.bind(this));

    // Create default GUI thread
    const defaultThread = this.createThread('gui');
    this.activeThreadId = defaultThread.id;
  }

  createThread(source: OverseerThreadSource, sourceId?: string): OverseerThread {
    const thread: OverseerThread = {
      id: crypto.randomUUID(),
      source,
      sourceId,
      createdAt: Date.now(),
      lastMessageAt: Date.now(),
      preview: '',
      messageCount: 0,
    };

    this.threads.set(thread.id, {
      metadata: thread,
      conversationHistory: [],
      displayMessages: [],
    });

    log.info('Thread created', { threadId: thread.id, source, sourceId });
    this.emit('threadCreated', thread);

    return thread;
  }

  getThreads(limit = 10): OverseerThread[] {
    const allThreads = Array.from(this.threads.values())
      .map(t => t.metadata)
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);

    return allThreads.slice(0, limit);
  }

  switchThread(threadId: string): void {
    const threadData = this.threads.get(threadId);
    if (!threadData) {
      throw new Error(`Thread ${threadId} not found`);
    }

    log.info('Switching thread', { from: this.activeThreadId, to: threadId });
    this.activeThreadId = threadId;

    // Update the current conversation history reference
    this.conversationHistory = threadData.conversationHistory;

    this.emit('threadSwitched', threadId, threadData.displayMessages);
  }

  getOrCreateThread(source: OverseerThreadSource, sourceId?: string): string {
    // Try to find existing thread by sourceId
    if (sourceId) {
      for (const [id, data] of this.threads.entries()) {
        if (data.metadata.source === source && data.metadata.sourceId === sourceId) {
          log.debug('Found existing thread', { threadId: id, source, sourceId });
          return id;
        }
      }
    }

    // Create new thread if not found
    const thread = this.createThread(source, sourceId);
    return thread.id;
  }

  async chat(
    userMessage: string,
    options?: { threadId?: string; source?: OverseerThreadSource; sourceId?: string }
  ): Promise<void> {
    log.info('Chat received', { messageLength: userMessage.length, preview: userMessage.slice(0, 100), options });

    // Determine which thread to use
    let threadId: string;
    if (options?.threadId) {
      threadId = options.threadId;
    } else if (options?.source) {
      threadId = this.getOrCreateThread(options.source, options.sourceId);
    } else {
      // Use active thread or create default GUI thread
      threadId = this.activeThreadId || this.createThread('gui').id;
    }

    // Get thread data
    const threadData = this.threads.get(threadId);
    if (!threadData) {
      throw new Error(`Thread ${threadId} not found`);
    }

    // Switch to this thread if not already active
    if (this.activeThreadId !== threadId) {
      this.switchThread(threadId);
    }

    // Always ensure conversationHistory reference is correct
    this.conversationHistory = threadData.conversationHistory;

    if (this.sleeping) {
      log.info('Waking from sleep due to new message');
      this.wake();
      // Wait for the sleeping agent loop to finish adding tool results
      if (this.agentLoopPromise) {
        await this.agentLoopPromise;
      }
    }

    // Reset abort state for new chat
    this.isAborted = false;
    this.abortController = new AbortController();

    this.updateStatus('thinking');

    // Add to thread's conversation history
    threadData.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    const userMsg: OverseerMessage = {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    };

    // Add to thread's display messages
    threadData.displayMessages.push(userMsg);

    // Update thread metadata
    threadData.metadata.lastMessageAt = Date.now();
    threadData.metadata.messageCount++;
    if (!threadData.metadata.preview) {
      threadData.metadata.preview = userMessage.slice(0, 50);
    }

    this.emitMessage(userMsg);

    try {
      // Track the agent loop so we can wait for it to finish when waking from sleep
      this.agentLoopPromise = this.runAgentLoop();
      await this.agentLoopPromise;
    } catch (error) {
      if (this.isAborted) {
        log.info('Chat aborted');
        return;
      }
      log.error('Chat error', { error: String(error), stack: (error as Error).stack });
      throw error;
    } finally {
      this.agentLoopPromise = null;
    }
  }

  private async runAgentLoop(): Promise<void> {
    const MAX_ACTIONS = 30;
    let actionCount = 0;

    log.debug('Starting agent loop', { maxActions: MAX_ACTIONS });

    while (actionCount < MAX_ACTIONS) {
      // Check for abort
      if (this.isAborted) {
        log.info('Agent loop aborted');
        return;
      }

      log.debug('Making API call', { model: this.model, historyLength: this.conversationHistory.length });
      const startTime = Date.now();

      let response: Anthropic.Message;
      try {
        response = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          system: buildSystemPrompt(),
          tools: TOOLS as Anthropic.Tool[],
          messages: this.conversationHistory,
        });
        log.info('API call completed', {
          duration: Date.now() - startTime,
          stopReason: response.stop_reason,
          usage: response.usage,
        });
      } catch (apiError) {
        log.error('API call failed', {
          duration: Date.now() - startTime,
          error: String(apiError),
          stack: (apiError as Error).stack,
        });
        throw apiError;
      }

      // Check for abort after API call
      if (this.isAborted) {
        log.info('Agent loop aborted after API call');
        return;
      }

      // Add assistant response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: response.content,
      });

      // Extract text content for user display
      const textContent = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

      if (textContent) {
        this.emitMessage({
          role: 'assistant',
          content: textContent,
          timestamp: Date.now(),
        });
      }

      // Check for tool use
      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );

      if (toolUses.length === 0 || response.stop_reason === 'end_turn') {
        this.updateStatus('idle');
        break;
      }

      // Count actions and check limit
      actionCount += toolUses.length;

      if (actionCount >= MAX_ACTIONS) {
        this.emitMessage({
          role: 'assistant',
          content: `(Reached maximum actions limit: ${actionCount}/${MAX_ACTIONS})`,
          timestamp: Date.now(),
        });
        this.updateStatus('idle');
        break;
      }

      // Execute tools
      this.updateStatus('acting');
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      log.info('Executing tools', { count: toolUses.length, tools: toolUses.map(t => t.name) });

      for (const toolUse of toolUses) {
        // Check for abort before each tool
        if (this.isAborted) {
          log.info('Aborted before tool execution', { tool: toolUse.name });
          return;
        }

        log.debug('Tool start', { tool: toolUse.name, input: toolUse.input });

        // Emit tool start message
        this.emitMessage({
          role: 'tool',
          content: `Using ${toolUse.name}...`,
          timestamp: Date.now(),
          toolCall: {
            name: toolUse.name,
            input: toolUse.input as Record<string, unknown>,
            status: 'running',
          },
        });

        const toolStartTime = Date.now();
        const result = await this.executeTool(toolUse.name, toolUse.input as Record<string, unknown>);

        // Check for abort after tool execution
        if (this.isAborted) {
          log.info('Aborted after tool execution', { tool: toolUse.name });
          return;
        }

        // Emit tool completion message
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        const isError = typeof result === 'object' && result !== null && 'error' in result;

        log.info('Tool completed', {
          tool: toolUse.name,
          duration: Date.now() - toolStartTime,
          isError,
          resultPreview: resultStr.slice(0, 200),
        });

        this.emitMessage({
          role: 'tool',
          content: isError ? `${toolUse.name} failed` : `${toolUse.name} completed`,
          timestamp: Date.now(),
          toolCall: {
            name: toolUse.name,
            input: toolUse.input as Record<string, unknown>,
            result: resultStr,
            status: isError ? 'error' : 'completed',
          },
        });

        // Check if this was a sleep tool
        if (toolUse.name === 'sleep' && this.sleeping) {
          // Wait for wake
          await new Promise<void>((resolve) => {
            this.wakeResolver = resolve;
          });
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: resultStr,
        });
      }

      // Add tool results to history
      this.conversationHistory.push({
        role: 'user',
        content: toolResults,
      });
    }
  }

  private async executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'list_terminals':
        return this.terminalManager.list();

      case 'get_terminal_buffer':
        return this.terminalManager.getBuffer(
          input.terminal_id as string,
          (input.lines as number) || 50
        );

      case 'send_to_terminal':
        this.terminalManager.send(input.terminal_id as string, input.message as string);
        return { success: true };

      case 'spawn_terminal': {
        let cwd = input.cwd as string;

        // Resolve relative paths against the projects directory
        if (!isAbsolute(cwd)) {
          cwd = resolve(PROJECTS_DIR, cwd);
        }

        // Validate path exists
        if (!existsSync(cwd)) {
          return { error: `Directory does not exist: ${cwd}. Please use a valid absolute path.` };
        }

        const options: SpawnOptions = {
          cwd,
          model: input.model as string,
          permissionMode: input.permission_mode as PermissionMode,
          dangerouslySkipPermissions: input.dangerously_skip_permissions as boolean,
        };
        const terminal = this.terminalManager.spawn(options);
        return terminal;
      }

      case 'kill_terminal':
        this.terminalManager.kill(input.terminal_id as string);
        return { success: true };

      case 'set_permission_mode':
        this.terminalManager.setPermissionMode(
          input.terminal_id as string,
          input.mode as PermissionMode
        );
        return { success: true };

      case 'search_history':
        return await this.historyService.searchMessages(
          input.query as string,
          undefined,
          (input.limit as number) || 10
        );

      case 'sleep':
        return this.startSleep(input);

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  private startSleep(input: Record<string, unknown>): { status: string; conditions: WakeCondition[] } {
    log.info('Starting sleep', input);
    this.sleeping = true;
    this.wakeConditions = [];

    if (input.timeout_ms) {
      this.wakeConditions.push({
        type: 'timeout',
        timeoutMs: input.timeout_ms as number,
      });

      setTimeout(() => {
        if (this.sleeping) {
          this.wake();
        }
      }, input.timeout_ms as number);
    }

    if (input.wake_on_terminal_complete) {
      this.wakeConditions.push({
        type: 'terminal_complete',
        terminalId: input.wake_on_terminal_complete as string,
      });
    }

    if (input.wake_on_terminal_error) {
      this.wakeConditions.push({
        type: 'terminal_error',
        terminalId: input.wake_on_terminal_error as string,
      });
    }

    if (input.wake_on_terminal_input) {
      this.wakeConditions.push({
        type: 'terminal_input_needed',
        terminalId: input.wake_on_terminal_input as string,
      });
    }

    this.updateStatus('sleeping');
    this.emit('sleeping', this.wakeConditions);

    return {
      status: 'sleeping',
      conditions: this.wakeConditions,
    };
  }

  private checkWakeConditions(terminalId: string, statusOrCode: string | number): void {
    if (!this.sleeping) return;

    for (const condition of this.wakeConditions) {
      if (condition.terminalId !== terminalId) continue;

      if (condition.type === 'terminal_complete' && statusOrCode === 'idle') {
        this.wake();
        return;
      }

      if (condition.type === 'terminal_error' && statusOrCode === 'error') {
        this.wake();
        return;
      }

      if (condition.type === 'terminal_input_needed' && statusOrCode === 'waiting_input') {
        this.wake();
        return;
      }
    }
  }

  wake(): void {
    if (!this.sleeping) return;

    log.info('Waking up');
    this.sleeping = false;
    this.wakeConditions = [];
    this.updateStatus('idle');
    this.emit('awake');

    if (this.wakeResolver) {
      this.wakeResolver();
      this.wakeResolver = null;
    }
  }

  private updateStatus(status: OverseerStatus): void {
    if (this.status !== status) {
      log.debug('Status change', { from: this.status, to: status });
      this.status = status;
      this.emit('status', status);
    }
  }

  private emitMessage(message: OverseerMessage): void {
    // Store message in active thread (except user messages which are already stored in chat())
    if (this.activeThreadId && message.role !== 'user') {
      const threadData = this.threads.get(this.activeThreadId);
      if (threadData) {
        threadData.displayMessages.push(message);
        threadData.metadata.lastMessageAt = Date.now();
        threadData.metadata.messageCount++;
      }
    }

    this.emit('message', message);
  }

  getStatus(): OverseerStatus {
    return this.status;
  }

  isSleeping(): boolean {
    return this.sleeping;
  }

  getWakeConditions(): WakeCondition[] {
    return this.wakeConditions;
  }

  clearHistory(): void {
    if (this.activeThreadId) {
      const threadData = this.threads.get(this.activeThreadId);
      if (threadData) {
        threadData.conversationHistory = [];
        threadData.displayMessages = [];
        threadData.metadata.messageCount = 0;
        log.info('Cleared active thread history', { threadId: this.activeThreadId });
      }
    }
    this.conversationHistory = [];
    this.emit('cleared');
  }

  setModel(model: string): void {
    this.model = model;
    this.emit('model', model);
  }

  getModel(): string {
    return this.model;
  }

  abort(): void {
    if (this.status === 'idle') return;

    this.isAborted = true;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Also wake if sleeping
    if (this.sleeping) {
      this.sleeping = false;
      this.wakeConditions = [];
      if (this.wakeResolver) {
        this.wakeResolver();
        this.wakeResolver = null;
      }
    }

    this.updateStatus('idle');
    this.emitMessage({
      role: 'assistant',
      content: '(Operation cancelled)',
      timestamp: Date.now(),
    });
    this.emit('aborted');
  }
}
