// Terminal pane component - displays a single Claude Code session

import { useRef, useEffect } from 'react';
import { useTerminalStore } from '../stores/terminals';
import { ChatMessage } from './ChatMessage';
import { CommandInput } from './CommandInput';
import { ModeToggles } from './ModeToggles';
import type { TerminalInfo } from '../../shared/types';

interface TerminalPaneProps {
  terminal: TerminalInfo;
}

export function TerminalPane({ terminal }: TerminalPaneProps) {
  const { messages, kill, activeTerminalId, setActive } = useTerminalStore();
  const contentRef = useRef<HTMLDivElement>(null);
  const terminalMessages = messages.get(terminal.id) || [];
  const isActive = activeTerminalId === terminal.id;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [terminalMessages]);

  const handleClose = () => {
    if (confirm('Close this terminal?')) {
      kill(terminal.id);
    }
  };

  const statusColors: Record<string, string> = {
    idle: 'status-idle',
    thinking: 'status-thinking',
    running_tool: 'status-running_tool',
    waiting_input: 'status-waiting_input',
    error: 'status-error',
  };

  return (
    <div
      className={`terminal-pane ${isActive ? 'ring-2 ring-accent' : ''}`}
      onClick={() => setActive(terminal.id)}
    >
      {/* Header */}
      <div className="terminal-header">
        <div className="flex items-center gap-3">
          <span className="text-text-primary font-medium truncate max-w-[200px]" title={terminal.cwd}>
            {terminal.cwd.split('/').pop() || terminal.cwd}
          </span>
          <span className={`status-badge ${statusColors[terminal.status]}`}>
            {terminal.status.replace('_', ' ')}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <ModeToggles terminal={terminal} />

          <button
            onClick={handleClose}
            className="btn btn-icon text-text-muted hover:text-error"
            title="Close terminal"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="terminal-content" ref={contentRef}>
        {terminalMessages.length === 0 ? (
          <div className="text-text-muted text-center py-8">
            {terminal.sessionId ? (
              <>
                <svg
                  className="animate-spin h-6 w-6 text-accent mx-auto mb-2"
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
                <p className="text-accent">Resuming session...</p>
                <p className="text-sm mt-1">Loading previous conversation context</p>
              </>
            ) : (
              <>
                <p>Ready for input</p>
                <p className="text-sm mt-1">Type a message or use a slash command</p>
              </>
            )}
          </div>
        ) : (
          terminalMessages.map((msg, idx) => (
            <ChatMessage key={idx} message={msg} />
          ))
        )}
      </div>

      {/* Input */}
      <div className="terminal-input">
        <CommandInput terminalId={terminal.id} />
      </div>
    </div>
  );
}
