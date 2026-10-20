import crypto from 'node:crypto';
import argon2 from 'argon2';
import { getTestPool } from './db.js';
import { signToken } from '../../src/http/auth.js';
import { TeamRole, OrgRole } from '../../src/domain/permissions.js';
import { staleAtFor } from '../../src/domain/staleness.js';
import { DbWorkItem } from '../../src/modules/items/repo.js';

let cachedHash: string | null = null;

export async function getTestPasswordHash(): Promise<string> {
  if (!cachedHash) {
    cachedHash = await argon2.hash('Passw0rd!demo');
  }
  return cachedHash;
}

export interface CreatedUser {
  id: string;
  email: string;
  displayName: string;
  token: string;
  orgRole: OrgRole;
}

export async function createUser(
  opts: {
    orgRole?: OrgRole;
    org_role?: OrgRole;
    email?: string;
    displayName?: string;
    isActive?: boolean;
  } = {}
): Promise<CreatedUser> {
  const pool = getTestPool();
  const id = crypto.randomUUID();
  const email = opts.email || `user_${id.slice(0, 8)}@opsflow.test`;
  const displayName = opts.displayName || `User ${id.slice(0, 6)}`;
  const orgRole = opts.orgRole || opts.org_role || 'member';
  const isActive = opts.isActive ?? true;
  const hash = await getTestPasswordHash();

  await pool.query(
    `INSERT INTO users (id, email, display_name, password_hash, org_role, is_active, token_version)
     VALUES ($1, $2, $3, $4, $5, $6, 0)`,
    [id, email, displayName, hash, orgRole, isActive]
  );

  const token = await signToken({ id, token_version: 0 });

  return {
    id,
    email,
    displayName,
    token,
    orgRole,
  };
}

export interface CreatedTeam {
  id: string;
  name: string;
  slug: string;
}

export async function createTeam(name?: string, slug?: string): Promise<CreatedTeam> {
  const pool = getTestPool();
  const id = crypto.randomUUID();
  const uniqueName = name ? `${name} ${id.slice(0, 4)}` : `Team ${id.slice(0, 6)}`;
  const uniqueSlug = slug ? `${slug}-${id.slice(0, 6)}` : `team-${id.slice(0, 8)}`;

  await pool.query(
    `INSERT INTO teams (id, name, slug)
     VALUES ($1, $2, $3)`,
    [id, uniqueName, uniqueSlug]
  );

  return {
    id,
    name: uniqueName,
    slug: uniqueSlug,
  };
}

export async function addTeamMember(teamId: string, userId: string, role: TeamRole): Promise<void> {
  const pool = getTestPool();
  await pool.query(
    `INSERT INTO team_memberships (team_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [teamId, userId, role]
  );
}

export async function createWorkItem(
  teamId: string,
  reporterId: string,
  params: Partial<any> = {}
): Promise<DbWorkItem> {
  const pool = getTestPool();
  const priority = params.priority || 'p2';
  const status = params.status || 'open';
  const requiresApproval = params.requires_approval ?? false;
  const approvalState = params.approval_state || (requiresApproval ? 'not_requested' : 'not_required');
  const now = new Date();

  let assigneeId = params.assignee_id ?? null;
  if ((status === 'in_progress' || status === 'pending_approval') && assigneeId === null) {
    assigneeId = reporterId;
  }

  const closeReason = status === 'closed' ? params.close_reason || 'completed' : null;
  const closedAt = status === 'closed' ? params.closed_at || now : null;

  let staleAt: Date | null = null;
  if (status !== 'resolved' && status !== 'closed') {
    staleAt = params.stale_at !== undefined ? params.stale_at : staleAtFor(priority, now);
  }

  const res = await pool.query<DbWorkItem>(
    `INSERT INTO work_items (
       team_id, type, title, description, priority, reporter_id, assignee_id,
       requires_approval, approval_state, tags, due_at, stale_at, status,
       close_reason, closed_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      teamId,
      params.type || 'operational_task',
      params.title || 'Test Item',
      params.description || 'Description',
      priority,
      reporterId,
      assigneeId,
      requiresApproval,
      approvalState,
      params.tags || [],
      params.due_at ?? null,
      staleAt,
      status,
      closeReason,
      closedAt,
    ]
  );
  return res.rows[0];
}

