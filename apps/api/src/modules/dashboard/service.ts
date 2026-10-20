import { Actor, effectiveRole } from '../../domain/permissions.js';
import { getPool } from '../../db/pool.js';
import { AppError } from '../../http/errors.js';
import { formatItemDto } from '../items/service.js';
import { DbWorkItem } from '../items/repo.js';

export interface AttentionSection {
  key: string;
  label: string;
  count: number;
  count_capped: boolean;
  items: unknown[];
  filter_preset: string;
}

export async function attention(actor: Actor): Promise<{ sections: AttentionSection[] }> {
  const pool = getPool();

  // Helper to query bounded count (up to 1001) and top 10 items
  async function querySection(
    baseWhere: string,
    values: any[],
    orderBy: string,
    key: string,
    label: string,
    filterPreset: string
  ): Promise<AttentionSection> {
    const countSql = `
      SELECT count(*) AS cnt FROM (
        SELECT 1
        FROM work_items wi
        WHERE ${baseWhere}
        LIMIT 1001
      ) t
    `;
    const countRes = await pool.query<{ cnt: string }>(countSql, values);
    const rawCount = parseInt(countRes.rows[0]?.cnt || '0', 10);
    const countCapped = rawCount > 1000;
    const finalCount = countCapped ? 1000 : rawCount;

    const itemsSql = `
      SELECT wi.*, t.name AS team_name, ru.display_name AS reporter_display_name, au.display_name AS assignee_display_name
      FROM work_items wi
      JOIN teams t ON t.id = wi.team_id
      JOIN users ru ON ru.id = wi.reporter_id
      LEFT JOIN users au ON au.id = wi.assignee_id
      WHERE ${baseWhere}
      ORDER BY ${orderBy}
      LIMIT 10
    `;
    const itemsRes = await pool.query<DbWorkItem>(itemsSql, values);
    const items = itemsRes.rows.map((r) => formatItemDto(actor, r));

    return {
      key,
      label,
      count: finalCount,
      count_capped: countCapped,
      items,
      filter_preset: filterPreset,
    };
  }

  // 1. awaiting_my_approval
  const approvalWhere =
    actor.orgRole === 'org_admin'
      ? `wi.status = 'pending_approval' AND wi.assignee_id != $1 AND NOT EXISTS (
           SELECT 1 FROM approvals a WHERE a.item_id = wi.id AND a.state = 'pending' AND a.requested_by = $1
         )`
      : `wi.status = 'pending_approval'
         AND wi.team_id IN (
           SELECT team_id FROM team_memberships WHERE user_id = $1 AND role IN ('approver', 'admin')
         )
         AND wi.assignee_id != $1
         AND NOT EXISTS (
           SELECT 1 FROM approvals a WHERE a.item_id = wi.id AND a.state = 'pending' AND a.requested_by = $1
         )`;

  // 2. my_overdue
  const overdueWhere = `wi.assignee_id = $1 AND wi.due_at < now() AND wi.status NOT IN ('resolved', 'closed')`;

  // 3. my_stale
  const staleWhere = `wi.assignee_id = $1 AND wi.stale_at IS NOT NULL AND wi.stale_at < now() AND wi.status NOT IN ('resolved', 'closed')`;

  // 4. my_active (in_progress or blocked, not overdue and not stale)
  const activeWhere = `
    wi.assignee_id = $1
    AND wi.status IN ('in_progress', 'blocked')
    AND (wi.due_at IS NULL OR wi.due_at >= now())
    AND (wi.stale_at IS NULL OR wi.stale_at >= now())
  `;

  // 5. unassigned_in_my_teams
  const unassignedWhere =
    actor.orgRole === 'org_admin' || actor.orgRole === 'auditor'
      ? `wi.status = 'open' AND wi.assignee_id IS NULL`
      : `wi.status = 'open' AND wi.assignee_id IS NULL AND wi.team_id IN (
           SELECT team_id FROM team_memberships WHERE user_id = $1
         )`;

  // 6. unread_notifications (count only + top 5)
  const notifCountSql = `
    SELECT count(*) AS cnt FROM (
      SELECT 1 FROM notifications WHERE user_id = $1 AND read_at IS NULL LIMIT 1001
    ) t
  `;
  const notifCountRes = await pool.query<{ cnt: string }>(notifCountSql, [actor.id]);
  const notifRawCount = parseInt(notifCountRes.rows[0]?.cnt || '0', 10);
  const notifCapped = notifRawCount > 1000;
  const notifFinalCount = notifCapped ? 1000 : notifRawCount;

  const notifItemsSql = `
    SELECT n.*, wi.title AS item_title
    FROM notifications n
    JOIN work_items wi ON wi.id = n.item_id
    WHERE n.user_id = $1 AND n.read_at IS NULL
    ORDER BY n.id DESC
    LIMIT 5
  `;
  const notifItemsRes = await pool.query(notifItemsSql, [actor.id]);

  const [awaitingSec, overdueSec, staleSec, activeSec, unassignedSec] = await Promise.all([
    querySection(
      approvalWhere,
      [actor.id],
      'wi.created_at ASC, wi.id ASC',
      'awaiting_my_approval',
      'Awaiting My Approval',
      'awaiting_my_approval=true'
    ),
    querySection(
      overdueWhere,
      [actor.id],
      'wi.due_at ASC, wi.id ASC',
      'my_overdue',
      'My Overdue Items',
      'assignee=me&due=overdue'
    ),
    querySection(
      staleWhere,
      [actor.id],
      'wi.stale_at ASC, wi.id ASC',
      'my_stale',
      'My Stale Items',
      'assignee=me&stale=true'
    ),
    querySection(
      activeWhere,
      [actor.id],
      'wi.priority ASC, wi.due_at ASC NULLS LAST, wi.id ASC',
      'my_active',
      'My Active Work',
      'assignee=me&status=in_progress&status=blocked'
    ),
    querySection(
      unassignedWhere,
      actor.orgRole === 'org_admin' || actor.orgRole === 'auditor' ? [] : [actor.id],
      'wi.priority ASC, wi.created_at ASC',
      'unassigned_in_my_teams',
      'Unassigned in My Teams',
      'assignee=unassigned&status=open'
    ),
  ]);

  const notifSection: AttentionSection = {
    key: 'unread_notifications',
    label: 'Unread Notifications',
    count: notifFinalCount,
    count_capped: notifCapped,
    items: notifItemsRes.rows.map((r) => ({
      id: String(r.id),
      item_id: r.item_id,
      item_title: r.item_title,
      event_id: String(r.event_id),
      kind: r.kind,
      created_at: new Date(r.created_at).toISOString(),
    })),
    filter_preset: 'notifications',
  };

  return {
    sections: [
      awaitingSec,
      overdueSec,
      staleSec,
      activeSec,
      unassignedSec,
      notifSection,
    ],
  };
}

