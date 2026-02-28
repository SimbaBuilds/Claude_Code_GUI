// Main server entry point - HTTP + WebSocket server

import { join } from 'path';
import { readFile, mkdir } from 'fs/promises';
import { homedir } from 'os';
import type { ServerWebSocket } from 'bun';
import { TerminalManager } from './terminal-manager';
import { HistoryService } from './history-service';
import { OverseerAgent } from './overseer-agent';
import { TelegramBridge } from './telegram-bridge';
import { SlackBridge } from './slack-bridge';
import type { ClientMessage, ServerMessage } from '../shared/protocol';
import type { LayoutConfig } from '../shared/types';

const PORT = process.env.PORT || 3000;

// Telegram config
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Slack config
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;       // xoxb-...
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;       // xapp-...
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const DATA_DIR = join(homedir(), '.claude-code-gui');
const DB_PATH = join(DATA_DIR, 'history.db');
const LAYOUT_PATH = join(DATA_DIR, 'layout.json');

// Ensure data directory exists
await mkdir(DATA_DIR, { recursive: true });

// Initialize services
const terminalManager = new TerminalManager();
const historyService = new HistoryService(DB_PATH);
const overseerAgent = new OverseerAgent(terminalManager, historyService);

// Start history sync
await historyService.startWatching();

// Initialize Telegram bridge if token is provided
let telegramBridge: TelegramBridge | null = null;
if (TELEGRAM_BOT_TOKEN) {
  const allowedChatIds = TELEGRAM_CHAT_ID ? [parseInt(TELEGRAM_CHAT_ID, 10)] : [];
  telegramBridge = new TelegramBridge(
    { botToken: TELEGRAM_BOT_TOKEN, allowedChatIds },
    terminalManager,
    overseerAgent
  );
  await telegramBridge.start();
} else {
  console.log('Telegram: No bot token provided. Set TELEGRAM_BOT_TOKEN to enable.');
}

// Initialize Slack bridge if tokens are provided
let slackBridge: SlackBridge | null = null;
if (SLACK_BOT_TOKEN && SLACK_APP_TOKEN && SLACK_SIGNING_SECRET) {
  slackBridge = new SlackBridge(
    {
      botToken: SLACK_BOT_TOKEN,
      appToken: SLACK_APP_TOKEN,
      signingSecret: SLACK_SIGNING_SECRET,
    },
    terminalManager,
    overseerAgent
  );
  await slackBridge.start();
} else {
  console.log('Slack: Missing tokens. Set SLACK_BOT_TOKEN, SLACK_APP_TOKEN, and SLACK_SIGNING_SECRET to enable.');
}

// Track connected WebSocket clients
type WS = ServerWebSocket<unknown>;
const clients = new Set<WS>();

// Broadcast to all clients
function broadcast(message: ServerMessage): void {
  const data = JSON.stringify(message);
  for (const client of clients) {
    client.send(data);
  }
}

// Send to specific client
function send(ws: WS, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}

// Wire up terminal manager events
terminalManager.on('output', (id: string, data: string) => {
  broadcast({ type: 'terminal:output', id, data });
});

terminalManager.on('message', (id: string, message) => {
  broadcast({ type: 'terminal:message', id, message });
});

terminalManager.on('status', (id: string, status) => {
  broadcast({ type: 'terminal:status', id, status });
});

terminalManager.on('mode', (id: string, mode) => {
  broadcast({ type: 'terminal:mode', id, mode });
});

terminalManager.on('killed', (id: string) => {
  broadcast({ type: 'terminal:killed', id });
});

terminalManager.on('exit', (id: string) => {
  broadcast({ type: 'terminal:killed', id });
});

// Wire up overseer events
overseerAgent.on('message', (message) => {
  broadcast({ type: 'overseer:message', message });
});

overseerAgent.on('status', (status) => {
  broadcast({ type: 'overseer:status', status });
});

overseerAgent.on('sleeping', (conditions) => {
  broadcast({ type: 'overseer:sleeping', conditions });
});

overseerAgent.on('awake', () => {
  broadcast({ type: 'overseer:awake' });
});

// Wire up history events
historyService.on('syncComplete', (sessionCount: number) => {
  broadcast({ type: 'history:syncComplete', sessionCount });
});

