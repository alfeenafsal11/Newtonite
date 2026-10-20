import { Actor, can, effectiveRole } from '../../domain/permissions.js';
import { evaluateTransition } from '../../domain/transitions.js';
import { computeAllowedActions } from '../../domain/allowed-actions.js';
import { staleAtFor, isStale, isOverdue } from '../../domain/staleness.js';
import { HANDLERS_FOR, buildChanges } from '../../domain/events.js';
import { encodeCursor, SortOption } from '../../domain/cursor.js';
import { buildListQuery, ListItemsParams } from './list-query.js';
import { AppError } from '../../http/errors.js';
import { withIdempotency, computeRequestFingerprint } from '../../http/idempotency.js';
import { getPool } from '../../db/pool.js';
import {
  lockItem,
  getItemForActor,
  insertItem,
  updateItem,
  insertEvent,
  insertOutbox,
  addWatcher,
  notifyChanged,
  DbWorkItem,
} from './repo.js';

export function formatItemDto(actor: Actor, row: DbWorkItem) {
  return {
    id: row.id,
    number: Number(row.number),
    key: `OPS-${row.number}`,
    team: {
      id: row.team_id,
      name: row.team_name || '',
    },
    type: row.type,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    reporter: {
      id: row.reporter_id,
      display_name: row.reporter_display_name || '',
    },
    assignee: row.assignee_id
      ? {
          id: row.assignee_id,
          display_name: row.assignee_display_name || '',
        }
      : null,
    requires_approval: row.requires_approval,
    approval_state: row.approval_state,
    tags: row.tags || [],
    due_at: row.due_at ? new Date(row.due_at).toISOString() : null,
    is_overdue: isOverdue(row),
    is_stale: isStale(row),
    resolution_note: row.resolution_note || null,
    version: row.version,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    last_activity_at: new Date(row.last_activity_at).toISOString(),
    allowed_actions: computeAllowedActions(actor, row),
  };
}

export async function getItemDto(actor: Actor, id: string) {
  const pool = getPool();
  const row = await getItemForActor(pool, actor, id);
  if (!row) {
    throw new AppError(404, 'not_found', 'Work item not found');
  }
  return formatItemDto(actor, row);
}

export async function createItem(
  actor: Actor,
  input: {
    team_id: string;
    type: string;
    title: string;
    description?: string;
    priority?: string;
    tags?: string[];
    due_at?: string | null;
    requires_approval?: boolean;
  },
  reqCtx: { idempotencyKey?: string; requestId: string }
) {
  // Permission check
  const perm = can(actor, 'item.create', { teamId: input.team_id });
  if (!perm.allowed) {
    throw new AppError(403, 'forbidden', perm.reason || 'Permission denied to create items in this team');
  }

  const priority = input.priority || 'p2';
  if (priority === 'p0') {
    const p0Perm = can(actor, 'item.priority.p0', { teamId: input.team_id });
    if (!p0Perm.allowed) {
      throw new AppError(403, 'forbidden', 'Only approvers and above can create critical (p0) items');
    }
  }

  // Default requires_approval logic
  let requiresApproval = input.requires_approval;
  if (requiresApproval === undefined) {
    if (input.type === 'payment_investigation' || input.type === 'compliance_request') {
      requiresApproval = true;
    } else {
      requiresApproval = false;
    }
  }

  const approvalState = requiresApproval ? 'not_requested' : 'not_required';
  const staleAt = staleAtFor(priority, new Date());
  const fingerprint = computeRequestFingerprint('POST', '/items', input);

  const result = await withIdempotency(actor, reqCtx.idempotencyKey, fingerprint, async (client) => {
    const inserted = await insertItem(client, {
      team_id: input.team_id,
      type: input.type,
      title: input.title,
      description: input.description || '',
      priority,
      reporter_id: actor.id,
      assignee_id: null,
      requires_approval: requiresApproval,
      approval_state: approvalState,
      tags: input.tags || [],
      due_at: input.due_at ?? null,
      stale_at: staleAt,
    });

    const event = await insertEvent(client, {
      item_id: inserted.id,
      team_id: inserted.team_id,
      actor_id: actor.id,
      type: 'item_created',
      payload: {},
      item_version: inserted.version,
      request_id: reqCtx.requestId,
    });

    await addWatcher(client, inserted.id, actor.id);
    await insertOutbox(client, event.id, HANDLERS_FOR['item_created'] || []);
    await notifyChanged(client, {
      item_id: inserted.id,
      team_id: inserted.team_id,
      version: inserted.version,
      type: 'item_created',
      event_id: event.id,
    });

    // Re-query with team and reporter names
    const itemWithNames = await getItemForActor(client, actor, inserted.id);
    return {
      status: 201,
      body: formatItemDto(actor, itemWithNames || inserted),
    };
  });

  return result;
}

