// Command input with slash command autocomplete

import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { useTerminalStore } from '../stores/terminals';
import { ALL_SLASH_COMMANDS } from '../../shared/constants';

interface CommandInputProps {
  terminalId: string;
}

export function CommandInput({ terminalId }: CommandInputProps) {
  const { send, sendKey } = useTerminalStore();
  const [value, setValue] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Filter commands based on input
  const filteredCommands = value.startsWith('/')
    ? ALL_SLASH_COMMANDS.filter((cmd) =>
        cmd.name.toLowerCase().includes(value.toLowerCase())
      )
    : [];

  useEffect(() => {
    setShowMenu(filteredCommands.length > 0 && value.startsWith('/'));
    setSelectedIndex(0);
  }, [value, filteredCommands.length]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // Handle GUI-specific commands
    if (trimmed === '/history') {
      // Toggle history - handled by parent
      setValue('');
      return;
    }

    if (trimmed === '/overseer') {
      // Toggle overseer - handled by parent
      setValue('');
      return;
    }

    // Send to terminal
    send(terminalId, trimmed);
    setValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle slash menu navigation
    if (showMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }

      if (e.key === 'Tab' || (e.key === 'Enter' && filteredCommands.length > 0)) {
        e.preventDefault();
        const selected = filteredCommands[selectedIndex];
        if (selected) {
          setValue(selected.name + ' ');
          setShowMenu(false);
        }
        return;
      }

      if (e.key === 'Escape') {
        setShowMenu(false);
        return;
      }
    }

    // Submit on Enter (without shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }

    // Cancel with Escape
    if (e.key === 'Escape') {
      sendKey(terminalId, 'escape');
      return;
    }

    // Interrupt with Ctrl+C
    if (e.key === 'c' && e.ctrlKey) {
      sendKey(terminalId, 'ctrl+c');
      return;
    }
  };

  const selectCommand = (cmd: typeof ALL_SLASH_COMMANDS[0]) => {
    setValue(cmd.name + ' ');
    setShowMenu(false);
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      {/* Slash command menu */}
      {showMenu && (
        <div className="slash-menu">
          {filteredCommands.map((cmd, idx) => (
            <div
              key={cmd.name}
              className={`slash-item ${idx === selectedIndex ? 'slash-item-selected' : ''}`}
              onClick={() => selectCommand(cmd)}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <span className="slash-item-name">{cmd.name}</span>
              <span className="slash-item-desc">{cmd.description}</span>
              {cmd.args && (
                <span className="text-text-muted text-xs ml-2">{cmd.args}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message or / for commands..."
          className="chat-input flex-1"
          rows={1}
          style={{
            minHeight: '40px',
            maxHeight: '120px',
            height: 'auto',
          }}
        />

        <button
          onClick={handleSubmit}
          disabled={!value.trim()}
          className="btn btn-primary self-end"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M15.854 8.354a.5.5 0 000-.708l-4-4a.5.5 0 00-.708.708L14.293 7.5H1.5a.5.5 0 000 1h12.793l-3.147 3.146a.5.5 0 00.708.708l4-4z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
