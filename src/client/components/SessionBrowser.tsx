// Session Browser - browse and resume past Claude Code sessions

import { useEffect } from 'react';
import { useSessionsStore } from '../stores/sessions';
import { useTerminalStore } from '../stores/terminals';

interface SessionBrowserProps {
  onClose: () => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function truncateHash(hash: string): string {
  // Try to extract a meaningful path from the hash
  // For now, just show the first 12 chars
  return hash.length > 12 ? `${hash.slice(0, 12)}...` : hash;
}

export function SessionBrowser({ onClose }: SessionBrowserProps) {
  const { sessions, loading, discover, resume } = useSessionsStore();
  const { ws, connected } = useTerminalStore();

  // Discover sessions when opened
  useEffect(() => {
    if (ws && connected) {
      discover(ws);
    }
  }, [ws, connected, discover]);

  const handleResume = (session: (typeof sessions)[0]) => {
    resume(ws, session);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-secondary border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Resume Session</h2>
            <p className="text-sm text-text-secondary">
              Browse and resume past Claude Code sessions from any source
            </p>
          </div>
          <button
            onClick={onClose}
            className="btn btn-icon"
            title="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
            </svg>
          </button>
        </div>

        {/* Info banner */}
        <div className="px-4 py-2 bg-accent/10 border-b border-border text-sm text-text-secondary">
          <span className="text-accent">Tip:</span> These are sessions from ~/.claude/projects/.
          Includes sessions from VS Code, Cursor, and terminal.
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <svg
                className="animate-spin h-6 w-6 text-accent"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span className="ml-2 text-text-secondary">Discovering sessions...</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              <svg
                width="48"
                height="48"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="mx-auto mb-3 opacity-50"
              >
                <path d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z" />
                <path d="M6.5 7.5A.75.75 0 017.25 8v2.25a.75.75 0 01-1.5 0V8a.75.75 0 01.75-.75zm2.5 0A.75.75 0 019.75 8v2.25a.75.75 0 01-1.5 0V8A.75.75 0 019 7.5zM8 5.75a.75.75 0 01.75.75v.5a.75.75 0 01-1.5 0v-.5a.75.75 0 01.75-.75z" />
              </svg>
              <p>No sessions found</p>
              <p className="text-sm mt-1">Sessions will appear here after using Claude Code</p>
            </div>
          ) : (
            <div className="space-y-1">
              {sessions.map((session) => (
                <button
                  key={`${session.projectHash}-${session.id}`}
                  onClick={() => handleResume(session)}
                  className="w-full text-left p-3 rounded-md hover:bg-bg-tertiary transition-colors group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-text-primary font-medium truncate">
                          {truncateHash(session.projectPath)}
                        </span>
                        <span className="text-xs text-text-muted px-1.5 py-0.5 bg-bg-tertiary rounded">
                          {session.messageCount} msgs
                        </span>
                      </div>
                      {session.preview && (
                        <p className="text-sm text-text-secondary mt-1 line-clamp-2">
                          {session.preview}
                        </p>
                      )}
                      <p className="text-xs text-text-muted mt-1">
                        {formatDate(session.lastModified)}
                      </p>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="text-accent"
                      >
                        <path
                          fillRule="evenodd"
                          d="M4.646 1.646a.5.5 0 01.708 0l6 6a.5.5 0 010 .708l-6 6a.5.5 0 01-.708-.708L10.293 8 4.646 2.354a.5.5 0 010-.708z"
                        />
                      </svg>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border flex justify-between items-center">
          <button
            onClick={() => ws && discover(ws)}
            disabled={loading}
            className="btn btn-secondary"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="currentColor"
              className={loading ? 'animate-spin' : ''}
            >
              <path d="M8 3a5 5 0 00-4.546 2.914.5.5 0 01-.908-.418A6 6 0 0114 8a.5.5 0 01-1 0 5 5 0 00-5-5z" />
              <path d="M8 13a5 5 0 004.546-2.914.5.5 0 01.908.418A6 6 0 012 8a.5.5 0 011 0 5 5 0 005 5z" />
            </svg>
            Refresh
          </button>
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
