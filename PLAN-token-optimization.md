# Token Optimization Plan for Overseer Agent

## Problem Summary

The overseer agent hit API limit: **220,668 tokens > 200,000 maximum**

This happened in a short session, indicating significant bloat from tool results rather than conversation length.

## Research Findings

From [Claude Code docs](https://docs.anthropic.com/en/docs/claude-code/costs) and [community guides](https://claudefa.st/blog/guide/mechanics/context-buffer-management):

- Claude Code reserves ~33K tokens as buffer (down from 45K)
- Auto-compaction fires at ~170K tokens (200K × 0.85)
- Best practice: proactive clearing at 50% + structured recovery beats lossy auto-compaction
- Context editing: selectively remove specific content types from earlier conversation
- The [1M context window](https://qmaki.hashnode.dev/1m-token-context-windows-just-went-ga-heres-what-actually-changes) is available for Opus 4.6/Sonnet 4.6 with beta header

## Sources of Token Bloat (Identified)

### 1. `get_terminal_buffer` Tool (MAJOR)
**Location**: `terminal-manager.ts:482-486`, `overseer-agent.ts:1185-1188`

- Returns up to 100 lines by default (overseer requests 50)
- Each "line" is actually a **raw output chunk** from stdout, not a text line
- Buffer stores up to 1000 chunks (`terminal-manager.ts:224`)
- Claude Code output includes: file contents, build logs, test results, tool use JSON
- **A single buffer read can easily be 50K+ tokens**

### 2. `search_history` Tool (MODERATE)
**Location**: `history-service.ts:286-339`, `overseer-agent.ts:1229-1234`

- Returns up to 50 results with full `content` field
- Each message's content can be arbitrarily large
- No truncation on search results

### 3. Conversation History Accumulation (MODERATE)
**Location**: `overseer-agent.ts:1056-1059`, `1173-1176`

- Every assistant response added verbatim
- Every tool result added verbatim (including massive buffers)
- No token estimation before API calls
- No trimming when approaching limits
- No summarization/compaction

### 4. No Pre-flight Token Check
**Location**: `overseer-agent.ts:1027-1034`

- API call made without checking if prompt will exceed limit
- No graceful handling when approaching limits

## Proposed Solutions

### Phase 1: Tool Result Truncation (Immediate Impact)

#### 1.1 Truncate `get_terminal_buffer` Results
```typescript
// In overseer-agent.ts executeTool()
case 'get_terminal_buffer': {
  const buffer = this.terminalManager.getBuffer(
    input.terminal_id as string,
    (input.lines as number) || 50
  );

  // Join and truncate to max characters
  const MAX_BUFFER_CHARS = 15000; // ~4K tokens
  const joined = buffer.join('');

  if (joined.length > MAX_BUFFER_CHARS) {
    const truncated = joined.slice(-MAX_BUFFER_CHARS);
    return `[...truncated ${joined.length - MAX_BUFFER_CHARS} chars...]\n${truncated}`;
  }
  return joined;
}
```

#### 1.2 Truncate `search_history` Results
```typescript
case 'search_history': {
  const results = await this.historyService.searchMessages(
    input.query as string,
    undefined,
    (input.limit as number) || 10  // Reduce default from 50 to 10
  );

  // Truncate each result's content
  const MAX_CONTENT_CHARS = 500;
  return results.map(r => ({
    ...r,
    message: {
      ...r.message,
      content: r.message.content.length > MAX_CONTENT_CHARS
        ? r.message.content.slice(0, MAX_CONTENT_CHARS) + '...'
        : r.message.content
    }
  }));
}
```

### Phase 2: Token Estimation & History Management

#### 2.1 Add Token Estimation Utility
```typescript
// Simple estimation: ~4 chars per token for English text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(messages: Anthropic.MessageParam[]): number {
  return messages.reduce((sum, msg) => {
    const content = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content);
    return sum + estimateTokens(content);
  }, 0);
}
```

#### 2.2 Pre-flight Token Check
```typescript
// In runAgentLoop(), before API call
const MAX_CONTEXT_TOKENS = 180000; // Leave 20K buffer
const estimatedTokens = estimateMessageTokens(this.conversationHistory);

if (estimatedTokens > MAX_CONTEXT_TOKENS) {
  log.warn('Context approaching limit, trimming history', { estimatedTokens });
  this.trimHistory(MAX_CONTEXT_TOKENS * 0.7); // Trim to 70% of max
}
```

#### 2.3 History Trimming Strategy
```typescript
private trimHistory(targetTokens: number): void {
  // Strategy: Remove oldest messages first, but keep:
  // 1. System context (first few messages)
  // 2. Most recent N turns

  const KEEP_RECENT_TURNS = 4; // Keep last 4 turns (8 messages)
  const recentStart = Math.max(0, this.conversationHistory.length - KEEP_RECENT_TURNS * 2);

  // Find messages to remove
  let tokensToRemove = estimateMessageTokens(this.conversationHistory) - targetTokens;
  let removeUpTo = 0;

  for (let i = 0; i < recentStart && tokensToRemove > 0; i++) {
    const msgTokens = estimateMessageTokens([this.conversationHistory[i]]);
    tokensToRemove -= msgTokens;
    removeUpTo = i + 1;
  }

  if (removeUpTo > 0) {
    // Insert summary of removed content
    const removed = this.conversationHistory.splice(0, removeUpTo);
    this.conversationHistory.unshift({
      role: 'user',
      content: `[Previous ${removeUpTo} messages summarized: conversation covered terminal management and task coordination]`
    });

    log.info('Trimmed conversation history', { removedCount: removeUpTo, newLength: this.conversationHistory.length });
  }
}
```

### Phase 3: Advanced Optimizations (Future)

#### 3.1 Use 1M Context Window (if available)
```typescript
// Add beta header for 1M context
const response = await this.client.messages.create({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 4096,
  // Enable 1M context for supported models
  betas: ['context-1m-2025-08-07'],
  system: buildSystemPrompt(),
  tools: TOOLS,
  messages: this.conversationHistory,
});
```

#### 3.2 Smart Tool Result Caching
- Cache `get_terminal_buffer` results and only include diffs
- Track which terminal states have already been shown

#### 3.3 Conversation Compaction
- When approaching limits, use Claude to summarize older portions
- Replace detailed history with condensed summaries

## Implementation Order

1. **Immediate (Phase 1)**: Truncate tool results - biggest impact, lowest risk
2. **Short-term (Phase 2)**: Add token estimation and history trimming
3. **Medium-term (Phase 3)**: 1M context, smart caching, compaction

## Metrics to Track

- Tokens per API call (from `response.usage`)
- Frequency of truncation events
- Frequency of history trimming events
- Error rate from context overflow

## Files to Modify

1. `src/server/overseer-agent.ts` - Main changes
2. `src/server/terminal-manager.ts` - Optional: add truncation at source
