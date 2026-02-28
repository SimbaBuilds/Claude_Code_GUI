# Claude Code GUI - Architecture Plan

## Overview

A browser-based GUI for managing multiple Claude Code sessions with an LLM overseer agent. Built with **Bun + React + TypeScript**.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Bun |
| Backend | Bun HTTP server + WebSocket |
| Frontend | React 19 + TypeScript |
| Styling | Tailwind CSS |
| State | Zustand |
| Overseer Agent | `@anthropic-ai/claude-agent-sdk` |
| PTY | `node-pty` (terminal emulation) |
| Chat History DB | SQLite (via `bun:sqlite`) |

**Estimated node_modules:** ~150MB (vs ~660MB with npm/Next.js)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (React)                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐  │
│  │  Terminal 1 │ │  Terminal 2 │ │  Terminal 3 │ │    ...    │  │
│  │  (Claude)   │ │  (Claude)   │ │  (Claude)   │ │  (up to   │  │
│  │             │ │             │ │             │ │    10)    │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Overseer Agent Panel                     ││
│  │  "Watching 3 terminals. Terminal 1 is editing files..."    ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Chat History Sidebar                     ││
│  │  [Search] ______________________                            ││
│  │  > Today                                                    ││
│  │    - Session: Fix auth bug (2h ago)                         ││
│  │    - Session: Add dark mode (5h ago)                        ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Bun Backend Server                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │ Terminal Manager │  │  Overseer Agent  │  │ History Service│ │
│  │                  │  │                  │  │                │ │
│  │ - spawn()        │  │ - watch()        │  │ - search()     │ │
│  │ - send()         │  │ - sleep()        │  │ - getSessions()│ │
│  │ - kill()         │  │ - command()      │  │ - getMessages()│ │
│  │ - resize()       │  │ - summarize()    │  │ - sync()       │ │
│  └────────┬─────────┘  └────────┬─────────┘  └───────┬────────┘ │
│           │                     │                    │          │
│           ▼                     ▼                    ▼          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │   node-pty       │  │ Claude Agent SDK │  │    SQLite      │ │
│  │   (PTY pool)     │  │                  │  │  + ~/.claude/  │ │
│  └──────────────────┘  └──────────────────┘  └────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
claude-code-gui/
├── package.json
├── bunfig.toml
├── tsconfig.json
├── tailwind.config.ts
│
├── src/
│   ├── server/                    # Bun backend
│   │   ├── index.ts               # HTTP + WebSocket server entry
│   │   ├── terminal-manager.ts    # PTY process management
│   │   ├── overseer-agent.ts      # Claude Agent SDK integration
│   │   ├── history-service.ts     # Chat history indexing/search
│   │   ├── ws-handlers.ts         # WebSocket message handlers
│   │   └── types.ts               # Shared types
│   │
│   ├── client/                    # React frontend
│   │   ├── index.html
│   │   ├── main.tsx               # React entry
│   │   ├── App.tsx                # Root component
│   │   │
│   │   ├── components/
│   │   │   ├── TerminalGrid.tsx   # Multi-pane layout
│   │   │   ├── TerminalPane.tsx   # Single terminal view
│   │   │   ├── ChatMessage.tsx    # Message rendering
│   │   │   ├── CommandInput.tsx   # Input with slash commands
│   │   │   ├── OverseerPanel.tsx  # Overseer agent UI
│   │   │   ├── HistorySidebar.tsx # Chat history browser
│   │   │   ├── SessionCard.tsx    # Session preview card
│   │   │   └── ToolOutput.tsx     # Tool result rendering
│   │   │
│   │   ├── stores/
│   │   │   ├── terminals.ts       # Terminal state (Zustand)
│   │   │   ├── overseer.ts        # Overseer state
│   │   │   └── history.ts         # History state
│   │   │
│   │   ├── hooks/
│   │   │   ├── useTerminal.ts     # Terminal WebSocket hook
│   │   │   ├── useOverseer.ts     # Overseer interaction hook
│   │   │   └── useHistory.ts      # History search hook
│   │   │
│   │   └── styles/
│   │       └── globals.css        # Tailwind + custom styles
│   │
│   └── shared/
│       ├── protocol.ts            # WebSocket message types
│       └── constants.ts           # Slash commands, etc.
│
├── db/
│   └── schema.sql                 # SQLite schema for history
│
└── scripts/
    └── sync-history.ts            # Sync ~/.claude/ history to SQLite
```

---

## Core Components

### 1. Terminal Manager (`terminal-manager.ts`)

Manages up to 10 Claude Code PTY sessions.

```typescript
interface Terminal {
  id: string;
  pty: IPty;
  cwd: string;
  sessionId?: string;        // Claude Code session ID
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  status: 'idle' | 'thinking' | 'running_tool' | 'waiting_input';
  buffer: string[];          // Recent output for overseer
}

