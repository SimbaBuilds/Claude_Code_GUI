// Header component with controls

import { useTerminalStore } from '../stores/terminals';
import { useOverseerStore } from '../stores/overseer';
import { useHistoryStore } from '../stores/history';
import { useLayoutStore } from '../stores/layout';
import { MODELS, DEFAULT_MODEL } from '../../shared/constants';
import { useState } from 'react';

export function Header() {
  const { spawn, terminals, ws } = useTerminalStore();
  const { status: overseerStatus, togglePanel: toggleOverseer, panelOpen: overseerOpen } = useOverseerStore();
  const { toggleSidebar: toggleHistory, sidebarOpen: historyOpen } = useHistoryStore();
  const { save: saveLayout } = useLayoutStore();
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);

  const handleNewTerminal = () => {
    const cwd = prompt('Working directory:', '/Users/cameronhightower/Software_Projects');
    if (cwd) {
      spawn({ cwd, model: selectedModel });
    }
  };

  const handleSaveLayout = () => {
    saveLayout(ws);
  };

  const terminalCount = terminals.size;

  return (
    <header className="flex items-center justify-between px-4 py-2 bg-bg-secondary border-b border-border">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-text-primary">Claude Code GUI</h1>

        <button
          onClick={handleNewTerminal}
          className="btn btn-primary"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z" />
          </svg>
          New Terminal
        </button>

        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
        >
          {MODELS.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>

        {terminalCount > 0 && (
          <span className="text-text-secondary text-sm">
            {terminalCount} terminal{terminalCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleOverseer}
          className={`btn ${overseerOpen ? 'btn-primary' : 'btn-secondary'}`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              overseerStatus === 'idle'
                ? 'bg-text-muted'
                : overseerStatus === 'thinking'
                ? 'bg-accent animate-pulse'
                : overseerStatus === 'sleeping'
                ? 'bg-warning'
                : 'bg-success animate-pulse'
            }`}
          />
          Overseer
        </button>

        <button
          onClick={toggleHistory}
          className={`btn ${historyOpen ? 'btn-primary' : 'btn-secondary'}`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.5 3.5a2 2 0 012-2h9a2 2 0 012 2v9a2 2 0 01-2 2h-9a2 2 0 01-2-2v-9zm2-.5a.5.5 0 00-.5.5v9a.5.5 0 00.5.5h9a.5.5 0 00.5-.5v-9a.5.5 0 00-.5-.5h-9z" />
            <path d="M4 5.5a.5.5 0 01.5-.5h7a.5.5 0 010 1h-7a.5.5 0 01-.5-.5zm0 2.5a.5.5 0 01.5-.5h7a.5.5 0 010 1h-7a.5.5 0 01-.5-.5zm0 2.5a.5.5 0 01.5-.5h4a.5.5 0 010 1h-4a.5.5 0 01-.5-.5z" />
          </svg>
          History
        </button>

        <button onClick={handleSaveLayout} className="btn btn-icon" title="Save Layout">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.5 1.5v10.793l2.146-2.147a.5.5 0 01.708.708l-3 3a.5.5 0 01-.708 0l-3-3a.5.5 0 01.708-.708L10.5 12.293V1.5a.5.5 0 011 0z" />
            <path d="M3.5 15a.5.5 0 01-.5-.5v-3a.5.5 0 01.5-.5h3a.5.5 0 010 1H4v2.5a.5.5 0 01-.5.5z" />
          </svg>
        </button>
      </div>
    </header>
  );
}