export async function patchItem(
  actor: Actor,
  id: string,
  input: {
    expected_version: number;
    title?: string;
    description?: string;
    priority?: string;
    tags?: string[];
    due_at?: string | null;
  },
  reqCtx: { idempotencyKey?: string; requestId: string }
) {
  const fingerprint = computeRequestFingerprint('PATCH', `/items/${id}`, input);

  return await withIdempotency(actor, reqCtx.idempotencyKey, fingerprint, async (client) => {
    const current = await lockItem(client, id);
    if (!current) {
      throw new AppError(404, 'not_found', 'Work item not found');
    }

    // Auth check on loaded item fresh from DB
    const role = effectiveRole(actor, current.team_id);
    if (role === 'none' && actor.orgRole !== 'org_admin' && actor.orgRole !== 'auditor') {
      throw new AppError(404, 'not_found', 'Work item not found');
    }

    const perm = can(actor, 'item.update', { item: current });
    if (!perm.allowed) {
      throw new AppError(403, 'forbidden', perm.reason || 'Permission denied to update this item');
    }

    if (current.version !== input.expected_version) {
      throw new AppError(409, 'version_conflict', 'Item changed since you loaded it.', {
        current: formatItemDto(actor, current),
      });
    }

    // Priority p0 change check
    if (input.priority && input.priority !== current.priority) {
      if (input.priority === 'p0' || current.priority === 'p0') {
        const p0Perm = can(actor, 'item.priority.p0', { item: current });
        if (!p0Perm.allowed) {
          throw new AppError(403, 'forbidden', 'Only approvers and above can change p0 priority');
        }
      }
    }

    const patch: Partial<DbWorkItem> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.tags !== undefined) patch.tags = input.tags;
    if (input.due_at !== undefined) patch.due_at = input.due_at;

    const changes = buildChanges(current as unknown as Record<string, unknown>, patch as any, ['title', 'description', 'priority', 'tags', 'due_at']);
    if (Object.keys(changes).length === 0) {
      return {
        status: 200,
        body: formatItemDto(actor, current),
      };
    }

    const newPriority = (input.priority || current.priority);
    const newStaleAt = staleAtFor(newPriority, new Date());
    (patch as any).stale_at = newStaleAt;
    (patch as any).stale_notified_at = null; // Clear stale notified on activity

    const updated = await updateItem(client, id, input.expected_version, patch as any);
    if (!updated) {
      const freshCurrent = await lockItem(client, id);
      throw new AppError(409, 'version_conflict', 'Item changed since you loaded it.', {
        current: freshCurrent ? formatItemDto(actor, freshCurrent) : null,
      });
    }

    // Insert events
    let eventType = 'fields_updated';
    if (changes['priority']) {
      eventType = 'priority_changed';
    }

    const event = await insertEvent(client, {
      item_id: id,
      team_id: updated.team_id,
      actor_id: actor.id,
      type: eventType,
      payload: { changes },
      item_version: updated.version,
      request_id: reqCtx.requestId,
    });

    await addWatcher(client, id, actor.id);
    await insertOutbox(client, event.id, HANDLERS_FOR[eventType as keyof typeof HANDLERS_FOR] || []);
    await notifyChanged(client, {
      item_id: id,
      team_id: updated.team_id,
      version: updated.version,
      type: eventType,
      event_id: event.id,
    });

    const refreshed = await getItemForActor(client, actor, id);
    return {
      status: 200,
      body: formatItemDto(actor, refreshed || updated),
    };
  });
}

