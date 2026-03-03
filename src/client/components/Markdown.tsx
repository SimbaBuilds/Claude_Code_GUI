// Markdown rendering component for chat messages

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface MarkdownProps {
  content: string;
  className?: string;
}

export function Markdown({ content, className = '' }: MarkdownProps) {
  const components: Components = {
    // Code blocks and inline code
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const isInline = !match && !className;

      if (isInline) {
        return (
          <code
            className="bg-bg-tertiary px-1.5 py-0.5 rounded text-sm font-mono"
            {...props}
          >
            {children}
          </code>
        );
      }

      return (
        <code
          className={`block bg-bg-primary px-3 py-2 rounded text-sm font-mono overflow-x-auto ${className || ''}`}
          {...props}
        >
          {children}
        </code>
      );
    },
    // Pre blocks (wrapper for code blocks)
    pre({ children }) {
      return <pre className="my-2 overflow-x-auto">{children}</pre>;
    },
    // Paragraphs
    p({ children }) {
      return <p className="mb-2 last:mb-0">{children}</p>;
    },
    // Links
    a({ href, children }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          {children}
        </a>
      );
    },
    // Lists
    ul({ children }) {
      return <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>;
    },
    ol({ children }) {
      return <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>;
    },
    li({ children }) {
      return <li className="ml-2">{children}</li>;
    },
    // Headings
    h1({ children }) {
      return <h1 className="text-xl font-bold mb-2 mt-3 first:mt-0">{children}</h1>;
    },
    h2({ children }) {
      return <h2 className="text-lg font-bold mb-2 mt-3 first:mt-0">{children}</h2>;
    },
    h3({ children }) {
      return <h3 className="text-base font-bold mb-2 mt-2 first:mt-0">{children}</h3>;
    },
    // Blockquotes
    blockquote({ children }) {
      return (
        <blockquote className="border-l-2 border-accent pl-3 my-2 text-text-secondary italic">
          {children}
        </blockquote>
      );
    },
    // Horizontal rule
    hr() {
      return <hr className="border-border my-3" />;
    },
    // Tables (GFM)
    table({ children }) {
      return (
        <div className="overflow-x-auto my-2">
          <table className="min-w-full border-collapse">{children}</table>
        </div>
      );
    },
    thead({ children }) {
      return <thead className="bg-bg-tertiary">{children}</thead>;
    },
    th({ children }) {
      return (
        <th className="border border-border px-3 py-1 text-left font-semibold">
          {children}
        </th>
      );
    },
    td({ children }) {
      return <td className="border border-border px-3 py-1">{children}</td>;
    },
    // Strong and emphasis
    strong({ children }) {
      return <strong className="font-bold">{children}</strong>;
    },
    em({ children }) {
      return <em className="italic">{children}</em>;
    },
    // Strikethrough (GFM)
    del({ children }) {
      return <del className="line-through text-text-muted">{children}</del>;
    },
  };

  return (
    <div className={`markdown-content break-words ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
