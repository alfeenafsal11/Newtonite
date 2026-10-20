import React from 'react';

export interface TimelineEvent {
  id: string;
  type: string;
  actor_id?: string;
  actor?: { id: string; display_name: string } | null;
  actor_name?: string;
  payload?: Record<string, any>;
  changes?: Record<string, any>;
  item_version: number;
  created_at: string;
}

export interface TimelineComment {
  id: string;
  author_id?: string;
  author?: { id: string; display_name: string } | null;
  author_name?: string;
  body: string;
  created_at: string;
}

interface TimelineItem {
  id: string;
  kind: 'event' | 'comment';
  created_at: string;
  actor_name: string;
  content: React.ReactNode;
}

interface TimelineProps {
  events: TimelineEvent[];
  comments: TimelineComment[];
  isLoading: boolean;
  onLoadOlder?: () => void;
  hasOlder?: boolean;
}

export const Timeline: React.FC<TimelineProps> = ({
  events,
  comments,
  isLoading,
  onLoadOlder,
  hasOlder,
}) => {
  const merged: TimelineItem[] = [
    ...events.map((e) => {
      const changes = e.payload?.changes || e.changes || (e.payload && Object.keys(e.payload).length > 0 ? e.payload : null);
      const actorName = e.actor?.display_name || e.actor_name || 'System';
      return {
        id: `event-${e.id}`,
        kind: 'event' as const,
        created_at: e.created_at,
        actor_name: actorName,
        content: (
          <div>
            <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{e.type.replace(/_/g, ' ')}</span>
            {changes && Object.keys(changes).length > 0 && (
              <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                {Object.entries(changes).map(([k, v]) => (
                  <div key={k}>
                    <span style={{ fontWeight: 500 }}>{k}:</span>{' '}
                    {typeof v === 'object' && v !== null && 'from' in v
                      ? `${JSON.stringify((v as any).from)} → ${JSON.stringify((v as any).to)}`
                      : JSON.stringify(v)}
                  </div>
                ))}
              </div>
            )}
          </div>
        ),
      };
    }),
    ...comments.map((c) => ({
      id: `comment-${c.id}`,
      kind: 'comment' as const,
      created_at: c.created_at,
      actor_name: c.author?.display_name || c.author_name || 'User',
      content: (
        <div
          style={{
            whiteSpace: 'pre-wrap',
            padding: '8px 12px',
            backgroundColor: 'var(--color-surface-hover)',
            borderRadius: 'var(--radius-sm)',
            marginTop: '4px',
            fontSize: '13px',
          }}
        >
          {c.body}
        </div>
      ),
    })),
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '20px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Activity & History</h3>
        {hasOlder && onLoadOlder && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onLoadOlder}
            disabled={isLoading}
            style={{ fontSize: '11px', padding: '4px 8px' }}
          >
            Load older
          </button>
        )}
      </div>

      {merged.length === 0 ? (
        <div style={{ color: 'var(--color-text-muted)', fontSize: '13px', fontStyle: 'italic' }}>
          No activity recorded yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {merged.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                borderLeft: item.kind === 'comment' ? '2px solid var(--color-primary)' : '2px solid var(--color-border)',
                paddingLeft: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{item.actor_name}</span>
                <span>{new Date(item.created_at).toLocaleString()}</span>
              </div>
              <div>{item.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
