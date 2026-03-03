Below:

Last login: Sat Feb 28 10:18:29 on ttys024
cameronhightower@Mac ~ % cd /Users/cameronhightower/Software_Projects/Claude_Code_GUI && make gui

~/.bun/bin/bun run src/server/index.ts
Telegram: No bot token provided. Set TELEGRAM_BOT_TOKEN to enable.
Slack: Connected via Socket Mode
288 | 
289 | // Build static file path - serve from dist in production, src for dev
290 | const CLIENT_DIR = join(import.meta.dir, '..', '..', 'dist', 'client');
291 | 
292 | // Bun server
293 | const server = Bun.serve({
                         ^
error: Failed to start server. Is port 3001 in use?
 syscall: "listen",
   errno: 0,
    code: "EADDRINUSE"

      at /Users/cameronhightower/Software_Projects/Claude_Code_GUI/src/server/index.ts:293:20

Bun v1.3.10 (macOS arm64)
make: *** [run-gui] Error 1
cameronhightower@Mac Claude_Code_GUI % cd /Users/cameronhightower/Software_Projects/Claude_Code_GUI && make gui

~/.bun/bin/bun run src/server/index.ts
Telegram: No bot token provided. Set TELEGRAM_BOT_TOKEN to enable.
Slack: Connected via Socket Mode
Claude Code GUI server running on http://localhost:3001
WebSocket open: sending 50 sessions
WebSocket open: sending 50 sessions
WebSocket open: sending 50 sessions
Received message: terminal:spawn
Spawning terminal with options: {
  cwd: "/Users/cameronhightower/Software_Projects/Claude_Code_Scratch",
  model: "sonnet",
}
Created terminal terminal-1 for cwd: /Users/cameronhightower/Software_Projects/Claude_Code_Scratch
Terminal spawned: {
  id: "terminal-1",
  cwd: "/Users/cameronhightower/Software_Projects/Claude_Code_Scratch",
  sessionId: undefined,
  permissionMode: "default",
  status: "idle",
  model: "sonnet",
  createdAt: 1772475632000,
}
Received message: terminal:setMode
Received message: terminal:input
Error handling message: 75 | 
76 |     // Update status to thinking
77 |     this.updateStatus(id, 'thinking');
78 | 
79 |     // Spawn claude with the prompt as argument
80 |     const proc = Bun.spawn([this.claudePath, ...args], {
                          ^
ENOENT: no such file or directory, posix_spawn '/Users/cameronhightower/.claude/local/claude'
    path: "/Users/cameronhightower/.claude/local/claude",
 syscall: "posix_spawn",
   errno: -2,
    code: "ENOENT"

      at send (/Users/cameronhightower/Software_Projects/Claude_Code_GUI/src/server/terminal-manager.ts:80:22)
      at handleMessage (/Users/cameronhightower/Software_Projects/Claude_Code_GUI/src/server/index.ts:168:31)
      at message (/Users/cameronhightower/Software_Projects/Claude_Code_GUI/src/server/index.ts:372:9)

Received message: terminal:kill
Received message: terminal:spawn
Spawning terminal with options: {
  cwd: "/Users/cameronhightower/Documents/Claude_Code_Scratch",
  model: "sonnet",
}
Created terminal terminal-2 for cwd: /Users/cameronhightower/Documents/Claude_Code_Scratch
Terminal spawned: {
  id: "terminal-2",
  cwd: "/Users/cameronhightower/Documents/Claude_Code_Scratch",
  sessionId: undefined,
  permissionMode: "default",
  status: "idle",
  model: "sonnet",
  createdAt: 1772475776520,
}
Received message: terminal:input
Received message: terminal:input
Claude process for terminal terminal-2 exited with code 0
Received message: terminal:spawn
Spawning terminal with options: {
  cwd: "/Users/cameronhightower/Software_Projects/Cluade_Code_GUI",
  model: "sonnet",
}
Created terminal terminal-3 for cwd: /Users/cameronhightower/Software_Projects/Cluade_Code_GUI
Terminal spawned: {
  id: "terminal-3",
  cwd: "/Users/cameronhightower/Software_Projects/Cluade_Code_GUI",
  sessionId: undefined,
  permissionMode: "default",
  status: "idle",
  model: "sonnet",
  createdAt: 1772476071104,
}
Claude process for terminal terminal-2 exited with code 0

