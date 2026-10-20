import { Actor, can, effectiveRole } from '../../domain/permissions.js';
import { evaluateTransition } from '../../domain/transitions.js';
import { HANDLERS_FOR } from '../../domain/events.js';
import { AppError } from '../../http/errors.js';
import { withIdempotency, computeRequestFingerprint } from '../../http/idempotency.js';
import {
  lockItem,
  getItemForActor,
  updateItem,
  insertEvent,
  insertOutbox,
  addWatcher,
  notifyChanged,
} from '../items/repo.js';
import { formatItemDto } from '../items/service.js';

export async function requestApproval(
  actor: Actor,
  itemId: string,
  input: { expected_version: number },
  reqCtx: { idempotencyKey?: string; requestId: string }
) {
  const fingerprint = computeRequestFingerprint('POST', `/items/${itemId}/approval/request`, input);

  return await withIdempotency(actor, reqCtx.idempotencyKey, fingerprint, async (client) => {
    const current = await lockItem(client, itemId);
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

    const evalRes = evaluateTransition('request_approval', actor, current, {
      name: 'request_approval',
    });
    if (!evalRes.ok) {
      const statusCode = evalRes.code === 'forbidden' ? 403 : 409;
      throw new AppError(statusCode, evalRes.code, evalRes.detail);
    }

    // Insert pending approval row
    try {
      await client.query(
        `INSERT INTO approvals (item_id, requested_by, state)
         VALUES ($1, $2, 'pending')`,
        [itemId, actor.id]
      );
    } catch (err: any) {
      if (err.code === '23505') {
        throw new AppError(409, 'invalid_transition', 'An approval request is already pending for this item.');
      }
      throw err;
    }

    const updated = await updateItem(client, itemId, current.version, evalRes.patch);
    if (!updated) {
      const fresh = await lockItem(client, itemId);
      throw new AppError(409, 'version_conflict', 'Item changed since you loaded it.', {
        current: fresh ? formatItemDto(actor, fresh) : null,
      });
    }

    const event = await insertEvent(client, {
      item_id: itemId,
      team_id: updated.team_id,
      actor_id: actor.id,
      type: 'approval_requested',
      payload: {
        changes: {
          status: { from: current.status, to: updated.status },
          approval_state: { from: current.approval_state, to: updated.approval_state },
        },
      },
      item_version: updated.version,
      request_id: reqCtx.requestId,
    });

    await addWatcher(client, itemId, actor.id);
    await insertOutbox(client, event.id, HANDLERS_FOR['approval_requested'] || []);
    await notifyChanged(client, {
      item_id: itemId,
      team_id: updated.team_id,
      version: updated.version,
      type: 'approval_requested',
      event_id: event.id,
    });

    const refreshed = await getItemForActor(client, actor, itemId);
    return {
      status: 200,
      body: formatItemDto(actor, refreshed || updated),
    };
  });
}

export async function decideApproval(
  actor: Actor,
  itemId: string,
  decision: 'approved' | 'rejected',
  input: { expected_version: number; note?: string },
  reqCtx: { idempotencyKey?: string; requestId: string }
) {
  const path = `/items/${itemId}/approval/${decision === 'approved' ? 'approve' : 'reject'}`;
  const fingerprint = computeRequestFingerprint('POST', path, input);

  return await withIdempotency(actor, reqCtx.idempotencyKey, fingerprint, async (client) => {
    const current = await lockItem(client, itemId);
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

    // Load pending approval row
    const pendingRes = await client.query(
      `SELECT * FROM approvals WHERE item_id = $1 AND state = 'pending' FOR UPDATE`,
      [itemId]
    );

    if (pendingRes.rows.length === 0) {
      throw new AppError(409, 'invalid_transition', 'No pending approval request found for this item.');
    }

    const pending = pendingRes.rows[0];

    const transitionName = decision === 'approved' ? 'approve' : 'reject';
    const evalRes = evaluateTransition(transitionName, actor, current, {
      name: transitionName,
      approval_requester_id: pending.requested_by,
      has_pending_approval: true,
      note: input.note,
    });

    if (!evalRes.ok) {
      const statusCode = evalRes.code === 'forbidden' ? 403 : 409;
      throw new AppError(statusCode, evalRes.code, evalRes.detail);
    }

    // Update approval row atomically
    const approvalUpdateRes = await client.query(
      `UPDATE approvals
       SET state = $1, decided_by = $2, decided_at = now(), decision_note = $3
       WHERE item_id = $4 AND state = 'pending'
       RETURNING *`,
      [decision, actor.id, input.note?.trim() || null, itemId]
    );

    if (approvalUpdateRes.rows.length === 0) {
      throw new AppError(409, 'invalid_transition', 'Approval decision conflict or already decided.');
    }

    const updated = await updateItem(client, itemId, current.version, evalRes.patch);
    if (!updated) {
      const fresh = await lockItem(client, itemId);
      throw new AppError(409, 'version_conflict', 'Item changed since you loaded it.', {
        current: fresh ? formatItemDto(actor, fresh) : null,
      });
    }

    const eventType = decision === 'approved' ? 'approval_approved' : 'approval_rejected';
    const event = await insertEvent(client, {
      item_id: itemId,
      team_id: updated.team_id,
      actor_id: actor.id,
      type: eventType,
      payload: {
        approval_id: pending.id,
        changes: {
          status: { from: current.status, to: updated.status },
          approval_state: { from: current.approval_state, to: updated.approval_state },
        },
        note: input.note,
      },
      item_version: updated.version,
      request_id: reqCtx.requestId,
    });

    await insertOutbox(client, event.id, HANDLERS_FOR[eventType] || []);
    await notifyChanged(client, {
      item_id: itemId,
      team_id: updated.team_id,
      version: updated.version,
      type: eventType,
      event_id: event.id,
    });

    const refreshed = await getItemForActor(client, actor, itemId);
    return {
      status: 200,
      body: formatItemDto(actor, refreshed || updated),
    };
  });
}
