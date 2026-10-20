import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ToastContext.js';
import { ItemDetailPage } from '../pages/ItemDetailPage.js';
import { SseListener } from '../api/sse.js';

let capturedSseListener: SseListener | null = null;

vi.mock('../api/sse.js', () => ({
  SseClient: class MockSseClient {
    subscribe(listener: SseListener) {
      capturedSseListener = listener;
      return () => {
        capturedSseListener = null;
      };
    }
    connect() {}
    disconnect() {}
  },
}));

vi.mock('../state/auth.js', () => ({
  useAuth: () => ({
    user: { id: 'user-1', display_name: 'Carol', org_role: 'member' },
    memberships: [{ team_id: 'team-1', role: 'member' }],
    token: 'fake-jwt-token',
  }),
}));

describe('stale-banner', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    sessionStorage.setItem('opsflow_token', 'fake-jwt-token');
    capturedSseListener = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows StaleBanner on SSE signal when form is dirty without overwriting draft', async () => {
    let currentServerItem = {
      id: 'item-stale-1',
      key: 'OPS-303',
      team_id: 'team-1',
      type: 'customer_issue',
      title: 'Initial Server Title',
      description: 'Initial description',
      status: 'open',
      priority: 'p2',
      assignee_id: null,
      assignee_name: null,
      reporter_id: 'user-1',
      reporter_name: 'Carol',
      approval_state: null,
      requires_approval: false,
      tags: [],
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      allowed_actions: ['claim', 'update', 'comment'],
    };

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/items/item-stale-1/events')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ events: [], next_cursor: null }),
        });
      }
      if (url.includes('/items/item-stale-1/comments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ comments: [], next_cursor: null }),
        });
      }
      if (url.includes('/items/item-stale-1')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => currentServerItem,
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
          <MemoryRouter initialEntries={['/items/item-stale-1']}>
            <Routes>
              <Route path="/items/:id" element={<ItemDetailPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );

    expect(await screen.findByText('OPS-303')).toBeDefined();

    // 1. User edits the form (making it dirty)
    const titleInput = screen.getAllByDisplayValue('Initial Server Title')[0]!;
    fireEvent.change(titleInput, { target: { value: 'My Unsaved Draft Changes' } });

    // 2. Server publishes SSE item_changed signal with version 2
    currentServerItem = {
      ...currentServerItem,
      version: 2,
      title: 'Updated in Background by Colleague',
    };

    expect(capturedSseListener).not.toBeNull();
    act(() => {
      capturedSseListener!({
        item_id: 'item-stale-1',
        team_id: 'team-1',
        version: 2,
        type: 'item_updated',
      });
    });

    // 3. StaleBanner must appear
    await waitFor(() => {
      expect(screen.getByText(/This item was updated. Reload to see changes/i)).toBeDefined();
    });

    // 4. Draft must NOT be overwritten
    expect((titleInput as HTMLInputElement).value).toBe('My Unsaved Draft Changes');

    // 5. Clicking Reload on StaleBanner reloads server truth
    const reloadBtn = screen.getByRole('button', { name: 'Reload' });
    fireEvent.click(reloadBtn);

    // Stale banner disappears and updated title loads
    await waitFor(() => {
      expect(screen.queryByText(/This item was updated/i)).toBeNull();
      expect(screen.getByDisplayValue('Updated in Background by Colleague')).toBeDefined();
    });
  });

  it('refreshes silently on SSE signal when form is clean', async () => {
    let currentServerItem = {
      id: 'item-stale-2',
      key: 'OPS-304',
      team_id: 'team-1',
      type: 'customer_issue',
      title: 'Clean Initial Title',
      description: 'Clean description',
      status: 'open',
      priority: 'p2',
      assignee_id: null,
      assignee_name: null,
      reporter_id: 'user-1',
      reporter_name: 'Carol',
      approval_state: null,
      requires_approval: false,
      tags: [],
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      allowed_actions: ['claim', 'update', 'comment'],
    };

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/items/item-stale-2/events')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ events: [], next_cursor: null }),
        });
      }
      if (url.includes('/items/item-stale-2/comments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ comments: [], next_cursor: null }),
        });
      }
      if (url.includes('/items/item-stale-2')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => currentServerItem,
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
          <MemoryRouter initialEntries={['/items/item-stale-2']}>
            <Routes>
              <Route path="/items/:id" element={<ItemDetailPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );

    expect(await screen.findByText('OPS-304')).toBeDefined();

    // Form is clean (not edited). Colleague updates item on server
    currentServerItem = {
      ...currentServerItem,
      version: 2,
      title: 'Silently Updated Background Title',
    };

    expect(capturedSseListener).not.toBeNull();
    act(() => {
      capturedSseListener!({
        item_id: 'item-stale-2',
        team_id: 'team-1',
        version: 2,
        type: 'item_updated',
      });
    });

    // Form updates silently to the new title, without StaleBanner appearing
    await waitFor(() => {
      expect(screen.getByDisplayValue('Silently Updated Background Title')).toBeDefined();
    });
    expect(screen.queryByText(/This item was updated/i)).toBeNull();
  });
});