class TerminalManager {
  spawn(cwd: string, options?: SpawnOptions): Terminal;
  send(id: string, input: string): void;
  sendKey(id: string, key: string): void;  // For Shift+Tab, etc.
  kill(id: string): void;
  resize(id: string, cols: number, rows: number): void;
  getStatus(id: string): TerminalStatus;
  getBuffer(id: string, lines?: number): string[];
}
```

**Spawn options:**
- `--dangerously-skip-permissions`
- `--permission-mode <mode>`
- `--continue` / `--resume <session-id>`
- `--model <model>`

### 2. Overseer Agent (`overseer-agent.ts`)

An autonomous agent using Claude Agent SDK that monitors terminals and can take actions.

```typescript
import { query, ClaudeAgentOptions } from '@anthropic-ai/claude-agent-sdk';

const OVERSEER_SYSTEM_PROMPT = `
You are an overseer agent managing multiple Claude Code terminal sessions.

You have access to these tools:
- listTerminals(): Get status of all terminals
- getTerminalBuffer(id, lines): Read recent output from a terminal
- sendToTerminal(id, message): Send a message/command to a terminal
- spawnTerminal(cwd, options): Create a new terminal
- killTerminal(id): Terminate a terminal
- togglePermissionMode(id, mode): Change permission mode
- sleep(ms): Pause execution while waiting for tasks

Your job is to:
1. Monitor ongoing work across terminals
2. Coordinate tasks when asked
3. Summarize progress
4. Alert if something seems stuck or errored
`;

class OverseerAgent {
  private sleeping: boolean = false;
  private wakeConditions: WakeCondition[] = [];

  async chat(message: string): AsyncGenerator<OverseerMessage>;
  async sleep(ms: number, wakeOn?: WakeCondition): Promise<void>;
  async wake(): void;

  // Custom MCP tools exposed to the agent
  private tools = {
    listTerminals: () => this.terminalManager.list(),
    getTerminalBuffer: (id: string, lines: number) =>
      this.terminalManager.getBuffer(id, lines),
    sendToTerminal: (id: string, msg: string) =>
      this.terminalManager.send(id, msg),
    spawnTerminal: (cwd: string, opts: SpawnOptions) =>
      this.terminalManager.spawn(cwd, opts),
    killTerminal: (id: string) =>
      this.terminalManager.kill(id),
    togglePermissionMode: (id: string, mode: PermissionMode) =>
      this.terminalManager.setPermissionMode(id, mode),
    searchHistory: (query: string) =>
      this.historyService.search(query),
  };
}
```

**Wake conditions:**
- Terminal completes a task
- Terminal encounters an error
- Terminal requests user input
- Timeout

### 3. History Service (`history-service.ts`)

Indexes Claude Code's native history for fast search.

```typescript
interface Session {
  id: string;
  projectPath: string;
  startedAt: Date;
  lastMessageAt: Date;
  messageCount: number;
  summary?: string;         // Generated by overseer on demand
}

interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  toolUses?: ToolUse[];
  timestamp: Date;
}

class HistoryService {
  // Sync from ~/.claude/projects/*//*.jsonl
  async sync(): Promise<void>;

  // Search
  async searchSessions(query: string): Promise<Session[]>;
  async searchMessages(query: string, sessionId?: string): Promise<Message[]>;

  // CRUD
  async getSessions(options: ListOptions): Promise<Session[]>;
  async getSession(id: string): Promise<Session>;
  async getMessages(sessionId: string): Promise<Message[]>;
}
```

**SQLite Schema:**

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  message_count INTEGER DEFAULT 0,
  summary TEXT,
  raw_path TEXT NOT NULL  -- Path to original .jsonl
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_uses TEXT,  -- JSON array
  timestamp INTEGER NOT NULL
);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='rowid'
);

CREATE INDEX idx_sessions_project ON sessions(project_path);
CREATE INDEX idx_messages_session ON messages(session_id);
```

### 4. WebSocket Protocol (`protocol.ts`)

```typescript
// Client -> Server
type ClientMessage =
  | { type: 'terminal:spawn'; cwd: string; options?: SpawnOptions }
  | { type: 'terminal:input'; id: string; data: string }
  | { type: 'terminal:key'; id: string; key: string }  // Special keys
  | { type: 'terminal:resize'; id: string; cols: number; rows: number }
  | { type: 'terminal:kill'; id: string }
  | { type: 'overseer:chat'; message: string }
  | { type: 'overseer:wake' }
  | { type: 'history:search'; query: string }
  | { type: 'history:getSessions'; limit?: number; offset?: number }
  | { type: 'history:getMessages'; sessionId: string };

// Server -> Client
type ServerMessage =
  | { type: 'terminal:spawned'; terminal: TerminalInfo }
  | { type: 'terminal:output'; id: string; data: string }
  | { type: 'terminal:status'; id: string; status: TerminalStatus }
  | { type: 'terminal:killed'; id: string }
  | { type: 'overseer:message'; message: OverseerMessage }
  | { type: 'overseer:sleeping'; wakeConditions: WakeCondition[] }
  | { type: 'overseer:awake' }
  | { type: 'history:sessions'; sessions: Session[] }
  | { type: 'history:messages'; messages: Message[] }
  | { type: 'history:searchResults'; results: SearchResult[] };
```

