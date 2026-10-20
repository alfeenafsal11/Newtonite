import React from 'react';

interface StaleBannerProps {
  onReload: () => void;
}

export const StaleBanner: React.FC<StaleBannerProps> = ({ onReload }) => {
  return (
    <div
      role="alert"
      style={{
        padding: '12px 16px',
        backgroundColor: 'rgba(234, 179, 8, 0.1)',
        border: '1px solid var(--color-warning)',
        borderRadius: 'var(--radius-md)',
        marginBottom: '16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
      }}
    >
      <div style={{ color: 'var(--color-warning)', fontSize: '13px', fontWeight: 500 }}>
        This item was updated. Reload to see changes.
      </div>
      <div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onReload}
          style={{ fontSize: '12px', padding: '4px 10px' }}
        >
          Reload
        </button>
      </div>
    </div>
  );
};
