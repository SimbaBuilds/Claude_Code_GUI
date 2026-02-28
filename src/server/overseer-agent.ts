// Overseer Agent - monitors and controls Claude Code terminals

import Anthropic from '@anthropic-ai/sdk';
import { EventEmitter } from 'events';
import type { TerminalManager } from './terminal-manager';
import type { HistoryService } from './history-service';
import type {
  OverseerMessage,
  OverseerStatus,
  WakeCondition,
  SpawnOptions,
  PermissionMode,
} from '../shared/types';

const SYSTEM_PROMPT = `You are an overseer agent managing multiple Claude Code terminal sessions in a GUI application.

You have access to these tools to monitor and control the terminals:

1. list_terminals - Get status of all active terminals
2. get_terminal_buffer - Read recent output from a specific terminal
3. send_to_terminal - Send a message or command to a terminal
4. spawn_terminal - Create a new Claude Code terminal
5. kill_terminal - Terminate a terminal
6. set_permission_mode - Change a terminal's permission mode (default, acceptEdits, bypassPermissions, plan)
7. search_history - Search past chat sessions
8. sleep - Pause your execution and wait for conditions to be met

Your responsibilities:
1. Monitor ongoing work across all terminals
2. Coordinate tasks when the user asks (e.g., "have terminal 1 build while terminal 2 runs tests")
3. Summarize progress across terminals
4. Alert if something seems stuck or errored
5. Execute multi-terminal workflows autonomously

When you need to wait for a terminal to complete a task, use the sleep tool with appropriate wake conditions.
You can wake on: timeout, terminal completing, terminal error, or terminal needing input.

Be concise in your responses. Focus on status updates and actions.`;

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
    description: 'Pause execution and wait for conditions. Use this when waiting for terminals to complete tasks.',
    input_schema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number', description: 'Max time to sleep in milliseconds' },
        wake_on_terminal_complete: {
          type: 'string',
          description: 'Terminal ID to wake when it completes',
        },
        wake_on_terminal_error: {
          type: 'string',
          description: 'Terminal ID to wake when it errors',
        },
        wake_on_terminal_input: {
          type: 'string',
          description: 'Terminal ID to wake when it needs input',
        },
      },
    },
  },
];

export class OverseerAgent extends EventEmitter {
  private client: Anthropic;
  private terminalManager: TerminalManager;
  private historyService: HistoryService;
  private conversationHistory: Anthropic.MessageParam[] = [];
  private status: OverseerStatus = 'idle';
  private sleeping = false;
  private wakeConditions: WakeCondition[] = [];
  private wakeResolver: (() => void) | null = null;

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
  }

  async chat(userMessage: string): Promise<void> {
    if (this.sleeping) {
      this.wake();
    }

    this.updateStatus('thinking');

    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    this.emitMessage({
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    await this.runAgentLoop();
  }

  private async runAgentLoop(): Promise<void> {
    while (true) {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS as Anthropic.Tool[],
        messages: this.conversationHistory,
      });

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

      // Execute tools
      this.updateStatus('acting');
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUses) {
        const result = await this.executeTool(toolUse.name, toolUse.input as Record<string, unknown>);

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
          content: typeof result === 'string' ? result : JSON.stringify(result),
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
        const options: SpawnOptions = {
          cwd: input.cwd as string,
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
      this.status = status;
      this.emit('status', status);
    }
  }

  private emitMessage(message: OverseerMessage): void {
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
}
