# Plan: Clear Chat Functionality

## Problem
The overseer chat has no way to clear conversation history. Users may want to start fresh without restarting the server.

## Current Behavior
- `OverseerAgent` stores conversation in `conversationHistory: Anthropic.MessageParam[]`
- No method exists to clear this array
- No WebSocket message type for clearing chat
- No UI button for clearing

## Solution

### 1. Add `clearHistory()` method to OverseerAgent

```typescript
// In overseer-agent.ts
clearHistory(): void {
  this.conversationHistory = [];
  this.emit('cleared');
}
```

### 2. Add WebSocket message handler in index.ts

```typescript
// In handleMessage switch statement
case 'overseer:clear': {
  overseerAgent.clearHistory();
  broadcast({ type: 'overseer:cleared' });
  break;
}
```

### 3. Add event listener for cleared event

```typescript
// Wire up overseer events section
overseerAgent.on('cleared', () => {
  broadcast({ type: 'overseer:cleared' });
});
```

### 4. Update protocol types

```typescript
// In shared/protocol.ts - ClientMessage
| { type: 'overseer:clear' }

// In shared/protocol.ts - ServerMessage
| { type: 'overseer:cleared' }
```

### 5. Add UI button and store handler

```typescript
// In client store (overseer-store.ts or similar)
clearChat: () => {
  ws.send(JSON.stringify({ type: 'overseer:clear' }));
}

// Handle incoming cleared message
case 'overseer:cleared':
  set({ messages: [] });
  break;
```

```tsx
// In OverseerPanel.tsx - add clear button near header
<button onClick={clearChat} title="Clear chat">
  <TrashIcon />
</button>
```

## Files to Modify
- `src/server/overseer-agent.ts` - Add `clearHistory()` method
- `src/server/index.ts` - Add message handler and event listener
- `src/shared/protocol.ts` - Add message types
- `src/client/stores/` - Add store handler
- `src/client/components/OverseerPanel.tsx` - Add clear button

## Testing
1. Send several messages to overseer
2. Click clear button
3. Verify chat is empty in UI
4. Send new message, verify it works fresh (no prior context)
