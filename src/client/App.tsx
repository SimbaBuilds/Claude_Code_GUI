// Main App component

import { useEffect } from 'react';
import { useTerminalStore } from './stores/terminals';
import { useOverseerStore } from './stores/overseer';
import { useHistoryStore } from './stores/history';
import { useLayoutStore } from './stores/layout';
import { useSessionsStore } from './stores/sessions';
import { TerminalGrid } from './components/TerminalGrid';
import { HistorySidebar } from './components/HistorySidebar';
import { OverseerPanel } from './components/OverseerPanel';
import { Header } from './components/Header';
import { SessionBrowser } from './components/SessionBrowser';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import type { ServerMessage } from '../shared/protocol';

export function App() {
  const { connect, ws, connected, handleMessage: handleTerminalMessage } = useTerminalStore();

  // Set up keyboard shortcuts
  useKeyboardShortcuts();
  const { handleMessage: handleOverseerMessage } = useOverseerStore();
  const { handleMessage: handleHistoryMessage } = useHistoryStore();
  const { handleMessage: handleLayoutMessage, load: loadLayout, historySidebarOpen, overseerPanelOpen, overseerPanelHeight } = useLayoutStore();
  const { handleMessage: handleSessionsMessage, isOpen: sessionBrowserOpen, setOpen: setSessionBrowserOpen } = useSessionsStore();

  // Connect WebSocket on mount
  useEffect(() => {
    connect();
  }, [connect]);

  // Set up message handlers
  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage;

        // Route to appropriate store
        if (message.type.startsWith('terminal:')) {
          handleTerminalMessage(message);
        } else if (message.type.startsWith('overseer:')) {
          handleOverseerMessage(message);
        } else if (message.type.startsWith('history:')) {
          handleHistoryMessage(message);
        } else if (message.type.startsWith('layout:')) {
          handleLayoutMessage(message);
        } else if (message.type.startsWith('sessions:')) {
          handleSessionsMessage(message);
        }
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    };

    ws.addEventListener('message', handleMessage);

    return () => {
      ws.removeEventListener('message', handleMessage);
    };
  }, [ws, handleTerminalMessage, handleOverseerMessage, handleHistoryMessage, handleLayoutMessage, handleSessionsMessage]);

  // Load initial data when connected
  useEffect(() => {
    if (ws && connected) {
      loadLayout(ws);
    }
  }, [ws, connected, loadLayout]);

  return (
    <div className="h-full flex flex-col bg-bg-primary">
      <Header />

      <div className="flex-1 flex overflow-hidden">
        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Terminal grid */}
          <div className="flex-1 overflow-hidden">
            <TerminalGrid />
          </div>

          {/* Overseer panel */}
          {overseerPanelOpen && (
            <div style={{ height: overseerPanelHeight }}>
              <OverseerPanel />
            </div>
          )}
        </div>

        {/* History sidebar */}
        {historySidebarOpen && <HistorySidebar />}
      </div>

      {/* Session browser modal */}
      {sessionBrowserOpen && (
        <SessionBrowser onClose={() => setSessionBrowserOpen(false)} />
      )}
    </div>
  );
}
