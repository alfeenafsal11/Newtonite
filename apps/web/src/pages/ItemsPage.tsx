import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { queryKeys } from '../api/queryKeys.js';
import { parseFilters, serializeFilters, ItemFilters } from '../state/filters.js';
import { FilterBar } from '../components/FilterBar.js';
import { ItemTable } from '../components/ItemTable.js';
import { CreateItemDialog } from '../components/CreateItemDialog.js';

interface ItemsPageProps {
  onOpenCreateItem?: () => void;
}

export const ItemsPage: React.FC<ItemsPageProps> = ({ onOpenCreateItem }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [localCreateOpen, setLocalCreateOpen] = useState(false);

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: queryKeys.items(filters as unknown as Record<string, unknown>),
    queryFn: async ({ pageParam }) => {
      const params = serializeFilters(filters);
      if (pageParam) {
        params.set('cursor', pageParam);
      }
      params.set('limit', '50');
      return await apiFetch<{ items: any[]; next_cursor: string | null }>(
        `/items?${params.toString()}`
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.next_cursor || undefined,
  });

  const handleFilterChange = (newFilters: ItemFilters) => {
    const params = serializeFilters(newFilters);
    setSearchParams(params, { replace: true });
  };

  const allItems = useMemo(() => {
    if (!data) return [];
    return data.pages.flatMap((page) => page.items);
  }, [data]);

  const handleOpenCreate = onOpenCreateItem || (() => setLocalCreateOpen(true));

  return (
    <div className="container" style={{ padding: '24px 16px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>Work Items</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', margin: 0 }}>
            Browse, filter, and triage team operations work items.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleOpenCreate}
          style={{ padding: '8px 16px', fontSize: '13px' }}
        >
          + New Item
        </button>
      </div>

      <FilterBar filters={filters} onChange={handleFilterChange} />

      <ItemTable
        items={allItems}
        isLoading={isLoading}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onFetchNextPage={fetchNextPage}
      />

      <CreateItemDialog
        isOpen={localCreateOpen}
        onClose={() => setLocalCreateOpen(false)}
        defaultTeamId={filters.team_id}
      />
    </div>
  );
};
