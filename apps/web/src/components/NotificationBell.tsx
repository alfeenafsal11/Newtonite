import React, { useState, useRef, useEffect } from 'react';
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
  const [dropdownAlign, setDropdownAlign] = useState<'right' | 'left'>('right');
  const containerRef = useRef<HTMLDivElement>(null);
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

  // Close dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('touchstart', handleOutsideClick);

      // Check boundary alignment relative to viewport
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        // If aligning to right would cause dropdown (width ~360px) to bleed off left edge of screen
        if (rect.right < 370) {
          setDropdownAlign('left');
        } else {
          setDropdownAlign('right');
        }
      }
    }

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [isOpen]);

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
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{ position: 'relative', padding: '8px 14px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        aria-label="Notifications"
        aria-expanded={isOpen}
      >
        <span>Notifications</span>
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '-4px',
              right: '-4px',
              backgroundColor: 'var(--color-p0)',
              color: '#fff',
              fontSize: '11px',
              fontWeight: 700,
              borderRadius: '9999px',
              padding: '2px 6px',
              lineHeight: 1,
              boxShadow: '0 0 0 2px var(--color-surface)',
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
            top: 'calc(100% + 8px)',
            ...(dropdownAlign === 'right' ? { right: 0 } : { left: 0 }),
            width: 'min(360px, calc(100vw - 32px))',
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: '420px',
            overflowY: 'auto',
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4)',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: '13px' }}>Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '11px', padding: '3px 8px' }}
                onClick={() => markReadMutation.mutate(undefined)}
                disabled={markReadMutation.isPending}
              >
                Mark all read
              </button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>
                No notifications
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--color-border)',
                    cursor: n.item_id ? 'pointer' : 'default',
                    backgroundColor: n.read_at ? 'transparent' : 'rgba(56, 189, 248, 0.08)',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', gap: '8px' }}>
                    <span style={{ fontWeight: n.read_at ? 500 : 700, fontSize: '13px' }}>
                      {n.item_key}: {n.kind.replace('_', ' ')}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: '1.4' }}>{n.item_title}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
