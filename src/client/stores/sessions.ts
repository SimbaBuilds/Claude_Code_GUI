// Session discovery state management with Zustand

import { create } from 'zustand';
import type { DiscoveredSession } from '../../shared/types';
import type { ClientMessage, ServerMessage } from '../../shared/protocol';

interface SessionsState {
  sessions: DiscoveredSession[];
  loading: boolean;
  isOpen: boolean;

  // Actions
  discover: (ws: WebSocket | null, limit?: number) => void;
  resume: (ws: WebSocket | null, session: DiscoveredSession) => void;
  setOpen: (open: boolean) => void;
  handleMessage: (message: ServerMessage) => void;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  loading: false,
  isOpen: false,

  discover: (ws, limit = 50) => {
    if (!ws) return;

    set({ loading: true });
    const message: ClientMessage = { type: 'sessions:discover', limit };
    ws.send(JSON.stringify(message));
  },

  resume: (ws, session) => {
    if (!ws) return;

    const message: ClientMessage = {
      type: 'sessions:resume',
      sessionId: session.id,
      projectPath: session.projectPath,
    };
    ws.send(JSON.stringify(message));

    // Close the browser after resuming
    set({ isOpen: false });
  },

  setOpen: (open) => {
    set({ isOpen: open });
  },

  handleMessage: (message) => {
    if (message.type === 'sessions:discovered') {
      set({ sessions: message.sessions, loading: false });
    }
  },
}));
