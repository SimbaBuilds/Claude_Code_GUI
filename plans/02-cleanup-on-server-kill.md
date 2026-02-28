# Plan: Cleanup on Server Kill

## Problem
When the bun server is killed (SIGINT/SIGTERM), spawned Claude Code subprocesses become orphaned and continue running until they finish or timeout.

## Current Behavior
- `TerminalManager.kill(id)` properly kills individual terminal processes
- No cleanup hook exists for server shutdown
- `index.ts` SIGINT handler only stops bridges and closes history service

## Solution

### 1. Add `shutdown()` method to TerminalManager

```typescript
// In terminal-manager.ts
shutdown(): void {
  console.log(`Shutting down ${this.terminals.size} terminals...`);
  for (const [id] of this.terminals) {
    this.kill(id);
  }
}
```

### 2. Update SIGINT handler in index.ts

```typescript
// In index.ts
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  terminalManager.shutdown();  // Add this line
  telegramBridge?.stop();
  await slackBridge?.stop();
  historyService.close();
  process.exit(0);
});

// Also handle SIGTERM for containerized deployments
process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, shutting down...');
  terminalManager.shutdown();
  telegramBridge?.stop();
  await slackBridge?.stop();
  historyService.close();
  process.exit(0);
});
```

## Files to Modify
- `src/server/terminal-manager.ts` - Add `shutdown()` method
- `src/server/index.ts` - Call shutdown in signal handlers, add SIGTERM handler

## Testing
1. Start server with `bun run start`
2. Spawn a terminal via GUI or overseer
3. Kill server with Ctrl+C
4. Verify no orphaned `claude` processes with `pgrep -fl claude`
