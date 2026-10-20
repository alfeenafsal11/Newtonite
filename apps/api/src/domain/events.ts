export type EventType =
  | 'item_created'
  | 'fields_updated'
  | 'priority_changed'
  | 'claimed'
  | 'released'
  | 'assigned'
  | 'status_changed'
  | 'comment_added'
  | 'approval_requested'
  | 'approval_approved'
  | 'approval_rejected'
  | 'transferred'
  | 'stale_flagged'
  | 'overdue_flagged'
  | 'auto_closed';

export const HANDLERS_FOR: Record<EventType, string[]> = {
  item_created: ['notify_watchers'],
  fields_updated: ['notify_watchers'],
  priority_changed: ['notify_watchers'],
  claimed: ['notify_watchers'],
  released: ['notify_watchers'],
  assigned: ['notify_watchers'],
  status_changed: ['notify_watchers'],
  comment_added: ['notify_watchers'],
  approval_requested: ['notify_approvers', 'notify_watchers'],
  approval_approved: ['notify_watchers'],
  approval_rejected: ['notify_watchers'],
  transferred: ['notify_watchers'],
  stale_flagged: ['notify_watchers'],
  overdue_flagged: ['notify_watchers'],
  auto_closed: ['notify_watchers'],
};

export interface ChangeRecord {
  from: unknown;
  to: unknown;
}

export interface EventPayload {
  changes?: Record<string, ChangeRecord>;
  reason?: string;
  comment_id?: string;
  approval_id?: string;
  [key: string]: unknown;
}

export function buildChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[]
): Record<string, ChangeRecord> {
  const changes: Record<string, ChangeRecord> = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(after, field)) {
      const fromVal = before[field];
      const toVal = after[field];
      if (fromVal !== toVal) {
        changes[field] = { from: fromVal ?? null, to: toVal ?? null };
      }
    }
  }
  return changes;
}
