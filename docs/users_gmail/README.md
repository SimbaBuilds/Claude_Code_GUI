# Gmail Access Tool

Read-only IMAP access to user's Gmail accounts for Claude Code.

## Accounts

| Email | Use |
|-------|-----|
| `cmrn.hightower@gmail.com` | Personal |
| `cameron.hightower@simbabuilds.com` | Work (aliased as cameron@hightower-ai.com) |

App passwords stored in `gmail_app_password.md`.

## Usage

### Basic - Run the script
```bash
cd /Users/cameronhightower/Software_Projects/SKMD/tools/access_user_gmail
python3 read_gmail.py
```

### Search for specific email (inline Python)
```bash
python3 -c "
import imaplib
import email
from email.header import decode_header

EMAIL = 'cameron.hightower@simbabuilds.com'
APP_PASSWORD = 'knfc cgob uxls apao'

mail = imaplib.IMAP4_SSL('imap.gmail.com')
mail.login(EMAIL, APP_PASSWORD)
mail.select('INBOX', readonly=True)

status, messages = mail.search(None, 'SUBJECT \"Your Search Term\"')
# ... fetch and parse emails
mail.logout()
"
```

## Gotchas

### Folder names with special characters
When using inline `python3 -c "..."` commands, folder names like `[Gmail]/All Mail` don't parse correctly due to bracket/space escaping issues.

**This fails:**
```python
mail.select('[Gmail]/All Mail', readonly=True)
# Error: EXAMINE command error: BAD [b'Could not parse command']
```

**Use simple folder names instead:**
```python
mail.select('INBOX', readonly=True)  # Works
```

For Gmail special folders, either:
1. Use `INBOX` (usually sufficient for recent emails)
2. Write a proper `.py` script file instead of inline Python
3. Escape carefully: `mail.select('"[Gmail]/All Mail"', readonly=True)`

## Available Functions (read_gmail.py)

- `connect()` - Connect to Gmail IMAP
- `list_folders(mail)` - List all Gmail folders/labels
- `get_recent_emails(mail, folder, limit, days_back)` - Fetch recent emails
- `search_emails(mail, query, folder, limit)` - Search by subject/body
