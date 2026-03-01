// Overseer agent panel with resizable height

import { useState, useRef, useEffect, useCallback } from 'react';
import { useOverseerStore } from '../stores/overseer';
import { useTerminalStore } from '../stores/terminals';
import { useLayoutStore } from '../stores/layout';

interface OverseerPanelProps {
  onHeightChange?: (height: number) => void;
}

// Helper function to format tool result JSON nicely
function formatToolResult(result: string): string {
  try {
    const parsed = JSON.parse(result);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return result;
  }
}

// Helper function to format timeout duration
function formatTimeout(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function OverseerPanel({ onHeightChange }: OverseerPanelProps) {
  const { status, messages, wakeConditions, chat, wake, abort, clearChat } = useOverseerStore();
  const { ws } = useTerminalStore();
  const { overseerPanelHeight, setOverseerPanel, save } = useLayoutStore();
  const [input, setInput] = useState('');
  const [isResizing, setIsResizing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  // Auto-scroll
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle resize drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startYRef.current = e.clientY;
    startHeightRef.current = overseerPanelHeight;
  }, [overseerPanelHeight]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = startYRef.current - e.clientY;
      const newHeight = Math.max(100, Math.min(600, startHeightRef.current + deltaY));
      setOverseerPanel(true, newHeight);
      onHeightChange?.(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      // Save layout when done resizing
      save(ws);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, setOverseerPanel, onHeightChange, save, ws]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || !ws) return;

    chat(trimmed, ws);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleWake = () => {
    wake(ws);
  };

  const handleAbort = () => {
    abort(ws);
  };

  const handleClear = () => {
    if (messages.length > 0 && confirm('Clear chat history?')) {
      clearChat(ws);
    }
  };

  const statusLabels: Record<string, string> = {
    idle: 'Idle',
    thinking: 'Thinking...',
    sleeping: 'Sleeping',
    acting: 'Acting...',
  };

  const statusClasses: Record<string, string> = {
    idle: 'overseer-status-idle',
    thinking: 'overseer-status-thinking',
    sleeping: 'overseer-status-sleeping',
    acting: 'overseer-status-acting',
  };

  return (
    <div ref={panelRef} className="overseer-panel h-full flex flex-col">
      {/* Resize handle */}
      <div
        className={`overseer-resize-handle ${isResizing ? 'active' : ''}`}
        onMouseDown={handleMouseDown}
      >
        <div className="overseer-resize-grip" />
      </div>

      {/* Header */}
      <div className="overseer-header">
        <div className="overseer-status">
          <span className={`overseer-status-dot ${statusClasses[status]}`} />
          <span className="text-text-primary font-medium">Overseer</span>
          <span className="text-text-secondary">{statusLabels[status]}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Cancel button for thinking/acting states */}
          {(status === 'thinking' || status === 'acting') && (
            <button
              onClick={handleAbort}
              className="btn btn-danger text-xs px-2 py-1"
              title="Cancel operation"
            >
              Cancel
            </button>
          )}

          {status === 'sleeping' && (
            <button onClick={handleWake} className="btn btn-secondary">
              Wake
            </button>
          )}

          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className="btn btn-icon text-text-muted hover:text-error"
              title="Clear chat"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6.5 1h3a.5.5 0 01.5.5v1H6v-1a.5.5 0 01.5-.5zM11 2.5v-1A1.5 1.5 0 009.5 0h-3A1.5 1.5 0 005 1.5v1H2.5a.5.5 0 000 1h.5v9.5A1.5 1.5 0 004.5 15h7a1.5 1.5 0 001.5-1.5V3.5h.5a.5.5 0 000-1H11zM4.5 14a.5.5 0 01-.5-.5V3.5h8v10a.5.5 0 01-.5.5h-7zM6 5.5a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm4 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Wake conditions - enhanced sleep state visualization */}
      {status === 'sleeping' && wakeConditions.length > 0 && (
        <div className="sleep-indicator">
          <div className="sleep-indicator-title">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="inline mr-1">
              <path d="M9.598 1.591a.75.75 0 01.785.175 7 7 0 11-8.967 8.967.75.75 0 01.961-.96 5.5 5.5 0 007.046-7.046.75.75 0 01.175-.136z" />
            </svg>
            Sleeping - Waiting for:
          </div>
          <div className="sleep-indicator-conditions">
            {wakeConditions.map((cond, idx) => (
              <span key={idx} className="sleep-condition">
                {cond.type === 'timeout' && (
                  <>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="sleep-condition-icon">
                      <path d="M8 3.5a.5.5 0 00-1 0V9a.5.5 0 00.252.434l3.5 2a.5.5 0 00.496-.868L8 8.71V3.5z" />
                      <path d="M8 16A8 8 0 118 0a8 8 0 010 16zm7-8A7 7 0 101 8a7 7 0 0014 0z" />
                    </svg>
                    {formatTimeout(cond.timeoutMs || 0)}
                  </>
                )}
                {cond.type === 'terminal_complete' && (
                  <>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="sleep-condition-icon">
                      <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                    </svg>
                    Terminal {cond.terminalId} completes
                  </>
                )}
                {cond.type === 'terminal_error' && (
                  <>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="sleep-condition-icon">
                      <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
                    </svg>
                    Terminal {cond.terminalId} errors
                  </>
                )}
                {cond.type === 'terminal_input_needed' && (
                  <>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="sleep-condition-icon">
                      <path d="M0 4a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H2a2 2 0 01-2-2V4zm4.5 0a.5.5 0 00-.5.5v7a.5.5 0 001 0v-7a.5.5 0 00-.5-.5zm2 0a.5.5 0 00-.5.5v7a.5.5 0 001 0v-7a.5.5 0 00-.5-.5z" />
                    </svg>
                    Terminal {cond.terminalId} needs input
                  </>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="overseer-content flex-1" ref={contentRef}>
        {messages.length === 0 ? (
          <div className="text-text-muted text-center py-4">
            <p>The overseer agent monitors your terminals.</p>
            <p className="text-sm mt-1">
              Ask it to coordinate tasks, summarize progress, or manage terminals.
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={idx}
              className={`mb-3 ${
                msg.role === 'user' ? 'text-right' : ''
              }`}
            >
              {/* Tool call messages */}
              {msg.role === 'tool' && msg.toolCall && (
                <div className="tool-call-message">
                  <div className="tool-call-header">
                    <span className={`tool-call-status ${msg.toolCall.status}`}>
                      {msg.toolCall.status === 'running' && (
                        <span className="tool-call-spinner" />
                      )}
                      {msg.toolCall.status === 'completed' && (
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-success">
                          <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                        </svg>
                      )}
                      {msg.toolCall.status === 'error' && (
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-error">
                          <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
                        </svg>
                      )}
                    </span>
                    <span className="tool-call-name">{msg.toolCall.name}</span>
                  </div>
                  {/* Show input parameters for running tools or collapsed for completed */}
                  {msg.toolCall.status === 'running' && Object.keys(msg.toolCall.input).length > 0 && (
                    <details className="tool-call-details" open>
                      <summary className="tool-call-summary">Input</summary>
                      <pre className="tool-call-input">{JSON.stringify(msg.toolCall.input, null, 2)}</pre>
                    </details>
                  )}
                  {/* Show result for completed tools */}
                  {msg.toolCall.status !== 'running' && msg.toolCall.result && (
                    <details className="tool-call-details">
                      <summary className="tool-call-summary">Result</summary>
                      <pre className="tool-call-result">{formatToolResult(msg.toolCall.result)}</pre>
                    </details>
                  )}
                </div>
              )}

              {/* User and assistant messages */}
              {msg.role !== 'tool' && (
                <>
                  <div
                    className={`inline-block max-w-[80%] p-3 rounded-lg ${
                      msg.role === 'user'
                        ? 'bg-accent text-white'
                        : 'bg-bg-tertiary text-text-primary'
                    }`}
                  >
                    {msg.content}
                  </div>
                  <div className="text-xs text-text-muted mt-1">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="overseer-input">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the overseer..."
            className="chat-input flex-1"
            rows={1}
            disabled={status === 'thinking' || status === 'acting'}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || status === 'thinking' || status === 'acting'}
            className="btn btn-primary self-end"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