// Handle WebSocket messages
async function handleMessage(ws: WS, message: ClientMessage): Promise<void> {
  console.log('Received message:', message.type);
  try {
    switch (message.type) {
      case 'terminal:spawn': {
        console.log('Spawning terminal with options:', message.options);
        const terminal = terminalManager.spawn(message.options);
        console.log('Terminal spawned:', terminal);
        send(ws, { type: 'terminal:spawned', terminal });
        break;
      }

      case 'terminal:input': {
        await terminalManager.send(message.id, message.data);
        break;
      }

      case 'terminal:key': {
        terminalManager.sendKey(message.id, message.key);
        break;
      }

      case 'terminal:resize': {
        terminalManager.resize(message.id, message.cols, message.rows);
        break;
      }

      case 'terminal:kill': {
        terminalManager.kill(message.id);
        break;
      }

      case 'terminal:setMode': {
        terminalManager.setPermissionMode(message.id, message.mode);
        break;
      }

      case 'overseer:chat': {
        await overseerAgent.chat(message.message);
        break;
      }

      case 'overseer:wake': {
        overseerAgent.wake();
        break;
      }

      case 'history:search': {
        const results = await historyService.searchMessages(message.query);
        send(ws, { type: 'history:searchResults', results });
        break;
      }

      case 'history:getSessions': {
        const sessions = historyService.getSessions(message.limit, message.offset);
        console.log(`history:getSessions returning ${sessions.length} sessions`);
        send(ws, { type: 'history:sessions', sessions });
        break;
      }

      case 'history:getMessages': {
        const messages = historyService.getMessages(message.sessionId);
        send(ws, { type: 'history:messages', sessionId: message.sessionId, messages });
        break;
      }

      case 'history:sync': {
        const count = await historyService.sync();
        send(ws, { type: 'history:syncComplete', sessionCount: count });
        break;
      }

      case 'layout:save': {
        await Bun.write(LAYOUT_PATH, JSON.stringify(message.layout, null, 2));
        break;
      }

      case 'layout:load': {
        try {
          const content = await readFile(LAYOUT_PATH, 'utf-8');
          const layout = JSON.parse(content) as LayoutConfig;
          send(ws, { type: 'layout:loaded', layout });
        } catch {
          send(ws, { type: 'layout:loaded', layout: null });
        }
        break;
      }

      default:
        send(ws, { type: 'error', error: `Unknown message type: ${(message as { type: string }).type}` });
    }
  } catch (error) {
    console.error('Error handling message:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    send(ws, { type: 'error', error: errorMessage });
  }
}

// Build static file path - serve from dist in production, src for dev
const CLIENT_DIR = join(import.meta.dir, '..', '..', 'dist', 'client');

// Bun server
const server = Bun.serve({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    // API endpoints
    if (url.pathname === '/api/terminals') {
      return Response.json(terminalManager.list());
    }

    if (url.pathname === '/api/overseer/status') {
      return Response.json({
        status: overseerAgent.getStatus(),
        sleeping: overseerAgent.isSleeping(),
        wakeConditions: overseerAgent.getWakeConditions(),
      });
    }

    // Static files
    let filePath = url.pathname;
    if (filePath === '/') filePath = '/index.html';

    try {
      const file = Bun.file(join(CLIENT_DIR, filePath));
      if (await file.exists()) {
        return new Response(file);
      }
    } catch {
      // Fall through to 404
    }

    // SPA fallback
    const indexFile = Bun.file(join(CLIENT_DIR, 'index.html'));
    if (await indexFile.exists()) {
      return new Response(indexFile);
    }

    return new Response('Not found', { status: 404 });
  },

  websocket: {
    open(ws) {
      clients.add(ws);

      // Send current state
      send(ws, { type: 'terminal:list', terminals: terminalManager.list() });
      send(ws, {
        type: 'overseer:status',
        status: overseerAgent.getStatus(),
      });

      if (overseerAgent.isSleeping()) {
        send(ws, {
          type: 'overseer:sleeping',
          conditions: overseerAgent.getWakeConditions(),
        });
      }

      // Send history sessions automatically on connect
      const sessions = historyService.getSessions(50, 0);
      console.log(`WebSocket open: sending ${sessions.length} sessions`);
      send(ws, { type: 'history:sessions', sessions });
    },

    message(ws, message) {
      try {
        const data = JSON.parse(message.toString()) as ClientMessage;
        handleMessage(ws, data);
      } catch (error) {
        send(ws, {
          type: 'error',
          error: `Invalid message: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },

    close(ws) {
      clients.delete(ws);
    },
  },
});

console.log(`Claude Code GUI server running on http://localhost:${server.port}`);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  telegramBridge?.stop();
  await slackBridge?.stop();
  historyService.close();
  process.exit(0);
});