export async function claimItem(
  actor: Actor,
  id: string,
  reqCtx: { idempotencyKey?: string; requestId: string }
) {
  const fingerprint = computeRequestFingerprint('POST', `/items/${id}/claim`, {});

  return await withIdempotency(actor, reqCtx.idempotencyKey, fingerprint, async (client) => {
    const current = await lockItem(client, id);
    if (!current) {
      throw new AppError(404, 'not_found', 'Work item not found');
    }

    const role = effectiveRole(actor, current.team_id);
    if (role === 'none' && actor.orgRole !== 'org_admin' && actor.orgRole !== 'auditor') {
      throw new AppError(404, 'not_found', 'Work item not found');
    }

    if (current.assignee_id === actor.id) {
      // Idempotent success when actor already holds item
      return {
        status: 200,
        body: formatItemDto(actor, current),
      };
    }

    if (current.assignee_id != null) {
      throw new AppError(409, 'already_claimed', 'Item has already been claimed by another user.', {
        assignee: {
          id: current.assignee_id,
          display_name: current.assignee_display_name || '',
        },
      });
    }

    if (current.status !== 'open' && current.status !== 'blocked') {
      throw new AppError(409, 'already_claimed', `Item in status '${current.status}' cannot be claimed.`);
    }

    const perm = can(actor, 'item.claim', { item: current });
    if (!perm.allowed) {
      throw new AppError(403, 'forbidden', perm.reason || 'Permission denied to claim this item');
    }

    const newStatus = current.status === 'open' ? 'in_progress' : current.status;
    const updated = await updateItem(client, id, current.version, {
      status: newStatus,
      assignee_id: actor.id,
    });

    if (!updated) {
      const fresh = await lockItem(client, id);
      throw new AppError(409, 'already_claimed', 'Item claim conflict.', {
        assignee: fresh?.assignee_id
          ? { id: fresh.assignee_id, display_name: fresh.assignee_display_name || '' }
          : null,
      });
    }

    const event = await insertEvent(client, {
      item_id: id,
      team_id: updated.team_id,
      actor_id: actor.id,
      type: 'claimed',
      payload: {
        changes: {
          assignee_id: { from: null, to: actor.id },
          status: { from: current.status, to: newStatus },
        },
      },
      item_version: updated.version,
      request_id: reqCtx.requestId,
    });

    await addWatcher(client, id, actor.id);
    await insertOutbox(client, event.id, HANDLERS_FOR['claimed'] || []);
    await notifyChanged(client, {
      item_id: id,
      team_id: updated.team_id,
      version: updated.version,
      type: 'claimed',
      event_id: event.id,
    });

    const refreshed = await getItemForActor(client, actor, id);
    return {
      status: 200,
      body: formatItemDto(actor, refreshed || updated),
    };
  });
}

