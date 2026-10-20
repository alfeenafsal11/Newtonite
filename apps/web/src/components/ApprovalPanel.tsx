import React, { useState } from 'react';
import { WorkItemDetail } from './ItemHeader.js';
import { useAuth } from '../state/auth.js';

interface ApprovalPanelProps {
  item: WorkItemDetail;
  onApprove: (note?: string) => void;
  onReject: (note?: string) => void;
  isPending: boolean;
}

export const ApprovalPanel: React.FC<ApprovalPanelProps> = ({
  item,
  onApprove,
  onReject,
  isPending,
}) => {
  const { user } = useAuth();
  const [note, setNote] = useState('');
  const allowed = item.allowed_actions || [];
  const canApprove = allowed.includes('approve');
  const canReject = allowed.includes('reject');

  if (!item.requires_approval && item.status !== 'pending_approval') {
    return null;
  }

  const isAssigneeOrRequester =
    user?.id === (item.assignee?.id || item.assignee_id) ||
    user?.id === (item.reporter?.id || item.reporter_id);

  return (
    <div
      style={{
        padding: '16px 20px',
        backgroundColor: 'rgba(234, 179, 8, 0.05)',
        border: '1px solid rgba(234, 179, 8, 0.3)',
        borderRadius: 'var(--radius-md)',
        marginBottom: '16px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <h4 style={{ margin: 0, color: '#facc15', fontSize: '14px', fontWeight: 600 }}>
          Approval Process
        </h4>
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
          }}
        >
          {item.approval_state ? item.approval_state.toUpperCase() : 'PENDING'}
        </span>
      </div>

      {item.status === 'pending_approval' && (
        <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '0 0 12px 0' }}>
          This item requires sign-off before it can be resolved.
        </p>
      )}

      {(canApprove || canReject) ? (
        <div style={{ marginTop: '12px' }}>
          <div style={{ marginBottom: '8px' }}>
            <input
              type="text"
              className="input"
              placeholder="Decision note (optional)..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ width: '100%', fontSize: '13px' }}
              disabled={isPending}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {canApprove && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onApprove(note.trim() || undefined)}
                disabled={isPending}
                style={{ backgroundColor: 'var(--color-success)', borderColor: 'var(--color-success)' }}
              >
                {isPending ? 'Submitting...' : 'Approve'}
              </button>
            )}
            {canReject && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onReject(note.trim() || undefined)}
                disabled={isPending}
                style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
              >
                {isPending ? 'Submitting...' : 'Reject'}
              </button>
            )}
          </div>
        </div>
      ) : item.status === 'pending_approval' ? (
        <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          {isAssigneeOrRequester
            ? 'You are the assignee or requester of this item and cannot approve it yourself.'
            : 'Only team approvers or admins can approve or reject this item.'}
        </div>
      ) : null}
    </div>
  );
};
