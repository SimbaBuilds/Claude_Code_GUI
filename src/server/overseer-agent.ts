// Overseer Agent - monitors and controls Claude Code terminals

import Anthropic from '@anthropic-ai/sdk';
import { EventEmitter } from 'events';
import { existsSync, readdirSync, statSync } from 'fs';
import { resolve, isAbsolute, join } from 'path';
import type { TerminalManager } from './terminal-manager';
import type { HistoryService } from './history-service';
import type {
  OverseerMessage,
  OverseerStatus,
  OverseerThread,
  OverseerThreadSource,
  WakeCondition,
  SpawnOptions,
  PermissionMode,
} from '../shared/types';
import { overseerLogger as log } from './logger';

const PROJECTS_DIR = '/Users/cameronhightower/Software_Projects';

// Gmail API configuration
const GMAIL_TOKENS_PATH = '/Users/cameronhightower/Software_Projects/Terminal_Agent_GUI/gmail-tokens.json';
const GMAIL_ACCOUNT_ALIASES: Record<string, string> = {
  work: 'cameron.hightower@simbabuilds.com',
  personal: 'cmrn.hightower@gmail.com',
};

interface GmailTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  obtained_at: string;
}

interface GmailTokensFile {
  [email: string]: GmailTokens;
}

interface GmailMessageHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: GmailMessageHeader[];
  body: {
    size: number;
    data?: string;
    attachmentId?: string;
  };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  payload?: {
    headers: GmailMessageHeader[];
    mimeType: string;
    body: {
      size: number;
      data?: string;
    };
    parts?: GmailMessagePart[];
  };
  internalDate?: string;
}

interface GmailThread {
  id: string;
  snippet: string;
  historyId: string;
  messages?: GmailMessage[];
}

