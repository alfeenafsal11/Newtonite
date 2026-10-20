import { describe, it, expect } from 'vitest';
import {
  can,
  effectiveRole,
  roleAtLeast,
  Actor,
  Permission,
  TeamRole,
} from '../../src/domain/permissions.js';

function makeActor(
  id: string,
  orgRole: 'member' | 'auditor' | 'org_admin',
  memberships: Record<string, TeamRole> = {},
  isActive = true
): Actor {
  return {
    id,
    orgRole,
    isActive,
    memberships: new Map(Object.entries(memberships)),
  };
}

describe('permissions domain module', () => {
  const teamId = 'team-1';

  describe('effectiveRole', () => {
    it('returns admin for org_admin across any team', () => {
      const actor = makeActor('u1', 'org_admin');
      expect(effectiveRole(actor, teamId)).toBe('admin');
      expect(effectiveRole(actor, 'other-team')).toBe('admin');
    });

    it('returns viewer for auditor across any team', () => {
      const actor = makeActor('u2', 'auditor');
      expect(effectiveRole(actor, teamId)).toBe('viewer');
      expect(effectiveRole(actor, 'other-team')).toBe('viewer');
    });

    it('returns team membership role for regular member', () => {
      const actor = makeActor('u3', 'member', { [teamId]: 'member' });
      expect(effectiveRole(actor, teamId)).toBe('member');
      expect(effectiveRole(actor, 'other-team')).toBe('none');
    });

    it('ranks roles correctly', () => {
      expect(roleAtLeast('admin', 'approver')).toBe(true);
      expect(roleAtLeast('approver', 'member')).toBe(true);
      expect(roleAtLeast('member', 'viewer')).toBe(true);
      expect(roleAtLeast('viewer', 'none')).toBe(true);
      expect(roleAtLeast('member', 'admin')).toBe(false);
    });
  });

  describe('can() permission matrix', () => {
    const roles: (TeamRole | 'none')[] = ['none', 'viewer', 'member', 'approver', 'admin'];

    it('inactive users cannot perform any action', () => {
      const actor = makeActor('u-inactive', 'org_admin', {}, false);
      const res = can(actor, 'item.read', { teamId });
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('user_inactive');
    });

    it('auditor can read items and team members, but cannot perform any write', () => {
      const auditor = makeActor('u-auditor', 'auditor');
      expect(can(auditor, 'item.read', { teamId }).allowed).toBe(true);
      expect(can(auditor, 'team.members.read', { teamId }).allowed).toBe(true);
      expect(can(auditor, 'item.create', { teamId }).allowed).toBe(false);
      expect(can(auditor, 'item.update', { teamId, item: { team_id: teamId, status: 'open' } }).allowed).toBe(false);
      expect(can(auditor, 'item.comment', { teamId, item: { team_id: teamId, status: 'open' } }).allowed).toBe(false);
      expect(can(auditor, 'item.claim', { teamId, item: { team_id: teamId, status: 'open', assignee_id: null } }).allowed).toBe(false);
    });

    it('item.read is allowed for viewer, member, approver, admin, auditor, org_admin; denied for none', () => {
      for (const role of roles) {
        const actor = role === 'none' ? makeActor('u', 'member') : makeActor('u', 'member', { [teamId]: role });
        const res = can(actor, 'item.read', { teamId });
        expect(res.allowed).toBe(role !== 'none');
      }
    });

    it('item.create is allowed for member, approver, admin, org_admin; denied for viewer, none, auditor', () => {
      for (const role of roles) {
        const actor = role === 'none' ? makeActor('u', 'member') : makeActor('u', 'member', { [teamId]: role });
        const res = can(actor, 'item.create', { teamId });
        const expected = role === 'member' || role === 'approver' || role === 'admin';
        expect(res.allowed).toBe(expected);
      }
    });

    it('item.priority.p0 requires approver+ or org_admin', () => {
      const member = makeActor('u1', 'member', { [teamId]: 'member' });
      const approver = makeActor('u2', 'member', { [teamId]: 'approver' });
      const admin = makeActor('u3', 'member', { [teamId]: 'admin' });
      const orgAdmin = makeActor('u4', 'org_admin');

      expect(can(member, 'item.priority.p0', { teamId }).allowed).toBe(false);
      expect(can(approver, 'item.priority.p0', { teamId }).allowed).toBe(true);
      expect(can(admin, 'item.priority.p0', { teamId }).allowed).toBe(true);
      expect(can(orgAdmin, 'item.priority.p0', { teamId }).allowed).toBe(true);
    });

    it('item.claim requires member+, assignee null, and status open/blocked', () => {
      const member = makeActor('u1', 'member', { [teamId]: 'member' });
      const itemOpen = { team_id: teamId, status: 'open', assignee_id: null };
      const itemAssigned = { team_id: teamId, status: 'open', assignee_id: 'u9' };
      const itemResolved = { team_id: teamId, status: 'resolved', assignee_id: null };

      expect(can(member, 'item.claim', { item: itemOpen }).allowed).toBe(true);
      expect(can(member, 'item.claim', { item: itemAssigned }).allowed).toBe(false);
      expect(can(member, 'item.claim', { item: itemResolved }).allowed).toBe(false);
    });

    it('item.release is allowed for assignee or admin; rejected for others', () => {
      const assignee = makeActor('u1', 'member', { [teamId]: 'member' });
      const otherMember = makeActor('u2', 'member', { [teamId]: 'member' });
      const admin = makeActor('u3', 'member', { [teamId]: 'admin' });

      const item = { team_id: teamId, status: 'in_progress', assignee_id: 'u1' };

      expect(can(assignee, 'item.release', { item }).allowed).toBe(true);
      expect(can(otherMember, 'item.release', { item }).allowed).toBe(false);
      expect(can(admin, 'item.release', { item }).allowed).toBe(true);
    });

    it('item.cancel is allowed for reporter or admin; rejected for non-reporter members', () => {
      const reporter = makeActor('u1', 'member', { [teamId]: 'member' });
      const other = makeActor('u2', 'member', { [teamId]: 'member' });
      const admin = makeActor('u3', 'member', { [teamId]: 'admin' });

      const item = { team_id: teamId, status: 'in_progress', reporter_id: 'u1' };

      expect(can(reporter, 'item.cancel', { item }).allowed).toBe(true);
      expect(can(other, 'item.cancel', { item }).allowed).toBe(false);
      expect(can(admin, 'item.cancel', { item }).allowed).toBe(true);
    });

    it('item.approval.decide enforces separation of duties (approver != requester, approver != assignee)', () => {
      const approver = makeActor('u-approver', 'member', { [teamId]: 'approver' });
      const item = {
        team_id: teamId,
        status: 'pending_approval',
        assignee_id: 'u-assignee',
        requires_approval: true,
      };

      // Valid case: approver is neither requester nor assignee
      expect(
        can(approver, 'item.approval.decide', {
          item,
          approvalRequesterId: 'u-requester',
        }).allowed
      ).toBe(true);

      // Same as assignee
      const approverAssignee = makeActor('u-assignee', 'member', { [teamId]: 'approver' });
      expect(
        can(approverAssignee, 'item.approval.decide', {
          item,
          approvalRequesterId: 'u-requester',
        }).allowed
      ).toBe(false);

      // Same as requester
      const approverRequester = makeActor('u-requester', 'member', { [teamId]: 'approver' });
      expect(
        can(approverRequester, 'item.approval.decide', {
          item,
          approvalRequesterId: 'u-requester',
        }).allowed
      ).toBe(false);
    });

    it('item.transfer requires membership in target team unless org_admin', () => {
      const assignee = makeActor('u1', 'member', {
        [teamId]: 'member',
        'target-team': 'member',
      });
      const assigneeWithoutTarget = makeActor('u2', 'member', {
        [teamId]: 'member',
      });
      const orgAdmin = makeActor('u3', 'org_admin');

      const item = { team_id: teamId, status: 'in_progress', assignee_id: 'u1' };
      const item2 = { team_id: teamId, status: 'in_progress', assignee_id: 'u2' };

      expect(
        can(assignee, 'item.transfer', {
          item,
          targetTeamId: 'target-team',
        }).allowed
      ).toBe(true);

      expect(
        can(assigneeWithoutTarget, 'item.transfer', {
          item: item2,
          targetTeamId: 'target-team',
        }).allowed
      ).toBe(false);

      expect(
        can(orgAdmin, 'item.transfer', {
          item,
          targetTeamId: 'target-team',
        }).allowed
      ).toBe(true);
    });
  });
});
