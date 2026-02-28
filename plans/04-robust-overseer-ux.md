# Plan: Robust Overseer UX

## Problem
The overseer panel lacks visibility into what the agent is doing, making it hard to understand and control.

## Current Issues
1. Tool calls are not shown - user only sees final text responses
2. No visual indicator when overseer is sleeping or what it's waiting for
3. No way to cancel an in-progress operation
4. Status only shows "Idle", "Thinking...", "Acting..." without detail

## Solution

### Phase 1: Show Tool Calls in Chat

#### 1.1 Update OverseerMessage type
```typescript
// In shared/types.ts
export interface OverseerMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolCall?: {
    name: string;
    input: Record<string, unknown>;
    result?: string;
  };
}
```

#### 1.2 Emit tool events from OverseerAgent
```typescript
// In overseer-agent.ts - executeTool method
private async executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  // Emit tool start
  this.emitMessage({
    role: 'tool',
    content: `Using ${name}...`,
    timestamp: Date.now(),
    toolCall: { name, input },
  });

  const result = await this.executeToolInternal(name, input);

  // Emit tool result
  this.emitMessage({
    role: 'tool',
    content: `${name} completed`,
    timestamp: Date.now(),
    toolCall: { name, input, result: JSON.stringify(result) },
  });

  return result;
}
```

#### 1.3 Render tool calls in UI
```tsx
// In OverseerPanel.tsx
{message.role === 'tool' && (
  <div className="tool-call">
    <span className="tool-name">{message.toolCall?.name}</span>
    {message.toolCall?.input && (
      <pre className="tool-input">{JSON.stringify(message.toolCall.input, null, 2)}</pre>
    )}
  </div>
)}
```

### Phase 2: Sleep State Visualization

#### 2.1 Show sleep conditions in UI
```tsx
// When status is 'sleeping', show conditions
{status === 'sleeping' && wakeConditions.length > 0 && (
  <div className="sleep-indicator">
    <span>Sleeping until:</span>
    <ul>
      {wakeConditions.map((c, i) => (
        <li key={i}>
          {c.type === 'timeout' && `Timeout: ${c.timeoutMs}ms`}
          {c.type === 'terminal_complete' && `Terminal ${c.terminalId} completes`}
          {c.type === 'terminal_error' && `Terminal ${c.terminalId} errors`}
          {c.type === 'terminal_input_needed' && `Terminal ${c.terminalId} needs input`}
        </li>
      ))}
    </ul>
    <button onClick={wake}>Wake Now</button>
  </div>
)}
```

### Phase 3: Cancel Operation

#### 3.1 Add abort capability to OverseerAgent
```typescript
// In overseer-agent.ts
private abortController: AbortController | null = null;

async chat(userMessage: string): Promise<void> {
  this.abortController = new AbortController();
  // ... existing code with abort signal support
}

abort(): void {
  if (this.abortController) {
    this.abortController.abort();
    this.abortController = null;
    this.updateStatus('idle');
    this.emit('aborted');
  }
}
```

#### 3.2 Add cancel button in UI
```tsx
{(status === 'thinking' || status === 'acting') && (
  <button onClick={abort} className="cancel-btn">
    Cancel
  </button>
)}
```

## Files to Modify
- `src/shared/types.ts` - Update OverseerMessage type
- `src/shared/protocol.ts` - Add abort message types
- `src/server/overseer-agent.ts` - Emit tool events, add abort
- `src/server/index.ts` - Handle abort message
- `src/client/components/OverseerPanel.tsx` - Render tool calls, sleep state, cancel button
- `src/client/stores/` - Handle new message types

## Implementation Order
1. Phase 1 (tool visibility) - Most impactful for understanding
2. Phase 2 (sleep state) - Important for long-running tasks
3. Phase 3 (cancel) - Nice to have, more complex

## Testing
1. Ask overseer to spawn a terminal - verify tool call appears in chat
2. Ask overseer to sleep - verify conditions shown
3. Start a task and click cancel - verify it stops
