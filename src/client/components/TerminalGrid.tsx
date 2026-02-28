// Terminal grid layout component

import { useTerminalStore } from '../stores/terminals';
import { useLayoutStore } from '../stores/layout';
import { TerminalPane } from './TerminalPane';

export function TerminalGrid() {
  const { terminals } = useTerminalStore();
  const { gridCols, gridRows } = useLayoutStore();

  const terminalList = Array.from(terminals.values());

  if (terminalList.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-secondary">
        <div className="text-center">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <p className="text-lg mb-2">No terminals open</p>
          <p className="text-sm text-text-muted">
            Click "New Terminal" to start a Claude Code session
          </p>
        </div>
      </div>
    );
  }

  // Calculate grid based on number of terminals
  const cols = Math.min(terminalList.length, gridCols);
  const rows = Math.ceil(terminalList.length / cols);

  return (
    <div
      className="terminal-grid h-full"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
    >
      {terminalList.map((terminal) => (
        <TerminalPane key={terminal.id} terminal={terminal} />
      ))}
    </div>
  );
}
