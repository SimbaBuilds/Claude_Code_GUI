// Main server entry point - HTTP + WebSocket server
// Testing GUI interaction - Claude Code GUI is working!

// Global error handlers to prevent process crashes
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
});

import { join } from 'path';
import { readFile, mkdir } from 'fs/promises';
import { homedir } from 'os';
import type { ServerWebSocket } from 'bun';
import { TerminalManager } from './terminal-manager';
import { HistoryService } from './history-service';
import { OverseerAgent } from './overseer-agent';
import { SessionDiscoveryService } from './session-discovery';
import { TelegramBridge } from './telegram-bridge';
import { SlackBridge } from './slack-bridge';
import { serverLogger as log } from './logger';
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
const sessionDiscovery = new SessionDiscoveryService();

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
  log.info('Telegram: No bot token provided. Set TELEGRAM_BOT_TOKEN to enable.');
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
  log.info('Slack: Missing tokens. Set SLACK_BOT_TOKEN, SLACK_APP_TOKEN, and SLACK_SIGNING_SECRET to enable.');
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
terminalManager.on('spawned', (terminal) => {
  broadcast({ type: 'terminal:spawned', terminal });
});

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
  // When status returns to idle, broadcast updated thread list with new metadata
  if (status === 'idle') {
    broadcast({ type: 'overseer:threads', threads: overseerAgent.getThreads(10) });
  }
});

overseerAgent.on('sleeping', (conditions) => {
  broadcast({ type: 'overseer:sleeping', conditions });
});

overseerAgent.on('awake', () => {
  broadcast({ type: 'overseer:awake' });
});

overseerAgent.on('cleared', () => {
  broadcast({ type: 'overseer:cleared' });
});

overseerAgent.on('aborted', () => {
  broadcast({ type: 'overseer:aborted' });
});

overseerAgent.on('model', (model: string) => {
  broadcast({ type: 'overseer:model', model });
});

overseerAgent.on('threadCreated', (thread) => {
  broadcast({ type: 'overseer:threadCreated', thread });
});

overseerAgent.on('threadSwitched', (threadId: string, messages) => {
  broadcast({ type: 'overseer:threadSwitched', threadId, messages });
});

// Wire up history events
historyService.on('syncComplete', (sessionCount: number) => {
  broadcast({ type: 'history:syncComplete', sessionCount });
});

// Handle WebSocket messages
async function handleMessage(ws: WS, message: ClientMessage): Promise<void> {
  log.debug('WebSocket message received', { type: message.type });
  try {
    switch (message.type) {
      case 'terminal:spawn': {
        log.info('Spawning terminal', { options: message.options });
        try {
          const terminal = terminalManager.spawn(message.options);
          log.info('Terminal spawned successfully', { id: terminal.id });
          send(ws, { type: 'terminal:spawned', terminal });
        } catch (spawnError) {
          const errorMessage = spawnError instanceof Error ? spawnError.message : String(spawnError);
          log.error('Failed to spawn terminal', { error: errorMessage, cwd: message.options.cwd });
          send(ws, { type: 'terminal:spawnError', error: errorMessage, cwd: message.options.cwd });
        }
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

      case 'overseer:abort': {
        overseerAgent.abort();
        break;
      }

      case 'overseer:clear': {
        overseerAgent.clearHistory();
        break;
      }

      case 'overseer:setModel': {
        overseerAgent.setModel(message.model);
        break;
      }

      case 'overseer:listThreads': {
        const threads = overseerAgent.getThreads(10);
        send(ws, { type: 'overseer:threads', threads });
        break;
      }

      case 'overseer:switchThread': {
        try {
          overseerAgent.switchThread(message.threadId);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          send(ws, { type: 'error', error: errorMessage });
        }
        break;
      }

      case 'overseer:newThread': {
        const thread = overseerAgent.createThread('gui');
        overseerAgent.switchThread(thread.id);
        break;
      }

      case 'history:search': {
        const results = await historyService.searchMessages(message.query);
        send(ws, { type: 'history:searchResults', results });
        break;
      }

      case 'history:getSessions': {
        const sessions = historyService.getSessions(message.limit, message.offset);
        log.debug('Returning history sessions', { count: sessions.length });
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

      case 'sessions:discover': {
        const discoveredSessions = await sessionDiscovery.discoverSessions(message.limit || 50);
        // Convert Date to ISO string for serialization
        const serializedSessions = discoveredSessions.map((s) => ({
          ...s,
          lastModified: s.lastModified.toISOString(),
        }));
        send(ws, { type: 'sessions:discovered', sessions: serializedSessions });
        break;
      }

      case 'sessions:resume': {
        // Spawn terminal with resume flag
        const terminal = terminalManager.spawn({
          cwd: message.projectPath,
          resumeSessionId: message.sessionId,
        });
        broadcast({ type: 'terminal:spawned', terminal });
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
    log.error('Error handling WebSocket message', { error: String(error), stack: (error as Error).stack });
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

      try {
        // Send current state
        send(ws, { type: 'terminal:list', terminals: terminalManager.list() });
        send(ws, {
          type: 'overseer:status',
          status: overseerAgent.getStatus(),
        });
        send(ws, {
          type: 'overseer:model',
          model: overseerAgent.getModel(),
        });

        if (overseerAgent.isSleeping()) {
          send(ws, {
            type: 'overseer:sleeping',
            conditions: overseerAgent.getWakeConditions(),
          });
        }

        // Send overseer threads
        const threads = overseerAgent.getThreads(10);
        send(ws, { type: 'overseer:threads', threads });

        // Send history sessions automatically on connect
        const sessions = historyService.getSessions(50, 0);
        log.debug('WebSocket client connected', { sessionCount: sessions.length });
        send(ws, { type: 'history:sessions', sessions });
      } catch (error) {
        log.error('Error in WebSocket open handler', { error: String(error) });
      }
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

log.info(`Server started on http://localhost:${server.port}`);

// Graceful shutdown
process.on('SIGINT', async () => {
  log.info('Received SIGINT, shutting down...');
  terminalManager.shutdown();
  telegramBridge?.stop();
  await slackBridge?.stop();
  historyService.close();
  log.info('Shutdown complete');
  process.exit(0);
});

// Also handle SIGTERM for containerized deployments
process.on('SIGTERM', async () => {
  log.info('Received SIGTERM, shutting down...');
  terminalManager.shutdown();
  telegramBridge?.stop();
  await slackBridge?.stop();
  historyService.close();
  log.info('Shutdown complete');
  process.exit(0);
});
