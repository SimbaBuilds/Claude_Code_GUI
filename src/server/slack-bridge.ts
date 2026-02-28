// Slack Bridge - connects overseer to Slack via Socket Mode (no public URL needed)

import { App } from '@slack/bolt';
import { EventEmitter } from 'events';
import type { TerminalManager } from './terminal-manager';
import type { OverseerAgent } from './overseer-agent';

interface SlackConfig {
  botToken: string;      // xoxb-...
  appToken: string;      // xapp-...
  signingSecret: string;
}

export class SlackBridge extends EventEmitter {
  private app: App;
  private terminalManager: TerminalManager;
  private overseerAgent: OverseerAgent;
  private activeChannel: string | null = null;

  constructor(
    config: SlackConfig,
    terminalManager: TerminalManager,
    overseerAgent: OverseerAgent
  ) {
    super();
    this.terminalManager = terminalManager;
    this.overseerAgent = overseerAgent;

    // Initialize Slack Bolt app with Socket Mode
    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      signingSecret: config.signingSecret,
      socketMode: true,
    });

    this.setupHandlers();

    // Listen to overseer responses
    this.overseerAgent.on('message', (message: string) => {
      if (this.activeChannel) {
        this.sendMessage(this.activeChannel, message);
      }
    });
  }

  private setupHandlers(): void {
    // Handle direct messages and mentions
    this.app.event('app_mention', async ({ event, say }) => {
      const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
      console.log(`Slack: Mentioned with "${text}"`);

      this.activeChannel = event.channel;

      if (text) {
        await this.overseerAgent.chat(text);
      } else {
        await say('Hi! I\'m the Claude Code Overseer. Ask me anything about your terminals, or use `/claude-status` to check system status.');
      }
    });

    this.app.event('message', async ({ event, say }) => {
      // Only respond to DMs (not channel messages unless mentioned)
      if ((event as any).channel_type !== 'im') return;
      if ((event as any).bot_id) return; // Ignore bot messages

      const text = (event as any).text;
      console.log(`Slack: DM received "${text}"`);

      this.activeChannel = event.channel;
      await this.overseerAgent.chat(text);
    });

    // Slash command: /claude-status
    this.app.command('/claude-status', async ({ command, ack, respond }) => {
      await ack();
      const status = this.getStatusMessage();
      await respond({
        response_type: 'ephemeral',
        blocks: this.formatStatusBlocks(),
      });
    });

    // Slash command: /claude-terminals
    this.app.command('/claude-terminals', async ({ command, ack, respond }) => {
      await ack();
      await respond({
        response_type: 'ephemeral',
        blocks: this.formatTerminalBlocks(),
      });
    });

    // Slash command: /claude-spawn
    this.app.command('/claude-spawn', async ({ command, ack, respond }) => {
      await ack();
      const cwd = command.text.trim() || '~';
      try {
        const terminal = this.terminalManager.spawn({ cwd, model: 'sonnet' });
        await respond({
          response_type: 'in_channel',
          text: `:white_check_mark: Created terminal \`${terminal.id}\` in \`${cwd}\``,
        });
      } catch (error) {
        await respond({
          response_type: 'ephemeral',
          text: `:x: Failed to spawn terminal: ${error}`,
        });
      }
    });

    // Slash command: /claude-kill
    this.app.command('/claude-kill', async ({ command, ack, respond }) => {
      await ack();
      const terminalId = command.text.trim();
      if (!terminalId) {
        await respond({ response_type: 'ephemeral', text: ':x: Usage: /claude-kill <terminal-id>' });
        return;
      }

      const terminal = this.terminalManager.getInfo(terminalId);
      if (!terminal) {
        await respond({ response_type: 'ephemeral', text: `:x: Terminal \`${terminalId}\` not found` });
        return;
      }

      this.terminalManager.kill(terminalId);
      await respond({
        response_type: 'in_channel',
        text: `:white_check_mark: Killed terminal \`${terminalId}\``,
      });
    });

    // Slash command: /claude-chat
    this.app.command('/claude-chat', async ({ command, ack, respond }) => {
      await ack();
      const message = command.text.trim();
      if (!message) {
        await respond({ response_type: 'ephemeral', text: ':x: Usage: /claude-chat <message>' });
        return;
      }

      this.activeChannel = command.channel_id;
      await respond({ response_type: 'ephemeral', text: ':speech_balloon: Thinking...' });
      await this.overseerAgent.chat(message);
    });
  }

  private getStatusMessage(): string {
    const terminals = this.terminalManager.list();
    const overseerStatus = this.overseerAgent.getStatus();

    let message = `*System Status*\n`;
    message += `Overseer: ${overseerStatus}\n`;
    message += `Terminals: ${terminals.length} active\n`;

    return message;
  }

  private formatStatusBlocks(): any[] {
    const terminals = this.terminalManager.list();
    const overseerStatus = this.overseerAgent.getStatus();

    const blocks: any[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: ':robot_face: Claude Code GUI Status' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Overseer:*\n${overseerStatus}` },
          { type: 'mrkdwn', text: `*Terminals:*\n${terminals.length} active` },
        ],
      },
    ];

    if (terminals.length > 0) {
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '*Terminal Details:*' },
      });

      for (const t of terminals) {
        const statusEmoji =
          t.status === 'idle' ? ':large_green_circle:' :
          t.status === 'thinking' ? ':large_yellow_circle:' :
          t.status === 'running_tool' ? ':large_blue_circle:' : ':white_circle:';

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${statusEmoji} *${t.id}*\n_${t.cwd}_ | ${t.model} | ${t.status}`,
          },
        });
      }
    }

    return blocks;
  }

  private formatTerminalBlocks(): any[] {
    const terminals = this.terminalManager.list();

    if (terminals.length === 0) {
      return [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: ':inbox_tray: No active terminals.\n\nUse `/claude-spawn <path>` to create one.' },
        },
      ];
    }

    const blocks: any[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `:computer: Active Terminals (${terminals.length})` },
      },
    ];

    for (const t of terminals) {
      const statusEmoji =
        t.status === 'idle' ? ':large_green_circle:' :
        t.status === 'thinking' ? ':large_yellow_circle:' :
        t.status === 'running_tool' ? ':large_blue_circle:' : ':white_circle:';

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${statusEmoji} *${t.id}*\n> Status: ${t.status}\n> Model: ${t.model}\n> Path: \`${t.cwd}\``,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: ':x: Kill' },
          action_id: `kill_terminal_${t.id}`,
          value: t.id,
          style: 'danger',
        },
      });
    }

    return blocks;
  }

  async start(): Promise<void> {
    await this.app.start();
    console.log('Slack: Connected via Socket Mode');
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }

  async sendMessage(channel: string, text: string): Promise<void> {
    try {
      await this.app.client.chat.postMessage({
        channel,
        text,
        mrkdwn: true,
      });
    } catch (error) {
      console.error('Slack: Failed to send message:', error);
    }
  }

  async sendAlert(text: string): Promise<void> {
    if (this.activeChannel) {
      await this.sendMessage(this.activeChannel, `:rotating_light: *Alert*\n\n${text}`);
    }
  }
}
