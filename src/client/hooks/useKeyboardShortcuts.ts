// Keyboard shortcuts hook

import { useEffect, useCallback } from 'react';
import { useTerminalStore } from '../stores/terminals';
import { useOverseerStore } from '../stores/overseer';
import { useHistoryStore } from '../stores/history';
import { useLayoutStore } from '../stores/layout';

export function useKeyboardShortcuts() {
  const { terminals, spawn, activeTerminalId, setActive, sendKey, ws } = useTerminalStore();
  const { togglePanel: toggleOverseer } = useOverseerStore();
  const { toggleSidebar: toggleHistory } = useHistoryStore();
  const { save: saveLayout } = useLayoutStore();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;

      // Cmd+N: New terminal
      if (isMeta && e.key === 'n') {
        e.preventDefault();
        const cwd = prompt('Working directory:', '/');
        if (cwd) {
          spawn({ cwd });
        }
        return;
      }

      // Cmd+W: Close current terminal
      if (isMeta && e.key === 'w') {
        e.preventDefault();
        if (activeTerminalId) {
          const { kill } = useTerminalStore.getState();
          if (confirm('Close this terminal?')) {
            kill(activeTerminalId);
          }
        }
        return;
      }

      // Cmd+1-9: Focus terminal by index
      if (isMeta && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        const terminalIds = Array.from(terminals.keys());
        if (terminalIds[index]) {
          setActive(terminalIds[index]);
        }
        return;
      }

      // Cmd+\: Toggle history sidebar
      if (isMeta && e.key === '\\') {
        e.preventDefault();
        toggleHistory();
        return;
      }

      // Cmd+O: Toggle overseer panel
      if (isMeta && e.key === 'o') {
        e.preventDefault();
        toggleOverseer();
        return;
      }

      // Cmd+S: Save layout
      if (isMeta && e.key === 's') {
        e.preventDefault();
        saveLayout(ws);
        return;
      }

      // Shift+Tab: Cycle permission mode (when terminal focused)
      if (e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        if (activeTerminalId) {
          sendKey(activeTerminalId, 'shift+tab');
        }
        return;
      }

      // Escape: Interrupt current operation
      if (e.key === 'Escape') {
        if (activeTerminalId) {
          sendKey(activeTerminalId, 'escape');
        }
        return;
      }
    },
    [terminals, spawn, activeTerminalId, setActive, sendKey, toggleOverseer, toggleHistory, saveLayout, ws]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
