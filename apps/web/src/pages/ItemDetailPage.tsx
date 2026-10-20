import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../api/client.js';
import { queryKeys } from '../api/queryKeys.js';
import { useAuth } from '../state/auth.js';
import { useToast } from '../components/ToastContext.js';
import { useIntentKey } from '../api/idempotency.js';
import { SseClient } from '../api/sse.js';

import { ItemHeader, WorkItemDetail } from '../components/ItemHeader.js';
import { ActionBar } from '../components/ActionBar.js';
import { ApprovalPanel } from '../components/ApprovalPanel.js';
import { Timeline, TimelineEvent, TimelineComment } from '../components/Timeline.js';
import { CommentBox } from '../components/CommentBox.js';
import { ConflictBanner } from '../components/ConflictBanner.js';
import { StaleBanner } from '../components/StaleBanner.js';

export const ItemDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { token } = useAuth();

  // Item Query
  const {
    data: item,
    isLoading: isLoadingItem,
    error: itemError,
    refetch: refetchItem,
  } = useQuery<WorkItemDetail>({
    queryKey: queryKeys.item(id!),
    queryFn: () => apiFetch(`/items/${id}`),
    enabled: !!id,
  });

  // Events Query
  const { data: eventsData, isLoading: isLoadingEvents } = useQuery<{
    events: TimelineEvent[];
    next_cursor: string | null;
  }>({
    queryKey: queryKeys.itemEvents(id!),
    queryFn: () => apiFetch(`/items/${id}/events`),
    enabled: !!id,
  });

  // Comments Query
  const { data: commentsData } = useQuery<{
    comments: TimelineComment[];
    next_cursor: string | null;
  }>({
    queryKey: queryKeys.itemComments(id!),
    queryFn: () => apiFetch(`/items/${id}/comments`),
    enabled: !!id,
  });

  // Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<string>('p2');
  const [tagsInput, setTagsInput] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  // Conflict & Stale State
  const [conflictError, setConflictError] = useState<{
    actorName?: string;
    latestItem?: WorkItemDetail;
  } | null>(null);
  const [isStaleNotification, setIsStaleNotification] = useState(false);

  // Sync form state when server item loads or changes (if clean)
  useEffect(() => {
    if (item && !isDirty && !conflictError) {
      setTitle(item.title);
      setDescription(item.description || '');
      setPriority(item.priority);
      setTagsInput(item.tags?.join(', ') || '');
      setDueAt(item.due_at ? item.due_at.slice(0, 16) : '');
    }
  }, [item, isDirty, conflictError]);

  // SSE client for real-time invalidation / stale banner
  useEffect(() => {
    if (!id || !token) return;

    const sse = new SseClient(queryClient);
    const unsubscribe = sse.subscribe((signal) => {
      if (signal.item_id === id) {
        if (item && signal.version && signal.version > item.version) {
          if (isDirty) {
            setIsStaleNotification(true);
          } else {
            refetchItem();
            queryClient.invalidateQueries({ queryKey: queryKeys.itemEvents(id) });
          }
        }
      }
    });

    return () => unsubscribe();
  }, [id, token, isDirty, item?.version, refetchItem, queryClient]);

  // Intent Keys for mutations
  const { key: editIntentKey, reset: resetEditIntentKey } = useIntentKey();
  const { key: claimIntentKey, reset: resetClaimIntentKey } = useIntentKey();
  const { key: releaseIntentKey, reset: resetReleaseIntentKey } = useIntentKey();
  const { key: actionIntentKey, reset: resetActionIntentKey } = useIntentKey();

  // 1. Claim Mutation (Optimistic)
  const claimMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/items/${id}/claim`, {
        method: 'POST',
        idempotencyKey: claimIntentKey,
      }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.item(id!) });
      const previous = queryClient.getQueryData<WorkItemDetail>(queryKeys.item(id!));
      if (previous) {
        queryClient.setQueryData(queryKeys.item(id!), {
          ...previous,
          assignee: { id: 'me', display_name: 'You' },
          assignee_name: 'You',
          status: previous.status === 'open' ? 'in_progress' : previous.status,
          allowed_actions: (previous.allowed_actions || []).filter((a) => a !== 'claim'),
        });
      }
      return { previous };
    },
    onSuccess: (serverItem) => {
      queryClient.setQueryData(queryKeys.item(id!), serverItem);
      queryClient.invalidateQueries({ queryKey: queryKeys.itemsRoot });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardRoot });
      queryClient.invalidateQueries({ queryKey: queryKeys.itemEvents(id!) });
      showToast('Item claimed successfully', 'success');
      resetClaimIntentKey();
    },
    onError: (err: any, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.item(id!), context.previous);
      }
      if (err instanceof ApiError && err.code === 'already_claimed') {
        const winner = err.details?.assignee?.display_name || 'another user';
        showToast(`Claimed by ${winner} just now.`, 'error', err.requestId);
        if (err.details?.current) {
          queryClient.setQueryData(queryKeys.item(id!), err.details.current);
        } else {
          refetchItem();
        }
      } else {
        showToast(err.message || 'Failed to claim item', 'error', err?.requestId);
      }
    },
  });

  // 2. Release Mutation (Optimistic)
  const releaseMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/items/${id}/release`, {
        method: 'POST',
        idempotencyKey: releaseIntentKey,
      }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.item(id!) });
      const previous = queryClient.getQueryData<WorkItemDetail>(queryKeys.item(id!));
      if (previous) {
        queryClient.setQueryData(queryKeys.item(id!), {
          ...previous,
          assignee: null,
          assignee_id: null,
          assignee_name: null,
          status: 'open',
        });
      }
      return { previous };
    },
    onSuccess: (serverItem) => {
      queryClient.setQueryData(queryKeys.item(id!), serverItem);
      queryClient.invalidateQueries({ queryKey: queryKeys.itemsRoot });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardRoot });
      queryClient.invalidateQueries({ queryKey: queryKeys.itemEvents(id!) });
      showToast('Item released', 'success');
      resetReleaseIntentKey();
    },
    onError: (err: any, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.item(id!), context.previous);
      }
      showToast(err.message || 'Failed to release item', 'error', err?.requestId);
    },
  });

  // 3. Patch Mutation (Save Form)
  const patchMutation = useMutation({
    mutationFn: (expectedVersion: number) => {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      return apiFetch(`/items/${id}`, {
        method: 'PATCH',
        idempotencyKey: editIntentKey,
        body: {
          expected_version: expectedVersion,
          title: title.trim(),
          description: description.trim(),
          priority,
          tags,
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
        },
      });
    },
    onSuccess: (serverItem) => {
      queryClient.setQueryData(queryKeys.item(id!), serverItem);
      queryClient.invalidateQueries({ queryKey: queryKeys.itemsRoot });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardRoot });
      queryClient.invalidateQueries({ queryKey: queryKeys.itemEvents(id!) });
      showToast('Item updated successfully', 'success');
      setIsDirty(false);
      setConflictError(null);
      resetEditIntentKey();
    },
    onError: (err: any) => {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        const actorName = err.details?.actor?.display_name || 'another user';
        setConflictError({
          actorName,
          latestItem: err.details?.current,
        });
      } else {
        showToast(err.message || 'Failed to update item', 'error', err?.requestId);
      }
    },
  });

  // 4. Transition Mutation
  const transitionMutation = useMutation({
    mutationFn: ({
      name,
      reason,
      resolutionNote,
    }: {
      name: string;
      reason?: string;
      resolutionNote?: string;
    }) =>
      apiFetch(`/items/${id}/transition`, {
        method: 'POST',
        idempotencyKey: actionIntentKey,
        body: {
          expected_version: item!.version,
          name,
          reason,
          resolution_note: resolutionNote,
        },
      }),
    onSuccess: (serverItem) => {
      queryClient.setQueryData(queryKeys.item(id!), serverItem);
      queryClient.invalidateQueries({ queryKey: queryKeys.itemsRoot });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardRoot });
      queryClient.invalidateQueries({ queryKey: queryKeys.itemEvents(id!) });
      showToast('Status updated successfully', 'success');
      resetActionIntentKey();
    },
    onError: (err: any) => {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        refetchItem();
      }
      showToast(err.message || 'Transition failed', 'error', err?.requestId);
    },
  });

  // 5. Approval Mutations
  const requestApprovalMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/items/${id}/approval/request`, {
        method: 'POST',
        idempotencyKey: actionIntentKey,
        body: { expected_version: item!.version },
      }),
    onSuccess: (serverItem) => {
      queryClient.setQueryData(queryKeys.item(id!), serverItem);
      queryClient.invalidateQueries({ queryKey: queryKeys.itemEvents(id!) });
      showToast('Approval requested', 'success');
      resetActionIntentKey();
    },
    onError: (err: any) => {
      showToast(err.message || 'Approval request failed', 'error', err?.requestId);
    },
  });

  const approveMutation = useMutation({
    mutationFn: (note?: string) =>
      apiFetch(`/items/${id}/approval/approve`, {
        method: 'POST',
        idempotencyKey: actionIntentKey,
        body: { expected_version: item!.version, note },
      }),
    onSuccess: (serverItem) => {
      queryClient.setQueryData(queryKeys.item(id!), serverItem);
      queryClient.invalidateQueries({ queryKey: queryKeys.itemEvents(id!) });
      showToast('Item approved', 'success');
      resetActionIntentKey();
    },
    onError: (err: any) => {
      showToast(err.message || 'Approval failed', 'error', err?.requestId);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (note?: string) =>
      apiFetch(`/items/${id}/approval/reject`, {
        method: 'POST',
        idempotencyKey: actionIntentKey,
        body: { expected_version: item!.version, note },
      }),
    onSuccess: (serverItem) => {
      queryClient.setQueryData(queryKeys.item(id!), serverItem);
      queryClient.invalidateQueries({ queryKey: queryKeys.itemEvents(id!) });
      showToast('Item rejected', 'success');
      resetActionIntentKey();
    },
    onError: (err: any) => {
      showToast(err.message || 'Rejection failed', 'error', err?.requestId);
    },
  });

  // Handlers for Conflict Banner
  const handleReloadLatest = () => {
    setConflictError(null);
    setIsDirty(false);
    refetchItem();
  };

  const handleReapplyChanges = () => {
    if (!conflictError?.latestItem) {
      refetchItem();
      return;
    }
    // Rebase expected_version onto current server version, keep dirty draft
    const latestVersion = conflictError.latestItem.version;
    setConflictError(null);
    patchMutation.mutate(latestVersion);
  };

  const handleReloadStale = () => {
    setIsStaleNotification(false);
    setIsDirty(false);
    refetchItem();
  };

  const handleCommentSubmit = async (body: string, idempotencyKey: string) => {
    await apiFetch(`/items/${id}/comments`, {
      method: 'POST',
      idempotencyKey,
      body: { body },
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.itemComments(id!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.itemEvents(id!) });
    showToast('Comment posted', 'success');
  };

  if (isLoadingItem) {
    return (
      <div className="container" style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
        Loading item details...
      </div>
    );
  }

  if (itemError || !item) {
    return (
      <div className="container" style={{ padding: '48px 16px', textAlign: 'center' }}>
        <h2 style={{ color: 'var(--color-danger)' }}>Item not found</h2>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: '16px' }}>
          This item does not exist or you do not have permission to view it.
        </p>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/items')}>
          Back to Items
        </button>
      </div>
    );
  }

  const isAnyActionPending =
    claimMutation.isPending ||
    releaseMutation.isPending ||
    transitionMutation.isPending ||
    requestApprovalMutation.isPending ||
    approveMutation.isPending ||
    rejectMutation.isPending;

  return (
    <div className="container" style={{ padding: '24px 16px' }}>
      {/* Back button */}
      <div style={{ marginBottom: '12px' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => navigate('/items')}
          style={{ fontSize: '12px', padding: '4px 10px' }}
        >
          ← Back to Items
        </button>
      </div>

      {/* Conflict & Stale Banners */}
      {conflictError && (
        <ConflictBanner
          actorName={conflictError.actorName}
          onReloadLatest={handleReloadLatest}
          onReapplyChanges={handleReapplyChanges}
        />
      )}

      {isStaleNotification && <StaleBanner onReload={handleReloadStale} />}

      {/* Item Header */}
      <ItemHeader item={item} />

      {/* Action Bar */}
      <ActionBar
        item={item}
        onClaim={() => claimMutation.mutate()}
        onRelease={() => releaseMutation.mutate()}
        onTransition={(name, reason, resolutionNote) =>
          transitionMutation.mutate({ name, reason, resolutionNote })
        }
        onRequestApproval={() => requestApprovalMutation.mutate()}
        isPending={isAnyActionPending}
      />

      {/* Approval Panel */}
      <ApprovalPanel
        item={item}
        onApprove={(note) => approveMutation.mutate(note)}
        onReject={(note) => rejectMutation.mutate(note)}
        isPending={isAnyActionPending}
      />

      {/* Main Grid: Left = Editable Details Form, Right = Timeline & Comments */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '24px',
          alignItems: 'start',
        }}
      >
        {/* Editable Details Form */}
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '20px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Item Details</h3>
            {isDirty && (
              <span className="badge badge-priority-p1" style={{ fontSize: '10px' }}>
                Unsaved changes
              </span>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              patchMutation.mutate(item.version);
            }}
          >
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
                Title
              </label>
              <input
                type="text"
                className="input"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setIsDirty(true);
                }}
                disabled={item.status === 'closed'}
                style={{ width: '100%', fontSize: '13px' }}
              />
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
                Description
              </label>
              <textarea
                className="input"
                rows={5}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setIsDirty(true);
                }}
                disabled={item.status === 'closed'}
                style={{ width: '100%', resize: 'vertical', fontSize: '13px' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
                  Priority
                </label>
                <select
                  className="input"
                  value={priority}
                  onChange={(e) => {
                    setPriority(e.target.value);
                    setIsDirty(true);
                  }}
                  disabled={item.status === 'closed'}
                  style={{ width: '100%', fontSize: '13px' }}
                >
                  <option value="p0">P0 - Blocker</option>
                  <option value="p1">P1 - High</option>
                  <option value="p2">P2 - Normal</option>
                  <option value="p3">P3 - Low</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
                  Due Date
                </label>
                <input
                  type="datetime-local"
                  className="input"
                  value={dueAt}
                  onChange={(e) => {
                    setDueAt(e.target.value);
                    setIsDirty(true);
                  }}
                  disabled={item.status === 'closed'}
                  style={{ width: '100%', fontSize: '13px' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
                Tags (comma separated)
              </label>
              <input
                type="text"
                className="input"
                value={tagsInput}
                onChange={(e) => {
                  setTagsInput(e.target.value);
                  setIsDirty(true);
                }}
                disabled={item.status === 'closed'}
                style={{ width: '100%', fontSize: '13px' }}
              />
            </div>

            {item.status !== 'closed' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                {isDirty && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setTitle(item.title);
                      setDescription(item.description || '');
                      setPriority(item.priority);
                      setTagsInput(item.tags?.join(', ') || '');
                      setDueAt(item.due_at ? item.due_at.slice(0, 16) : '');
                      setIsDirty(false);
                    }}
                    disabled={patchMutation.isPending}
                  >
                    Discard
                  </button>
                )}
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!isDirty || patchMutation.isPending}
                >
                  {patchMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            )}
          </form>
        </div>

        {/* Timeline & Comments Column */}
        <div>
          <Timeline
            events={eventsData?.events || []}
            comments={commentsData?.comments || []}
            isLoading={isLoadingEvents}
          />
          {item.status !== 'closed' && (
            <CommentBox onSubmit={handleCommentSubmit} isSubmitting={false} />
          )}
        </div>
      </div>
    </div>
  );
};
