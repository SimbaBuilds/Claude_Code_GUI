// Slash commands supported by Claude Code
// Only includes commands that work in --print mode (non-interactive)

export interface SlashCommand {
  name: string;
  description: string;
  args?: string;
}

// Commands that work in --print mode and provide unique value
// (can't be replicated by GUI - require Claude Code internal state)
export const CLAUDE_SLASH_COMMANDS: SlashCommand[] = [
  // Unique monitoring (can't replicate - Claude Code internals)
  { name: '/context', description: 'Show context window usage' },
  { name: '/usage', description: 'Show plan limits and rate status' },
  { name: '/cost', description: 'Show token usage and costs' },
  { name: '/stats', description: 'Show usage statistics' },
  { name: '/todos', description: 'Show current task list' },

  // Context management (works in --print mode)
  { name: '/compact', description: 'Compact conversation to save context', args: '[focus]' },
  { name: '/clear', description: 'Clear conversation history' },

  // Diagnostics (works in --print mode)
  { name: '/doctor', description: 'Check Claude Code health' },
  { name: '/debug', description: 'Troubleshoot session', args: '[issue]' },

  // Project setup (works in --print mode)
  { name: '/init', description: 'Initialize CLAUDE.md' },

  // Mode switching (works in --print mode)
  { name: '/plan', description: 'Enter plan mode' },
];

// Note: These commands are INTERACTIVE and don't work well in --print mode.
// The GUI provides alternatives for these:
// - /resume → "Resume Session" button
// - /model → Model dropdown in header
// - /config, /permissions, /theme → Future: Settings panel
// - /memory → Future: CLAUDE.md editor
// - /rewind, /copy, /export → Future: GUI controls

// All commands shown in autocomplete (just Claude commands for now)
export const ALL_SLASH_COMMANDS = CLAUDE_SLASH_COMMANDS;

// Key escape sequences for PTY
export const KEY_SEQUENCES: Record<string, string> = {
  'shift+tab': '\x1b[Z',
  'ctrl+c': '\x03',
  'ctrl+d': '\x04',
  'escape': '\x1b',
  'enter': '\r',
  'tab': '\t',
  'up': '\x1b[A',
  'down': '\x1b[B',
};

// Default models for Claude Code terminals
export const MODELS = [
  { id: 'opus', name: 'Claude Opus 4.5', description: 'Most capable' },
  { id: 'sonnet', name: 'Claude Sonnet 4.5', description: 'Balanced' },
  { id: 'haiku', name: 'Claude Haiku 4.5', description: 'Fastest' },
];

export const DEFAULT_MODEL = 'sonnet';

// Models for Overseer agent (uses full API model IDs)
export const OVERSEER_MODELS = [
  { id: 'claude-opus-4-5-20250929', name: 'Opus 4.5', description: 'Most capable' },
  { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5', description: 'Balanced' },
  { id: 'claude-haiku-3-5-20241022', name: 'Haiku 3.5', description: 'Fastest' },
];

export const DEFAULT_OVERSEER_MODEL = 'claude-sonnet-4-5-20250929';

// Layout defaults
export const DEFAULT_LAYOUT = {
  gridCols: 2,
  gridRows: 2,
  terminals: [],
  historySidebarOpen: true,
  historySidebarWidth: 300,
  overseerPanelOpen: true,
  overseerPanelHeight: 200,
};

export const MAX_TERMINALS = 10;
