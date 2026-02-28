// Telegram Bridge - connects overseer to Telegram Bot API

import { EventEmitter } from 'events';
import type { TerminalManager } from './terminal-manager';
import type { OverseerAgent } from './overseer-agent';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text?: string;
  };
}

interface TelegramConfig {
  botToken: string;
  allowedChatIds?: number[]; // Restrict to specific chat IDs for security
}

export class TelegramBridge extends EventEmitter {
  private botToken: string;
  private allowedChatIds: Set<number>;
  private apiBase: string;
  private lastUpdateId = 0;
  private polling = false;
  private terminalManager: TerminalManager;
  private overseerAgent: OverseerAgent;
  private activeChatId: number | null = null;

  constructor(
    config: TelegramConfig,
    terminalManager: TerminalManager,
    overseerAgent: OverseerAgent
  ) {
    super();
    this.botToken = config.botToken;
    this.allowedChatIds = new Set(config.allowedChatIds || []);
    this.apiBase = `https://api.telegram.org/bot${this.botToken}`;
    this.terminalManager = terminalManager;
    this.overseerAgent = overseerAgent;

    // Listen to overseer responses
    this.overseerAgent.on('message', (message: { role: string; content: string; timestamp: number }) => {
      if (this.activeChatId && message.role === 'assistant') {
        this.sendMessage(this.activeChatId, message.content);
      }
    });
  }

  async start(): Promise<void> {
    // Verify bot token
    const me = await this.callApi('getMe');
    if (!me.ok) {
      console.error('Telegram: Invalid bot token');
      return;
    }
    console.log(`Telegram: Connected as @${me.result.username}`);

    // Start polling
    this.polling = true;
    this.poll();
  }

  stop(): void {
    this.polling = false;
  }

