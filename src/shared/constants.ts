// Slash commands supported by Claude Code

export interface SlashCommand {
  name: string;
  description: string;
  args?: string;
}

export const CLAUDE_SLASH_COMMANDS: SlashCommand[] = [
  { name: '/help', description: 'Show help information' },
  { name: '/clear', description: 'Clear conversation history' },
  { name: '/compact', description: 'Compact conversation to save context' },
  { name: '/config', description: 'Open configuration settings' },
  { name: '/cost', description: 'Show token usage and costs' },
  { name: '/doctor', description: 'Run health diagnostics' },
  { name: '/init', description: 'Initialize project with CLAUDE.md' },
  { name: '/login', description: 'Authenticate with Anthropic' },
  { name: '/logout', description: 'Sign out of current session' },
  { name: '/memory', description: 'Edit CLAUDE.md memory file' },
  { name: '/model', description: 'Switch AI model', args: '<model>' },
  { name: '/permissions', description: 'Manage tool permissions' },
  { name: '/review', description: 'Request code review' },
  { name: '/status', description: 'Show session status' },
  { name: '/terminal', description: 'Show terminal information' },
  { name: '/vim', description: 'Toggle vim keybindings' },
  { name: '/bug', description: 'Report a bug' },
  { name: '/pr-comments', description: 'Fetch PR comments' },
];

// GUI-specific slash commands
export const GUI_SLASH_COMMANDS: SlashCommand[] = [
  { name: '/new', description: 'Spawn a new terminal' },
  { name: '/close', description: 'Close current terminal' },
  { name: '/overseer', description: 'Focus overseer panel' },
  { name: '/history', description: 'Toggle history sidebar' },
  { name: '/layout', description: 'Manage layout', args: '<save|reset>' },
];

export const ALL_SLASH_COMMANDS = [...CLAUDE_SLASH_COMMANDS, ...GUI_SLASH_COMMANDS];

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

// Default models
export const MODELS = [
  { id: 'opus', name: 'Claude Opus 4.5', description: 'Most capable' },
  { id: 'sonnet', name: 'Claude Sonnet 4', description: 'Balanced' },
  { id: 'haiku', name: 'Claude Haiku 3.5', description: 'Fastest' },
];

export const DEFAULT_MODEL = 'sonnet';

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
