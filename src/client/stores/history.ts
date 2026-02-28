// History state management

import { create } from 'zustand';
import type { Session, HistoryMessage } from '../../shared/types';
import type { ClientMessage, ServerMessage, SearchResult } from '../../shared/protocol';

interface HistoryState {
  sessions: Session[];
  selectedSessionId: string | null;
  selectedSessionMessages: HistoryMessage[];
  searchQuery: string;
  searchResults: SearchResult[];
  sidebarOpen: boolean;
  loading: boolean;

  // Actions
  loadSessions: (ws: WebSocket | null) => void;
  loadMessages: (sessionId: string, ws: WebSocket | null) => void;
  search: (query: string, ws: WebSocket | null) => void;
  sync: (ws: WebSocket | null) => void;
  selectSession: (sessionId: string | null) => void;
  toggleSidebar: () => void;
  setSidebar: (open: boolean) => void;
  setSearchQuery: (query: string) => void;

  // Internal
  handleMessage: (message: ServerMessage) => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  sessions: [],
  selectedSessionId: null,
  selectedSessionMessages: [],
  searchQuery: '',
  searchResults: [],
  sidebarOpen: true,
  loading: false,

  loadSessions: (ws) => {
    console.log('loadSessions called, ws ready:', ws?.readyState === WebSocket.OPEN);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    set({ loading: true });
    const message: ClientMessage = { type: 'history:getSessions', limit: 50 };
    console.log('Sending history:getSessions message');
    ws.send(JSON.stringify(message));
  },

  loadMessages: (sessionId, ws) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    set({ loading: true, selectedSessionId: sessionId });
    const message: ClientMessage = { type: 'history:getMessages', sessionId };
    ws.send(JSON.stringify(message));
  },

  search: (query, ws) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    set({ loading: true, searchQuery: query });

    if (query.trim()) {
      const message: ClientMessage = { type: 'history:search', query };
      ws.send(JSON.stringify(message));
    } else {
      set({ searchResults: [], loading: false });
    }
  },

  sync: (ws) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    set({ loading: true });
    const message: ClientMessage = { type: 'history:sync' };
    ws.send(JSON.stringify(message));
  },

  selectSession: (sessionId) => {
    set({ selectedSessionId: sessionId, selectedSessionMessages: [] });
  },

  toggleSidebar: () => {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }));
  },

  setSidebar: (open) => {
    set({ sidebarOpen: open });
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query });
  },

  handleMessage: (message) => {
    console.log('History store received:', message.type, message);
    switch (message.type) {
      case 'history:sessions': {
        console.log('Setting sessions:', message.sessions?.length, 'sessions');
        set({ sessions: message.sessions, loading: false });
        break;
      }

      case 'history:messages': {
        if (message.sessionId === get().selectedSessionId) {
          set({ selectedSessionMessages: message.messages, loading: false });
        }
        break;
      }

      case 'history:searchResults': {
        set({ searchResults: message.results, loading: false });
        break;
      }

      case 'history:syncComplete': {
        set({ loading: false });
        // Reload sessions after sync
        break;
      }
    }
  },
}));
