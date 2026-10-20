import React, { useState } from 'react';
import { useIntentKey } from '../api/idempotency.js';

interface CommentBoxProps {
  onSubmit: (body: string, idempotencyKey: string) => Promise<void>;
  isSubmitting: boolean;
}

export const CommentBox: React.FC<CommentBoxProps> = ({ onSubmit, isSubmitting }) => {
  const [text, setText] = useState('');
  const { key: intentKey, reset: resetIntentKey } = useIntentKey();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || isSubmitting) return;

    try {
      await onSubmit(trimmed, intentKey);
      setText('');
      resetIntentKey();
    } catch {
      // Retry keeps the same intentKey
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        marginTop: '16px',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '16px',
      }}
    >
      <div style={{ marginBottom: '12px' }}>
        <textarea
          className="input"
          rows={3}
          placeholder="Leave a comment or note..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={isSubmitting}
          style={{ width: '100%', resize: 'vertical', fontSize: '13px' }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={isSubmitting || !text.trim()}
          style={{ fontSize: '13px', padding: '6px 14px' }}
        >
          {isSubmitting ? 'Posting...' : 'Post Comment'}
        </button>
      </div>
    </form>
  );
};
