// Shared types for Claude Code GUI

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

export type TerminalStatus = 'idle' | 'thinking' | 'running_tool' | 'waiting_input' | 'error';

export interface TerminalInfo {
  id: string;
  cwd: string;
  sessionId?: string;
  permissionMode: PermissionMode;
  status: TerminalStatus;
  model: string;
  createdAt: number;
}

export interface SpawnOptions {
  cwd: string;
  continueSession?: boolean;
  resumeSessionId?: string;
  model?: string;
  permissionMode?: PermissionMode;
  dangerouslySkipPermissions?: boolean;
}

// Claude Code streaming message types
export interface ClaudeMessage {
  type: 'user' | 'assistant' | 'system';
  content: MessageContent[];
  timestamp: number;
}

export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

// History types
export interface Session {
  id: string;
  projectPath: string;
  startedAt: number;
  lastMessageAt: number;
  messageCount: number;
  summary?: string;
}

export interface HistoryMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  toolUses?: ToolUse[];
  timestamp: number;
}

export interface ToolUse {
  name: string;
  input: Record<string, unknown>;
  output?: string;
}

// Overseer types
export type OverseerStatus = 'idle' | 'thinking' | 'sleeping' | 'acting';

export interface OverseerMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  action?: OverseerAction;
}

export interface OverseerAction {
  type: 'spawn' | 'kill' | 'send' | 'toggleMode' | 'sleep';
  terminalId?: string;
  payload?: unknown;
}

export interface WakeCondition {
  type: 'timeout' | 'terminal_complete' | 'terminal_error' | 'terminal_input_needed';
  terminalId?: string;
  timeoutMs?: number;
}

// Layout persistence
export interface LayoutConfig {
  gridCols: number;
  gridRows: number;
  terminals: TerminalLayoutItem[];
  historySidebarOpen: boolean;
  historySidebarWidth: number;
  overseerPanelOpen: boolean;
  overseerPanelHeight: number;
}

export interface TerminalLayoutItem {
  id: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}
