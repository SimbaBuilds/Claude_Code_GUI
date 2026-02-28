// Session card component

import type { Session } from '../../shared/types';

interface SessionCardProps {
  session: Session;
  onClick: () => void;
  highlight?: string;
}

export function SessionCard({ session, onClick, highlight }: SessionCardProps) {
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  // Extract project name from path
  const projectName = session.projectPath
    .replace(/-Users-[^-]+-/, '')
    .split('-')
    .pop() || session.projectPath;

  return (
    <div className="session-card" onClick={onClick}>
      <div className="session-card-path" title={session.projectPath}>
        {projectName}
      </div>

      {highlight && (
        <div
          className="text-sm text-text-secondary my-1"
          dangerouslySetInnerHTML={{ __html: highlight }}
        />
      )}

      <div className="session-card-meta flex items-center justify-between">
        <span>{formatDate(session.lastMessageAt)}</span>
        <span>{session.messageCount} messages</span>
      </div>
    </div>
  );
}
