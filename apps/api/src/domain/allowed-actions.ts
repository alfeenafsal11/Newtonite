import { Actor, can } from './permissions.js';
import { ItemRow, TRANSITIONS, TransitionName } from './transitions.js';

export type AllowedAction =
  | 'update'
  | 'comment'
  | 'claim'
  | 'release'
  | 'assign'
  | 'block'
  | 'unblock'
  | 'request_approval'
  | 'approve'
  | 'reject'
  | 'resolve'
  | 'reopen'
  | 'close'
  | 'cancel'
  | 'transfer';

export function computeAllowedActions(actor: Actor, item: ItemRow): AllowedAction[] {
  if (!actor.isActive || item.status === 'closed') {
    return [];
  }

  const actions: AllowedAction[] = [];

  // General operations
  if (can(actor, 'item.update', { item }).allowed) {
    actions.push('update');
  }

  if (can(actor, 'item.comment', { item }).allowed) {
    actions.push('comment');
  }

  if (can(actor, 'item.transfer', { item, targetTeamId: item.team_id }).allowed) {
    // Check if user has permission to transfer (must be assignee or admin)
    actions.push('transfer');
  }

  // State transitions
  const transitionNames: TransitionName[] = [
    'claim',
    'release',
    'assign',
    'block',
    'unblock',
    'request_approval',
    'approve',
    'reject',
    'resolve',
    'reopen',
    'close',
    'cancel',
  ];

  for (const name of transitionNames) {
    const def = TRANSITIONS[name];
    if (!def.from.includes(item.status)) {
      continue;
    }

    // Permission check
    const perm = def.permission(actor, item, { name });
    if (!perm.allowed) {
      continue;
    }

    // Non-input guard checks
    if (name === 'claim' && item.assignee_id != null) {
      continue;
    }
    if (name === 'unblock' && !item.assignee_id) {
      continue;
    }
    if (name === 'request_approval') {
      if (!item.requires_approval) continue;
      if (item.approval_state !== 'not_requested' && item.approval_state !== 'rejected') continue;
    }
    if (name === 'resolve') {
      if (item.requires_approval && item.approval_state !== 'approved') continue;
    }

    actions.push(name as AllowedAction);
  }

  return actions;
}