export async function releaseItem(
  actor: Actor,
  id: string,
  reqCtx: { idempotencyKey?: string; requestId: string }
) {
  const fingerprint = computeRequestFingerprint('POST', `/items/${id}/release`, {});

  return await withIdempotency(actor, reqCtx.idempotencyKey, fingerprint, async (client) => {
    const current = await lockItem(client, id);
    if (!current) {
      throw new AppError(404, 'not_found', 'Work item not found');
    }

    const role = effectiveRole(actor, current.team_id);
    if (role === 'none' && actor.orgRole !== 'org_admin' && actor.orgRole !== 'auditor') {
      throw new AppError(404, 'not_found', 'Work item not found');
    }

    const perm = can(actor, 'item.release', { item: current });
    if (!perm.allowed) {
      throw new AppError(403, 'forbidden', perm.reason || 'Permission denied to release this item');
    }

    const updated = await updateItem(client, id, current.version, {
      status: 'open',
      assignee_id: null,
    });

    if (!updated) {
      const fresh = await lockItem(client, id);
      throw new AppError(409, 'version_conflict', 'Item changed since you loaded it.', {
        current: fresh ? formatItemDto(actor, fresh) : null,
      });
    }

    const event = await insertEvent(client, {
      item_id: id,
      team_id: updated.team_id,
      actor_id: actor.id,
      type: 'released',
      payload: {
        changes: {
          assignee_id: { from: current.assignee_id, to: null },
          status: { from: current.status, to: 'open' },
        },
      },
      item_version: updated.version,
      request_id: reqCtx.requestId,
    });

    await insertOutbox(client, event.id, HANDLERS_FOR['released'] || []);
    await notifyChanged(client, {
      item_id: id,
      team_id: updated.team_id,
      version: updated.version,
      type: 'released',
      event_id: event.id,
    });

    const refreshed = await getItemForActor(client, actor, id);
    return {
      status: 200,
      body: formatItemDto(actor, refreshed || updated),
    };
  });
}

export async function assignItem(
  actor: Actor,
  id: string,
  input: { expected_version: number; assignee_id: string },
  reqCtx: { idempotencyKey?: string; requestId: string }
) {
  const fingerprint = computeRequestFingerprint('POST', `/items/${id}/assign`, input);

  return await withIdempotency(actor, reqCtx.idempotencyKey, fingerprint, async (client) => {
    const current = await lockItem(client, id);
    if (!current) {
      throw new AppError(404, 'not_found', 'Work item not found');
    }

    const role = effectiveRole(actor, current.team_id);
    if (role === 'none' && actor.orgRole !== 'org_admin' && actor.orgRole !== 'auditor') {
      throw new AppError(404, 'not_found', 'Work item not found');
    }

    if (current.version !== input.expected_version) {
      throw new AppError(409, 'version_conflict', 'Item changed since you loaded it.', {
        current: formatItemDto(actor, current),
      });
    }

    // Verify target membership in team
    const memberRes = await client.query(
      'SELECT role FROM team_memberships WHERE team_id = $1 AND user_id = $2',
      [current.team_id, input.assignee_id]
    );

    if (memberRes.rows.length === 0 || memberRes.rows[0].role === 'viewer') {
      throw new AppError(403, 'forbidden', 'Target user must be a member or above in the item team');
    }

    const targetRole = memberRes.rows[0].role;
    const perm = can(actor, 'item.assign', { item: current, targetAssigneeRole: targetRole });
    if (!perm.allowed) {
      throw new AppError(403, 'forbidden', perm.reason || 'Permission denied to assign this item');
    }

    const newStatus = current.status === 'open' ? 'in_progress' : current.status;
    const updated = await updateItem(client, id, current.version, {
      status: newStatus,
      assignee_id: input.assignee_id,
    });

    if (!updated) {
      const fresh = await lockItem(client, id);
      throw new AppError(409, 'version_conflict', 'Item changed since you loaded it.', {
        current: fresh ? formatItemDto(actor, fresh) : null,
      });
    }

    const event = await insertEvent(client, {
      item_id: id,
      team_id: updated.team_id,
      actor_id: actor.id,
      type: 'assigned',
      payload: {
        changes: {
          assignee_id: { from: current.assignee_id, to: input.assignee_id },
          status: { from: current.status, to: newStatus },
        },
      },
      item_version: updated.version,
      request_id: reqCtx.requestId,
    });

    await addWatcher(client, id, input.assignee_id);
    await insertOutbox(client, event.id, HANDLERS_FOR['assigned'] || []);
    await notifyChanged(client, {
      item_id: id,
      team_id: updated.team_id,
      version: updated.version,
      type: 'assigned',
      event_id: event.id,
    });

    const refreshed = await getItemForActor(client, actor, id);
    return {
      status: 200,
      body: formatItemDto(actor, refreshed || updated),
    };
  });
}

