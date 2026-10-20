export type OrgRole = 'member' | 'auditor' | 'org_admin';
export type TeamRole = 'viewer' | 'member' | 'approver' | 'admin';

export interface Actor {
  id: string;
  email?: string;
  displayName?: string;
  orgRole: OrgRole;
  isActive: boolean;
  tokenVersion?: number;
  memberships: Map<string, TeamRole>;
}

export type Permission =
  | 'item.read'
  | 'item.create'
  | 'item.update'
  | 'item.priority.p0'
  | 'item.comment'
  | 'item.claim'
  | 'item.release'
  | 'item.assign'
  | 'item.approval.request'
  | 'item.approval.decide'
  | 'item.transfer'
  | 'item.cancel'
  | 'team.members.read'
  | 'team.members.manage'
  | 'org.users.manage'
  | 'org.teams.create';

export interface Decision {
  allowed: boolean;
  reason?: string;
}

export interface ItemRowContext {
  id?: string;
  team_id: string;
  status: string;
  assignee_id?: string | null;
  reporter_id?: string;
  requires_approval?: boolean;
  priority?: string;
}

export interface PermissionContext {
  teamId?: string;
  item?: ItemRowContext;
  approvalRequesterId?: string;
  targetTeamId?: string;
  targetAssigneeRole?: TeamRole | 'none';
  newPriority?: string;
}

const ROLE_RANK: Record<TeamRole | 'none', number> = {
  none: 0,
  viewer: 1,
  member: 2,
  approver: 3,
  admin: 4,
};

export function roleAtLeast(a: TeamRole | 'none', b: TeamRole | 'none'): boolean {
  return ROLE_RANK[a] >= ROLE_RANK[b];
}

export function effectiveRole(actor: Actor, teamId: string): TeamRole | 'none' {
  if (actor.orgRole === 'org_admin') {
    return 'admin';
  }
  if (actor.orgRole === 'auditor') {
    return 'viewer';
  }
  return actor.memberships.get(teamId) || 'none';
}

