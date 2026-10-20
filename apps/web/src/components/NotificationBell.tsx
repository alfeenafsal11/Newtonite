import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { queryKeys } from '../api/queryKeys.js';
import { useNavigate } from 'react-router-dom';

interface NotificationItem {
  id: string;
  item_id: string;
  item_key: string;
  item_title: string;
  event_id: string;
  kind: string;
  created_at: string;
  read_at: string | null;
}

interface NotificationsResponse {
  notifications: NotificationItem[];
  next_cursor: string | null;
}

export const NotificationBell: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data } = useQuery<NotificationsResponse>({
    queryKey: queryKeys.notifications,
    queryFn: () => apiFetch('/notifications'),
    refetchInterval: 30000,
  });

  const notifications = data?.notifications || [];

  const markReadMutation = useMutation({
    mutationFn: (upToId?: string) =>
      apiFetch('/notifications/read', {
        method: 'POST',
        body: upToId ? { up_to_id: upToId } : {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const handleNotificationClick = (n: NotificationItem) => {
    if (!n.read_at) {
      markReadMutation.mutate(n.id);
    }
    if (n.item_id) {
      setIsOpen(false);
      navigate(`/items/${n.item_id}`);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setIsOpen(!isOpen)}
        style={{ position: 'relative', padding: '6px 10px' }}
        aria-label="Notifications"
      >
        <span>Notifications</span>
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '-6px',
              right: '-6px',
              backgroundColor: 'var(--color-p0)',
              color: '#fff',
              fontSize: '11px',
              fontWeight: 700,
              borderRadius: '9999px',
              padding: '2px 6px',
              lineHeight: 1,
            }}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            marginTop: '8px',
            width: '320px',
            maxHeight: '400px',
            overflowY: 'auto',
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: '13px' }}>Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '11px', padding: '2px 6px' }}
                onClick={() => markReadMutation.mutate(undefined)}
                disabled={markReadMutation.isPending}
              >
                Mark all read
              </button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>
                No notifications
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid var(--color-border)',
                    cursor: n.item_id ? 'pointer' : 'default',
                    backgroundColor: n.read_at ? 'transparent' : 'rgba(56, 189, 248, 0.08)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontWeight: n.read_at ? 500 : 700, fontSize: '13px' }}>
                      {n.item_key}: {n.kind.replace('_', ' ')}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                      {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{n.item_title}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
