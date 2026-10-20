import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ToastContext.js';
import { ItemDetailPage } from '../pages/ItemDetailPage.js';

vi.mock('../state/auth.js', () => ({
  useAuth: () => ({
    user: { id: 'user-1', display_name: 'Bob', org_role: 'member' },
    memberships: [{ team_id: 'team-1', role: 'member' }],
    token: 'fake-jwt-token',
  }),
}));

describe('conflict-banner', () => {
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

  it('shows ConflictBanner on 409 version_conflict, preserves draft, and re-apply sends current version', async () => {
    const initialItem = {
      id: 'item-conflict-1',
      key: 'OPS-202',
      team_id: 'team-1',
      type: 'operational_task',
      title: 'Original Title',
      description: 'Initial description',
      status: 'in_progress',
      priority: 'p2',
      assignee_id: 'user-1',
      assignee_name: 'Bob',
      reporter_id: 'user-1',
      reporter_name: 'Bob',
      approval_state: null,
      requires_approval: false,
      tags: [],
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      allowed_actions: ['update', 'comment'],
    };

    const serverItemV2 = {
      ...initialItem,
      version: 2,
      title: 'Concurrently Updated Title by Alice',
    };

    const patchPayloads: any[] = [];

    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/items/item-conflict-1/events')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ events: [], next_cursor: null }),
        });
      }
      if (url.includes('/items/item-conflict-1/comments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ comments: [], next_cursor: null }),
        });
      }
      if (opts?.method === 'PATCH' && url.includes('/items/item-conflict-1')) {
        const parsedBody = JSON.parse(opts.body);
        patchPayloads.push(parsedBody);

        // First attempt with version 1 fails with 409 version_conflict
        if (parsedBody.expected_version === 1) {
          return Promise.resolve({
            ok: false,
            status: 409,
            headers: new Headers({ 'x-request-id': 'req-conflict-1' }),
            json: async () => ({
              error: {
                code: 'version_conflict',
                message: 'Version conflict',
                details: {
                  current: serverItemV2,
                  actor: { id: 'user-alice', display_name: 'Alice' },
                },
              },
            }),
          });
        }

        // Second attempt with version 2 succeeds
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            ...serverItemV2,
            title: parsedBody.title,
            version: 3,
          }),
        });
      }
      if (url.includes('/items/item-conflict-1')) {
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
          <MemoryRouter initialEntries={['/items/item-conflict-1']}>
            <Routes>
              <Route path="/items/:id" element={<ItemDetailPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );

    expect(await screen.findByText('OPS-202')).toBeDefined();

    // Find Title input in the form
    const titleInputs = screen.getAllByDisplayValue('Original Title');
    const formInput = titleInputs[0]!;

    // User types draft changes
    fireEvent.change(formInput, { target: { value: 'My Draft Update' } });

    // Click "Save Changes"
    const saveBtn = screen.getByRole('button', { name: 'Save Changes' });
    fireEvent.click(saveBtn);

    // Assert ConflictBanner appears with actor name
    await waitFor(() => {
      expect(screen.getByText(/Changed by Alice while you were editing/i)).toBeDefined();
    });

    // Verify draft was preserved in form input
    expect((formInput as HTMLInputElement).value).toBe('My Draft Update');

    // Verify first patch sent expected_version: 1
    expect(patchPayloads[0].expected_version).toBe(1);

    // Click "Re-apply my changes"
    const reapplyBtn = screen.getByRole('button', { name: 'Re-apply my changes' });
    fireEvent.click(reapplyBtn);

    // Verify second patch sent expected_version: 2
    await waitFor(() => {
      expect(patchPayloads.length).toBe(2);
      expect(patchPayloads[1].expected_version).toBe(2);
      expect(patchPayloads[1].title).toBe('My Draft Update');
    });

    // Conflict banner disappears after successful save
    await waitFor(() => {
      expect(screen.queryByText(/Changed by Alice while you were editing/i)).toBeNull();
    });
  });
});
