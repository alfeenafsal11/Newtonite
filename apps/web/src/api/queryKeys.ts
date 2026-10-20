export const queryKeys = {
  me: ['me'] as const,
  teams: ['teams'] as const,
  teamMembers: (teamId: string) => ['teams', teamId, 'members'] as const,
  itemsRoot: ['items'] as const,
  items: (filters: Record<string, unknown>) => ['items', filters] as const,
  item: (id: string) => ['item', id] as const,
  itemEvents: (id: string) => ['item', id, 'events'] as const,
  itemComments: (id: string) => ['item', id, 'comments'] as const,
  dashboardRoot: ['dashboard'] as const,
  dashboardAttention: ['dashboard', 'attention'] as const,
  dashboardOverview: (teamId: string) => ['dashboard', 'overview', teamId] as const,
  notifications: ['notifications'] as const,
};