export function can(actor: Actor, permission: Permission, ctx?: PermissionContext): Decision {
  if (!actor.isActive) {
    return { allowed: false, reason: 'user_inactive' };
  }

  // Org-level permissions
  if (permission === 'org.users.manage' || permission === 'org.teams.create') {
    return actor.orgRole === 'org_admin'
      ? { allowed: true }
      : { allowed: false, reason: 'role_insufficient' };
  }

  const teamId = ctx?.item ? ctx.item.team_id : ctx?.teamId;
  if (!teamId) {
    // If no team context, org_admin is allowed, auditor for reads
    if (actor.orgRole === 'org_admin') return { allowed: true };
    return { allowed: false, reason: 'team_context_required' };
  }

  const role = effectiveRole(actor, teamId);

  // Auditor is strictly read-only everywhere
  if (actor.orgRole === 'auditor') {
    if (permission === 'item.read' || permission === 'team.members.read') {
      return { allowed: true };
    }
    return { allowed: false, reason: 'auditor_read_only' };
  }

  // No membership/role in the team
  if (role === 'none') {
    return { allowed: false, reason: 'not_a_member' };
  }

  switch (permission) {
    case 'item.read':
    case 'team.members.read':
      return { allowed: true };

    case 'team.members.manage':
      return roleAtLeast(role, 'admin')
        ? { allowed: true }
        : { allowed: false, reason: 'role_insufficient' };

    case 'item.create':
      return roleAtLeast(role, 'member')
        ? { allowed: true }
        : { allowed: false, reason: 'role_insufficient' };

    case 'item.update':
      if (!roleAtLeast(role, 'member')) {
        return { allowed: false, reason: 'role_insufficient' };
      }
      if (ctx?.item && ctx.item.status === 'closed') {
        return { allowed: false, reason: 'item_closed' };
      }
      return { allowed: true };

    case 'item.priority.p0':
      return roleAtLeast(role, 'approver')
        ? { allowed: true }
        : { allowed: false, reason: 'role_insufficient' };

    case 'item.comment':
      if (!roleAtLeast(role, 'member')) {
        return { allowed: false, reason: 'role_insufficient' };
      }
      if (ctx?.item && ctx.item.status === 'closed') {
        return { allowed: false, reason: 'item_closed' };
      }
      return { allowed: true };

    case 'item.claim': {
      if (!roleAtLeast(role, 'member')) {
        return { allowed: false, reason: 'role_insufficient' };
      }
      if (ctx?.item) {
        if (ctx.item.assignee_id != null) {
          return { allowed: false, reason: 'already_assigned' };
        }
        if (ctx.item.status !== 'open' && ctx.item.status !== 'blocked') {
          return { allowed: false, reason: 'invalid_status_for_claim' };
        }
      }
      return { allowed: true };
    }

    case 'item.release': {
      if (!ctx?.item) return { allowed: false, reason: 'item_required' };
      if (ctx.item.status !== 'in_progress' && ctx.item.status !== 'blocked') {
        return { allowed: false, reason: 'invalid_status_for_release' };
      }
      if (roleAtLeast(role, 'admin')) {
        return { allowed: true };
      }
      if (roleAtLeast(role, 'member') && ctx.item.assignee_id === actor.id) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'assignee_or_admin_required' };
    }

    case 'item.assign': {
      if (!ctx?.item) return { allowed: false, reason: 'item_required' };
      if (ctx.item.status !== 'open' && ctx.item.status !== 'in_progress' && ctx.item.status !== 'blocked') {
        return { allowed: false, reason: 'invalid_status_for_assign' };
      }
      // Target must be member+
      if (ctx.targetAssigneeRole && !roleAtLeast(ctx.targetAssigneeRole, 'member')) {
        return { allowed: false, reason: 'target_must_be_member' };
      }
      if (roleAtLeast(role, 'admin')) {
        return { allowed: true };
      }
      if (roleAtLeast(role, 'member') && ctx.item.assignee_id === actor.id) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'assignee_or_admin_required' };
    }

    case 'item.approval.request': {
      if (!ctx?.item) return { allowed: false, reason: 'item_required' };
      if (!ctx.item.requires_approval) {
        return { allowed: false, reason: 'approval_not_required' };
      }
      if (ctx.item.status !== 'in_progress') {
        return { allowed: false, reason: 'item_must_be_in_progress' };
      }
      if (roleAtLeast(role, 'admin') || (roleAtLeast(role, 'member') && ctx.item.assignee_id === actor.id)) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'assignee_or_admin_required' };
    }

    case 'item.approval.decide': {
      if (!roleAtLeast(role, 'approver')) {
        return { allowed: false, reason: 'role_insufficient' };
      }
      if (ctx?.item && ctx.item.assignee_id === actor.id) {
        return { allowed: false, reason: 'cannot_approve_own_work' };
      }
      if (ctx?.approvalRequesterId && ctx.approvalRequesterId === actor.id) {
        return { allowed: false, reason: 'cannot_approve_own_request' };
      }
      return { allowed: true };
    }

    case 'item.transfer': {
      if (!ctx?.item) return { allowed: false, reason: 'item_required' };
      if (ctx.item.status === 'closed') return { allowed: false, reason: 'item_closed' };
      if (!ctx.targetTeamId) return { allowed: false, reason: 'target_team_required' };
      const canActOnSource = roleAtLeast(role, 'admin') || (roleAtLeast(role, 'member') && ctx.item.assignee_id === actor.id);
      if (!canActOnSource) {
        return { allowed: false, reason: 'assignee_or_admin_required' };
      }
      const targetRole = effectiveRole(actor, ctx.targetTeamId);
      if (!roleAtLeast(targetRole, 'member') && actor.orgRole !== 'org_admin') {
        return { allowed: false, reason: 'target_team_membership_required' };
      }
      return { allowed: true };
    }

    case 'item.cancel': {
      if (!ctx?.item) return { allowed: false, reason: 'item_required' };
      if (ctx.item.status === 'closed') {
        return { allowed: false, reason: 'already_closed' };
      }
      if (roleAtLeast(role, 'admin')) {
        return { allowed: true };
      }
      if (roleAtLeast(role, 'member') && ctx.item.reporter_id === actor.id) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'reporter_or_admin_required' };
    }

    default:
      return { allowed: false, reason: 'unknown_permission' };
  }
}
