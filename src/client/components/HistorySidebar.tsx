// History sidebar with search and session list

import { useState, useEffect } from 'react';
import { useHistoryStore } from '../stores/history';
import { useTerminalStore } from '../stores/terminals';
import { useLayoutStore } from '../stores/layout';
import { SessionCard } from './SessionCard';

export function HistorySidebar() {
  const {
    sessions,
    searchQuery,
    searchResults,
    selectedSessionId,
    selectedSessionMessages,
    loading,
    search,
    loadSessions,
    loadMessages,
    selectSession,
    sync,
  } = useHistoryStore();
  const { ws, connected } = useTerminalStore();
  const { historySidebarWidth } = useLayoutStore();
  const [localQuery, setLocalQuery] = useState(searchQuery);

  // Load sessions when connected
  useEffect(() => {
    if (ws && connected) {
      loadSessions(ws);
    }
  }, [ws, connected, loadSessions]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localQuery !== searchQuery) {
        search(localQuery, ws);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [localQuery, searchQuery, search, ws]);

  // Load messages when session selected
  useEffect(() => {
    if (selectedSessionId && ws) {
      loadMessages(selectedSessionId, ws);
    }
  }, [selectedSessionId, ws, loadMessages]);

  const handleSync = () => {
    sync(ws);
    loadSessions(ws);
  };

  const displayItems = localQuery.trim()
    ? searchResults.map((r) => r.session)
    : sessions;

  return (
    <div className="sidebar" style={{ width: historySidebarWidth }}>
      <div className="sidebar-header flex items-center justify-between">
        <span>History</span>
        <button
          onClick={handleSync}
          className="btn btn-icon"
          title="Sync history"
          disabled={loading}
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
        </button>
      </div>

      <div className="p-2 border-b border-border">
        <input
          type="text"
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
          placeholder="Search history..."
          className="search-input"
        />
      </div>

      <div className="sidebar-content">
        {loading && displayItems.length === 0 ? (
          <div className="text-center text-text-muted py-8">
            Loading...
          </div>
        ) : displayItems.length === 0 ? (
          <div className="text-center text-text-muted py-8">
            {localQuery.trim() ? 'No results found' : 'No sessions yet'}
          </div>
        ) : (
          <>
            {/* Back button when viewing a session */}
            {selectedSessionId && (
              <button
                onClick={() => selectSession(null)}
                className="flex items-center gap-2 w-full p-2 text-left text-text-secondary hover:text-text-primary"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path fillRule="evenodd" d="M11.354 1.646a.5.5 0 010 .708L5.707 8l5.647 5.646a.5.5 0 01-.708.708l-6-6a.5.5 0 010-.708l6-6a.5.5 0 01.708 0z" />
                </svg>
                Back to sessions
              </button>
            )}

            {/* Session messages */}
            {selectedSessionId && selectedSessionMessages.length > 0 && (
              <div className="space-y-2">
                {selectedSessionMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`p-2 rounded text-sm ${
                      msg.role === 'user' ? 'bg-bg-tertiary' : ''
                    }`}
                  >
                    <div className="text-text-muted text-xs mb-1">
                      {msg.role === 'user' ? 'You' : 'Claude'}
                    </div>
                    <div className="text-text-primary line-clamp-3">
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Session list */}
            {!selectedSessionId && displayItems.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onClick={() => selectSession(session.id)}
                highlight={
                  localQuery.trim()
                    ? searchResults.find((r) => r.session.id === session.id)?.highlight
                    : undefined
                }
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
