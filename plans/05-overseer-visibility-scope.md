# Plan: Overseer Visibility Scope

## Current Behavior
The overseer can only see terminals managed by this GUI's `TerminalManager`. It has no visibility into:
- Claude Code sessions running in VS Code/Cursor
- Claude Code sessions started from a separate terminal
- Any external processes

This is by design - the `list_terminals` tool calls `terminalManager.list()` which returns from an in-memory Map populated only by `spawn()`.

## Options

### Option A: Document Current Behavior (Recommended)
Accept the limitation and document it clearly for users.

**Pros:**
- No code changes needed
- Simpler mental model
- More secure (no process scanning)

**Cons:**
- Can't coordinate with IDE sessions

**Implementation:**
- Add tooltip/info in UI explaining scope
- Update CLAUDE.md documentation

### Option B: Process Discovery (Not Recommended)
Scan for running `claude` processes on the system.

**Pros:**
- Could show all Claude sessions

**Cons:**
- Can only see processes, not control them
- No way to inject commands into existing PTY
- Security concerns with process scanning
- Platform-specific implementation
- Would show misleading "terminals" that can't be interacted with

### Option C: Session Resume (See Plan 06)
Allow resuming past sessions from `~/.claude/sessions/`. This partially addresses the gap by letting users bring external sessions into the GUI.

## Recommendation
Go with **Option A** (document) + **Option C** (session resume from Plan 06).

## UI Changes for Option A

### Add info tooltip to Overseer panel
```tsx
<div className="overseer-header">
  <span>Overseer</span>
  <Tooltip content="The overseer can only see terminals opened in this GUI. Sessions started in VS Code or terminal are not visible.">
    <InfoIcon />
  </Tooltip>
</div>
```

### Update system prompt for clarity
```typescript
// In overseer-agent.ts SYSTEM_PROMPT
`Note: You can only see and control terminals that were opened through this GUI.
Claude Code sessions running in VS Code, Cursor, or other terminals are not visible.
Use the spawn_terminal tool to create terminals you can manage.`
```

## Files to Modify
- `src/server/overseer-agent.ts` - Update SYSTEM_PROMPT
- `src/client/components/OverseerPanel.tsx` - Add info tooltip
- `CLAUDE.md` - Document limitation

## No Testing Required
This is documentation/UX only, no functional changes.
