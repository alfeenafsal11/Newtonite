import { Actor, can, effectiveRole, TeamRole } from '../../domain/permissions.js';
import { AppError } from '../../http/errors.js';
import { getPool } from '../../db/pool.js';

export async function listTeamsFor(actor: Actor) {
  const pool = getPool();
  const isAuditorOrOrgAdmin = actor.orgRole === 'org_admin' || actor.orgRole === 'auditor';

  let res;
  if (isAuditorOrOrgAdmin) {
    res = await pool.query('SELECT id, name, slug, created_at FROM teams ORDER BY name ASC');
  } else {
    res = await pool.query(
      `SELECT t.id, t.name, t.slug, t.created_at
       FROM teams t
       JOIN team_memberships tm ON tm.team_id = t.id
       WHERE tm.user_id = $1
       ORDER BY t.name ASC`,
      [actor.id]
    );
  }

  return {
    teams: res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      created_at: new Date(r.created_at).toISOString(),
    })),
  };
}

export async function listMembers(actor: Actor, teamId: string) {
  const pool = getPool();
  const role = effectiveRole(actor, teamId);

  if (role === 'none' && actor.orgRole !== 'org_admin' && actor.orgRole !== 'auditor') {
    throw new AppError(404, 'not_found', 'Team not found');
  }

  const perm = can(actor, 'team.members.read', { teamId });
  if (!perm.allowed) {
    throw new AppError(403, 'forbidden', perm.reason || 'Permission denied');
  }

  const res = await pool.query(
    `SELECT tm.user_id, u.display_name, u.email, tm.role, tm.created_at
     FROM team_memberships tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = $1
     ORDER BY tm.created_at ASC`,
    [teamId]
  );

  return {
    members: res.rows.map((r) => ({
      user_id: r.user_id,
      display_name: r.display_name,
      email: r.email,
      role: r.role,
      created_at: new Date(r.created_at).toISOString(),
    })),
  };
}

export async function setMemberRole(
  actor: Actor,
  teamId: string,
  userId: string,
  role: TeamRole
) {
  const pool = getPool();
  const currentRole = effectiveRole(actor, teamId);

  if (currentRole === 'none' && actor.orgRole !== 'org_admin') {
    throw new AppError(404, 'not_found', 'Team not found');
  }

  const perm = can(actor, 'team.members.manage', { teamId });
  if (!perm.allowed) {
    throw new AppError(403, 'forbidden', perm.reason || 'Permission denied to manage team members');
  }

  // Ensure target user exists
  const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
  if (userCheck.rows.length === 0) {
    throw new AppError(404, 'not_found', 'User not found');
  }

  const res = await pool.query(
    `INSERT INTO team_memberships (team_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING *`,
    [teamId, userId, role]
  );

  await pool.query(
    `SELECT pg_notify('membership_changed', $1)`,
    [JSON.stringify({ team_id: teamId, user_id: userId, role })]
  );

  return {
    team_id: res.rows[0].team_id,
    user_id: res.rows[0].user_id,
    role: res.rows[0].role,
  };
}

export async function removeMember(actor: Actor, teamId: string, userId: string) {
  const pool = getPool();
  const currentRole = effectiveRole(actor, teamId);

  if (currentRole === 'none' && actor.orgRole !== 'org_admin') {
    throw new AppError(404, 'not_found', 'Team not found');
  }

  const perm = can(actor, 'team.members.manage', { teamId });
  if (!perm.allowed) {
    throw new AppError(403, 'forbidden', perm.reason || 'Permission denied to manage team members');
  }

  // Check if member holds assigned active items in the team
  const activeItems = await pool.query(
    `SELECT count(*) FROM work_items
     WHERE team_id = $1 AND assignee_id = $2 AND status NOT IN ('resolved', 'closed')`,
    [teamId, userId]
  );

  if (parseInt(activeItems.rows[0].count, 10) > 0) {
    throw new AppError(
      409,
      'guard_failed',
      'Cannot remove team member with active assigned work items in this team'
    );
  }

  await pool.query(
    'DELETE FROM team_memberships WHERE team_id = $1 AND user_id = $2',
    [teamId, userId]
  );

  await pool.query(
    `SELECT pg_notify('membership_changed', $1)`,
    [JSON.stringify({ team_id: teamId, user_id: userId, action: 'removed' })]
  );

  return { success: true };
}
