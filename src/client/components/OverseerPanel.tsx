// Overseer agent panel with resizable height

import { useState, useRef, useEffect, useCallback } from 'react';
import { useOverseerStore } from '../stores/overseer';
import { useTerminalStore } from '../stores/terminals';
import { useLayoutStore } from '../stores/layout';

interface OverseerPanelProps {
  onHeightChange?: (height: number) => void;
}

export function OverseerPanel({ onHeightChange }: OverseerPanelProps) {
  const { status, messages, wakeConditions, chat, wake } = useOverseerStore();
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

        {status === 'sleeping' && (
          <button onClick={handleWake} className="btn btn-secondary">
            Wake
          </button>
        )}
      </div>

      {/* Wake conditions */}
      {status === 'sleeping' && wakeConditions.length > 0 && (
        <div className="px-4 py-2 bg-warning/10 border-b border-border text-sm">
          <span className="text-warning font-medium">Waiting for: </span>
          {wakeConditions.map((cond, idx) => (
            <span key={idx} className="text-text-secondary">
              {idx > 0 && ', '}
              {cond.type === 'timeout' && `${cond.timeoutMs}ms timeout`}
              {cond.type === 'terminal_complete' && `Terminal ${cond.terminalId} to complete`}
              {cond.type === 'terminal_error' && `Terminal ${cond.terminalId} to error`}
              {cond.type === 'terminal_input_needed' && `Terminal ${cond.terminalId} to need input`}
            </span>
          ))}
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
