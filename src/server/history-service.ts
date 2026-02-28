// History service - indexes and searches Claude Code chat history

import { Database } from 'bun:sqlite';
import { watch } from 'fs';
import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import { EventEmitter } from 'events';
import type { Session, HistoryMessage, ToolUse } from '../shared/types';
import type { SearchResult } from '../shared/protocol';

const CLAUDE_DIR = join(homedir(), '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

export class HistoryService extends EventEmitter {
  private db: Database;
  private watcher: ReturnType<typeof watch> | null = null;
  private syncInProgress = false;

  constructor(dbPath: string) {
    super();
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        last_message_at INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0,
        summary TEXT,
        raw_path TEXT NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_uses TEXT,
        timestamp INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)
    `);

    // FTS for full-text search
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content='messages',
        content_rowid='rowid'
      )
    `);

    // Triggers to keep FTS in sync
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END
    `);

    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      END
    `);

    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END
    `);
  }

  async startWatching(): Promise<void> {
    // Initial sync
    await this.sync();

    // Watch for changes
    try {
      this.watcher = watch(PROJECTS_DIR, { recursive: true }, async (event, filename) => {
        if (filename?.endsWith('.jsonl') && !this.syncInProgress) {
          await this.syncFile(join(PROJECTS_DIR, filename));
        }
      });
    } catch (error) {
      console.error('Failed to start watching:', error);
    }
  }

  stopWatching(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  async sync(): Promise<number> {
    if (this.syncInProgress) return 0;
    this.syncInProgress = true;

    let sessionCount = 0;

    try {
      const projectDirs = await readdir(PROJECTS_DIR).catch(() => []);

      for (const projectDir of projectDirs) {
        const projectPath = join(PROJECTS_DIR, projectDir);
        const stats = await stat(projectPath).catch(() => null);

        if (!stats?.isDirectory()) continue;

        const files = await readdir(projectPath).catch(() => []);

        for (const file of files) {
          if (file.endsWith('.jsonl')) {
            const filePath = join(projectPath, file);
            const synced = await this.syncFile(filePath);
            if (synced) sessionCount++;
          }
        }
      }

      this.emit('syncComplete', sessionCount);
    } finally {
      this.syncInProgress = false;
    }

    return sessionCount;
  }

  private async syncFile(filePath: string): Promise<boolean> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());

      if (lines.length === 0) return false;

      const sessionId = basename(filePath, '.jsonl');
      const projectPath = basename(join(filePath, '..'));

      // Check if we need to update
      const existing = this.db.query<{ message_count: number }, [string]>(
        'SELECT message_count FROM sessions WHERE id = ?'
      ).get(sessionId);

      if (existing && existing.message_count >= lines.length) {
        return false; // Already up to date
      }

      // Parse messages
      let firstTimestamp = Date.now();
      let lastTimestamp = Date.now();
      const messages: Array<{
        id: string;
        role: string;
        content: string;
        toolUses: ToolUse[];
        timestamp: number;
      }> = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          if (entry.type === 'user' || entry.type === 'assistant') {
            const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

            if (timestamp < firstTimestamp) firstTimestamp = timestamp;
            if (timestamp > lastTimestamp) lastTimestamp = timestamp;

            const msgContent = this.extractMessageContent(entry);
            const toolUses = this.extractToolUses(entry);

            messages.push({
              id: entry.uuid || `${sessionId}-${messages.length}`,
              role: entry.type,
              content: msgContent,
              toolUses,
              timestamp,
            });
          }
        } catch {
          // Skip invalid lines
        }
      }

      // Upsert session
      this.db.run(
        `INSERT INTO sessions (id, project_path, started_at, last_message_at, message_count, raw_path)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           last_message_at = excluded.last_message_at,
           message_count = excluded.message_count`,
        [sessionId, projectPath, firstTimestamp, lastTimestamp, messages.length, filePath]
      );

      // Insert messages (skip existing)
      const insertMsg = this.db.prepare(
        `INSERT OR IGNORE INTO messages (id, session_id, role, content, tool_uses, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`
      );

      for (const msg of messages) {
        insertMsg.run(
          msg.id,
          sessionId,
          msg.role,
          msg.content,
          msg.toolUses.length > 0 ? JSON.stringify(msg.toolUses) : null,
          msg.timestamp
        );
      }

      return true;
    } catch (error) {
      console.error(`Failed to sync ${filePath}:`, error);
      return false;
    }
  }

  private extractMessageContent(entry: Record<string, unknown>): string {
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message) return '';

    const content = message.content;
    if (typeof content === 'string') return content;

    if (Array.isArray(content)) {
      return content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
    }

    return '';
  }

  private extractToolUses(entry: Record<string, unknown>): ToolUse[] {
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message) return [];

    const content = message.content;
    if (!Array.isArray(content)) return [];

    return content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({
        name: b.name,
        input: b.input,
      }));
  }

  async searchSessions(query: string, limit = 20): Promise<Session[]> {
    const results = this.db
      .query<Session, [string, number]>(
        `SELECT DISTINCT s.id, s.project_path as projectPath, s.started_at as startedAt,
                s.last_message_at as lastMessageAt, s.message_count as messageCount, s.summary
         FROM sessions s
         JOIN messages m ON m.session_id = s.id
         JOIN messages_fts fts ON fts.rowid = m.rowid
         WHERE messages_fts MATCH ?
         ORDER BY s.last_message_at DESC
         LIMIT ?`
      )
      .all(query, limit);

    return results;
  }

  async searchMessages(query: string, sessionId?: string, limit = 50): Promise<SearchResult[]> {
    let sql = `
      SELECT m.id, m.session_id as sessionId, m.role, m.content, m.timestamp,
             s.project_path as projectPath, s.started_at as startedAt,
             s.last_message_at as lastMessageAt, s.message_count as messageCount,
             snippet(messages_fts, 0, '<mark>', '</mark>', '...', 32) as highlight
      FROM messages m
      JOIN messages_fts fts ON fts.rowid = m.rowid
      JOIN sessions s ON s.id = m.session_id
      WHERE messages_fts MATCH ?
    `;

    const params: (string | number)[] = [query];

    if (sessionId) {
      sql += ' AND m.session_id = ?';
      params.push(sessionId);
    }

    sql += ' ORDER BY m.timestamp DESC LIMIT ?';
    params.push(limit);

    const results = this.db.query(sql).all(...params) as Array<{
      id: string;
      sessionId: string;
      role: string;
      content: string;
      timestamp: number;
      projectPath: string;
      startedAt: number;
      lastMessageAt: number;
      messageCount: number;
      highlight: string;
    }>;

    return results.map((r) => ({
      type: 'message' as const,
      session: {
        id: r.sessionId,
        projectPath: r.projectPath,
        startedAt: r.startedAt,
        lastMessageAt: r.lastMessageAt,
        messageCount: r.messageCount,
      },
      message: {
        id: r.id,
        sessionId: r.sessionId,
        role: r.role as 'user' | 'assistant',
        content: r.content,
        timestamp: r.timestamp,
      },
      highlight: r.highlight,
    }));
  }

  getSessions(limit = 50, offset = 0): Session[] {
    return this.db
      .query<Session, [number, number]>(
        `SELECT id, project_path as projectPath, started_at as startedAt,
                last_message_at as lastMessageAt, message_count as messageCount, summary
         FROM sessions
         ORDER BY last_message_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset);
  }

  getSession(id: string): Session | null {
    return this.db
      .query<Session, [string]>(
        `SELECT id, project_path as projectPath, started_at as startedAt,
                last_message_at as lastMessageAt, message_count as messageCount, summary
         FROM sessions WHERE id = ?`
      )
      .get(id);
  }

  getMessages(sessionId: string): HistoryMessage[] {
    return this.db
      .query<HistoryMessage, [string]>(
        `SELECT id, session_id as sessionId, role, content, tool_uses as toolUses, timestamp
         FROM messages WHERE session_id = ?
         ORDER BY timestamp ASC`
      )
      .all(sessionId)
      .map((m) => ({
        ...m,
        toolUses: m.toolUses ? JSON.parse(m.toolUses as unknown as string) : undefined,
      }));
  }

  updateSummary(sessionId: string, summary: string): void {
    this.db.run('UPDATE sessions SET summary = ? WHERE id = ?', [summary, sessionId]);
  }

  close(): void {
    this.stopWatching();
    this.db.close();
  }
}
