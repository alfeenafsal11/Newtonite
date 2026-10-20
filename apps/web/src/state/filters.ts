export interface ItemFilters {
  team_id?: string;
  status?: string[];
  priority?: string[];
  type?: string[];
  assignee?: string;
  reporter?: string;
  tag?: string;
  due?: 'overdue' | 'today' | 'week';
  stale?: boolean;
  awaiting_my_approval?: boolean;
  include_closed?: boolean;
  q?: string;
  sort?: 'activity_desc' | 'priority_due' | 'created_desc';
}

export function parseFilters(searchParams: URLSearchParams): ItemFilters {
  const filters: ItemFilters = {};

  const teamId = searchParams.get('team_id');
  if (teamId) filters.team_id = teamId;

  const statuses = searchParams.getAll('status');
  if (statuses.length > 0) filters.status = statuses;

  const priorities = searchParams.getAll('priority');
  if (priorities.length > 0) filters.priority = priorities;

  const types = searchParams.getAll('type');
  if (types.length > 0) filters.type = types;

  const assignee = searchParams.get('assignee');
  if (assignee) filters.assignee = assignee;

  const reporter = searchParams.get('reporter');
  if (reporter) filters.reporter = reporter;

  const tag = searchParams.get('tag');
  if (tag) filters.tag = tag;

  const due = searchParams.get('due');
  if (due === 'overdue' || due === 'today' || due === 'week') filters.due = due;

  const stale = searchParams.get('stale');
  if (stale === 'true') filters.stale = true;

  const awaitingApproval = searchParams.get('awaiting_my_approval');
  if (awaitingApproval === 'true') filters.awaiting_my_approval = true;

  const includeClosed = searchParams.get('include_closed');
  if (includeClosed === 'true') filters.include_closed = true;

  const q = searchParams.get('q');
  if (q) filters.q = q;

  const sort = searchParams.get('sort');
  if (sort === 'activity_desc' || sort === 'priority_due' || sort === 'created_desc') {
    filters.sort = sort;
  } else {
    filters.sort = 'activity_desc';
  }

  return filters;
}

export function serializeFilters(filters: ItemFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.team_id) params.set('team_id', filters.team_id);

  if (filters.status) {
    for (const s of filters.status) params.append('status', s);
  }

  if (filters.priority) {
    for (const p of filters.priority) params.append('priority', p);
  }

  if (filters.type) {
    for (const t of filters.type) params.append('type', t);
  }

  if (filters.assignee) params.set('assignee', filters.assignee);
  if (filters.reporter) params.set('reporter', filters.reporter);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.due) params.set('due', filters.due);
  if (filters.stale) params.set('stale', 'true');
  if (filters.awaiting_my_approval) params.set('awaiting_my_approval', 'true');
  if (filters.include_closed) params.set('include_closed', 'true');
  if (filters.q) params.set('q', filters.q);
  if (filters.sort && filters.sort !== 'activity_desc') params.set('sort', filters.sort);

  return params;
}
