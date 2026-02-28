// Layout state management with persistence

import { create } from 'zustand';
import type { LayoutConfig, TerminalLayoutItem } from '../../shared/types';
import type { ClientMessage, ServerMessage } from '../../shared/protocol';
import { DEFAULT_LAYOUT } from '../../shared/constants';

interface LayoutState extends LayoutConfig {
  // Actions
  load: (ws: WebSocket | null) => void;
  save: (ws: WebSocket | null) => void;
  setGridSize: (cols: number, rows: number) => void;
  addTerminal: (item: TerminalLayoutItem) => void;
  removeTerminal: (id: string) => void;
  updateTerminal: (id: string, updates: Partial<TerminalLayoutItem>) => void;
  setHistorySidebar: (open: boolean, width?: number) => void;
  setOverseerPanel: (open: boolean, height?: number) => void;

  // Internal
  handleMessage: (message: ServerMessage) => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  ...DEFAULT_LAYOUT,

  load: (ws) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const message: ClientMessage = { type: 'layout:load' };
    ws.send(JSON.stringify(message));
  },

  save: (ws) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const state = get();
    const layout: LayoutConfig = {
      gridCols: state.gridCols,
      gridRows: state.gridRows,
      terminals: state.terminals,
      historySidebarOpen: state.historySidebarOpen,
      historySidebarWidth: state.historySidebarWidth,
      overseerPanelOpen: state.overseerPanelOpen,
      overseerPanelHeight: state.overseerPanelHeight,
    };

    const message: ClientMessage = { type: 'layout:save', layout };
    ws.send(JSON.stringify(message));
  },

  setGridSize: (cols, rows) => {
    set({ gridCols: cols, gridRows: rows });
  },

  addTerminal: (item) => {
    set((state) => ({
      terminals: [...state.terminals, item],
    }));
  },

  removeTerminal: (id) => {
    set((state) => ({
      terminals: state.terminals.filter((t) => t.id !== id),
    }));
  },

  updateTerminal: (id, updates) => {
    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    }));
  },

  setHistorySidebar: (open, width) => {
    set((state) => ({
      historySidebarOpen: open,
      historySidebarWidth: width ?? state.historySidebarWidth,
    }));
  },

  setOverseerPanel: (open, height) => {
    set((state) => ({
      overseerPanelOpen: open,
      overseerPanelHeight: height ?? state.overseerPanelHeight,
    }));
  },

  handleMessage: (message) => {
    if (message.type === 'layout:loaded' && message.layout) {
      set(message.layout);
    }
  },
}));
