import React, { useState } from 'react';
import { WorkItemDetail } from './ItemHeader.js';
import { useAuth } from '../state/auth.js';

interface ActionBarProps {
  item: WorkItemDetail;
  onClaim: () => void;
  onRelease: () => void;
  onTransition: (name: string, reason?: string, resolutionNote?: string) => void;
  onRequestApproval: () => void;
  onAssign?: (assigneeId: string) => void;
  onTransfer?: (teamId: string, reason?: string) => void;
  isPending: boolean;
}

export const ActionBar: React.FC<ActionBarProps> = ({
  item,
  onClaim,
  onRelease,
  onTransition,
  onRequestApproval,
  isPending,
}) => {
  const allowed = item.allowed_actions || [];
  const [modalAction, setModalAction] = useState<string | null>(null);
  const [modalInput, setModalInput] = useState('');

  const handleModalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalAction) return;

    if (modalAction === 'resolve') {
      onTransition('resolve', undefined, modalInput.trim() || undefined);
    } else {
      onTransition(modalAction, modalInput.trim() || undefined);
    }
    setModalAction(null);
    setModalInput('');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        padding: '12px 16px',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        marginBottom: '16px',
        alignItems: 'center',
      }}
    >
      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', marginRight: '4px' }}>
        Actions:
      </span>

      {allowed.length === 0 && (
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          No actions available for current role/status
        </span>
      )}

      {/* Claim button */}
      {allowed.includes('claim') && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={onClaim}
          disabled={isPending}
        >
          {isPending ? 'Claiming...' : 'Claim'}
        </button>
      )}

      {/* Release button */}
      {allowed.includes('release') && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onRelease}
          disabled={isPending}
        >
          {isPending ? 'Releasing...' : 'Release'}
        </button>
      )}

      {/* Request approval button */}
      {allowed.includes('request_approval') && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onRequestApproval}
          disabled={isPending}
        >
          Request Approval
        </button>
      )}

      {/* Block button */}
      {allowed.includes('block') && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setModalAction('block');
            setModalInput('');
          }}
          disabled={isPending}
        >
          Block
        </button>
      )}

      {/* Unblock button */}
      {allowed.includes('unblock') && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onTransition('unblock')}
          disabled={isPending}
        >
          Unblock
        </button>
      )}

      {/* Resolve button */}
      {allowed.includes('resolve') && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setModalAction('resolve');
            setModalInput('');
          }}
          disabled={isPending}
          style={{ backgroundColor: 'var(--color-success)', borderColor: 'var(--color-success)' }}
        >
          Resolve
        </button>
      )}

      {/* Reopen button */}
      {allowed.includes('reopen') && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onTransition('reopen')}
          disabled={isPending}
        >
          Reopen
        </button>
      )}

      {/* Close button */}
      {allowed.includes('close') && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setModalAction('close');
            setModalInput('');
          }}
          disabled={isPending}
        >
          Close
        </button>
      )}

      {/* Cancel button */}
      {allowed.includes('cancel') && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setModalAction('cancel');
            setModalInput('');
          }}
          disabled={isPending}
          style={{ color: 'var(--color-danger)' }}
        >
          Cancel
        </button>
      )}

      {/* Modal for actions requiring reason / note */}
      {modalAction && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '420px' }}>
            <h3 style={{ marginBottom: '12px', textTransform: 'capitalize' }}>
              {modalAction} Item
            </h3>
            <form onSubmit={handleModalSubmit}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px' }}>
                  {modalAction === 'resolve' ? 'Resolution Note (optional):' : 'Reason (optional):'}
                </label>
                <textarea
                  className="input"
                  rows={3}
                  value={modalInput}
                  onChange={(e) => setModalInput(e.target.value)}
                  placeholder={`Enter ${modalAction} note...`}
                  style={{ width: '100%', resize: 'vertical' }}
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setModalAction(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isPending}>
                  Confirm
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
