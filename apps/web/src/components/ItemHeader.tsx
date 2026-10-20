import React from 'react';

export interface WorkItemDetail {
  id: string;
  key: string;
  team_id?: string;
  team?: { id: string; name: string };
  type: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee?: { id: string; display_name: string } | null;
  assignee_id?: string | null;
  assignee_name?: string | null;
  reporter?: { id: string; display_name: string } | null;
  reporter_id?: string;
  reporter_name?: string | null;
  approval_state?: string | null;
  requires_approval: boolean;
  tags: string[];
  due_at?: string | null;
  stale_at?: string | null;
  is_stale?: boolean;
  is_overdue?: boolean;
  resolved_at?: string | null;
  closed_at?: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  allowed_actions?: string[];
  team_name?: string;
}

interface ItemHeaderProps {
  item: WorkItemDetail;
  isStale?: boolean;
  isOverdue?: boolean;
}

export const ItemHeader: React.FC<ItemHeaderProps> = ({ item, isStale, isOverdue }) => {
  const teamDisplayName =
    item.team?.name || item.team_name || (item.team_id ? item.team_id.slice(0, 8) : item.team?.id?.slice(0, 8) || 'Team');
  const assigneeDisplayName = item.assignee?.display_name || item.assignee_name || null;
  const reporterDisplayName =
    item.reporter?.display_name || item.reporter_name || (item.reporter_id ? item.reporter_id.slice(0, 8) : item.reporter?.id?.slice(0, 8) || 'Reporter');

  const staleFlag = isStale ?? item.is_stale;
  const overdueFlag = isOverdue ?? item.is_overdue;

  return (
    <div
      style={{
        padding: '20px 24px',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        marginBottom: '16px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--color-primary)' }}>
            {item.key}
          </span>
          <span className="badge badge-outline" style={{ textTransform: 'uppercase', fontSize: '11px' }}>
            {item.type.replace('_', ' ')}
          </span>
          <span className={`badge badge-status-${item.status}`}>
            {item.status.replace('_', ' ')}
          </span>
          <span className={`badge badge-priority-${item.priority}`}>
            {item.priority.toUpperCase()}
          </span>
          {overdueFlag && <span className="badge badge-priority-p0">OVERDUE</span>}
          {staleFlag && !overdueFlag && <span className="badge badge-priority-p1">STALE</span>}
          {item.requires_approval && (
            <span
              className="badge"
              style={{
                backgroundColor:
                  item.approval_state === 'approved'
                    ? 'rgba(34, 197, 94, 0.2)'
                    : item.approval_state === 'rejected'
                    ? 'rgba(239, 68, 68, 0.2)'
                    : 'rgba(234, 179, 8, 0.2)',
                color:
                  item.approval_state === 'approved'
                    ? '#4ade80'
                    : item.approval_state === 'rejected'
                    ? '#f87171'
                    : '#facc15',
                border: '1px solid currentColor',
              }}
            >
              Approval: {item.approval_state || 'required'}
            </span>
          )}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
          v{item.version}
        </div>
      </div>

      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '8px 0 16px 0', color: 'var(--color-text)' }}>
        {item.title}
      </h1>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px',
          paddingTop: '12px',
          borderTop: '1px solid var(--color-border)',
          fontSize: '13px',
        }}
      >
        <div>
          <span style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: '11px' }}>Team</span>
          <span style={{ fontWeight: 500 }}>{teamDisplayName}</span>
        </div>
        <div>
          <span style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: '11px' }}>Assignee</span>
          <span style={{ fontWeight: 500, fontStyle: assigneeDisplayName ? 'normal' : 'italic' }}>
            {assigneeDisplayName || 'Unassigned'}
          </span>
        </div>
        <div>
          <span style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: '11px' }}>Reporter</span>
          <span style={{ fontWeight: 500 }}>{reporterDisplayName}</span>
        </div>
        <div>
          <span style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: '11px' }}>Due Date</span>
          <span style={{ fontWeight: 500 }}>
            {item.due_at ? new Date(item.due_at).toLocaleDateString() : 'None'}
          </span>
        </div>
      </div>
    </div>
  );
};