interface GmailSearchResult {
  messages?: Array<{ id: string; threadId: string }>;
  threads?: Array<{ id: string; snippet: string; historyId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

// Load tokens from file
async function loadGmailTokens(): Promise<GmailTokensFile> {
  const { readFile } = await import('fs/promises');
  const content = await readFile(GMAIL_TOKENS_PATH, 'utf-8');
  return JSON.parse(content);
}

// Save tokens to file
async function saveGmailTokens(tokens: GmailTokensFile): Promise<void> {
  const { writeFile } = await import('fs/promises');
  await writeFile(GMAIL_TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

// Refresh access token if expired
async function refreshAccessToken(email: string, tokens: GmailTokens): Promise<GmailTokens> {
  const clientId = process.env.G_CLIENT_ID;
  const clientSecret = process.env.G_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('G_CLIENT_ID and G_CLIENT_SECRET environment variables are required');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to refresh token: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  const now = Date.now();

  const updatedTokens: GmailTokens = {
    ...tokens,
    access_token: data.access_token,
    expires_at: now + (data.expires_in * 1000),
    obtained_at: new Date(now).toISOString(),
  };

  // Save updated tokens
  const allTokens = await loadGmailTokens();
  allTokens[email] = updatedTokens;
  await saveGmailTokens(allTokens);

  log.info('Gmail token refreshed', { email });

  return updatedTokens;
}

// Get valid access token, refreshing if necessary
async function getValidAccessToken(email: string): Promise<string> {
  const allTokens = await loadGmailTokens();
  let tokens = allTokens[email];

  if (!tokens) {
    throw new Error(`No tokens found for ${email}`);
  }

  // Check if token is expired (with 5 minute buffer)
  const now = Date.now();
  if (tokens.expires_at - now < 5 * 60 * 1000) {
    log.info('Gmail token expired or expiring soon, refreshing', { email });
    tokens = await refreshAccessToken(email, tokens);
  }

  return tokens.access_token;
}

// Resolve account alias to email
function resolveAccountEmail(account: string): string {
  return GMAIL_ACCOUNT_ALIASES[account] || account;
}

// Decode base64url encoded content
function decodeBase64Url(data: string): string {
  // Convert base64url to base64
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  // Decode
  return Buffer.from(base64, 'base64').toString('utf-8');
}

// Decode MIME encoded words (RFC 2047)
function decodeMimeWord(text: string): string {
  // Match =?charset?encoding?text?= patterns
  const mimePattern = /=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi;
  return text.replace(mimePattern, (match, charset, encoding, encodedText) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        // Base64 encoding
        return Buffer.from(encodedText, 'base64').toString('utf-8');
      } else if (encoding.toUpperCase() === 'Q') {
        // Quoted-printable encoding
        const decoded = encodedText
          .replace(/_/g, ' ')
          .replace(/=([0-9A-F]{2})/gi, (_: string, hex: string) =>
            String.fromCharCode(parseInt(hex, 16))
          );
        return decoded;
      }
    } catch {
      // Return original on error
    }
    return match;
  });
}

// Get header value from message
function getHeader(message: GmailMessage, name: string): string {
  const header = message.payload?.headers?.find(
    h => h.name.toLowerCase() === name.toLowerCase()
  );
  return header ? decodeMimeWord(header.value) : '';
}

// Extract text body from message parts
function extractTextBody(part: GmailMessagePart): string {
  if (part.mimeType === 'text/plain' && part.body.data) {
    return decodeBase64Url(part.body.data);
  }

  if (part.parts) {
    for (const subPart of part.parts) {
      const text = extractTextBody(subPart);
      if (text) return text;
    }
  }

  // Fallback to text/html if no plain text
  if (part.mimeType === 'text/html' && part.body.data) {
    const html = decodeBase64Url(part.body.data);
    // Strip HTML tags for basic text extraction
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  return '';
}

// Extract attachments info from message parts
function extractAttachments(part: GmailMessagePart): Array<{ filename: string; mimeType: string; size: number }> {
  const attachments: Array<{ filename: string; mimeType: string; size: number }> = [];

  if (part.filename && part.filename.length > 0) {
    attachments.push({
      filename: part.filename,
      mimeType: part.mimeType,
      size: part.body.size,
    });
  }

  if (part.parts) {
    for (const subPart of part.parts) {
      attachments.push(...extractAttachments(subPart));
    }
  }

  return attachments;
}

// Search Gmail messages
async function searchGmailMessages(
  email: string,
  query: string,
  maxResults: number = 10
): Promise<Array<{ id: string; threadId: string; snippet: string; from: string; to: string; subject: string; date: string }>> {
  const accessToken = await getValidAccessToken(email);

  const searchUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('maxResults', maxResults.toString());

  const searchResponse = await fetch(searchUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!searchResponse.ok) {
    const errorText = await searchResponse.text();
    throw new Error(`Gmail search failed: ${searchResponse.status} ${errorText}`);
  }

  const searchData = await searchResponse.json() as GmailSearchResult;

  if (!searchData.messages || searchData.messages.length === 0) {
    return [];
  }

  // Fetch message metadata for each result
  const results = await Promise.all(
    searchData.messages.map(async (msg) => {
      const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`;
      const msgResponse = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!msgResponse.ok) {
        return null;
      }

      const message = await msgResponse.json() as GmailMessage;

      return {
        id: message.id,
        threadId: message.threadId,
        snippet: message.snippet,
        from: getHeader(message, 'From'),
        to: getHeader(message, 'To'),
        subject: getHeader(message, 'Subject'),
        date: getHeader(message, 'Date'),
      };
    })
  );

  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

// Search Gmail threads
async function searchGmailThreads(
  email: string,
  query: string,
  maxResults: number = 10
): Promise<Array<{ id: string; snippet: string; historyId: string; messagesCount: number }>> {
  const accessToken = await getValidAccessToken(email);

  const searchUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/threads');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('maxResults', maxResults.toString());

  const searchResponse = await fetch(searchUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!searchResponse.ok) {
    const errorText = await searchResponse.text();
    throw new Error(`Gmail thread search failed: ${searchResponse.status} ${errorText}`);
  }

  const searchData = await searchResponse.json() as GmailSearchResult;

  if (!searchData.threads || searchData.threads.length === 0) {
    return [];
  }

  // Fetch thread details for message count
  const results = await Promise.all(
    searchData.threads.map(async (thread) => {
      const threadUrl = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${thread.id}?format=minimal`;
      const threadResponse = await fetch(threadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!threadResponse.ok) {
        return {
          id: thread.id,
          snippet: thread.snippet,
          historyId: thread.historyId,
          messagesCount: 0,
        };
      }

      const threadData = await threadResponse.json() as GmailThread;

      return {
        id: thread.id,
        snippet: thread.snippet,
        historyId: thread.historyId,
        messagesCount: threadData.messages?.length || 0,
      };
    })
  );

  return results;
}

// Read a single Gmail message
async function readGmailMessage(
  email: string,
  messageId: string,
  format: 'full' | 'summary' = 'summary'
): Promise<{
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  labels: string[];
  body?: string;
  attachments?: Array<{ filename: string; mimeType: string; size: number }>;
}> {
  const accessToken = await getValidAccessToken(email);

  const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
  const msgResponse = await fetch(msgUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!msgResponse.ok) {
    const errorText = await msgResponse.text();
    throw new Error(`Failed to read message: ${msgResponse.status} ${errorText}`);
  }

  const message = await msgResponse.json() as GmailMessage;

  const result: {
    id: string;
    threadId: string;
    from: string;
    to: string;
    subject: string;
    date: string;
    snippet: string;
    labels: string[];
    body?: string;
    attachments?: Array<{ filename: string; mimeType: string; size: number }>;
  } = {
    id: message.id,
    threadId: message.threadId,
    from: getHeader(message, 'From'),
    to: getHeader(message, 'To'),
    subject: getHeader(message, 'Subject'),
    date: getHeader(message, 'Date'),
    snippet: message.snippet,
    labels: message.labelIds || [],
  };

  if (format === 'full' && message.payload) {
    // Extract body text
    if (message.payload.body.data) {
      result.body = decodeBase64Url(message.payload.body.data);
    } else if (message.payload.parts) {
      result.body = extractTextBody(message.payload as GmailMessagePart);
    }

    // Extract attachments
    if (message.payload.parts) {
      result.attachments = extractAttachments(message.payload as GmailMessagePart);
    }
  }

  return result;
}

// Create a Gmail draft
async function createGmailDraft(
  email: string,
  to: string,
  subject: string,
  body: string,
  cc?: string,
  bcc?: string,
  in_reply_to?: string,
): Promise<unknown> {
  const accessToken = await getValidAccessToken(email);

  // Build RFC 2822 message
  const headers: string[] = [
    `From: ${email}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
  ];
  if (cc) headers.push(`Cc: ${cc}`);
  if (bcc) headers.push(`Bcc: ${bcc}`);
  if (in_reply_to) headers.push(`In-Reply-To: ${in_reply_to}`);

  const rawMessage = headers.join('\r\n') + '\r\n\r\n' + body;
  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const requestBody: { message: { raw: string; threadId?: string } } = {
    message: { raw: encodedMessage },
  };
  if (in_reply_to) {
    // If replying, try to place in same thread by looking up the original message
    requestBody.message.threadId = in_reply_to;
  }

  const response = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail API error creating draft: ${response.status} ${errorText}`);
  }

  const draft = await response.json();
  return {
    id: draft.id,
    message_id: draft.message?.id,
    thread_id: draft.message?.threadId,
  };
}

// Execute manage_email tool
async function executeManageEmail(input: {
  account: string;
  action: 'search' | 'read' | 'draft';
  query?: string;
  num_results?: number;
  result_type?: 'threads' | 'messages';
  message_id?: string;
  format?: 'full' | 'summary';
  to?: string;
  subject?: string;
  body?: string;
  cc?: string;
  bcc?: string;
  in_reply_to?: string;
}): Promise<unknown> {
  const email = resolveAccountEmail(input.account);

  if (input.action === 'search') {
    if (!input.query) {
      return { error: 'Query is required for search action' };
    }

    const maxResults = input.num_results || 10;
    const resultType = input.result_type || 'messages';

    if (resultType === 'threads') {
      const threads = await searchGmailThreads(email, input.query, maxResults);
      return {
        success: true,
        account: email,
        result_type: 'threads',
        count: threads.length,
        threads,
      };
    } else {
      const messages = await searchGmailMessages(email, input.query, maxResults);
      return {
        success: true,
        account: email,
        result_type: 'messages',
        count: messages.length,
        messages,
      };
    }
  } else if (input.action === 'read') {
    if (!input.message_id) {
      return { error: 'message_id is required for read action' };
    }

    const format = input.format || 'summary';
    const message = await readGmailMessage(email, input.message_id, format);

    return {
      success: true,
      account: email,
      format,
      message,
    };
  } else if (input.action === 'draft') {
    if (!input.to) {
      return { error: '"to" is required for draft action' };
    }
    if (!input.subject) {
      return { error: '"subject" is required for draft action' };
    }
    if (!input.body) {
      return { error: '"body" is required for draft action' };
    }

    const draft = await createGmailDraft(
      email,
      input.to,
      input.subject,
      input.body,
      input.cc,
      input.bcc,
      input.in_reply_to,
    );

    return {
      success: true,
      account: email,
      action: 'draft',
      draft,
    };
  }

  return { error: `Unknown action: ${input.action}` };
}

function getProjectDirectories(): string[] {
  try {
    const entries = readdirSync(PROJECTS_DIR);
    return entries
      .map(entry => join(PROJECTS_DIR, entry))
      .filter(fullPath => {
        try {
          return statSync(fullPath).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

function buildSystemPrompt(): string {
  const projectDirs = getProjectDirectories();
  const dirList = projectDirs.length > 0
    ? projectDirs.map(dir => `- ${dir}`).join('\n')
    : '(No directories found)';

  return `You are an overseer agent managing multiple terminal sessions in a terminal AI agent GUI application.  

Notes::
- You will eventually act as Cameron Hightower's assistant though your actions are limited to managing CLuade Code terminals for now. 
- Your source code is in /Users/cameronhightower/Software_Projects/Claude_Code_GUI and you can spawn a Claude Code terminal in this path to make changes to yourself.
- You can only see and control terminals that were opened through this GUI.
- Terminal AI agent sessions running in VS Code, Cursor, or other terminals are not visible to you.

The user's projects are located in: ${PROJECTS_DIR}
When spawning terminals, always use FULL ABSOLUTE PATHS. If the user says "SKMD directory", use "${PROJECTS_DIR}/SKMD".
Docuspa_njs, skmd_wellness,njs, and skmd_fastapi are all in the SKMD directory.

AVAILABLE PROJECT DIRECTORIES:
${dirList}

You have access to these tools to monitor and control the terminals:

1. list_terminals - Get status of all active terminals (only shows GUI-managed terminals)
2. get_terminal_buffer - Read recent output from a specific terminal
3. send_to_terminal - Send a message or command to a terminal
4. spawn_terminal - Create a new Claude Code terminal (must use absolute paths)
5. kill_terminal - Terminate a terminal
6. set_permission_mode - Change a terminal's permission mode (default, acceptEdits, bypassPermissions, plan)
7. search_history - Search past chat sessions
8. sleep - Pause your execution and wait for conditions to be met
9. manage_email - Search, read, and draft emails in Cameron's Gmail (work or personal account) using Gmail API. Supports Gmail search syntax. Draft action creates a draft for Cameron to review and send.

Your responsibilities:
1. Monitor ongoing work across all terminals
2. Coordinate tasks when the user asks
3. Summarize progress across terminals
4. Alert if something seems stuck or errored

Workflow for terminal tasks:
After sending work to a terminal, always use the sleep tool to wait for results:

1. Provide a brief status update (e.g., "Running tests in terminal-1, checking back in 30 seconds...")
2. Call sleep with the best wait mechanism, defaulting to timeout_ms
   - For multiple terminals: use timeout_ms only, then check all terminals after waking
   - For single terminal: timeout_ms is usually sufficient, optionally add wake_on_terminal_complete
3. After waking, call get_terminal_buffer or list_terminals to check results
4. Report results to the user. If work is incomplete, sleep again and keep checking.

Important style note: match the style of the user's request.  Use direct imperatives in your instructions to the agent.  Instead of 'Help me refactor the backend' say 'Please refactor the backend'.
`;
}

interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const TOOLS: Tool[] = [
  {
    name: 'list_terminals',
    description: 'Get status of all active Claude Code terminals',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_terminal_buffer',
    description: 'Read recent output from a specific terminal',
    input_schema: {
      type: 'object',
      properties: {
        terminal_id: { type: 'string', description: 'The terminal ID' },
        lines: { type: 'number', description: 'Number of lines to retrieve (default 50)' },
      },
      required: ['terminal_id'],
    },
  },
  {
    name: 'send_to_terminal',
    description: 'Send a message or command to a terminal',
    input_schema: {
      type: 'object',
      properties: {
        terminal_id: { type: 'string', description: 'The terminal ID' },
        message: { type: 'string', description: 'The message or command to send' },
      },
      required: ['terminal_id', 'message'],
    },
  },
  {
    name: 'spawn_terminal',
    description: 'Create a new Claude Code terminal',
    input_schema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Working directory for the terminal' },
        model: { type: 'string', description: 'Model to use (opus, sonnet, haiku)' },
        permission_mode: {
          type: 'string',
          enum: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
          description: 'Permission mode',
        },
        dangerously_skip_permissions: {
          type: 'boolean',
          description: 'Skip all permission checks (use with caution)',
        },
      },
      required: ['cwd'],
    },
  },
  {
    name: 'kill_terminal',
    description: 'Terminate a terminal',
    input_schema: {
      type: 'object',
      properties: {
        terminal_id: { type: 'string', description: 'The terminal ID to kill' },
      },
      required: ['terminal_id'],
    },
  },
  {
    name: 'set_permission_mode',
    description: 'Change a terminal\'s permission mode',
    input_schema: {
      type: 'object',
      properties: {
        terminal_id: { type: 'string', description: 'The terminal ID' },
        mode: {
          type: 'string',
          enum: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
          description: 'The permission mode to set',
        },
      },
      required: ['terminal_id', 'mode'],
    },
  },
  {
    name: 'search_history',
    description: 'Search past Claude Code chat sessions. Use last_n + session_id to retrieve the final messages of a session (how it concluded). Use after/before for date range filtering. Use order:"asc" for chronological view.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Full-text search query. Required unless using last_n with session_id.' },
        session_id: { type: 'string', description: 'Filter results to a specific session ID' },
        limit: { type: 'number', description: 'Max results (default 5)' },
        after: { type: 'number', description: 'Only return messages after this Unix timestamp (ms)' },
        before: { type: 'number', description: 'Only return messages before this Unix timestamp (ms)' },
        order: { type: 'string', enum: ['asc', 'desc'], description: 'Result order: asc=chronological, desc=newest first (default)' },
        last_n: { type: 'number', description: 'Return the last N messages from session_id (requires session_id). Shows how a conversation concluded.' },
      },
      required: [],
    },
  },
  {
    name: 'sleep',
    description: 'Pause execution and wait for terminal work to complete. Use timeout_ms as your primary wait mechanism - estimate how long the task will take and sleep for that duration. After waking, check terminal status. For multiple terminals, use timeout only (not individual wake conditions).',
    input_schema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number', description: 'Duration to sleep in milliseconds. Primary wait mechanism. Estimate: 5000ms for quick commands, 30000-60000ms for tests/builds, 120000ms for long operations.' },
        wake_on_terminal_complete: {
          type: 'string',
          description: 'Optional: Terminal ID to wake early when it completes (use with single terminal only)',
        },
        wake_on_terminal_error: {
          type: 'string',
          description: 'Optional: Terminal ID to wake early when it errors (use with single terminal only)',
        },
        wake_on_terminal_input: {
          type: 'string',
          description: 'Optional: Terminal ID to wake early when it needs input (use with single terminal only)',
        },
      },
    },
  },
  {
    name: 'manage_email',
    description: 'Search, read, and draft emails in Gmail accounts using the Gmail API. Supports Gmail search syntax (e.g., "from:boss subject:urgent after:2024/01/01"). Draft action creates a draft in Gmail that the user can review and send manually.',
    input_schema: {
      type: 'object',
      properties: {
        account: {
          type: 'string',
          description: 'Account to use: "work" (cameron.hightower@simbabuilds.com), "personal" (cmrn.hightower@gmail.com), or an email address',
        },
        action: {
          type: 'string',
          enum: ['search', 'read', 'draft'],
          description: 'Action to perform: search for emails, read a specific message, or create a draft',
        },
        query: {
          type: 'string',
          description: 'Gmail search query (e.g., "from:boss subject:urgent", "is:unread", "after:2024/01/01"). Required for search action.',
        },
        num_results: {
          type: 'number',
          description: 'Maximum number of results for search (default: 10)',
        },
        result_type: {
          type: 'string',
          enum: ['threads', 'messages'],
          description: 'Return threads (conversations) or individual messages (default: messages)',
        },
        message_id: {
          type: 'string',
          description: 'Message ID to read. Required for read action.',
        },
        format: {
          type: 'string',
          enum: ['full', 'summary'],
          description: 'Output format for read action: "full" includes body and attachments, "summary" includes metadata only (default: summary)',
        },
        to: {
          type: 'string',
          description: 'Recipient email address(es), comma-separated. Required for draft action.',
        },
        subject: {
          type: 'string',
          description: 'Email subject line. Required for draft action.',
        },
        body: {
          type: 'string',
          description: 'Email body text (plain text). Required for draft action.',
        },
        cc: {
          type: 'string',
          description: 'CC recipient(s), comma-separated. Optional for draft action.',
        },
        bcc: {
          type: 'string',
          description: 'BCC recipient(s), comma-separated. Optional for draft action.',
        },
        in_reply_to: {
          type: 'string',
          description: 'Thread ID to place the draft in (for reply drafts). Optional for draft action.',
        },
      },
      required: ['account', 'action'],
    },
  },
];

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

