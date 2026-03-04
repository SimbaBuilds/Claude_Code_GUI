// Terminal state management with Zustand

import { create } from 'zustand';
import type {
  TerminalInfo,
  TerminalStatus,
  ClaudeMessage,
  PermissionMode,
  SpawnOptions,
} from '../../shared/types';
import type { ClientMessage, ServerMessage, SpecialKey } from '../../shared/protocol';

interface SpawnError {
  error: string;
  cwd: string;
  timestamp: number;
}

interface TerminalState {
  terminals: Map<string, TerminalInfo>;
  messages: Map<string, ClaudeMessage[]>;
  activeTerminalId: string | null;
  ws: WebSocket | null;
  connected: boolean;
  spawnError: SpawnError | null;
  shouldReconnect: boolean;

  // Actions
  connect: () => void;
  disconnect: () => void;
  spawn: (options: SpawnOptions) => void;
  send: (id: string, input: string) => void;
  sendKey: (id: string, key: SpecialKey) => void;
  kill: (id: string) => void;
  setMode: (id: string, mode: PermissionMode) => void;
  setActive: (id: string | null) => void;
  clearSpawnError: () => void;

  // Internal
  handleMessage: (message: ServerMessage) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminals: new Map(),
  messages: new Map(),
  activeTerminalId: null,
  ws: null,
  connected: false,
  spawnError: null,
  shouldReconnect: true,

  connect: () => {
    // Close any existing connection first to prevent duplicates
    const existingWs = get().ws;
    if (existingWs && existingWs.readyState !== WebSocket.CLOSED) {
      existingWs.close();
    }

    set({ shouldReconnect: true });

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      console.log('WebSocket connected');
      set({ connected: true });
    };

    // Note: Message handling is done in App.tsx via addEventListener
    // to allow routing messages to different stores

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      set({ ws: null, connected: false });
      // Only reconnect if we should (prevents reconnect on intentional disconnect)
      if (get().shouldReconnect) {
        setTimeout(() => get().connect(), 2000);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    set({ ws });
  },

  disconnect: () => {
    const { ws } = get();
    set({ shouldReconnect: false });
    if (ws) {
      ws.close();
      set({ ws: null });
    }
  },

  spawn: (options) => {
    const { ws } = get();
    if (!ws) return;

    const message: ClientMessage = { type: 'terminal:spawn', options };
    ws.send(JSON.stringify(message));
  },

  send: (id, input) => {
    const { ws } = get();
    if (!ws) return;

    const message: ClientMessage = { type: 'terminal:input', id, data: input };
    ws.send(JSON.stringify(message));

    // Add user message to local state
    const messages = get().messages.get(id) || [];
    const userMessage: ClaudeMessage = {
      type: 'user',
      content: [{ type: 'text', text: input }],
      timestamp: Date.now(),
    };
    set((state) => ({
      messages: new Map(state.messages).set(id, [...messages, userMessage]),
    }));
  },

  sendKey: (id, key) => {
    const { ws } = get();
    if (!ws) return;

    const message: ClientMessage = { type: 'terminal:key', id, key };
    ws.send(JSON.stringify(message));
  },

  kill: (id) => {
    const { ws } = get();
    if (!ws) return;

    const message: ClientMessage = { type: 'terminal:kill', id };
    ws.send(JSON.stringify(message));
  },

  setMode: (id, mode) => {
    const { ws } = get();
    if (!ws) return;

    const message: ClientMessage = { type: 'terminal:setMode', id, mode };
    ws.send(JSON.stringify(message));
  },

  setActive: (id) => {
    set({ activeTerminalId: id });
  },

  clearSpawnError: () => {
    set({ spawnError: null });
  },

  handleMessage: (message) => {
    switch (message.type) {
      case 'terminal:spawned': {
        set((state) => {
          const terminals = new Map(state.terminals);
          terminals.set(message.terminal.id, message.terminal);
          return {
            terminals,
            activeTerminalId: state.activeTerminalId || message.terminal.id,
            spawnError: null, // Clear any previous error on successful spawn
          };
        });
        break;
      }

      case 'terminal:spawnError': {
        set({
          spawnError: {
            error: message.error,
            cwd: message.cwd,
            timestamp: Date.now(),
          },
        });
        break;
      }

      case 'terminal:list': {
        set(() => {
          const terminals = new Map<string, TerminalInfo>();
          for (const terminal of message.terminals) {
            terminals.set(terminal.id, terminal);
          }
          return { terminals };
        });
        break;
      }

      case 'terminal:message': {
        set((state) => {
          const messages = new Map(state.messages);
          const terminalMessages = messages.get(message.id) || [];
          messages.set(message.id, [...terminalMessages, message.message]);
          return { messages };
        });
        break;
      }

      case 'terminal:status': {
        set((state) => {
          const terminals = new Map(state.terminals);
          const terminal = terminals.get(message.id);
          if (terminal) {
            terminals.set(message.id, { ...terminal, status: message.status });
          }
          return { terminals };
        });
        break;
      }

      case 'terminal:mode': {
        set((state) => {
          const terminals = new Map(state.terminals);
          const terminal = terminals.get(message.id);
          if (terminal) {
            terminals.set(message.id, { ...terminal, permissionMode: message.mode });
          }
          return { terminals };
        });
        break;
      }

      case 'terminal:killed': {
        set((state) => {
          const terminals = new Map(state.terminals);
          const messages = new Map(state.messages);
          terminals.delete(message.id);
          messages.delete(message.id);

          let activeTerminalId: string | null = state.activeTerminalId;
          if (activeTerminalId === message.id) {
            const ids = Array.from(terminals.keys());
            activeTerminalId = ids[0] ?? null;
          }

          return { terminals, messages, activeTerminalId };
        });
        break;
      }

      case 'terminal:error': {
        console.error(`Terminal ${message.id} error:`, message.error);
        break;
      }
    }
  },
}));