  private async poll(): Promise<void> {
    while (this.polling) {
      try {
        const updates = await this.callApi('getUpdates', {
          offset: this.lastUpdateId + 1,
          timeout: 30,
        });

        if (updates.ok && updates.result.length > 0) {
          for (const update of updates.result as TelegramUpdate[]) {
            this.lastUpdateId = update.update_id;
            await this.handleUpdate(update);
          }
        }
      } catch (error) {
        console.error('Telegram polling error:', error);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (!update.message?.text) return;

    const chatId = update.message.chat.id;
    const text = update.message.text;
    const username = update.message.from.username || update.message.from.first_name;

    // Security: Check if chat is allowed (if restrictions are set)
    if (this.allowedChatIds.size > 0 && !this.allowedChatIds.has(chatId)) {
      console.log(`Telegram: Unauthorized access attempt from chat ${chatId}`);
      await this.sendMessage(chatId, '⛔ Unauthorized. Your chat ID is: ' + chatId);
      return;
    }

    // Auto-authorize first user if no restrictions set
    if (this.allowedChatIds.size === 0) {
      this.allowedChatIds.add(chatId);
      console.log(`Telegram: Auto-authorized chat ${chatId} (${username})`);
    }

    console.log(`Telegram: [${username}] ${text}`);

    // Handle commands
    if (text.startsWith('/')) {
      await this.handleCommand(chatId, text);
      return;
    }

    // Forward to overseer
    this.activeChatId = chatId;
    await this.overseerAgent.chat(text);
  }

  private async handleCommand(chatId: number, text: string): Promise<void> {
    const [command, ...args] = text.split(' ');

    switch (command) {
      case '/start':
        await this.sendMessage(
          chatId,
          `👋 *Claude Code GUI Overseer*\n\n` +
            `I can help you monitor and control your Claude Code terminals remotely.\n\n` +
            `*Commands:*\n` +
            `/status - Show all terminal statuses\n` +
            `/terminals - List active terminals\n` +
            `/spawn <path> - Create new terminal\n` +
            `/kill <id> - Close a terminal\n` +
            `/chat <message> - Chat with overseer\n\n` +
            `Or just send a message to chat with the overseer directly.`,
          { parse_mode: 'Markdown' }
        );
        break;

      case '/status':
        await this.sendStatus(chatId);
        break;

      case '/terminals':
        await this.sendTerminalList(chatId);
        break;

      case '/spawn':
        const cwd = args.join(' ') || '~';
        try {
          const terminal = this.terminalManager.spawn({ cwd, model: 'sonnet' });
          await this.sendMessage(chatId, `✅ Created terminal \`${terminal.id}\` in \`${cwd}\``, {
            parse_mode: 'Markdown',
          });
        } catch (error) {
          await this.sendMessage(chatId, `❌ Failed to spawn: ${error}`);
        }
        break;

      case '/kill':
        const terminalId = args[0];
        if (!terminalId) {
          await this.sendMessage(chatId, '❌ Usage: /kill <terminal-id>');
          return;
        }
        const terminal = this.terminalManager.getInfo(terminalId);
        if (!terminal) {
          await this.sendMessage(chatId, `❌ Terminal \`${terminalId}\` not found`, {
            parse_mode: 'Markdown',
          });
          return;
        }
        this.terminalManager.kill(terminalId);
        await this.sendMessage(chatId, `✅ Killed terminal \`${terminalId}\``, {
          parse_mode: 'Markdown',
        });
        break;

      case '/chat':
        const message = args.join(' ');
        if (!message) {
          await this.sendMessage(chatId, '❌ Usage: /chat <message>');
          return;
        }
        this.activeChatId = chatId;
        await this.overseerAgent.chat(message);
        break;

      case '/help':
        await this.handleCommand(chatId, '/start');
        break;

      default:
        await this.sendMessage(chatId, `❓ Unknown command: ${command}\nUse /help for available commands.`);
    }
  }

  private async sendStatus(chatId: number): Promise<void> {
    const terminals = this.terminalManager.list();
    const overseerStatus = this.overseerAgent.getStatus();

    let message = `📊 *System Status*\n\n`;
    message += `*Overseer:* ${overseerStatus}\n`;
    message += `*Terminals:* ${terminals.length} active\n\n`;

    if (terminals.length > 0) {
      message += `*Terminal Details:*\n`;
      for (const t of terminals) {
        const statusEmoji =
          t.status === 'idle' ? '🟢' : t.status === 'thinking' ? '🟡' : t.status === 'running_tool' ? '🔵' : '⚪';
        message += `${statusEmoji} \`${t.id}\`: ${t.status}\n`;
        message += `   📁 ${t.cwd.split('/').pop()}\n`;
      }
    }

    await this.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  private async sendTerminalList(chatId: number): Promise<void> {
    const terminals = this.terminalManager.list();

    if (terminals.length === 0) {
      await this.sendMessage(chatId, '📭 No active terminals.\n\nUse /spawn <path> to create one.');
      return;
    }

    let message = `📟 *Active Terminals (${terminals.length})*\n\n`;
    for (const t of terminals) {
      const statusEmoji =
        t.status === 'idle' ? '🟢' : t.status === 'thinking' ? '🟡' : t.status === 'running_tool' ? '🔵' : '⚪';
      message += `${statusEmoji} *${t.id}*\n`;
      message += `   Status: ${t.status}\n`;
      message += `   Model: ${t.model}\n`;
      message += `   Path: \`${t.cwd}\`\n\n`;
    }

    await this.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  async sendMessage(
    chatId: number,
    text: string,
    options: { parse_mode?: string } = {}
  ): Promise<void> {
    // Telegram has a 4096 character limit, split if necessary
    const maxLength = 4000;
    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }
      // Find a good split point
      let splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt === -1) splitAt = maxLength;
      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).trimStart();
    }

    for (const chunk of chunks) {
      await this.callApi('sendMessage', {
        chat_id: chatId,
        text: chunk,
        ...options,
      });
    }
  }

  async sendAlert(message: string): Promise<void> {
    // Send to all authorized chats
    for (const chatId of this.allowedChatIds) {
      await this.sendMessage(chatId, `🚨 *Alert*\n\n${message}`, { parse_mode: 'Markdown' });
    }
  }

  private async callApi(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const response = await fetch(`${this.apiBase}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return response.json();
  }

  // Allow adding authorized chat IDs at runtime
  authorizeChatId(chatId: number): void {
    this.allowedChatIds.add(chatId);
  }
}