interface OverseerThreadData {
  metadata: OverseerThread;
  conversationHistory: Anthropic.MessageParam[];
  displayMessages: OverseerMessage[];
}

export class OverseerAgent extends EventEmitter {
  private client: Anthropic;
  private terminalManager: TerminalManager;
  private historyService: HistoryService;
  private conversationHistory: Anthropic.MessageParam[] = [];
  private status: OverseerStatus = 'idle';
  private sleeping = false;
  private wakeConditions: WakeCondition[] = [];
  private wakeResolver: (() => void) | null = null;
  private abortController: AbortController | null = null;
  private isAborted = false;
  private model: string = DEFAULT_MODEL;
  private agentLoopPromise: Promise<void> | null = null;

  // Thread management
  private threads: Map<string, OverseerThreadData> = new Map();
  private activeThreadId: string | null = null;

  constructor(
    terminalManager: TerminalManager,
    historyService: HistoryService
  ) {
    super();
    this.client = new Anthropic();
    this.terminalManager = terminalManager;
    this.historyService = historyService;

    // Listen for terminal events to check wake conditions
    this.terminalManager.on('status', this.checkWakeConditions.bind(this));
    this.terminalManager.on('exit', this.checkWakeConditions.bind(this));

    // Create default GUI thread
    const defaultThread = this.createThread('gui');
    this.activeThreadId = defaultThread.id;
  }

