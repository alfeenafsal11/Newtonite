import { Actor } from '../../domain/permissions.js';
import { getPool } from '../../db/pool.js';

export async function listNotifications(
  actor: Actor,
  params: { cursor?: string; limit?: number | string; unread?: boolean | string }
) {
  const pool = getPool();
  const limitNum = Math.min(Math.max(parseInt(String(params.limit || 50), 10) || 50, 1), 100);
  const unreadOnly = params.unread === true || params.unread === 'true';

  const values: any[] = [actor.id];
  let whereSql = 'n.user_id = $1';

  if (unreadOnly) {
    whereSql += ' AND n.read_at IS NULL';
  }

  if (params.cursor) {
    values.push(BigInt(params.cursor));
    whereSql += ` AND n.id < $${values.length}`;
  }

  values.push(limitNum + 1);
  const limitParam = `$${values.length}`;

  const query = `
    SELECT n.*, wi.title AS item_title, wi.number AS item_number
    FROM notifications n
    JOIN work_items wi ON wi.id = n.item_id
    WHERE ${whereSql}
    ORDER BY n.id DESC
    LIMIT ${limitParam}
  `;

  const res = await pool.query(query, values);
  const rows = res.rows;
  let nextCursor: string | null = null;

  if (rows.length > limitNum) {
    const last = rows[limitNum - 1];
    nextCursor = String(last.id);
  }

  const notifications = rows.slice(0, limitNum).map((r) => ({
    id: String(r.id),
    item_id: r.item_id,
    item_key: `OPS-${r.item_number}`,
    item_title: r.item_title,
    event_id: String(r.event_id),
    kind: r.kind,
    created_at: new Date(r.created_at).toISOString(),
    read_at: r.read_at ? new Date(r.read_at).toISOString() : null,
  }));

  return {
    notifications,
    next_cursor: nextCursor,
  };
}

export async function markRead(actor: Actor, upToId?: string | number) {
  const pool = getPool();
  let query: string;
  let values: any[];

  if (upToId) {
    query = `
      UPDATE notifications
      SET read_at = now()
      WHERE user_id = $1 AND id <= $2 AND read_at IS NULL
    `;
    values = [actor.id, BigInt(upToId)];
  } else {
    query = `
      UPDATE notifications
      SET read_at = now()
      WHERE user_id = $1 AND read_at IS NULL
    `;
    values = [actor.id];
  }

  const res = await pool.query(query, values);
  return { updated: res.rowCount || 0 };
}
