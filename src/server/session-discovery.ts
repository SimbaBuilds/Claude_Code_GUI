// Session Discovery Service - discovers Claude Code sessions from ~/.claude/projects/

import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';

export interface DiscoveredSession {
  id: string;
  projectPath: string;
  projectHash: string;
  lastModified: Date;
  messageCount: number;
  preview?: string; // First user message
}

export class SessionDiscoveryService {
  private claudeDir = join(homedir(), '.claude', 'projects');

  async discoverSessions(limit = 50): Promise<DiscoveredSession[]> {
    const sessions: DiscoveredSession[] = [];

    // Check if claude directory exists
    if (!existsSync(this.claudeDir)) {
      console.log('Claude projects directory not found:', this.claudeDir);
      return sessions;
    }

    try {
      // Scan project directories
      const projectDirs = await readdir(this.claudeDir);

      for (const projectHash of projectDirs) {
        const projectPath = join(this.claudeDir, projectHash);

        try {
          const projectStat = await stat(projectPath);
          if (!projectStat.isDirectory()) continue;

          const files = await readdir(projectPath);

          for (const file of files) {
            if (!file.endsWith('.jsonl')) continue;

            try {
              const sessionId = file.replace('.jsonl', '');
              const filePath = join(projectPath, file);
              const stats = await stat(filePath);

              // Parse first few lines for preview
              const content = await readFile(filePath, 'utf-8');
              const lines = content.split('\n').filter(Boolean);
              const messageCount = lines.length;

              // Find first user message for preview
              let preview = '';
              for (const line of lines.slice(0, 10)) {
                try {
                  const msg = JSON.parse(line);
                  if (msg.type === 'user') {
                    // Handle different message formats
                    if (typeof msg.message?.content === 'string') {
                      preview = msg.message.content.slice(0, 100);
                    } else if (Array.isArray(msg.message?.content)) {
                      const textBlock = msg.message.content.find(
                        (b: { type: string; text?: string }) => b.type === 'text'
                      );
                      if (textBlock?.text) {
                        preview = textBlock.text.slice(0, 100);
                      }
                    }
                    if (preview) break;
                  }
                } catch {
                  // Skip invalid JSON lines
                }
              }

              sessions.push({
                id: sessionId,
                projectPath: this.resolveProjectPath(projectHash),
                projectHash,
                lastModified: stats.mtime,
                messageCount,
                preview,
              });
            } catch (err) {
              console.warn(`Failed to read session file ${file}:`, err);
            }
          }
        } catch (err) {
          console.warn(`Failed to read project directory ${projectHash}:`, err);
        }
      }
    } catch (err) {
      console.error('Failed to discover sessions:', err);
    }

    // Sort by last modified, most recent first
    sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

    return sessions.slice(0, limit);
  }

  private resolveProjectPath(hash: string): string {
    // The hash is derived from the project path
    // We can try to reverse it from a mapping file if one exists
    // For now, return the hash - could enhance later with path resolution
    // TODO: Implement path resolution from ~/.claude/projects.json if it exists
    return hash;
  }

  async getSessionById(projectHash: string, sessionId: string): Promise<DiscoveredSession | null> {
    const filePath = join(this.claudeDir, projectHash, `${sessionId}.jsonl`);

    try {
      if (!existsSync(filePath)) {
        return null;
      }

      const stats = await stat(filePath);
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const messageCount = lines.length;

      let preview = '';
      for (const line of lines.slice(0, 10)) {
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'user') {
            if (typeof msg.message?.content === 'string') {
              preview = msg.message.content.slice(0, 100);
            } else if (Array.isArray(msg.message?.content)) {
              const textBlock = msg.message.content.find(
                (b: { type: string; text?: string }) => b.type === 'text'
              );
              if (textBlock?.text) {
                preview = textBlock.text.slice(0, 100);
              }
            }
            if (preview) break;
          }
        } catch {
          // Skip invalid JSON lines
        }
      }

      return {
        id: sessionId,
        projectPath: this.resolveProjectPath(projectHash),
        projectHash,
        lastModified: stats.mtime,
        messageCount,
        preview,
      };
    } catch (err) {
      console.error(`Failed to get session ${sessionId}:`, err);
      return null;
    }
  }
}
