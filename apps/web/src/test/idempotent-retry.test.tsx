import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CommentBox } from '../components/CommentBox.js';

describe('idempotent-retry', () => {
  it('re-sends the same Idempotency-Key on retry after failure, and uses a new key on new intent', async () => {
    const sentKeys: string[] = [];
    let shouldFail = true;

    const handleSubmit = vi.fn().mockImplementation(async (body: string, idempotencyKey: string) => {
      sentKeys.push(idempotencyKey);
      if (shouldFail) {
        throw new Error('Network failure');
      }
      return Promise.resolve();
    });

    render(<CommentBox onSubmit={handleSubmit} isSubmitting={false} />);

    const textarea = screen.getByPlaceholderText(/Leave a comment/i);
    const postBtn = screen.getByRole('button', { name: 'Post Comment' });

    // Step 1: Type text and submit (fails first attempt)
    fireEvent.change(textarea, { target: { value: 'First attempt comment' } });
    fireEvent.click(postBtn);

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledTimes(1);
    });

    const firstKey = sentKeys[0];
    expect(firstKey).toBeDefined();

    // Step 2: Retry (without resetting / after failure)
    shouldFail = false;
    fireEvent.click(postBtn);

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledTimes(2);
    });

    const secondKey = sentKeys[1];
    // Must re-use the exact same idempotency key for the same intent
    expect(secondKey).toBe(firstKey);

    // Step 3: Success clears input and resets intent key.
    // Now user begins a brand new comment interaction.
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('');
    });

    fireEvent.change(textarea, { target: { value: 'Second independent comment' } });
    fireEvent.click(postBtn);

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledTimes(3);
    });

    const thirdKey = sentKeys[2];
    // New interaction must generate a fresh idempotency key
    expect(thirdKey).not.toBe(firstKey);
  });
});
