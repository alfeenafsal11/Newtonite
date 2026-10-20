import pg from 'pg';
import { Actor, can, effectiveRole } from '../../domain/permissions.js';
import { staleAtFor } from '../../domain/staleness.js';
import { HANDLERS_FOR } from '../../domain/events.js';
import { AppError } from '../../http/errors.js';
import { withTx } from '../../db/tx.js';
import { getPool } from '../../db/pool.js';
import {
  lockItem,
  getItemForActor,
  insertEvent,
  insertOutbox,
  addWatcher,
  notifyChanged,
} from '../items/repo.js';

export async function addComment(
  actor: Actor,
  itemId: string,
  body: string,
  reqCtx: { requestId: string }
) {
  return await withTx(async (client) => {
    const item = await lockItem(client, itemId);
    if (!item) {
      throw new AppError(404, 'not_found', 'Work item not found');
    }

    const role = effectiveRole(actor, item.team_id);
    if (role === 'none' && actor.orgRole !== 'org_admin' && actor.orgRole !== 'auditor') {
      throw new AppError(404, 'not_found', 'Work item not found');
    }

    const perm = can(actor, 'item.comment', { item });
    if (!perm.allowed) {
      throw new AppError(403, 'forbidden', perm.reason || 'Permission denied to comment on this item');
    }

    // Insert comment
    const commentRes = await client.query(
      `INSERT INTO comments (item_id, team_id, author_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [itemId, item.team_id, actor.id, body.trim()]
    );
    const comment = commentRes.rows[0];

    // Activity bump without version increment
    const newStaleAt = staleAtFor(item.priority, new Date());
    await client.query(
      `UPDATE work_items
       SET last_activity_at = now(), stale_at = $1, stale_notified_at = NULL
       WHERE id = $2`,
      [newStaleAt, itemId]
    );

    // Event
    const event = await insertEvent(client, {
      item_id: itemId,
      team_id: item.team_id,
      actor_id: actor.id,
      type: 'comment_added',
      payload: { comment_id: comment.id },
      item_version: item.version,
      request_id: reqCtx.requestId,
    });

    await addWatcher(client, itemId, actor.id);
    await insertOutbox(client, event.id, HANDLERS_FOR['comment_added'] || []);
    await notifyChanged(client, {
      item_id: itemId,
      team_id: item.team_id,
      version: item.version,
      type: 'comment_added',
      event_id: event.id,
    });

    return {
      id: comment.id,
      item_id: comment.item_id,
      author: {
        id: actor.id,
        display_name: actor.displayName || '',
      },
      body: comment.body,
      created_at: new Date(comment.created_at).toISOString(),
    };
  });
}

export async function listComments(
  actor: Actor,
  itemId: string,
  _cursor?: string,
  limit = 50
) {
  const pool = getPool();
  const item = await getItemForActor(pool, actor, itemId);
  if (!item) {
    throw new AppError(404, 'not_found', 'Work item not found');
  }

  const res = await pool.query(
    `SELECT c.*, u.display_name as author_display_name
     FROM comments c
     JOIN users u ON u.id = c.author_id
     WHERE c.item_id = $1
     ORDER BY c.created_at ASC, c.id ASC
     LIMIT $2`,
    [itemId, limit]
  );

  return {
    comments: res.rows.map((row) => ({
      id: row.id,
      item_id: row.item_id,
      author: {
        id: row.author_id,
        display_name: row.author_display_name,
      },
      body: row.body,
      created_at: new Date(row.created_at).toISOString(),
    })),
  };
}
