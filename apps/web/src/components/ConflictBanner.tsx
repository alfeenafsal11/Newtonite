import React from 'react';

interface ConflictBannerProps {
  actorName?: string;
  onReloadLatest: () => void;
  onReapplyChanges: () => void;
}

export const ConflictBanner: React.FC<ConflictBannerProps> = ({
  actorName,
  onReloadLatest,
  onReapplyChanges,
}) => {
  return (
    <div
      role="alert"
      style={{
        padding: '12px 16px',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        border: '1px solid var(--color-danger)',
        borderRadius: 'var(--radius-md)',
        marginBottom: '16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
      }}
    >
      <div style={{ color: 'var(--color-danger)', fontSize: '13px', fontWeight: 500 }}>
        Changed by {actorName || 'another user'} while you were editing.
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onReloadLatest}
          style={{ fontSize: '12px', padding: '4px 10px' }}
        >
          Reload latest
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onReapplyChanges}
          style={{ fontSize: '12px', padding: '4px 10px', backgroundColor: 'var(--color-danger)' }}
        >
          Re-apply my changes
        </button>
      </div>
    </div>
  );
};
