import pg from 'pg';
import { EventWithItem } from './notify-watchers.js';

export async function handleNotifyApprovers(
  event: EventWithItem,
  db: pg.PoolClient | pg.Pool
): Promise<void> {
  // Find item details to get assignee_id
  const itemRes = await db.query<{ assignee_id: string | null }>(
    `SELECT assignee_id FROM work_items WHERE id = $1`,
    [event.item_id]
  );
  const assigneeId = itemRes.rows[0]?.assignee_id || null;

  // Find team approvers/admins and org_admins, excluding requester and assignee
  const approversRes = await db.query<{ id: string }>(
    `SELECT DISTINCT u.id
     FROM users u
     LEFT JOIN team_memberships tm
       ON tm.user_id = u.id AND tm.team_id = $1
     WHERE u.is_active = true
       AND (
         tm.role IN ('approver', 'admin')
         OR u.org_role = 'org_admin'
       )
       AND ($2::uuid IS NULL OR u.id != $2::uuid)
       AND ($3::uuid IS NULL OR u.id != $3::uuid)`,
    [event.team_id, event.actor_id, assigneeId]
  );

  for (const approver of approversRes.rows) {
    await db.query(
      `INSERT INTO notifications (user_id, item_id, event_id, kind)
       VALUES ($1, $2, $3, 'approver')
       ON CONFLICT (user_id, event_id, kind) DO NOTHING`,
      [approver.id, event.item_id, event.id]
    );
  }
}
