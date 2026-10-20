import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../api/client.js';
import { queryKeys } from '../api/queryKeys.js';
import { useToast } from '../components/ToastContext.js';

export function useItemMutations(itemId?: string) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  // 1. Claim Mutation (Optimistic)
  const claimMutation = useMutation({
    mutationFn: async ({ id, key }: { id: string; key: string }) => {
      return await apiFetch(`/items/${id}/claim`, {
        method: 'POST',
        idempotencyKey: key,
      });
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.item(id) });
      const previous = queryClient.getQueryData<any>(queryKeys.item(id));

      if (previous) {
        queryClient.setQueryData(queryKeys.item(id), {
          ...previous,
          assignee: { id: 'me', display_name: 'You' },
          status: previous.status === 'open' ? 'in_progress' : previous.status,
        });
      }

      return { previous };
    },
    onSuccess: (serverItem, { id }) => {
      queryClient.setQueryData(queryKeys.item(id), serverItem);
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.itemEvents(id) });
      addToast({ type: 'success', message: 'Item claimed successfully' });
    },
    onError: (err: any, { id }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.item(id), context.previous);
      }

      if (err instanceof ApiError && err.code === 'already_claimed') {
        const winner = err.details?.assignee?.display_name || 'another user';
        addToast({
          type: 'error',
          message: `Claimed by ${winner} just now.`,
          requestId: err.requestId,
        });
        if (err.details?.current) {
          queryClient.setQueryData(queryKeys.item(id), err.details.current);
        } else {
          queryClient.invalidateQueries({ queryKey: queryKeys.item(id) });
        }
      } else {
        addToast({
          type: 'error',
          message: err.message || 'Failed to claim item',
          requestId: err?.requestId,
        });
      }
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.item(id) });
    },
  });

  // 2. Release Mutation (Optimistic)
  const releaseMutation = useMutation({
    mutationFn: async ({ id, key }: { id: string; key: string }) => {
      return await apiFetch(`/items/${id}/release`, {
        method: 'POST',
        idempotencyKey: key,
      });
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.item(id) });
      const previous = queryClient.getQueryData<any>(queryKeys.item(id));
      if (previous) {
        queryClient.setQueryData(queryKeys.item(id), {
          ...previous,
          assignee: null,
          status: 'open',
        });
      }
      return { previous };
    },
    onSuccess: (serverItem, { id }) => {
      queryClient.setQueryData(queryKeys.item(id), serverItem);
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.itemEvents(id) });
      addToast({ type: 'success', message: 'Item released' });
    },
    onError: (err: any, { id }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.item(id), context.previous);
      }
      addToast({
        type: 'error',
        message: err.message || 'Failed to release item',
        requestId: err?.requestId,
      });
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.item(id) });
    },
  });

  // 3. Patch Mutation (Optimistic edit)
  const patchMutation = useMutation({
    mutationFn: async ({
      id,
      key,
      expectedVersion,
      patch,
    }: {
      id: string;
      key: string;
      expectedVersion: number;
      patch: Record<string, unknown>;
    }) => {
      return await apiFetch(`/items/${id}`, {
        method: 'PATCH',
        idempotencyKey: key,
        body: { expected_version: expectedVersion, ...patch },
      });
    },
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.item(id) });
      const previous = queryClient.getQueryData<any>(queryKeys.item(id));
      if (previous) {
        queryClient.setQueryData(queryKeys.item(id), {
          ...previous,
          ...patch,
        });
      }
      return { previous };
    },
    onSuccess: (serverItem, { id }) => {
      queryClient.setQueryData(queryKeys.item(id), serverItem);
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.itemEvents(id) });
      addToast({ type: 'success', message: 'Item updated successfully' });
    },
    onError: (err: any, { id }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.item(id), context.previous);
      }
      if (err instanceof ApiError && err.code === 'version_conflict') {
        if (err.details?.current) {
          queryClient.setQueryData(queryKeys.item(id), err.details.current);
        }
      } else {
        addToast({
          type: 'error',
          message: err.message || 'Update failed',
          requestId: err?.requestId,
        });
      }
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.item(id) });
    },
  });

  // 4. Transition Mutation (Non-optimistic)
  const transitionMutation = useMutation({
    mutationFn: async ({
      id,
      key,
      expectedVersion,
      name,
      reason,
      resolutionNote,
    }: {
      id: string;
      key: string;
      expectedVersion: number;
      name: string;
      reason?: string;
      resolutionNote?: string;
    }) => {
      return await apiFetch(`/items/${id}/transition`, {
        method: 'POST',
        idempotencyKey: key,
        body: {
          expected_version: expectedVersion,
          name,
          reason,
          resolution_note: resolutionNote,
        },
      });
    },
    onSuccess: (serverItem, { id }) => {
      queryClient.setQueryData(queryKeys.item(id), serverItem);
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.itemEvents(id) });
      addToast({ type: 'success', message: 'Status updated' });
    },
    onError: (err: any, { id }) => {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        if (err.details?.current) {
          queryClient.setQueryData(queryKeys.item(id), err.details.current);
        }
      }
      addToast({
        type: 'error',
        message: err.message || 'Transition failed',
        requestId: err?.requestId,
      });
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.item(id) });
    },
  });

  // 5. Add Comment (Optimistic)
  const commentMutation = useMutation({
    mutationFn: async ({ id, key, body }: { id: string; key: string; body: string }) => {
      return await apiFetch(`/items/${id}/comments`, {
        method: 'POST',
        idempotencyKey: key,
        body: { body },
      });
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.itemComments(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.itemEvents(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.item(id) });
      addToast({ type: 'success', message: 'Comment posted' });
    },
    onError: (err: any) => {
      addToast({
        type: 'error',
        message: err.message || 'Failed to post comment',
        requestId: err?.requestId,
      });
    },
  });

  return {
    claimMutation,
    releaseMutation,
    patchMutation,
    transitionMutation,
    commentMutation,
  };
}
