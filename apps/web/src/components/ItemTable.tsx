import React, { useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNavigate } from 'react-router-dom';

export interface WorkItemSummary {
  id: string;
  key: string;
  team_id?: string;
  team?: { id: string; name: string };
  type: string;
  title: string;
  status: string;
  priority: string;
  assignee?: { id: string; display_name: string } | null;
  assignee_id?: string | null;
  assignee_name?: string | null;
  due_at?: string | null;
  stale_at?: string | null;
  is_overdue?: boolean;
  is_stale?: boolean;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface ItemTableProps {
  items: WorkItemSummary[];
  isLoading: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onFetchNextPage?: () => void;
}

export const ItemTable: React.FC<ItemTableProps> = ({
  items,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  onFetchNextPage,
}) => {
  const navigate = useNavigate();
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 10,
  });

  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    const lastItem = virtualItems[virtualItems.length - 1];
    if (!lastItem) return;

    if (
      lastItem.index >= items.length - 3 &&
      hasNextPage &&
      !isFetchingNextPage &&
      onFetchNextPage
    ) {
      onFetchNextPage();
    }
  }, [virtualItems, items.length, hasNextPage, isFetchingNextPage, onFetchNextPage]);

  const now = new Date();

  const isOverdue = (item: WorkItemSummary) => {
    return (
      item.due_at &&
      new Date(item.due_at) < now &&
      !item.closed_at &&
      item.status !== 'resolved'
    );
  };

  const isStale = (item: WorkItemSummary) => {
    return (
      item.stale_at &&
      new Date(item.stale_at) <= now &&
      !item.closed_at &&
      item.status !== 'resolved'
    );
  };

  if (isLoading && items.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
        Loading items...
      </div>
    );
  }

  if (!isLoading && items.length === 0) {
    return (
      <div
        style={{
          padding: '48px',
          textAlign: 'center',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-text-muted)',
        }}
      >
        No items found matching the current filters.
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Table Header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '110px 1fr 130px 90px 160px 140px',
          padding: '10px 16px',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface-hover)',
          fontWeight: 600,
          fontSize: '12px',
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        <div>Key</div>
        <div>Title</div>
        <div>Status</div>
        <div>Priority</div>
        <div>Assignee</div>
        <div>Due / Badges</div>
      </div>

      {/* Virtualized Container */}
      <div
        ref={parentRef}
        style={{
          height: '650px',
          overflowY: 'auto',
          position: 'relative',
        }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualItems.map((virtualRow) => {
            const item = items[virtualRow.index];
            if (!item) return null;
            const overdue = isOverdue(item);
            const stale = isStale(item);

            return (
              <div
                key={item.id}
                onClick={() => navigate(`/items/${item.id}`)}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  display: 'grid',
                  gridTemplateColumns: '110px 1fr 130px 90px 160px 140px',
                  alignItems: 'center',
                  padding: '0 16px',
                  borderBottom: '1px solid var(--color-border)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  backgroundColor: 'transparent',
                  transition: 'background-color 0.15s ease',
                }}
                className="table-row-hover"
              >
                <div style={{ fontWeight: 600, color: 'var(--color-primary)' }}>
                  {item.key}
                </div>
                <div
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontWeight: 500,
                    paddingRight: '12px',
                  }}
                  title={item.title}
                >
                  {item.title}
                </div>
                <div>
                  <span className={`badge badge-status-${item.status}`}>
                    {item.status.replace('_', ' ')}
                  </span>
                </div>
                <div>
                  <span className={`badge badge-priority-${item.priority}`}>
                    {item.priority.toUpperCase()}
                  </span>
                </div>
                <div
                  style={{
                    color: (item.assignee?.display_name || item.assignee_name) ? 'var(--color-text)' : 'var(--color-text-muted)',
                    fontStyle: (item.assignee?.display_name || item.assignee_name) ? 'normal' : 'italic',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.assignee?.display_name || item.assignee_name || 'Unassigned'}
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {overdue && (
                    <span className="badge badge-priority-p0" style={{ fontSize: '10px' }}>
                      OVERDUE
                    </span>
                  )}
                  {stale && !overdue && (
                    <span className="badge badge-priority-p1" style={{ fontSize: '10px' }}>
                      STALE
                    </span>
                  )}
                  {item.due_at && (
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                      {new Date(item.due_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {isFetchingNextPage && (
          <div style={{ padding: '12px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '12px' }}>
            Loading more items...
          </div>
        )}
      </div>
    </div>
  );
};
