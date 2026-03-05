# Claude Code GUI

Browser-based GUI for Claude Code with multi-terminal support, overseer agent, and remote access via Slack/Telegram.


## Run with Slack Integration

See Makefile for more commands

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

## Styling & CSS

This project uses Tailwind CSS v4 with custom theme variables. The styling is defined in `src/client/styles/globals.css`.

### Theme Colors (CSS Variables)

Use these CSS variables for consistent styling:

| Variable | Color | Usage |
|----------|-------|-------|
| `--color-bg-primary` | `#0d1117` | Main background |
| `--color-bg-secondary` | `#161b22` | Cards, panels |
| `--color-bg-tertiary` | `#21262d` | Headers, inputs |
| `--color-border` | `#30363d` | Borders |
| `--color-text-primary` | `#e6edf3` | Main text |
| `--color-text-secondary` | `#8b949e` | Secondary text |
| `--color-text-muted` | `#6e7681` | Muted/hint text |
| `--color-accent` | `#58a6ff` | Primary accent (blue) |
| `--color-error` | `#f85149` | Error states (red) |
| `--color-success` | `#3fb950` | Success states (green) |
| `--color-warning` | `#d29922` | Warning states (yellow) |

### Important Notes

- **Use CSS variables, not Tailwind color classes** - Classes like `bg-red-500` won't work. Use `var(--color-error)` instead.
- **Inline styles for dynamic components** - For components with positioning needs (toasts, modals), use inline styles to ensure they work correctly.
- **Build CSS separately** - After changing `globals.css`, run: `npx @tailwindcss/cli -i src/client/styles/globals.css -o dist/client/styles/globals.css`
- Once plan is created or change is decided, please delegate implementation to Task agent on sonnet unless told otherwise. 
- After completing code changes, please rebuild project using one of the commands below:
make build      # JS only
make build-css  # CSS only
make all        # install + build + build-css