// File-based logger for debugging and monitoring

import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_DIR = join(process.cwd(), 'logs');
const MAX_LOG_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Track when we last checked log size (avoid checking on every write)
let lastCleanupCheck = 0;
const CLEANUP_CHECK_INTERVAL = 60000; // Check at most once per minute

function cleanupOldLogs(): void {
  try {
    const now = Date.now();
    if (now - lastCleanupCheck < CLEANUP_CHECK_INTERVAL) return;
    lastCleanupCheck = now;

    if (!existsSync(LOG_DIR)) return;

    const files = readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log'))
      .map(f => {
        const path = join(LOG_DIR, f);
        const stats = statSync(path);
        return { name: f, path, size: stats.size, mtime: stats.mtime.getTime() };
      })
      .sort((a, b) => a.mtime - b.mtime); // Oldest first

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    if (totalSize <= MAX_LOG_SIZE_BYTES) return;

    // Delete oldest files until under limit
    let currentSize = totalSize;
    for (const file of files) {
      if (currentSize <= MAX_LOG_SIZE_BYTES) break;
      try {
        unlinkSync(file.path);
        currentSize -= file.size;
        console.log(`[logger] Deleted old log: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
      } catch {
        // Ignore deletion errors
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

class Logger {
  private minLevel: LogLevel = 'debug';
  private component: string;

  constructor(component: string) {
    this.component = component;
    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
  }

  private getLogFile(): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return join(LOG_DIR, `${date}.log`);
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${this.component}] ${message}${dataStr}`;
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.minLevel]) {
      return;
    }

    const formatted = this.formatMessage(level, message, data);

    // Write to file
    try {
      appendFileSync(this.getLogFile(), formatted + '\n');
      cleanupOldLogs(); // Check if we need to delete old logs
    } catch (err) {
      console.error('Failed to write to log file:', err);
    }

    // Also write to console with color
    const colors: Record<LogLevel, string> = {
      debug: '\x1b[90m', // gray
      info: '\x1b[36m',  // cyan
      warn: '\x1b[33m',  // yellow
      error: '\x1b[31m', // red
    };
    const reset = '\x1b[0m';
    console.log(`${colors[level]}${formatted}${reset}`);
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }
}

// Factory function to create loggers for different components
export function createLogger(component: string): Logger {
  return new Logger(component);
}

// Pre-configured loggers for main components
export const overseerLogger = createLogger('overseer');
export const slackLogger = createLogger('slack');
export const terminalLogger = createLogger('terminal');
export const serverLogger = createLogger('server');
