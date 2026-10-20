import { Actor } from '../../domain/permissions.js';
import { decodeCursor } from '../../domain/cursor.js';
import { AppError } from '../../http/errors.js';

export interface ListItemsParams {
  team_id?: string | string[];
  status?: string | string[];
  priority?: string | string[];
  type?: string | string[];
  assignee?: string;
  reporter?: string;
  tag?: string;
  due?: 'overdue' | 'today' | 'week';
  stale?: boolean | string;
  awaiting_my_approval?: boolean | string;
  include_closed?: boolean | string;
  q?: string;
  sort?: 'activity_desc' | 'priority_due' | 'created_desc';
  limit?: number | string;
  cursor?: string;
}

export function buildListQuery(
  actor: Actor,
  params: ListItemsParams
): { text: string; values: any[]; limit: number; sort: string } {
  const values: any[] = [];
  const whereClauses: string[] = [];

  // Helper to push param
  const addParam = (val: any) => {
    values.push(val);
    return `$${values.length}`;
  };

  // 1. Base Authorization predicate
  if (actor.orgRole !== 'org_admin' && actor.orgRole !== 'auditor') {
    const actorParam = addParam(actor.id);
    whereClauses.push(
      `wi.team_id IN (SELECT team_id FROM team_memberships WHERE user_id = ${actorParam})`
    );
  }

  // 2. Filter: team_id
  if (params.team_id) {
    const teamIds = Array.isArray(params.team_id) ? params.team_id : [params.team_id];
    if (teamIds.length > 0) {
      const p = addParam(teamIds);
      whereClauses.push(`wi.team_id = ANY(${p}::uuid[])`);
    }
  }

  // 3. Filter: status
  const statuses = params.status
    ? Array.isArray(params.status)
      ? params.status
      : [params.status]
    : [];

  const includeClosed =
    params.include_closed === true ||
    params.include_closed === 'true' ||
    statuses.includes('closed');

  if (statuses.length > 0) {
    const p = addParam(statuses);
    whereClauses.push(`wi.status = ANY(${p}::item_status[])`);
  } else if (!includeClosed) {
    whereClauses.push(`wi.status <> 'closed'`);
  }

  // 4. Filter: priority
  if (params.priority) {
    const priorities = Array.isArray(params.priority) ? params.priority : [params.priority];
    if (priorities.length > 0) {
      const p = addParam(priorities);
      whereClauses.push(`wi.priority = ANY(${p}::item_priority[])`);
    }
  }

  // 5. Filter: type
  if (params.type) {
    const types = Array.isArray(params.type) ? params.type : [params.type];
    if (types.length > 0) {
      const p = addParam(types);
      whereClauses.push(`wi.type = ANY(${p}::item_type[])`);
    }
  }

  // 6. Filter: assignee
  if (params.assignee) {
    if (params.assignee === 'me') {
      const p = addParam(actor.id);
      whereClauses.push(`wi.assignee_id = ${p}`);
    } else if (params.assignee === 'unassigned') {
      whereClauses.push(`wi.assignee_id IS NULL`);
    } else {
      const p = addParam(params.assignee);
      whereClauses.push(`wi.assignee_id = ${p}`);
    }
  }

  // 7. Filter: reporter
  if (params.reporter) {
    if (params.reporter === 'me') {
      const p = addParam(actor.id);
      whereClauses.push(`wi.reporter_id = ${p}`);
    } else {
      const p = addParam(params.reporter);
      whereClauses.push(`wi.reporter_id = ${p}`);
    }
  }

  // 8. Filter: tag
  if (params.tag) {
    const p = addParam([params.tag]);
    whereClauses.push(`wi.tags @> ${p}::text[]`);
  }

  // 9. Filter: due
  if (params.due) {
    if (params.due === 'overdue') {
      whereClauses.push(`wi.due_at < now() AND wi.status NOT IN ('resolved', 'closed')`);
    } else if (params.due === 'today') {
      whereClauses.push(
        `wi.due_at >= date_trunc('day', now()) AND wi.due_at < date_trunc('day', now()) + interval '1 day'`
      );
    } else if (params.due === 'week') {
      whereClauses.push(`wi.due_at >= now() AND wi.due_at < now() + interval '7 days'`);
    }
  }

  // 10. Filter: stale
  if (params.stale === true || params.stale === 'true') {
    whereClauses.push(
      `wi.stale_at IS NOT NULL AND wi.stale_at < now() AND wi.status NOT IN ('resolved', 'closed')`
    );
  }

  // 11. Filter: awaiting_my_approval
  if (params.awaiting_my_approval === true || params.awaiting_my_approval === 'true') {
    const actorParam = addParam(actor.id);
    if (actor.orgRole === 'org_admin') {
      whereClauses.push(
        `wi.status = 'pending_approval' AND wi.assignee_id != ${actorParam} AND NOT EXISTS (
           SELECT 1 FROM approvals a
           WHERE a.item_id = wi.id AND a.state = 'pending' AND a.requested_by = ${actorParam}
         )`
      );
    } else {
      whereClauses.push(
        `wi.status = 'pending_approval'
         AND wi.team_id IN (
           SELECT team_id FROM team_memberships WHERE user_id = ${actorParam} AND role IN ('approver', 'admin')
         )
         AND wi.assignee_id != ${actorParam}
         AND NOT EXISTS (
           SELECT 1 FROM approvals a
           WHERE a.item_id = wi.id AND a.state = 'pending' AND a.requested_by = ${actorParam}
         )`
      );
    }
  }

  // 12. Filter: q (search)
  if (params.q && params.q.trim().length >= 2) {
    const qTrimmed = params.q.trim();
    const opsMatch = qTrimmed.match(/^(?:ops-)?(\d+)$/i);
    if (opsMatch && opsMatch[1]) {
      const numParam = addParam(parseInt(opsMatch[1], 10));
      whereClauses.push(`wi.number = ${numParam}`);
    } else {
      // Escape %, _, \ for ILIKE
      const escaped = qTrimmed.replace(/[%_\\]/g, '\\$&');
      const tsParam = addParam(qTrimmed);
      const likeParam = addParam(`%${escaped}%`);
      whereClauses.push(
        `(wi.search_vector @@ websearch_to_tsquery('english', ${tsParam}) OR wi.title ILIKE ${likeParam})`
      );
    }
  }

  // Sort and Keyset Pagination
  const sort = params.sort || 'activity_desc';
  const limitNum = Math.min(Math.max(parseInt(String(params.limit || 50), 10) || 50, 1), 100);

  // Decode cursor if provided
  if (params.cursor) {
    const decoded = decodeCursor(sort, params.cursor);
    if (!decoded) {
      throw new AppError(400, 'validation_error', 'Invalid cursor for requested sort');
    }

    if (sort === 'activity_desc') {
      const k0Param = addParam(new Date(decoded.k[0] as string | number));
      const idParam = addParam(decoded.id);
      whereClauses.push(`(wi.last_activity_at, wi.id) < (${k0Param}, ${idParam})`);
    } else if (sort === 'created_desc') {
      const k0Param = addParam(new Date(decoded.k[0] as string | number));
      const idParam = addParam(decoded.id);
      whereClauses.push(`(wi.created_at, wi.id) < (${k0Param}, ${idParam})`);
    } else if (sort === 'priority_due') {
      const prioParam = addParam(decoded.k[0]);
      const dueParam = decoded.k[1] ? addParam(new Date(decoded.k[1] as string | number)) : null;
      const idParam = addParam(decoded.id);

      if (dueParam) {
        whereClauses.push(
          `((wi.priority > ${prioParam})
            OR (wi.priority = ${prioParam} AND wi.due_at > ${dueParam})
            OR (wi.priority = ${prioParam} AND wi.due_at IS NULL)
            OR (wi.priority = ${prioParam} AND wi.due_at = ${dueParam} AND wi.id > ${idParam}))`
        );
      } else {
        whereClauses.push(
          `((wi.priority > ${prioParam})
            OR (wi.priority = ${prioParam} AND wi.due_at IS NULL AND wi.id > ${idParam}))`
        );
      }
    }
  }

  let orderBy = 'wi.last_activity_at DESC, wi.id DESC';
  if (sort === 'created_desc') {
    orderBy = 'wi.created_at DESC, wi.id DESC';
  } else if (sort === 'priority_due') {
    orderBy = 'wi.priority ASC, wi.due_at ASC NULLS LAST, wi.id ASC';
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const limitParam = addParam(limitNum + 1);

  const text = `
    SELECT
      wi.*,
      t.name AS team_name,
      ru.display_name AS reporter_display_name,
      au.display_name AS assignee_display_name
    FROM work_items wi
    JOIN teams t ON t.id = wi.team_id
    JOIN users ru ON ru.id = wi.reporter_id
    LEFT JOIN users au ON au.id = wi.assignee_id
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT ${limitParam}
  `;

  return { text, values, limit: limitNum, sort };
}
