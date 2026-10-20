import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { queryKeys } from '../api/queryKeys.js';
import { useAuth } from '../state/auth.js';
import { useToast } from '../components/ToastContext.js';

interface TeamMember {
  user_id: string;
  display_name: string;
  email: string;
  role: string;
  created_at: string;
}

export const TeamMembersPage: React.FC = () => {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, memberships } = useAuth();
  const { showToast } = useToast();

  const currentMembership = memberships.find((m) => m.team_id === teamId);
  const isAdmin = currentMembership?.role === 'admin' || user?.org_role === 'org_admin';

  const { data, isLoading, error } = useQuery<{ members: TeamMember[] }>({
    queryKey: queryKeys.teamMembers(teamId!),
    queryFn: () => apiFetch(`/teams/${teamId}/members`),
    enabled: !!teamId,
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      apiFetch(`/teams/${teamId}/members/${userId}`, {
        method: 'PUT',
        body: { role },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(teamId!) });
      showToast('Member role updated', 'success');
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to update member role', 'error', err?.requestId);
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/teams/${teamId}/members/${userId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(teamId!) });
      showToast('Member removed from team', 'success');
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to remove member', 'error', err?.requestId);
    },
  });

  return (
    <div className="container" style={{ padding: '24px 16px' }}>
      <div style={{ marginBottom: '16px' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => navigate('/items')}
          style={{ fontSize: '12px', padding: '4px 10px', marginBottom: '8px' }}
        >
          ← Back to Items
        </button>
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>Team Members</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', margin: 0 }}>
          Manage team membership and access permissions.
        </p>
      </div>

      {isLoading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
          Loading members...
        </div>
      ) : error ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-danger)' }}>
          Failed to load team members.
        </div>
      ) : (
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 2fr 1.5fr 1fr',
              padding: '12px 16px',
              borderBottom: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-surface-hover)',
              fontWeight: 600,
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
            }}
          >
            <div>Name</div>
            <div>Email</div>
            <div>Role</div>
            <div style={{ textAlign: 'right' }}>Actions</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {data?.members.map((member) => (
              <div
                key={member.user_id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 2fr 1.5fr 1fr',
                  alignItems: 'center',
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--color-border)',
                  fontSize: '13px',
                }}
              >
                <div style={{ fontWeight: 600 }}>{member.display_name}</div>
                <div style={{ color: 'var(--color-text-muted)' }}>{member.email}</div>
                <div>
                  {isAdmin && member.user_id !== user?.id ? (
                    <select
                      className="input"
                      value={member.role}
                      onChange={(e) =>
                        updateRoleMutation.mutate({ userId: member.user_id, role: e.target.value })
                      }
                      style={{ fontSize: '12px', padding: '4px 8px' }}
                      disabled={updateRoleMutation.isPending}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="member">Member</option>
                      <option value="approver">Approver</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    <span className="badge badge-outline" style={{ textTransform: 'uppercase', fontSize: '11px' }}>
                      {member.role}
                    </span>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  {isAdmin && member.user_id !== user?.id && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        if (confirm(`Remove ${member.display_name} from team?`)) {
                          removeMemberMutation.mutate(member.user_id);
                        }
                      }}
                      style={{ fontSize: '11px', padding: '4px 8px', color: 'var(--color-danger)' }}
                      disabled={removeMemberMutation.isPending}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
