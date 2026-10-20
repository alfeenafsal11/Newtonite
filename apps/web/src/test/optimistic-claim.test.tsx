import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ToastContext.js';
import { ItemDetailPage } from '../pages/ItemDetailPage.js';

vi.mock('../state/auth.js', () => ({
  useAuth: () => ({
    user: { id: 'user-1', display_name: 'Agent One', org_role: 'member' },
    memberships: [{ team_id: 'team-1', role: 'member' }],
    token: 'fake-jwt-token',
  }),
}));

describe('optimistic-claim', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    sessionStorage.setItem('opsflow_token', 'fake-jwt-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows assignee immediately on claim, and rolls back to server item showing winner on 409 already_claimed', async () => {
    const initialItem = {
      id: 'item-1',
      key: 'OPS-101',
      team_id: 'team-1',
      type: 'customer_issue',
      title: 'Database connection lag',
      description: 'Slow queries observed',
      status: 'open',
      priority: 'p1',
      assignee_id: null,
      assignee_name: null,
      reporter_id: 'user-0',
      reporter_name: 'Reporter User',
      approval_state: null,
      requires_approval: false,
      tags: ['perf'],
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      allowed_actions: ['claim', 'update', 'comment'],
    };

    let resolveClaimPromise: (val: any) => void;
    const claimPromise = new Promise((resolve) => {
      resolveClaimPromise = resolve;
    });

    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/items/item-1/events')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ events: [], next_cursor: null }),
        });
      }
      if (url.includes('/items/item-1/comments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ comments: [], next_cursor: null }),
        });
      }
      if (url.includes('/items/item-1/claim')) {
        return claimPromise;
      }
      if (url.includes('/items/item-1')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => initialItem,
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({}),
      });
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/items/item-1']}>
            <Routes>
              <Route path="/items/:id" element={<ItemDetailPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );

    // Initial load: shows unassigned and Claim button
    expect(await screen.findByText('OPS-101')).toBeDefined();
    expect(screen.getByText('Unassigned')).toBeDefined();
    const claimBtn = screen.getByRole('button', { name: 'Claim' });
    expect(claimBtn).toBeDefined();

    // Click Claim -> optimistic mutation triggers immediately
    fireEvent.click(claimBtn);

    // Optimistic assertion: assignee shows "You" immediately
    await waitFor(() => {
      expect(screen.getByText('You')).toBeDefined();
    });

    // Server responds with 409 already_claimed (won by Agent Two)
    const winnerItem = {
      ...initialItem,
      assignee_id: 'user-2',
      assignee_name: 'Agent Two',
      status: 'in_progress',
      version: 2,
      allowed_actions: ['update', 'comment'], // claim is removed
    };

    resolveClaimPromise!({
      ok: false,
      status: 409,
      headers: new Headers({ 'x-request-id': 'req-claim-conflict' }),
      json: async () => ({
        error: {
          code: 'already_claimed',
          message: 'Item already claimed by another user',
          details: {
            current: winnerItem,
            assignee: { id: 'user-2', display_name: 'Agent Two' },
          },
        },
      }),
    });

    // Rollback / convergence: UI now displays Agent Two as assignee and Claim button is gone
    await waitFor(() => {
      expect(screen.getByText('Agent Two')).toBeDefined();
      expect(screen.queryByRole('button', { name: 'Claim' })).toBeNull();
    });

    // Toast message appears
    expect(await screen.findByText(/Claimed by Agent Two just now/i)).toBeDefined();
  });
});