export async function transitionItem(
  actor: Actor,
  id: string,
  input: {
    expected_version: number;
    name: 'block' | 'unblock' | 'resolve' | 'reopen' | 'close' | 'cancel';
    reason?: string;
    resolution_note?: string;
  },
  reqCtx: { idempotencyKey?: string; requestId: string }
) {
  const fingerprint = computeRequestFingerprint('POST', `/items/${id}/transition`, input);

  return await withIdempotency(actor, reqCtx.idempotencyKey, fingerprint, async (client) => {
    const current = await lockItem(client, id);
    if (!current) {
      throw new AppError(404, 'not_found', 'Work item not found');
    }

    const role = effectiveRole(actor, current.team_id);
    if (role === 'none' && actor.orgRole !== 'org_admin' && actor.orgRole !== 'auditor') {
      throw new AppError(404, 'not_found', 'Work item not found');
    }

    if (current.version !== input.expected_version) {
      throw new AppError(409, 'version_conflict', 'Item changed since you loaded it.', {
        current: formatItemDto(actor, current),
      });
    }

    const evalRes = evaluateTransition(input.name, actor, current, input);
    if (!evalRes.ok) {
      const statusCode =
        evalRes.code === 'forbidden'
          ? 403
          : evalRes.code === 'validation_error'
          ? 400
          : 409;
      throw new AppError(statusCode, evalRes.code, evalRes.detail);
    }

    const updated = await updateItem(client, id, current.version, evalRes.patch);
    if (!updated) {
      const fresh = await lockItem(client, id);
      throw new AppError(409, 'version_conflict', 'Item changed since you loaded it.', {
        current: fresh ? formatItemDto(actor, fresh) : null,
      });
    }

    const event = await insertEvent(client, {
      item_id: id,
      team_id: updated.team_id,
      actor_id: actor.id,
      type: 'status_changed',
      payload: {
        transition: input.name,
        changes: {
          status: { from: current.status, to: updated.status },
        },
        reason: input.reason,
        resolution_note: input.resolution_note,
      },
      item_version: updated.version,
      request_id: reqCtx.requestId,
    });

    await insertOutbox(client, event.id, HANDLERS_FOR['status_changed'] || []);
    await notifyChanged(client, {
      item_id: id,
      team_id: updated.team_id,
      version: updated.version,
      type: 'status_changed',
      event_id: event.id,
    });

    const refreshed = await getItemForActor(client, actor, id);
    return {
      status: 200,
      body: formatItemDto(actor, refreshed || updated),
    };
  });
}

