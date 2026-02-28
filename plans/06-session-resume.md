# Plan: Session Resume

## Problem
Users want to continue past Claude Code sessions, whether started in this GUI, VS Code, or terminal. Currently there's no way to browse and resume historical sessions.

## Claude Code Session Storage
Sessions are stored in `~/.claude/projects/<project-hash>/<session-id>.jsonl`

Each session file contains:
- Conversation history
- Tool calls and results
- Session metadata

The `--resume <session-id>` flag allows continuing a session.

## Solution

### Phase 1: Session Discovery Service

#### 1.1 Create SessionDiscoveryService
```typescript
// src/server/session-discovery.ts
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

interface DiscoveredSession {
  id: string;
  projectPath: string;
  projectHash: string;
  lastModified: Date;
  messageCount: number;
  preview?: string;  // First user message
}

export class SessionDiscoveryService {
  private claudeDir = join(homedir(), '.claude', 'projects');

  async discoverSessions(limit = 50): Promise<DiscoveredSession[]> {
    const sessions: DiscoveredSession[] = [];

    // Scan project directories
    const projectDirs = await readdir(this.claudeDir);

    for (const projectHash of projectDirs) {
      const projectPath = join(this.claudeDir, projectHash);
      const files = await readdir(projectPath);

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;

        const sessionId = file.replace('.jsonl', '');
        const filePath = join(projectPath, file);
        const stats = await stat(filePath);

        // Parse first few lines for preview
        const content = await readFile(filePath, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        const messageCount = lines.length;

        // Find first user message for preview
        let preview = '';
        for (const line of lines.slice(0, 10)) {
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'user') {
              preview = msg.message?.content?.slice(0, 100) || '';
              break;
            }
          } catch {}
        }

        sessions.push({
          id: sessionId,
          projectPath: this.resolveProjectPath(projectHash),
          projectHash,
          lastModified: stats.mtime,
          messageCount,
          preview,
        });
      }
    }

    // Sort by last modified, most recent first
    sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

    return sessions.slice(0, limit);
  }

  private resolveProjectPath(hash: string): string {
    // The hash is derived from the project path
    // We can try to reverse it from CLAUDE.md or config files
    // For now, return the hash - could enhance later
    return hash;
  }
}
```

### Phase 2: API & WebSocket Integration

#### 2.1 Add to index.ts
```typescript
const sessionDiscovery = new SessionDiscoveryService();

// In handleMessage
case 'sessions:discover': {
  const sessions = await sessionDiscovery.discoverSessions(message.limit);
  send(ws, { type: 'sessions:discovered', sessions });
  break;
}

case 'sessions:resume': {
  // Spawn terminal with resume flag
  const terminal = terminalManager.spawn({
    cwd: message.projectPath,
    resumeSessionId: message.sessionId,
  });
  broadcast({ type: 'terminal:spawned', terminal });
  break;
}
```

#### 2.2 Update protocol types
```typescript
// ClientMessage
| { type: 'sessions:discover'; limit?: number }
| { type: 'sessions:resume'; sessionId: string; projectPath: string }

// ServerMessage
| { type: 'sessions:discovered'; sessions: DiscoveredSession[] }
```

### Phase 3: UI Integration

#### 3.1 Add "Resume Session" button/modal
```tsx
// In TerminalPanel.tsx or new SessionBrowser.tsx
function SessionBrowser() {
  const [sessions, setSessions] = useState<DiscoveredSession[]>([]);

  useEffect(() => {
    ws.send(JSON.stringify({ type: 'sessions:discover', limit: 50 }));
  }, []);

  return (
    <div className="session-browser">
      <h3>Resume Session</h3>
      <div className="session-list">
        {sessions.map(session => (
          <div
            key={session.id}
            className="session-item"
            onClick={() => resumeSession(session)}
          >
            <div className="session-project">{session.projectPath}</div>
            <div className="session-preview">{session.preview}</div>
            <div className="session-meta">
              {session.messageCount} messages · {formatDate(session.lastModified)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### 3.2 Add to History panel or as separate tab
Could integrate with existing History panel or add a "Resume" button that opens a modal.

### Phase 4: Slack/Telegram Integration

#### 4.1 Add commands for remote session resume
```typescript
// In slack-bridge.ts
'/claude-sessions': List recent sessions
'/claude-resume <session-id>': Resume a specific session
```

## Files to Create
- `src/server/session-discovery.ts` - New service

## Files to Modify
- `src/server/index.ts` - Add message handlers
- `src/shared/protocol.ts` - Add message types
- `src/shared/types.ts` - Add DiscoveredSession type
- `src/client/components/` - Add SessionBrowser UI
- `src/server/slack-bridge.ts` - Add commands (optional)
- `src/server/telegram-bridge.ts` - Add commands (optional)

## Testing
1. Run some Claude Code sessions outside the GUI
2. Open GUI and browse discovered sessions
3. Click to resume - verify terminal opens with session context
4. Send a message - verify it continues the conversation

## Edge Cases
- Session file may be corrupted/incomplete
- Project directory may no longer exist
- Session may be from different Claude Code version
- Handle gracefully with try/catch and skip invalid sessions