export async function overview(actor: Actor, teamId: string) {
  const pool = getPool();
  const role = effectiveRole(actor, teamId);
  if (role === 'none' && actor.orgRole !== 'org_admin' && actor.orgRole !== 'auditor') {
    throw new AppError(404, 'not_found', 'Team not found');
  }

  // Active items counts by status
  const statusRes = await pool.query<{ status: string; count: string }>(
    `SELECT status, count(*) AS count
     FROM work_items
     WHERE team_id = $1 AND status NOT IN ('resolved', 'closed')
     GROUP BY status`,
    [teamId]
  );
  const byStatus: Record<string, number> = {};
  for (const r of statusRes.rows) {
    byStatus[r.status] = parseInt(r.count, 10);
  }

  // Active items counts by priority
  const prioRes = await pool.query<{ priority: string; count: string }>(
    `SELECT priority, count(*) AS count
     FROM work_items
     WHERE team_id = $1 AND status NOT IN ('resolved', 'closed')
     GROUP BY priority`,
    [teamId]
  );
  const byPriority: Record<string, number> = {};
  for (const r of prioRes.rows) {
    byPriority[r.priority] = parseInt(r.count, 10);
  }

  // Overdue count
  const overdueRes = await pool.query<{ count: string }>(
    `SELECT count(*) AS count
     FROM work_items
     WHERE team_id = $1 AND due_at < now() AND status NOT IN ('resolved', 'closed')`,
    [teamId]
  );

  // Stale count
  const staleRes = await pool.query<{ count: string }>(
    `SELECT count(*) AS count
     FROM work_items
     WHERE team_id = $1 AND stale_at < now() AND status NOT IN ('resolved', 'closed')`,
    [teamId]
  );

  // Unassigned count & oldest unassigned age
  const unassignedRes = await pool.query<{ count: string; oldest_created: Date | null }>(
    `SELECT count(*) AS count, min(created_at) AS oldest_created
     FROM work_items
     WHERE team_id = $1 AND assignee_id IS NULL AND status = 'open'`,
    [teamId]
  );

  // 7-day counts
  const opened7dRes = await pool.query<{ count: string }>(
    `SELECT count(*) AS count
     FROM work_items
     WHERE team_id = $1 AND created_at >= now() - INTERVAL '7 days'`,
    [teamId]
  );

  const resolved7dRes = await pool.query<{ count: string }>(
    `SELECT count(*) AS count
     FROM work_items
     WHERE team_id = $1 AND resolved_at >= now() - INTERVAL '7 days'`,
    [teamId]
  );

  // Most recent 20 events
  const eventsRes = await pool.query(
    `SELECT ie.*, u.display_name AS actor_display_name
     FROM item_events ie
     LEFT JOIN users u ON u.id = ie.actor_id
     WHERE ie.team_id = $1
     ORDER BY ie.id DESC
     LIMIT 20`,
    [teamId]
  );

  return {
    team_id: teamId,
    by_status: byStatus,
    by_priority: byPriority,
    overdue_count: parseInt(overdueRes.rows[0]?.count || '0', 10),
    stale_count: parseInt(staleRes.rows[0]?.count || '0', 10),
    unassigned_count: parseInt(unassignedRes.rows[0]?.count || '0', 10),
    oldest_unassigned_created_at: unassignedRes.rows[0]?.oldest_created
      ? new Date(unassignedRes.rows[0].oldest_created).toISOString()
      : null,
    last_7_days: {
      opened: parseInt(opened7dRes.rows[0]?.count || '0', 10),
      resolved: parseInt(resolved7dRes.rows[0]?.count || '0', 10),
    },
    recent_events: eventsRes.rows.map((r) => ({
      id: String(r.id),
      item_id: r.item_id,
      actor: r.actor_id ? { id: r.actor_id, display_name: r.actor_display_name || '' } : null,
      type: r.type,
      payload: r.payload || {},
      created_at: new Date(r.created_at).toISOString(),
    })),
  };
}
