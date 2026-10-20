import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { queryKeys } from '../api/queryKeys.js';
import { useAuth } from '../state/auth.js';

interface AttentionSection {
  key: string;
  label: string;
  count: number;
  count_capped: boolean;
  items: any[];
  filter_preset: string;
}

interface TeamOverview {
  team_id: string;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  overdue_count: number;
  stale_count: number;
  unassigned_count: number;
  oldest_unassigned_created_at: string | null;
  last_7_days: {
    opened: number;
    resolved: number;
  };
  recent_events: any[];
}

export const DashboardPage: React.FC = () => {
  const { memberships } = useAuth();
  const navigate = useNavigate();

  const [selectedTeamId, setSelectedTeamId] = useState<string>(
    memberships[0]?.team_id || ''
  );

  const { data: attentionData, isLoading: isLoadingAttention } = useQuery<{
    sections: AttentionSection[];
  }>({
    queryKey: queryKeys.dashboardAttention,
    queryFn: () => apiFetch('/dashboard/attention'),
  });

  const { data: overviewData, isLoading: isLoadingOverview } = useQuery<TeamOverview>({
    queryKey: queryKeys.dashboardOverview(selectedTeamId),
    queryFn: () => apiFetch(`/dashboard/overview?team_id=${selectedTeamId}`),
    enabled: !!selectedTeamId,
  });

  const formatAge = (dateStr: string | null) => {
    if (!dateStr) return 'None';
    const ms = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(ms / (1000 * 60));
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="container" style={{ padding: '24px 16px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>Operations Dashboard</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', margin: 0 }}>
          Real-time overview of active work, pending approvals, and operational health.
        </p>
      </div>

      {/* Attention Sections */}
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Attention Queues</h2>

        {isLoadingAttention ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            Loading attention queues...
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
              gap: '16px',
            }}
          >
            {attentionData?.sections
              ?.filter((s) => s.key !== 'unread_notifications')
              .map((section) => (
                <div
                  key={section.key}
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>{section.label}</span>
                      <span
                        className="badge"
                        style={{
                          backgroundColor:
                            section.count > 0 ? 'rgba(56, 189, 248, 0.2)' : 'var(--color-surface-hover)',
                          color: section.count > 0 ? 'var(--color-primary)' : 'var(--color-text-muted)',
                          fontSize: '11px',
                          fontWeight: 700,
                        }}
                      >
                        {section.count_capped ? `${section.count}+` : section.count}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '11px', padding: '3px 8px' }}
                      onClick={() => navigate(`/items?${section.filter_preset}`)}
                    >
                      View all →
                    </button>
                  </div>

                  <div style={{ flex: 1, minHeight: '120px' }}>
                    {section.items.length === 0 ? (
                      <div
                        style={{
                          color: 'var(--color-text-muted)',
                          fontSize: '12px',
                          fontStyle: 'italic',
                          padding: '16px 0',
                          textAlign: 'center',
                        }}
                      >
                        Queue is clean.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {section.items.map((item: any) => (
                          <div
                            key={item.id}
                            onClick={() => navigate(`/items/${item.id}`)}
                            style={{
                              padding: '8px 10px',
                              backgroundColor: 'var(--color-surface-hover)',
                              borderRadius: 'var(--radius-sm)',
                              cursor: 'pointer',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: '12px',
                            }}
                          >
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '8px' }}>
                              <span style={{ fontWeight: 600, color: 'var(--color-primary)', marginRight: '6px' }}>
                                {item.key}
                              </span>
                              <span>{item.title}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                              <span className={`badge badge-priority-${item.priority}`} style={{ fontSize: '10px' }}>
                                {item.priority.toUpperCase()}
                              </span>
                              <span className={`badge badge-status-${item.status}`} style={{ fontSize: '10px' }}>
                                {item.status.replace('_', ' ')}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Team Overview Section */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Team Operations Overview</h2>
          {memberships.length > 0 && (
            <select
              className="input"
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              style={{ fontSize: '13px', padding: '6px 12px' }}
            >
              {memberships.map((m) => (
                <option key={m.team_id} value={m.team_id}>
                  {m.team_name || m.team_id}
                </option>
              ))}
            </select>
          )}
        </div>

        {isLoadingOverview ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            Loading team overview...
          </div>
        ) : overviewData ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Stat Cards */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: '12px',
              }}
            >
              <div
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px',
                }}
              >
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                  Unassigned
                </div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--color-primary)' }}>
                  {overviewData.unassigned_count}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                  Oldest: {formatAge(overviewData.oldest_unassigned_created_at)}
                </div>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px',
                }}
              >
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                  Overdue
                </div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#f87171' }}>
                  {overviewData.overdue_count}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                  Past target date
                </div>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px',
                }}
              >
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                  Stale
                </div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#facc15' }}>
                  {overviewData.stale_count}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                  Inactive threshold
                </div>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px',
                }}
              >
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                  7-Day Opened
                </div>
                <div style={{ fontSize: '22px', fontWeight: 700 }}>
                  {overviewData.last_7_days.opened}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                  New intake
                </div>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px',
                }}
              >
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                  7-Day Resolved
                </div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#4ade80' }}>
                  {overviewData.last_7_days.resolved}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                  Throughput
                </div>
              </div>
            </div>

            {/* Breakdowns & Recent Activity */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: '16px',
              }}
            >
              {/* Counts by Status & Priority */}
              <div
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                }}
              >
                <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
                  Status Distribution
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {Object.entries(overviewData.by_status).map(([status, count]) => (
                    <div
                      key={status}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '13px',
                      }}
                    >
                      <span className={`badge badge-status-${status}`}>
                        {status.replace('_', ' ')}
                      </span>
                      <span style={{ fontWeight: 600 }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Activity */}
              <div
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  maxHeight: '300px',
                  overflowY: 'auto',
                }}
              >
                <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
                  Recent Team Activity
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {overviewData.recent_events.slice(0, 10).map((ev: any) => (
                    <div
                      key={ev.id}
                      style={{
                        fontSize: '12px',
                        borderLeft: '2px solid var(--color-border)',
                        paddingLeft: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-muted)' }}>
                        <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                          {ev.actor?.display_name || 'System'}
                        </span>
                        <span>{new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div style={{ marginTop: '2px' }}>{ev.type.replace('_', ' ')}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
