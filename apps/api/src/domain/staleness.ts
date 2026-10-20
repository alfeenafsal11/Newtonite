export interface StalenessConfig {
  p0Hours?: number;
  p1Hours?: number;
  p2Hours?: number;
  p3Hours?: number;
}

export const DEFAULT_STALENESS_HOURS: Record<string, number> = {
  p0: 2,
  p1: 24,
  p2: 72,
  p3: 168,
};

export function staleAtFor(
  priority: string,
  from: Date | string,
  cfg?: StalenessConfig
): Date {
  const fromDate = typeof from === 'string' ? new Date(from) : from;
  let hours = DEFAULT_STALENESS_HOURS[priority] ?? 72;

  if (cfg) {
    if (priority === 'p0' && cfg.p0Hours != null) hours = cfg.p0Hours;
    else if (priority === 'p1' && cfg.p1Hours != null) hours = cfg.p1Hours;
    else if (priority === 'p2' && cfg.p2Hours != null) hours = cfg.p2Hours;
    else if (priority === 'p3' && cfg.p3Hours != null) hours = cfg.p3Hours;
  }

  return new Date(fromDate.getTime() + hours * 60 * 60 * 1000);
}

export function isStale(
  item: { status: string; stale_at?: Date | string | null },
  now: Date = new Date()
): boolean {
  if (item.status === 'resolved' || item.status === 'closed') {
    return false;
  }
  if (!item.stale_at) {
    return false;
  }
  const staleDate = typeof item.stale_at === 'string' ? new Date(item.stale_at) : item.stale_at;
  return staleDate.getTime() < now.getTime();
}

export function isOverdue(
  item: { status: string; due_at?: Date | string | null },
  now: Date = new Date()
): boolean {
  if (item.status === 'resolved' || item.status === 'closed') {
    return false;
  }
  if (!item.due_at) {
    return false;
  }
  const dueDate = typeof item.due_at === 'string' ? new Date(item.due_at) : item.due_at;
  return dueDate.getTime() < now.getTime();
}
