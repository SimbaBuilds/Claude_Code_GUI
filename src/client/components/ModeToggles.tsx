// Permission mode toggle buttons

import { useTerminalStore } from '../stores/terminals';
import type { TerminalInfo, PermissionMode } from '../../shared/types';

interface ModeTogglesProps {
  terminal: TerminalInfo;
}

export function ModeToggles({ terminal }: ModeTogglesProps) {
  const { setMode, sendKey } = useTerminalStore();

  const modes: { mode: PermissionMode; label: string; danger?: boolean }[] = [
    { mode: 'plan', label: 'Plan' },
    { mode: 'acceptEdits', label: 'Accept' },
    { mode: 'bypassPermissions', label: 'Skip Perms', danger: true },
  ];

  const handleClick = (mode: PermissionMode) => {
    // If clicking the same mode, cycle with Shift+Tab
    if (terminal.permissionMode === mode) {
      sendKey(terminal.id, 'shift+tab');
    } else {
      setMode(terminal.id, mode);
    }
  };

  const handleShiftTab = () => {
    sendKey(terminal.id, 'shift+tab');
  };

  return (
    <div className="flex items-center gap-1">
      {modes.map(({ mode, label, danger }) => {
        const isActive = terminal.permissionMode === mode;

        return (
          <button
            key={mode}
            onClick={() => handleClick(mode)}
            className={`mode-toggle ${
              isActive
                ? danger
                  ? 'mode-toggle-danger'
                  : 'mode-toggle-active'
                : 'mode-toggle-default'
            }`}
            title={`${label} mode${isActive ? ' (active)' : ''}`}
          >
            {label}
          </button>
        );
      })}

      <button
        onClick={handleShiftTab}
        className="btn btn-icon text-xs"
        title="Cycle mode (Shift+Tab)"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.534 7h3.932a.25.25 0 01.192.41l-1.966 2.36a.25.25 0 01-.384 0l-1.966-2.36a.25.25 0 01.192-.41zm-11 2h3.932a.25.25 0 00.192-.41L2.692 6.23a.25.25 0 00-.384 0L.342 8.59A.25.25 0 00.534 9z" />
          <path fillRule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 11-.771-.636A6.002 6.002 0 0114 8a.5.5 0 01-1 0 5 5 0 00-5-5zM2.5 7.5a.5.5 0 01.5.5 5 5 0 005 5c1.552 0 2.94-.707 3.857-1.818a.5.5 0 11.771.636A6.002 6.002 0 012 8a.5.5 0 01.5-.5z" />
        </svg>
      </button>
    </div>
  );
}
