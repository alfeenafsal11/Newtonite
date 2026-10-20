import pg from 'pg';
import { Actor, effectiveRole } from '../../domain/permissions.js';
import { ItemRow } from '../../domain/transitions.js';
import { EventPayload } from '../../domain/events.js';

export interface DbWorkItem extends ItemRow {
  number: number | string;
  type: string;
  title: string;
  description: string;
  priority: string;
  tags: string[];
  due_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  last_activity_at: Date | string;
  stale_at: Date | string | null;
  stale_notified_at: Date | string | null;
  overdue_notified_at: Date | string | null;
  team_name?: string;
  reporter_display_name?: string;
  assignee_display_name?: string | null;
}

export async function lockItem(client: pg.PoolClient, id: string): Promise<DbWorkItem | null> {
  const res = await client.query(
    `SELECT wi.*, t.name as team_name,
            u_rep.display_name as reporter_display_name,
            u_ass.display_name as assignee_display_name
     FROM work_items wi
     JOIN teams t ON t.id = wi.team_id
     JOIN users u_rep ON u_rep.id = wi.reporter_id
     LEFT JOIN users u_ass ON u_ass.id = wi.assignee_id
     WHERE wi.id = $1
     FOR UPDATE OF wi`,
    [id]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0];
}

export async function getItemForActor(
  poolOrClient: pg.Pool | pg.PoolClient,
  actor: Actor,
  id: string
): Promise<DbWorkItem | null> {
  const isAuditorOrOrgAdmin = actor.orgRole === 'org_admin' || actor.orgRole === 'auditor';

  let query: string;
  let params: unknown[];

  if (isAuditorOrOrgAdmin) {
    query = `
      SELECT wi.*, t.name as team_name,
             u_rep.display_name as reporter_display_name,
             u_ass.display_name as assignee_display_name
      FROM work_items wi
      JOIN teams t ON t.id = wi.team_id
      JOIN users u_rep ON u_rep.id = wi.reporter_id
      LEFT JOIN users u_ass ON u_ass.id = wi.assignee_id
      WHERE wi.id = $1
    `;
    params = [id];
  } else {
    query = `
      SELECT wi.*, t.name as team_name,
             u_rep.display_name as reporter_display_name,
             u_ass.display_name as assignee_display_name
      FROM work_items wi
      JOIN teams t ON t.id = wi.team_id
      JOIN users u_rep ON u_rep.id = wi.reporter_id
      LEFT JOIN users u_ass ON u_ass.id = wi.assignee_id
      WHERE wi.id = $1
        AND wi.team_id IN (SELECT team_id FROM team_memberships WHERE user_id = $2)
    `;
    params = [id, actor.id];
  }

  const res = await poolOrClient.query(query, params);
  if (res.rows.length === 0) return null;
  return res.rows[0];
}

export async function insertItem(
  client: pg.PoolClient,
  item: {
    team_id: string;
    type: string;
    title: string;
    description: string;
    priority: string;
    reporter_id: string;
    assignee_id?: string | null;
    requires_approval: boolean;
    approval_state: string;
    tags: string[];
    due_at?: string | null;
    stale_at: Date;
  }
): Promise<DbWorkItem> {
  const res = await client.query(
    `INSERT INTO work_items (
       team_id, type, title, description, priority, reporter_id, assignee_id,
       requires_approval, approval_state, tags, due_at, stale_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      item.team_id,
      item.type,
      item.title,
      item.description,
      item.priority,
      item.reporter_id,
      item.assignee_id ?? null,
      item.requires_approval,
      item.approval_state,
      item.tags,
      item.due_at ?? null,
      item.stale_at,
    ]
  );
  return res.rows[0];
}

export async function updateItem(
  client: pg.PoolClient,
  id: string,
  expectedVersion: number,
  patch: Partial<DbWorkItem> & { stale_at?: Date | null; resolution_note?: string | null }
): Promise<DbWorkItem | null> {
  const fieldEntries = Object.entries(patch).filter(
    ([k]) => !['id', 'number', 'version', 'created_at', 'team_name', 'reporter_display_name', 'assignee_display_name'].includes(k)
  );

  const setClauses: string[] = [
    'version = version + 1',
    'updated_at = now()',
    'last_activity_at = now()',
  ];
  const values: unknown[] = [id, expectedVersion];

  let idx = 3;
  for (const [key, value] of fieldEntries) {
    setClauses.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }

  const sql = `
    UPDATE work_items
    SET ${setClauses.join(', ')}
    WHERE id = $1 AND version = $2
    RETURNING *
  `;

  const res = await client.query(sql, values);
  if (res.rows.length === 0) return null;
  return res.rows[0];
}

export async function insertEvent(
  client: pg.PoolClient,
  ev: {
    item_id: string;
    team_id: string;
    actor_id: string | null;
    type: string;
    payload: EventPayload;
    item_version: number;
    request_id?: string;
  }
): Promise<{ id: string | number }> {
  const res = await client.query(
    `INSERT INTO item_events (item_id, team_id, actor_id, type, payload, item_version, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      ev.item_id,
      ev.team_id,
      ev.actor_id,
      ev.type,
      JSON.stringify(ev.payload || {}),
      ev.item_version,
      ev.request_id || null,
    ]
  );
  return res.rows[0];
}

export async function insertOutbox(
  client: pg.PoolClient,
  eventId: string | number,
  handlers: string[]
): Promise<void> {
  for (const handler of handlers) {
    await client.query(
      `INSERT INTO outbox (event_id, handler)
       VALUES ($1, $2)
       ON CONFLICT (event_id, handler) DO NOTHING`,
      [eventId, handler]
    );
  }
}

export async function addWatcher(
  client: pg.PoolClient,
  itemId: string,
  userId: string
): Promise<void> {
  await client.query(
    `INSERT INTO item_watchers (item_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (item_id, user_id) DO NOTHING`,
    [itemId, userId]
  );
}

export async function notifyChanged(
  client: pg.PoolClient,
  payload: {
    item_id: string;
    team_id: string;
    version: number;
    type: string;
    event_id: string | number;
  }
): Promise<void> {
  await client.query(`SELECT pg_notify('item_changed', $1)`, [JSON.stringify(payload)]);
}
