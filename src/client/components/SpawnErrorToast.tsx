// Toast component for terminal spawn errors

import { useEffect } from 'react';
import { useTerminalStore } from '../stores/terminals';

export function SpawnErrorToast() {
  const { spawnError, clearSpawnError } = useTerminalStore();

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    if (spawnError) {
      const timer = setTimeout(() => {
        clearSpawnError();
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [spawnError, clearSpawnError]);

  if (!spawnError) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '80px',
        right: '16px',
        zIndex: 9999,
        maxWidth: '400px',
        animation: 'slideIn 0.2s ease-out',
      }}
    >
      <div
        style={{
          background: 'rgba(248, 81, 73, 0.15)',
          border: '1px solid var(--color-error)',
          borderRadius: '8px',
          padding: '12px 16px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ flexShrink: 0, color: 'var(--color-error)' }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--color-error)',
                margin: 0,
              }}
            >
              Failed to create terminal
            </h3>
            <p
              style={{
                marginTop: '4px',
                fontSize: '13px',
                color: 'var(--color-text-primary)',
              }}
            >
              {spawnError.error}
            </p>
            <p
              style={{
                marginTop: '4px',
                fontSize: '12px',
                color: 'var(--color-text-muted)',
                fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={spawnError.cwd}
            >
              {spawnError.cwd}
            </p>
          </div>
          <button
            onClick={clearSpawnError}
            style={{
              flexShrink: 0,
              background: 'none',
              border: 'none',
              padding: '4px',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
            }}
            title="Dismiss"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.28 3.22a.75.75 0 00-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 101.06 1.06L8 9.06l3.72 3.72a.75.75 0 101.06-1.06L9.06 8l3.72-3.72a.75.75 0 00-1.06-1.06L8 6.94 4.28 3.22z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
