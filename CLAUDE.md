# Claude Code GUI

Browser-based GUI for Claude Code with multi-terminal support, overseer agent, and remote access via Slack/Telegram.

## Quick Start

```bash
# Install dependencies
bun install

# Build frontend (JS)
bun run build

# Build CSS (after making style changes)
npx @tailwindcss/cli -i src/client/styles/globals.css -o dist/client/styles/globals.css

# Start server
bun run start
```

Open http://localhost:3001

## Run with Slack Integration

See Makefiel for more commands

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `ANTHROPIC_API_KEY` | API key for overseer agent |
| `SLACK_BOT_TOKEN` | Slack bot token (xoxb-...) |
| `SLACK_APP_TOKEN` | Slack app token (xapp-...) |
| `SLACK_SIGNING_SECRET` | Slack signing secret |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Optional: restrict to specific chat |

## Project Structure

```
src/
├── client/           # React frontend
│   ├── components/   # UI components
│   ├── stores/       # Zustand state management
│   └── styles/       # CSS
├── server/           # Bun backend
│   ├── index.ts           # HTTP + WebSocket server
│   ├── terminal-manager.ts # Claude Code session management
│   ├── overseer-agent.ts   # LLM overseer (Sonnet)
│   ├── history-service.ts  # SQLite chat history
│   ├── slack-bridge.ts     # Slack integration
│   └── telegram-bridge.ts  # Telegram integration
└── shared/           # Shared types and constants
```

## Slack Commands

- `/claude-status` - System status
- `/claude-terminals` - List active terminals
- `/claude-spawn <path>` - Create new terminal
- `/claude-kill <id>` - Kill terminal
- `/claude-chat <msg>` - Chat with overseer

Or @mention the bot and reply in threads.

## Telegram Commands

- `/status` - System status
- `/terminals` - List terminals
- `/spawn <path>` - Create terminal
- `/kill <id>` - Kill terminal
- `/chat <msg>` - Chat with overseer

Or just send messages directly.
