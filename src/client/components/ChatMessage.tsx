// Chat message rendering component

import type { ClaudeMessage, MessageContent } from '../../shared/types';

interface ChatMessageProps {
  message: ClaudeMessage;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.type === 'user';

  return (
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      {message.content.map((block, idx) => (
        <MessageBlock key={idx} block={block} isUser={isUser} />
      ))}
    </div>
  );
}

interface MessageBlockProps {
  block: MessageContent;
  isUser: boolean;
}

function MessageBlock({ block, isUser }: MessageBlockProps) {
  switch (block.type) {
    case 'text':
      return (
        <div className={isUser ? 'text-text-primary' : 'text-text-primary'}>
          <FormattedText text={block.text} />
        </div>
      );

    case 'thinking':
      return (
        <div className="message-thinking">
          <div className="flex items-center gap-2 mb-1 text-sm font-medium">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="animate-pulse">
              <path d="M8 16A8 8 0 108 0a8 8 0 000 16zm.25-11.25v2.5h2.5a.75.75 0 010 1.5h-2.5v2.5a.75.75 0 01-1.5 0v-2.5h-2.5a.75.75 0 010-1.5h2.5v-2.5a.75.75 0 011.5 0z" />
            </svg>
            Thinking
          </div>
          <FormattedText text={block.thinking} />
        </div>
      );

    case 'tool_use':
      return (
        <div className="message-tool">
          <div className="message-tool-header">
            <span className="font-mono">{block.name}</span>
          </div>
          <div className="message-tool-content">
            <ToolInput name={block.name} input={block.input} />
          </div>
        </div>
      );

    case 'tool_result':
      return (
        <div className={`message-tool ${block.is_error ? 'border-error' : ''}`}>
          <div className="message-tool-header">
            {block.is_error ? (
              <span className="text-error">Error</span>
            ) : (
              <span className="text-success">Result</span>
            )}
          </div>
          <div className="message-tool-content">
            <FormattedText text={block.content} />
          </div>
        </div>
      );

    default:
      return null;
  }
}

interface FormattedTextProps {
  text: string;
}

function FormattedText({ text }: FormattedTextProps) {
  // Simple markdown-ish formatting
  const lines = text.split('\n');

  return (
    <div className="whitespace-pre-wrap break-words">
      {lines.map((line, idx) => {
        // Code blocks
        if (line.startsWith('```')) {
          return (
            <code key={idx} className="block bg-bg-primary px-3 py-2 rounded text-sm font-mono my-2">
              {line.slice(3)}
            </code>
          );
        }

        // Inline code
        const parts = line.split(/(`[^`]+`)/g);
        return (
          <span key={idx}>
            {parts.map((part, i) => {
              if (part.startsWith('`') && part.endsWith('`')) {
                return (
                  <code key={i} className="bg-bg-tertiary px-1.5 py-0.5 rounded text-sm font-mono">
                    {part.slice(1, -1)}
                  </code>
                );
              }
              return part;
            })}
            {idx < lines.length - 1 && '\n'}
          </span>
        );
      })}
    </div>
  );
}

interface ToolInputProps {
  name: string;
  input: Record<string, unknown>;
}

function ToolInput({ name, input }: ToolInputProps) {
  // Display tool-specific input formats
  switch (name) {
    case 'Read':
    case 'FileRead':
      return (
        <div>
          <span className="text-accent">{String(input.file_path)}</span>
          {input.limit !== undefined && <span className="text-text-muted ml-2">(lines: {String(input.limit)})</span>}
        </div>
      );

    case 'Write':
    case 'FileWrite':
      return (
        <div>
          <span className="text-accent">{input.file_path as string}</span>
          <div className="mt-2 text-text-secondary max-h-32 overflow-y-auto">
            {(input.content as string)?.slice(0, 500)}
            {(input.content as string)?.length > 500 && '...'}
          </div>
        </div>
      );

    case 'Edit':
    case 'FileEdit':
      return (
        <div>
          <span className="text-accent">{input.file_path as string}</span>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-error">- </span>
              <span className="text-text-muted">{(input.old_string as string)?.slice(0, 100)}</span>
            </div>
            <div>
              <span className="text-success">+ </span>
              <span className="text-text-muted">{(input.new_string as string)?.slice(0, 100)}</span>
            </div>
          </div>
        </div>
      );

    case 'Bash':
      return (
        <div className="font-mono">
          <span className="text-success">$ </span>
          <span>{input.command as string}</span>
        </div>
      );

    case 'Glob':
      return (
        <div>
          <span className="text-warning">{String(input.pattern)}</span>
          {input.path !== undefined && <span className="text-text-muted ml-2">in {String(input.path)}</span>}
        </div>
      );

    case 'Grep':
      return (
        <div>
          <span className="text-warning">/{String(input.pattern)}/</span>
          {input.path !== undefined && <span className="text-text-muted ml-2">in {String(input.path)}</span>}
        </div>
      );

    default:
      return (
        <pre className="text-xs overflow-x-auto">
          {JSON.stringify(input, null, 2)}
        </pre>
      );
  }
}
