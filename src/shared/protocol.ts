// WebSocket protocol message types

import type {
  TerminalInfo,
  TerminalStatus,
  SpawnOptions,
  ClaudeMessage,
  Session,
  HistoryMessage,
  OverseerMessage,
  OverseerStatus,
  WakeCondition,
  PermissionMode,
  LayoutConfig,
  DiscoveredSession,
} from './types';

// Client -> Server messages
export type ClientMessage =
  | { type: 'terminal:spawn'; options: SpawnOptions }
  | { type: 'terminal:input'; id: string; data: string }
  | { type: 'terminal:key'; id: string; key: SpecialKey }
  | { type: 'terminal:resize'; id: string; cols: number; rows: number }
  | { type: 'terminal:kill'; id: string }
  | { type: 'terminal:setMode'; id: string; mode: PermissionMode }
  | { type: 'overseer:chat'; message: string }
  | { type: 'overseer:wake' }
  | { type: 'overseer:abort' }
  | { type: 'overseer:clear' }
  | { type: 'overseer:setModel'; model: string }
  | { type: 'history:search'; query: string }
  | { type: 'history:getSessions'; limit?: number; offset?: number }
  | { type: 'history:getMessages'; sessionId: string }
  | { type: 'history:sync' }
  | { type: 'sessions:discover'; limit?: number }
  | { type: 'sessions:resume'; sessionId: string; projectPath: string }
  | { type: 'layout:save'; layout: LayoutConfig }
  | { type: 'layout:load' };

// Special keys that need to be sent as escape sequences
export type SpecialKey =
  | 'shift+tab'
  | 'ctrl+c'
  | 'ctrl+d'
  | 'escape'
  | 'enter'
  | 'tab'
  | 'up'
  | 'down';

// Server -> Client messages
export type ServerMessage =
  | { type: 'terminal:spawned'; terminal: TerminalInfo }
  | { type: 'terminal:output'; id: string; data: string }
  | { type: 'terminal:message'; id: string; message: ClaudeMessage }
  | { type: 'terminal:status'; id: string; status: TerminalStatus }
  | { type: 'terminal:mode'; id: string; mode: PermissionMode }
  | { type: 'terminal:killed'; id: string }
  | { type: 'terminal:error'; id: string; error: string }
  | { type: 'terminal:list'; terminals: TerminalInfo[] }
  | { type: 'overseer:message'; message: OverseerMessage }
  | { type: 'overseer:status'; status: OverseerStatus }
  | { type: 'overseer:sleeping'; conditions: WakeCondition[] }
  | { type: 'overseer:awake' }
  | { type: 'overseer:aborted' }
  | { type: 'overseer:cleared' }
  | { type: 'overseer:model'; model: string }
  | { type: 'history:sessions'; sessions: Session[] }
  | { type: 'history:messages'; sessionId: string; messages: HistoryMessage[] }
  | { type: 'history:searchResults'; results: SearchResult[] }
  | { type: 'history:syncComplete'; sessionCount: number }
  | { type: 'layout:loaded'; layout: LayoutConfig | null }
  | { type: 'sessions:discovered'; sessions: DiscoveredSession[] }
  | { type: 'error'; error: string };

export interface SearchResult {
  type: 'session' | 'message';
  session: Session;
  message?: HistoryMessage;
  highlight?: string;
}