---

## Slash Commands

All native Claude Code slash commands supported:

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/clear` | Clear conversation |
| `/compact` | Compact conversation |
| `/config` | Open settings |
| `/cost` | Show token usage |
| `/doctor` | Health check |
| `/init` | Initialize project |
| `/login` | Authenticate |
| `/logout` | Sign out |
| `/memory` | Edit CLAUDE.md |
| `/model` | Switch model |
| `/permissions` | Manage permissions |
| `/review` | Code review |
| `/status` | Show status |
| `/terminal` | Terminal info |
| `/vim` | Toggle vim mode |

**GUI-specific commands:**

| Command | Description |
|---------|-------------|
| `/new` | Spawn new terminal |
| `/close` | Close current terminal |
| `/overseer` | Focus overseer panel |
| `/history` | Toggle history sidebar |

---

## UI Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ [+] New Terminal    [Model: Opus]    [Overseer: Sleeping]    [⚙️]    │
├────────────────────────────────────────────────────┬─────────────────┤
│                                                    │                 │
│  ┌────────────────────┐ ┌────────────────────┐    │  HISTORY        │
│  │ Terminal 1         │ │ Terminal 2         │    │                 │
│  │ ~/project-a        │ │ ~/project-b        │    │  [🔍 Search...] │
│  │ ──────────────────│ │ ──────────────────│    │                 │
│  │ User: Fix the bug  │ │ User: Add tests    │    │  Today          │
│  │                    │ │                    │    │  ├─ Session 1   │
│  │ Claude: I'll start │ │ Claude: Creating   │    │  ├─ Session 2   │
│  │ by reading...      │ │ test file...       │    │  │              │
│  │                    │ │                    │    │  Yesterday      │
│  │ [Reading file.ts]  │ │ [Writing test.ts]  │    │  ├─ Session 3   │
│  │                    │ │                    │    │  └─ ...         │
│  │ ──────────────────│ │ ──────────────────│    │                 │
│  │ [Plan] [Accept]    │ │ [Plan] [Accept]    │    │                 │
│  │ [Skip Perms: OFF]  │ │ [Skip Perms: ON]   │    │                 │
│  │                    │ │                    │    │                 │
│  │ > _                │ │ > _                │    │                 │
│  └────────────────────┘ └────────────────────┘    │                 │
│                                                    │                 │
├────────────────────────────────────────────────────┴─────────────────┤
│ OVERSEER                                                      [Wake] │
│ ─────────────────────────────────────────────────────────────────── │
│ Sleeping... Waiting for Terminal 1 to complete file read.           │
│                                                                      │
│ > Ask overseer something...                                          │
└──────────────────────────────────────────────────────────────────────┘
```

**Key UI elements:**

1. **Terminal Grid** - Flexible grid layout (1x1, 2x1, 2x2, etc.)
2. **Terminal Pane** - Chat messages + tool outputs + input
3. **Mode Toggles** - Plan mode, Accept edits, Skip permissions (per terminal)
4. **Overseer Panel** - Collapsible bottom panel
5. **History Sidebar** - Collapsible right sidebar

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New terminal |
| `Cmd+W` | Close terminal |
| `Cmd+1-9` | Focus terminal N |
| `Cmd+\` | Toggle history sidebar |
| `Cmd+O` | Focus overseer |
| `Shift+Tab` | Cycle permission mode (in terminal) |
| `Cmd+Enter` | Send message |
| `Escape` | Interrupt current operation |

---

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Bun project setup with React
- [ ] WebSocket server
- [ ] Terminal manager with node-pty
- [ ] Basic terminal spawn/kill/input

### Phase 2: Terminal UI
- [ ] Terminal grid layout
- [ ] Chat message rendering
- [ ] Command input with slash command autocomplete
- [ ] Tool output rendering
- [ ] Permission mode toggles

### Phase 3: History System
- [ ] SQLite schema + sync script
- [ ] History service API
- [ ] History sidebar UI
- [ ] Full-text search

### Phase 4: Overseer Agent
- [ ] Claude Agent SDK integration
- [ ] Custom MCP tools for terminal control
- [ ] Sleep/wake mechanism
- [ ] Overseer panel UI

### Phase 5: Polish
- [ ] Keyboard shortcuts
- [ ] Responsive layout
- [ ] Error handling
- [ ] Settings persistence

---

## Open Questions for You

1. **Terminal rendering**: Use a full terminal emulator (xterm.js) or simplified chat-style rendering? Chat-style is cleaner but loses some terminal features.

2. **Overseer model**: Use the same model as terminals (Opus) or a cheaper model (Sonnet/Haiku) for the overseer?

3. **History sync**: Real-time watch on ~/.claude/ or manual sync button?

4. **Layout persistence**: Save terminal layout/positions between sessions?
