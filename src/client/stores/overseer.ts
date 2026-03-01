// Overseer agent state management

import { create } from 'zustand';
import type { OverseerMessage, OverseerStatus, WakeCondition } from '../../shared/types';
import type { ClientMessage, ServerMessage } from '../../shared/protocol';
import { DEFAULT_OVERSEER_MODEL } from '../../shared/constants';

interface OverseerState {
  status: OverseerStatus;
  messages: OverseerMessage[];
  wakeConditions: WakeCondition[];
  panelOpen: boolean;
  model: string;

  // Actions
  chat: (message: string, ws: WebSocket | null) => void;
  wake: (ws: WebSocket | null) => void;
  abort: (ws: WebSocket | null) => void;
  clearChat: (ws: WebSocket | null) => void;
  togglePanel: () => void;
  setPanel: (open: boolean) => void;
  setModel: (model: string, ws: WebSocket | null) => void;

  // Internal
  handleMessage: (message: ServerMessage) => void;
}

export const useOverseerStore = create<OverseerState>((set, get) => ({
  status: 'idle',
  messages: [],
  wakeConditions: [],
  panelOpen: true,
  model: DEFAULT_OVERSEER_MODEL,

  chat: (message, ws) => {
    if (!ws) return;

    const clientMessage: ClientMessage = { type: 'overseer:chat', message };
    ws.send(JSON.stringify(clientMessage));
  },

  wake: (ws) => {
    if (!ws) return;

    const clientMessage: ClientMessage = { type: 'overseer:wake' };
    ws.send(JSON.stringify(clientMessage));
  },

  abort: (ws) => {
    if (!ws) return;

    const clientMessage: ClientMessage = { type: 'overseer:abort' };
    ws.send(JSON.stringify(clientMessage));
  },

  clearChat: (ws) => {
    if (!ws) return;

    const clientMessage: ClientMessage = { type: 'overseer:clear' };
    ws.send(JSON.stringify(clientMessage));
  },

  togglePanel: () => {
    set((state) => ({ panelOpen: !state.panelOpen }));
  },

  setPanel: (open) => {
    set({ panelOpen: open });
  },

  setModel: (model, ws) => {
    if (!ws) return;

    const clientMessage: ClientMessage = { type: 'overseer:setModel', model };
    ws.send(JSON.stringify(clientMessage));
    // Optimistically update local state
    set({ model });
  },

  handleMessage: (message) => {
    switch (message.type) {
      case 'overseer:message': {
        set((state) => ({
          messages: [...state.messages, message.message],
        }));
        break;
      }

      case 'overseer:status': {
        set({ status: message.status });
        break;
      }

      case 'overseer:sleeping': {
        set({ status: 'sleeping', wakeConditions: message.conditions });
        break;
      }

      case 'overseer:awake': {
        set({ status: 'idle', wakeConditions: [] });
        break;
      }

      case 'overseer:cleared': {
        set({ messages: [] });
        break;
      }

      case 'overseer:aborted': {
        set({ status: 'idle', wakeConditions: [] });
        break;
      }

      case 'overseer:model': {
        set({ model: message.model });
        break;
      }
    }
  },
}));