  createThread(source: OverseerThreadSource, sourceId?: string): OverseerThread {
    const thread: OverseerThread = {
      id: crypto.randomUUID(),
      source,
      sourceId,
      createdAt: Date.now(),
      lastMessageAt: Date.now(),
      preview: '',
      messageCount: 0,
    };

    this.threads.set(thread.id, {
      metadata: thread,
      conversationHistory: [],
      displayMessages: [],
    });

    log.info('Thread created', { threadId: thread.id, source, sourceId });
    this.emit('threadCreated', thread);

    return thread;
  }

  getThreads(limit = 10): OverseerThread[] {
    const allThreads = Array.from(this.threads.values())
      .map(t => t.metadata)
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);

    return allThreads.slice(0, limit);
  }

  switchThread(threadId: string): void {
    const threadData = this.threads.get(threadId);
    if (!threadData) {
      throw new Error(`Thread ${threadId} not found`);
    }

    log.info('Switching thread', { from: this.activeThreadId, to: threadId });
    this.activeThreadId = threadId;

    // Update the current conversation history reference
    this.conversationHistory = threadData.conversationHistory;

    this.emit('threadSwitched', threadId, threadData.displayMessages);
  }

  getOrCreateThread(source: OverseerThreadSource, sourceId?: string): string {
    // Try to find existing thread by sourceId
    if (sourceId) {
      for (const [id, data] of this.threads.entries()) {
        if (data.metadata.source === source && data.metadata.sourceId === sourceId) {
          log.debug('Found existing thread', { threadId: id, source, sourceId });
          return id;
        }
      }
    }

    // Create new thread if not found
    const thread = this.createThread(source, sourceId);
    return thread.id;
  }

  /**
   * Repairs conversation history by ensuring every tool_use has a corresponding tool_result.
   * Scans the entire history and inserts missing tool_results where needed.
   * This can happen when the agent loop is interrupted during tool execution.
   */
  private repairConversationHistory(history: Anthropic.MessageParam[]): void {
    if (history.length === 0) return;

    // We need to rebuild the history array to insert missing tool_results
    const repairedHistory: Anthropic.MessageParam[] = [];
    let repairCount = 0;

    for (let i = 0; i < history.length; i++) {
      const message = history[i];
      if (!message) continue;

      repairedHistory.push(message);

      // Check if this is an assistant message with tool_use blocks
      if (message.role !== 'assistant') continue;

      const content = message.content;
      if (!Array.isArray(content)) continue;

      const toolUses = content.filter(
        (block): block is Anthropic.ToolUseBlock =>
          typeof block === 'object' && block !== null && block.type === 'tool_use'
      );

      if (toolUses.length === 0) continue;

      // Get the tool_use IDs we need results for
      const toolUseIds = new Set(toolUses.map(t => t.id));

      // Check if the next message has the required tool_results
      const nextMessage = history[i + 1];
      if (nextMessage && nextMessage.role === 'user' && Array.isArray(nextMessage.content)) {
        // Check which tool_results are present
        for (const block of nextMessage.content) {
          if (typeof block === 'object' && block !== null && 'type' in block && block.type === 'tool_result' && 'tool_use_id' in block) {
            toolUseIds.delete(block.tool_use_id as string);
          }
        }
      }

      // If any tool_use IDs are still missing results, add them
      if (toolUseIds.size > 0) {
        const missingToolUses = toolUses.filter(t => toolUseIds.has(t.id));
        log.warn('Repairing conversation history - adding missing tool_results', {
          position: i,
          missingCount: missingToolUses.length,
          toolNames: missingToolUses.map(t => t.name),
        });

        const toolResults: Anthropic.ToolResultBlockParam[] = missingToolUses.map(toolUse => ({
          type: 'tool_result' as const,
          tool_use_id: toolUse.id,
          content: '(Operation interrupted)',
        }));

        repairedHistory.push({
          role: 'user',
          content: toolResults,
        });
        repairCount++;
      }
    }

    // If we made repairs, replace the history contents
    if (repairCount > 0) {
      log.info('Conversation history repaired', { repairCount, originalLength: history.length, newLength: repairedHistory.length });
      history.length = 0;
      history.push(...repairedHistory);
    }
  }

  async chat(
    userMessage: string,
    options?: { threadId?: string; source?: OverseerThreadSource; sourceId?: string }
  ): Promise<void> {
    log.info('Chat received', { messageLength: userMessage.length, preview: userMessage.slice(0, 100), options });

    // Determine which thread to use
    let threadId: string;
    if (options?.threadId) {
      threadId = options.threadId;
    } else if (options?.source) {
      threadId = this.getOrCreateThread(options.source, options.sourceId);
    } else {
      // Use active thread or create default GUI thread
      threadId = this.activeThreadId || this.createThread('gui').id;
    }

    // Get thread data
    const threadData = this.threads.get(threadId);
    if (!threadData) {
      throw new Error(`Thread ${threadId} not found`);
    }

    // Switch to this thread if not already active
    if (this.activeThreadId !== threadId) {
      this.switchThread(threadId);
    }

    // Always ensure conversationHistory reference is correct
    this.conversationHistory = threadData.conversationHistory;

    if (this.sleeping) {
      log.info('Waking from sleep due to new message');
      this.wake();
      // Wait for the sleeping agent loop to finish adding tool results
      if (this.agentLoopPromise) {
        await this.agentLoopPromise;
      }
    }

    // Reset abort state for new chat
    this.isAborted = false;
    this.abortController = new AbortController();

    this.updateStatus('thinking');

    // Repair conversation history if it has incomplete tool_use blocks
    this.repairConversationHistory(threadData.conversationHistory);

    // Add to thread's conversation history
    threadData.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    const userMsg: OverseerMessage = {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    };

    // Add to thread's display messages
    threadData.displayMessages.push(userMsg);

    // Update thread metadata
    threadData.metadata.lastMessageAt = Date.now();
    threadData.metadata.messageCount++;
    if (!threadData.metadata.preview) {
      threadData.metadata.preview = userMessage.slice(0, 50);
    }

    this.emitMessage(userMsg);

    try {
      // Track the agent loop so we can wait for it to finish when waking from sleep
      this.agentLoopPromise = this.runAgentLoop();
      await this.agentLoopPromise;
    } catch (error) {
      if (this.isAborted) {
        log.info('Chat aborted');
        return;
      }
      log.error('Chat error', { error: String(error), stack: (error as Error).stack });
      throw error;
    } finally {
      this.agentLoopPromise = null;
    }
  }

  private async runAgentLoop(): Promise<void> {
    const MAX_ACTIONS = 75;
    let actionCount = 0;

    log.debug('Starting agent loop', { maxActions: MAX_ACTIONS });

    while (actionCount < MAX_ACTIONS) {
      // Check for abort
      if (this.isAborted) {
        log.info('Agent loop aborted');
        return;
      }

      log.debug('Making API call', { model: this.model, historyLength: this.conversationHistory.length });
      const startTime = Date.now();

      let response: Anthropic.Message;
      try {
        response = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          system: buildSystemPrompt(),
          tools: TOOLS as Anthropic.Tool[],
          messages: this.conversationHistory,
        });
        log.info('API call completed', {
          duration: Date.now() - startTime,
          stopReason: response.stop_reason,
          usage: response.usage,
        });
      } catch (apiError) {
        log.error('API call failed', {
          duration: Date.now() - startTime,
          error: String(apiError),
          stack: (apiError as Error).stack,
        });
        throw apiError;
      }

      // Check for abort after API call
      if (this.isAborted) {
        log.info('Agent loop aborted after API call');
        return;
      }

      // Add assistant response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: response.content,
      });

      // Extract text content for user display
      const textContent = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

      if (textContent) {
        this.emitMessage({
          role: 'assistant',
          content: textContent,
          timestamp: Date.now(),
        });
      }

      // Check for tool use
      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );

      if (toolUses.length === 0 || response.stop_reason === 'end_turn') {
        this.updateStatus('idle');
        break;
      }

      // Count actions and check limit
      actionCount += toolUses.length;

      if (actionCount >= MAX_ACTIONS) {
        this.emitMessage({
          role: 'assistant',
          content: `(Reached maximum actions limit: ${actionCount}/${MAX_ACTIONS})`,
          timestamp: Date.now(),
        });
        this.updateStatus('idle');
        break;
      }

      // Execute tools
      this.updateStatus('acting');
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      log.info('Executing tools', { count: toolUses.length, tools: toolUses.map(t => t.name) });

      for (const toolUse of toolUses) {
        // Check for abort before each tool
        if (this.isAborted) {
          log.info('Aborted before tool execution', { tool: toolUse.name });
          return;
        }

        log.debug('Tool start', { tool: toolUse.name, input: toolUse.input });

        // Emit tool start message
        this.emitMessage({
          role: 'tool',
          content: `Using ${toolUse.name}...`,
          timestamp: Date.now(),
          toolCall: {
            name: toolUse.name,
            input: toolUse.input as Record<string, unknown>,
            status: 'running',
          },
        });

        const toolStartTime = Date.now();
        let result: unknown;
        let threwError = false;
        try {
          result = await this.executeTool(toolUse.name, toolUse.input as Record<string, unknown>);
        } catch (err) {
          threwError = true;
          const errMsg = err instanceof Error ? err.message : String(err);
          log.warn('Tool threw error, returning to agent', { tool: toolUse.name, error: errMsg });
          result = { error: errMsg };
        }

        // Check for abort after tool execution
        if (this.isAborted) {
          log.info('Aborted after tool execution', { tool: toolUse.name });
          return;
        }

        // Emit tool completion message
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        const isError = threwError || (typeof result === 'object' && result !== null && 'error' in result);

        log.info('Tool completed', {
          tool: toolUse.name,
          duration: Date.now() - toolStartTime,
          isError,
          resultPreview: resultStr.slice(0, 200),
        });

        this.emitMessage({
          role: 'tool',
          content: isError ? `${toolUse.name} failed` : `${toolUse.name} completed`,
          timestamp: Date.now(),
          toolCall: {
            name: toolUse.name,
            input: toolUse.input as Record<string, unknown>,
            result: resultStr,
            status: isError ? 'error' : 'completed',
          },
        });

        // Check if this was a sleep tool
        if (toolUse.name === 'sleep' && this.sleeping) {
          // Wait for wake
          await new Promise<void>((resolve) => {
            this.wakeResolver = resolve;
          });
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: resultStr,
        });
      }

      // Add tool results to history
      this.conversationHistory.push({
        role: 'user',
        content: toolResults,
      });
    }
  }

  private async executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'list_terminals':
        return this.terminalManager.list();

      case 'get_terminal_buffer': {
        const buffer = this.terminalManager.getBuffer(
          input.terminal_id as string,
          (input.lines as number) || 50
        );
        // Join buffer and truncate to save tokens (keep the END/tail of output)
        const MAX_BUFFER_CHARS = 15000;
        const bufferStr = Array.isArray(buffer) ? buffer.join('\n') : String(buffer);
        if (bufferStr.length > MAX_BUFFER_CHARS) {
          log.info('Truncating terminal buffer', {
            terminalId: input.terminal_id,
            originalLength: bufferStr.length,
            truncatedTo: MAX_BUFFER_CHARS,
          });
          return `[...truncated, showing last ${MAX_BUFFER_CHARS} chars...]\n` + bufferStr.slice(-MAX_BUFFER_CHARS);
        }
        return bufferStr;
      }

      case 'send_to_terminal':
        this.terminalManager.send(input.terminal_id as string, input.message as string);
        return { success: true };

      case 'spawn_terminal': {
        let cwd = input.cwd as string;

        // Resolve relative paths against the projects directory
        if (!isAbsolute(cwd)) {
          cwd = resolve(PROJECTS_DIR, cwd);
        }

        // Validate path exists
        if (!existsSync(cwd)) {
          return { error: `Directory does not exist: ${cwd}. Please use a valid absolute path.` };
        }

        const options: SpawnOptions = {
          cwd,
          model: input.model as string,
          permissionMode: input.permission_mode as PermissionMode,
          dangerouslySkipPermissions: input.dangerously_skip_permissions as boolean,
        };
        const terminal = this.terminalManager.spawn(options);
        return terminal;
      }

      case 'kill_terminal':
        this.terminalManager.kill(input.terminal_id as string);
        return { success: true };

      case 'set_permission_mode':
        this.terminalManager.setPermissionMode(
          input.terminal_id as string,
          input.mode as PermissionMode
        );
        return { success: true };

      case 'search_history': {
        const MAX_CONTENT_CHARS = 300;

        // last_n mode: get final messages from a session
        if (input.last_n && input.session_id) {
          const messages = this.historyService.getLastMessages(
            input.session_id as string,
            input.last_n as number
          );
          // Truncate content
          for (const msg of messages) {
            if (typeof msg.content === 'string' && msg.content.length > MAX_CONTENT_CHARS) {
              (msg as { content: string }).content = msg.content.slice(0, MAX_CONTENT_CHARS) + '...';
            }
          }
          return messages;
        }

        if (!input.query) {
          return { error: 'query is required unless using last_n with session_id' };
        }

        const results = await this.historyService.searchMessages(
          input.query as string,
          input.session_id as string | undefined,
          (input.limit as number) || 5,
          input.after as number | undefined,
          input.before as number | undefined,
          (input.order as 'asc' | 'desc') || 'desc'
        );
        // Truncate each result's message.content to save tokens
        if (Array.isArray(results)) {
          let truncatedCount = 0;
          for (const result of results) {
            if (result && typeof result === 'object' && 'message' in result) {
              const msg = result.message as { content?: string };
              if (msg && typeof msg.content === 'string' && msg.content.length > MAX_CONTENT_CHARS) {
                msg.content = msg.content.slice(0, MAX_CONTENT_CHARS) + '...';
                truncatedCount++;
              }
            }
          }
          if (truncatedCount > 0) {
            log.info('Truncated search_history results', {
              query: input.query,
              resultsCount: results.length,
              truncatedCount,
            });
          }
        }
        return results;
      }

      case 'sleep':
        return this.startSleep(input);

      case 'manage_email':
        try {
          const emailResult = await executeManageEmail(input as {
            account: string;
            action: 'search' | 'read' | 'draft';
            query?: string;
            num_results?: number;
            result_type?: 'threads' | 'messages';
            message_id?: string;
            format?: 'full' | 'summary';
            to?: string;
            subject?: string;
            body?: string;
            cc?: string;
            bcc?: string;
            in_reply_to?: string;
          });
          // Truncate email body for 'read' action with 'full' format to save tokens
          const MAX_EMAIL_BODY_CHARS = 3000;
          if (
            input.action === 'read' &&
            input.format === 'full' &&
            emailResult &&
            typeof emailResult === 'object' &&
            'message' in emailResult
          ) {
            const msg = (emailResult as { message?: { body?: string } }).message;
            if (msg && typeof msg.body === 'string' && msg.body.length > MAX_EMAIL_BODY_CHARS) {
              log.info('Truncating email body', {
                messageId: input.message_id,
                originalLength: msg.body.length,
                truncatedTo: MAX_EMAIL_BODY_CHARS,
              });
              msg.body = msg.body.slice(0, MAX_EMAIL_BODY_CHARS) + `\n\n[...truncated, showing first ${MAX_EMAIL_BODY_CHARS} chars of ${msg.body.length} total...]`;
            }
          }
          return emailResult;
        } catch (error) {
          log.error('Gmail API error', { error: String(error) });
          return {
            error: `Gmail API error: ${error instanceof Error ? error.message : String(error)}`,
          };
        }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  private startSleep(input: Record<string, unknown>): { status: string; conditions: WakeCondition[] } {
    log.info('Starting sleep', input);
    this.sleeping = true;
    this.wakeConditions = [];

    if (input.timeout_ms) {
      this.wakeConditions.push({
        type: 'timeout',
        timeoutMs: input.timeout_ms as number,
      });

      setTimeout(() => {
        if (this.sleeping) {
          this.wake();
        }
      }, input.timeout_ms as number);
    }

    if (input.wake_on_terminal_complete) {
      this.wakeConditions.push({
        type: 'terminal_complete',
        terminalId: input.wake_on_terminal_complete as string,
      });
    }

    if (input.wake_on_terminal_error) {
      this.wakeConditions.push({
        type: 'terminal_error',
        terminalId: input.wake_on_terminal_error as string,
      });
    }

    if (input.wake_on_terminal_input) {
      this.wakeConditions.push({
        type: 'terminal_input_needed',
        terminalId: input.wake_on_terminal_input as string,
      });
    }

    this.updateStatus('sleeping');
    this.emit('sleeping', this.wakeConditions);

    return {
      status: 'sleeping',
      conditions: this.wakeConditions,
    };
  }

  private checkWakeConditions(terminalId: string, statusOrCode: string | number): void {
    if (!this.sleeping) return;

    for (const condition of this.wakeConditions) {
      if (condition.terminalId !== terminalId) continue;

      if (condition.type === 'terminal_complete' && statusOrCode === 'idle') {
        this.wake();
        return;
      }

      if (condition.type === 'terminal_error' && statusOrCode === 'error') {
        this.wake();
        return;
      }

      if (condition.type === 'terminal_input_needed' && statusOrCode === 'waiting_input') {
        this.wake();
        return;
      }
    }
  }

  wake(): void {
    if (!this.sleeping) return;

    log.info('Waking up');
    this.sleeping = false;
    this.wakeConditions = [];
    this.updateStatus('idle');
    this.emit('awake');

    if (this.wakeResolver) {
      this.wakeResolver();
      this.wakeResolver = null;
    }
  }

  private updateStatus(status: OverseerStatus): void {
    if (this.status !== status) {
      log.debug('Status change', { from: this.status, to: status });
      this.status = status;
      this.emit('status', status);
    }
  }

  private emitMessage(message: OverseerMessage): void {
    // Store message in active thread (except user messages which are already stored in chat())
    if (this.activeThreadId && message.role !== 'user') {
      const threadData = this.threads.get(this.activeThreadId);
      if (threadData) {
        threadData.displayMessages.push(message);
        threadData.metadata.lastMessageAt = Date.now();
        threadData.metadata.messageCount++;
      }
    }

    this.emit('message', message);
  }

  getStatus(): OverseerStatus {
    return this.status;
  }

  isSleeping(): boolean {
    return this.sleeping;
  }

  getWakeConditions(): WakeCondition[] {
    return this.wakeConditions;
  }

  clearHistory(): void {
    if (this.activeThreadId) {
      const threadData = this.threads.get(this.activeThreadId);
      if (threadData) {
        threadData.conversationHistory = [];
        threadData.displayMessages = [];
        threadData.metadata.messageCount = 0;
        log.info('Cleared active thread history', { threadId: this.activeThreadId });
      }
    }
    this.conversationHistory = [];
    this.emit('cleared');
  }

  setModel(model: string): void {
    this.model = model;
    this.emit('model', model);
  }

  getModel(): string {
    return this.model;
  }

  abort(): void {
    if (this.status === 'idle') return;

    this.isAborted = true;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Also wake if sleeping
    if (this.sleeping) {
      this.sleeping = false;
      this.wakeConditions = [];
      if (this.wakeResolver) {
        this.wakeResolver();
        this.wakeResolver = null;
      }
    }

    this.updateStatus('idle');
    this.emitMessage({
      role: 'assistant',
      content: '(Operation cancelled)',
      timestamp: Date.now(),
    });
    this.emit('aborted');
  }
}