export async function transferItem(
  actor: Actor,
  id: string,
  input: {
    expected_version: number;
    team_id: string;
    reason?: string;
  },
  reqCtx: { idempotencyKey?: string; requestId: string }
) {
  const fingerprint = computeRequestFingerprint('POST', `/items/${id}/transfer`, input);

  return await withIdempotency(actor, reqCtx.idempotencyKey, fingerprint, async (client) => {
    const current = await lockItem(client, id);
    if (!current) {
      throw new AppError(404, 'not_found', 'Work item not found');
    }

    const role = effectiveRole(actor, current.team_id);
    if (role === 'none' && actor.orgRole !== 'org_admin' && actor.orgRole !== 'auditor') {
      throw new AppError(404, 'not_found', 'Work item not found');
    }

    if (current.version !== input.expected_version) {
      throw new AppError(409, 'version_conflict', 'Item changed since you loaded it.', {
        current: formatItemDto(actor, current),
      });
    }

    const perm = can(actor, 'item.transfer', {
      item: current,
      targetTeamId: input.team_id,
    });
    if (!perm.allowed) {
      throw new AppError(403, 'forbidden', perm.reason || 'Permission denied to transfer item');
    }

    // Check if assignee is member of target team
    let newAssigneeId = current.assignee_id;
    let newStatus = current.status;
    if (current.assignee_id) {
      const targetMemberRes = await client.query(
        'SELECT role FROM team_memberships WHERE team_id = $1 AND user_id = $2',
        [input.team_id, current.assignee_id]
      );
      if (targetMemberRes.rows.length === 0 || targetMemberRes.rows[0].role === 'viewer') {
        newAssigneeId = null;
        if (current.status === 'in_progress' || current.status === 'pending_approval') {
          newStatus = 'open';
        }
      }
    }

    const updated = await updateItem(client, id, current.version, {
      team_id: input.team_id,
      assignee_id: newAssigneeId,
      status: newStatus,
    });

    if (!updated) {
      const fresh = await lockItem(client, id);
      throw new AppError(409, 'version_conflict', 'Item changed since you loaded it.', {
        current: fresh ? formatItemDto(actor, fresh) : null,
      });
    }

    const event = await insertEvent(client, {
      item_id: id,
      team_id: input.team_id,
      actor_id: actor.id,
      type: 'transferred',
      payload: {
        from_team_id: current.team_id,
        to_team_id: input.team_id,
        reason: input.reason,
      },
      item_version: updated.version,
      request_id: reqCtx.requestId,
    });

    await insertOutbox(client, event.id, HANDLERS_FOR['transferred'] || []);
    await notifyChanged(client, {
      item_id: id,
      team_id: input.team_id,
      version: updated.version,
      type: 'transferred',
      event_id: event.id,
    });

    const refreshed = await getItemForActor(client, actor, id);
    return {
      status: 200,
      body: formatItemDto(actor, refreshed || updated),
    };
  });
}

export async function listEvents(
  actor: Actor,
  itemId: string,
  cursor?: string,
  limit = 50
) {
  const pool = getPool();
  const item = await getItemForActor(pool, actor, itemId);
  if (!item) {
    throw new AppError(404, 'not_found', 'Work item not found');
  }

  const values: unknown[] = [itemId, limit + 1];
  let cursorPredicate = '';
  if (cursor) {
    values.push(BigInt(cursor));
    cursorPredicate = `AND ie.id < $3`;
  }

  const query = `
    SELECT ie.*, u.display_name as actor_display_name
    FROM item_events ie
    LEFT JOIN users u ON u.id = ie.actor_id
    WHERE ie.item_id = $1
      ${cursorPredicate}
    ORDER BY ie.id DESC
    LIMIT $2
  `;

  const res = await pool.query(query, values);
  const rows = res.rows;
  let nextCursor: string | null = null;

  if (rows.length > limit) {
    const last = rows.pop();
    if (last) {
      nextCursor = String(last.id);
    }
  }

  return {
    events: rows.map((r) => ({
      id: String(r.id),
      item_id: r.item_id,
      team_id: r.team_id,
      actor: r.actor_id
        ? {
            id: r.actor_id,
            display_name: r.actor_display_name || '',
          }
        : null,
      type: r.type,
      payload: r.payload || {},
      item_version: r.item_version,
      request_id: r.request_id || null,
      created_at: new Date(r.created_at).toISOString(),
    })),
    next_cursor: nextCursor,
  };
}

export async function listItems(actor: Actor, params: ListItemsParams) {
  const pool = getPool();
  const { text, values, limit, sort } = buildListQuery(actor, params);
  const res = await pool.query<DbWorkItem>(text, values);
  const rows = res.rows;
  let nextCursor: string | null = null;

  if (rows.length > limit) {
    const last = rows[limit - 1];
    nextCursor = encodeCursor(sort as SortOption, last as any);
  }

  const items = rows.slice(0, limit).map((r) => formatItemDto(actor, r));
  return {
    items,
    next_cursor: nextCursor,
  };
}

