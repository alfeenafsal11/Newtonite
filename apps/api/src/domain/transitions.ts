import { Actor, can, Decision } from './permissions.js';

export type ItemStatus = 'open' | 'in_progress' | 'blocked' | 'pending_approval' | 'resolved' | 'closed';
export type ApprovalState = 'not_required' | 'not_requested' | 'pending' | 'approved' | 'rejected';

export type TransitionName =
  | 'claim'
  | 'assign'
  | 'release'
  | 'block'
  | 'unblock'
  | 'request_approval'
  | 'approve'
  | 'reject'
  | 'resolve'
  | 'reopen'
  | 'close'
  | 'cancel'
  | 'auto_close';

export interface ItemRow {
  id: string;
  team_id: string;
  status: ItemStatus;
  assignee_id: string | null;
  reporter_id: string;
  requires_approval: boolean;
  approval_state: ApprovalState;
  resolution_note?: string | null;
  close_reason?: string | null;
  resolved_at?: Date | string | null;
  closed_at?: Date | string | null;
  version: number;
  priority?: string;
}

export interface TransitionInput {
  name: TransitionName;
  reason?: string;
  resolution_note?: string;
  note?: string;
  target_assignee_id?: string;
  target_assignee_role?: 'viewer' | 'member' | 'approver' | 'admin' | 'none';
  approval_requester_id?: string;
  has_pending_approval?: boolean;
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

export interface TransitionDef {
  name: TransitionName;
  from: ItemStatus[];
  to: (item: ItemRow, input: TransitionInput) => ItemStatus;
  permission: (actor: Actor, item: ItemRow, input: TransitionInput) => Decision;
  guard: (item: ItemRow, input: TransitionInput, actor: Actor) => GuardResult;
  apply: (item: ItemRow, input: TransitionInput, actor: Actor) => Partial<ItemRow>;
}

export const TRANSITIONS: Record<TransitionName, TransitionDef> = {
  claim: {
    name: 'claim',
    from: ['open', 'blocked'],
    to: (item) => (item.status === 'open' ? 'in_progress' : item.status),
    permission: (actor, item) => can(actor, 'item.claim', { item }),
    guard: (item) => {
      if (item.assignee_id != null) {
        return { ok: false, reason: 'Item is already assigned' };
      }
      return { ok: true };
    },
    apply: (item, _input, actor) => ({
      status: item.status === 'open' ? 'in_progress' : item.status,
      assignee_id: actor.id,
    }),
  },

  assign: {
    name: 'assign',
    from: ['open', 'in_progress', 'blocked'],
    to: (item) => (item.status === 'open' ? 'in_progress' : item.status),
    permission: (actor, item, input) =>
      can(actor, 'item.assign', {
        item,
        targetAssigneeRole: input.target_assignee_role,
      }),
    guard: (_item, input) => {
      if (!input.target_assignee_id) {
        return { ok: false, reason: 'Target assignee is required' };
      }
      if (input.target_assignee_role && input.target_assignee_role === 'viewer') {
        return { ok: false, reason: 'Target user must have member role or higher' };
      }
      return { ok: true };
    },
    apply: (item, input) => ({
      status: item.status === 'open' ? 'in_progress' : item.status,
      assignee_id: input.target_assignee_id!,
    }),
  },

  release: {
    name: 'release',
    from: ['in_progress', 'blocked'],
    to: () => 'open',
    permission: (actor, item) => can(actor, 'item.release', { item }),
    guard: () => ({ ok: true }),
    apply: () => ({
      status: 'open',
      assignee_id: null,
    }),
  },

  block: {
    name: 'block',
    from: ['in_progress'],
    to: () => 'blocked',
    permission: (actor, item) => {
      if (item.assignee_id !== actor.id) {
        return { allowed: false, reason: 'only_assignee' };
      }
      return { allowed: true };
    },
    guard: (_item, input) => {
      const reason = input.reason?.trim();
      if (!reason || reason.length < 1 || reason.length > 1000) {
        return { ok: false, reason: 'Block reason must be between 1 and 1000 characters' };
      }
      return { ok: true };
    },
    apply: () => ({
      status: 'blocked',
    }),
  },

  unblock: {
    name: 'unblock',
    from: ['blocked'],
    to: () => 'in_progress',
    permission: (actor, item) => {
      if (item.assignee_id !== actor.id) {
        return { allowed: false, reason: 'only_assignee' };
      }
      return { allowed: true };
    },
    guard: (item) => {
      if (!item.assignee_id) {
        return { ok: false, reason: 'Item must have an assignee to be unblocked' };
      }
      return { ok: true };
    },
    apply: () => ({
      status: 'in_progress',
    }),
  },

  request_approval: {
    name: 'request_approval',
    from: ['in_progress'],
    to: () => 'pending_approval',
    permission: (actor, item) => can(actor, 'item.approval.request', { item }),
    guard: (item) => {
      if (!item.requires_approval) {
        return { ok: false, reason: 'Item does not require approval' };
      }
      if (item.approval_state !== 'not_requested' && item.approval_state !== 'rejected') {
        return { ok: false, reason: 'Approval can only be requested when not requested or rejected' };
      }
      return { ok: true };
    },
    apply: () => ({
      status: 'pending_approval',
      approval_state: 'pending',
    }),
  },

  approve: {
    name: 'approve',
    from: ['pending_approval'],
    to: () => 'in_progress',
    permission: (actor, item, input) =>
      can(actor, 'item.approval.decide', {
        item,
        approvalRequesterId: input.approval_requester_id,
      }),
    guard: (_item, input) => {
      if (input.has_pending_approval === false) {
        return { ok: false, reason: 'No pending approval found' };
      }
      return { ok: true };
    },
    apply: () => ({
      status: 'in_progress',
      approval_state: 'approved',
    }),
  },

  reject: {
    name: 'reject',
    from: ['pending_approval'],
    to: () => 'in_progress',
    permission: (actor, item, input) =>
      can(actor, 'item.approval.decide', {
        item,
        approvalRequesterId: input.approval_requester_id,
      }),
    guard: (_item, input) => {
      if (input.has_pending_approval === false) {
        return { ok: false, reason: 'No pending approval found' };
      }
      const note = input.note?.trim();
      if (!note || note.length < 1 || note.length > 1000) {
        return { ok: false, reason: 'Rejection note must be between 1 and 1000 characters' };
      }
      return { ok: true };
    },
    apply: () => ({
      status: 'in_progress',
      approval_state: 'rejected',
    }),
  },

  resolve: {
    name: 'resolve',
    from: ['in_progress'],
    to: () => 'resolved',
    permission: (actor, item) => {
      if (item.assignee_id !== actor.id) {
        return { allowed: false, reason: 'only_assignee' };
      }
      return { allowed: true };
    },
    guard: (item, input) => {
      const note = input.resolution_note?.trim();
      if (!note || note.length < 1 || note.length > 1000) {
        return { ok: false, reason: 'Resolution note must be between 1 and 1000 characters' };
      }
      if (item.requires_approval && item.approval_state !== 'approved') {
        return { ok: false, reason: 'Approval required before resolution' };
      }
      return { ok: true };
    },
    apply: (_item, input) => ({
      status: 'resolved',
      resolution_note: input.resolution_note!.trim(),
      resolved_at: new Date(),
    }),
  },

  reopen: {
    name: 'reopen',
    from: ['resolved'],
    to: () => 'in_progress',
    permission: (actor, item) => can(actor, 'item.update', { item }),
    guard: (_item, input) => {
      const reason = input.reason?.trim();
      if (!reason || reason.length < 1 || reason.length > 1000) {
        return { ok: false, reason: 'Reopen reason must be between 1 and 1000 characters' };
      }
      return { ok: true };
    },
    apply: (item, _input, actor) => ({
      status: 'in_progress',
      assignee_id: item.assignee_id || actor.id,
      approval_state: item.requires_approval ? 'not_requested' : 'not_required',
      resolved_at: null,
      resolution_note: null,
    }),
  },

  close: {
    name: 'close',
    from: ['resolved'],
    to: () => 'closed',
    permission: (actor, item) => {
      if (item.reporter_id === actor.id) return { allowed: true };
      return can(actor, 'item.update', { item });
    },
    guard: () => ({ ok: true }),
    apply: () => ({
      status: 'closed',
      close_reason: 'completed',
      closed_at: new Date(),
    }),
  },

  cancel: {
    name: 'cancel',
    from: ['open', 'in_progress', 'blocked', 'pending_approval', 'resolved'],
    to: () => 'closed',
    permission: (actor, item) => can(actor, 'item.cancel', { item }),
    guard: (_item, input) => {
      const reason = input.reason?.trim();
      if (!reason || reason.length < 1 || reason.length > 1000) {
        return { ok: false, reason: 'Cancel reason must be between 1 and 1000 characters' };
      }
      return { ok: true };
    },
    apply: () => ({
      status: 'closed',
      close_reason: 'cancelled',
      closed_at: new Date(),
    }),
  },

  auto_close: {
    name: 'auto_close',
    from: ['resolved'],
    to: () => 'closed',
    permission: () => ({ allowed: true }),
    guard: () => ({ ok: true }),
    apply: () => ({
      status: 'closed',
      close_reason: 'auto_closed',
      closed_at: new Date(),
    }),
  },
};

export type TransitionEvalResult =
  | { ok: true; patch: Partial<ItemRow> }
  | {
      ok: false;
      code: 'forbidden' | 'invalid_transition' | 'guard_failed' | 'validation_error';
      detail: string;
    };

export function evaluateTransition(
  name: TransitionName,
  actor: Actor,
  item: ItemRow,
  input: TransitionInput
): TransitionEvalResult {
  if (item.status === 'closed') {
    return {
      ok: false,
      code: 'invalid_transition',
      detail: `Transition ${name} is not allowed on closed item (closed is terminal)`,
    };
  }

  const def = TRANSITIONS[name];
  if (!def) {
    return {
      ok: false,
      code: 'invalid_transition',
      detail: `Unknown transition: ${name}`,
    };
  }

  if (!def.from.includes(item.status)) {
    return {
      ok: false,
      code: 'invalid_transition',
      detail: `Transition ${name} cannot be performed from status ${item.status}`,
    };
  }

  const perm = def.permission(actor, item, input);
  if (!perm.allowed) {
    return {
      ok: false,
      code: 'forbidden',
      detail: perm.reason || 'Permission denied',
    };
  }

  const guardRes = def.guard(item, input, actor);
  if (!guardRes.ok) {
    return {
      ok: false,
      code: 'guard_failed',
      detail: guardRes.reason || 'Guard condition failed',
    };
  }

  const patch = def.apply(item, input, actor);
  return { ok: true, patch };
}
