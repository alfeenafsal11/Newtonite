import { describe, it, expect } from 'vitest';
import {
  evaluateTransition,
  ItemRow,
  ItemStatus,
  TRANSITIONS,
  TransitionName,
} from '../../src/domain/transitions.js';
import { Actor } from '../../src/domain/permissions.js';

function makeActor(id: string, role = 'member', orgRole: 'member' | 'org_admin' = 'member'): Actor {
  return {
    id,
    orgRole,
    isActive: true,
    memberships: new Map([['t1', role as any]]),
  };
}

function makeItem(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: 'item-1',
    team_id: 't1',
    status: 'open',
    assignee_id: null,
    reporter_id: 'rep-1',
    requires_approval: false,
    approval_state: 'not_required',
    version: 1,
    ...overrides,
  };
}

describe('transitions domain module', () => {
  const actor = makeActor('user-1', 'member');
  const approver = makeActor('approver-1', 'approver');
  const admin = makeActor('admin-1', 'admin');

  describe('closed status is strictly terminal', () => {
    const allTransitions = Object.keys(TRANSITIONS) as TransitionName[];
    for (const name of allTransitions) {
      it(`rejects transition ${name} from closed status`, () => {
        const item = makeItem({ status: 'closed', assignee_id: actor.id });
        const res = evaluateTransition(name, actor, item, { name, reason: 'test', resolution_note: 'test' });
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.code).toBe('invalid_transition');
        }
      });
    }
  });

  describe('legal transitions produce correct patch', () => {
    it('claim transition moves open -> in_progress and sets assignee', () => {
      const item = makeItem({ status: 'open', assignee_id: null });
      const res = evaluateTransition('claim', actor, item, { name: 'claim' });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.patch.status).toBe('in_progress');
        expect(res.patch.assignee_id).toBe(actor.id);
      }
    });

    it('assign transition sets target assignee and updates status if open', () => {
      const item = makeItem({ status: 'open', assignee_id: null });
      const res = evaluateTransition('assign', admin, item, {
        name: 'assign',
        target_assignee_id: 'target-user',
        target_assignee_role: 'member',
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.patch.status).toBe('in_progress');
        expect(res.patch.assignee_id).toBe('target-user');
      }
    });

    it('release transition returns in_progress -> open and clears assignee', () => {
      const item = makeItem({ status: 'in_progress', assignee_id: actor.id });
      const res = evaluateTransition('release', actor, item, { name: 'release' });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.patch.status).toBe('open');
        expect(res.patch.assignee_id).toBe(null);
      }
    });

    it('block requires reason and changes in_progress -> blocked', () => {
      const item = makeItem({ status: 'in_progress', assignee_id: actor.id });
      const res = evaluateTransition('block', actor, item, {
        name: 'block',
        reason: 'Waiting on vendor response',
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.patch.status).toBe('blocked');
      }
    });

    it('unblock transitions blocked -> in_progress', () => {
      const item = makeItem({ status: 'blocked', assignee_id: actor.id });
      const res = evaluateTransition('unblock', actor, item, { name: 'unblock' });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.patch.status).toBe('in_progress');
      }
    });

    it('request_approval moves in_progress -> pending_approval when approval required', () => {
      const item = makeItem({
        status: 'in_progress',
        assignee_id: actor.id,
        requires_approval: true,
        approval_state: 'not_requested',
      });
      const res = evaluateTransition('request_approval', actor, item, { name: 'request_approval' });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.patch.status).toBe('pending_approval');
        expect(res.patch.approval_state).toBe('pending');
      }
    });

    it('approve moves pending_approval -> in_progress and sets approved state', () => {
      const item = makeItem({
        status: 'pending_approval',
        assignee_id: actor.id,
        requires_approval: true,
        approval_state: 'pending',
      });
      const res = evaluateTransition('approve', approver, item, {
        name: 'approve',
        approval_requester_id: 'some-other-requester',
        has_pending_approval: true,
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.patch.status).toBe('in_progress');
        expect(res.patch.approval_state).toBe('approved');
      }
    });

    it('reject requires note, moves pending_approval -> in_progress, sets rejected state', () => {
      const item = makeItem({
        status: 'pending_approval',
        assignee_id: actor.id,
        requires_approval: true,
        approval_state: 'pending',
      });
      const res = evaluateTransition('reject', approver, item, {
        name: 'reject',
        approval_requester_id: 'some-other-requester',
        has_pending_approval: true,
        note: 'Missing risk assessment',
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.patch.status).toBe('in_progress');
        expect(res.patch.approval_state).toBe('rejected');
      }
    });

    it('resolve without approval requirement succeeds with resolution note', () => {
      const item = makeItem({
        status: 'in_progress',
        assignee_id: actor.id,
        requires_approval: false,
      });
      const res = evaluateTransition('resolve', actor, item, {
        name: 'resolve',
        resolution_note: 'Resolved by patch deployment',
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.patch.status).toBe('resolved');
        expect(res.patch.resolution_note).toBe('Resolved by patch deployment');
        expect(res.patch.resolved_at).toBeDefined();
      }
    });

    it('resolve WITH approval requirement succeeds ONLY when approved', () => {
      const itemApproved = makeItem({
        status: 'in_progress',
        assignee_id: actor.id,
        requires_approval: true,
        approval_state: 'approved',
      });
      const resApproved = evaluateTransition('resolve', actor, itemApproved, {
        name: 'resolve',
        resolution_note: 'Approved and resolved',
      });
      expect(resApproved.ok).toBe(true);

      const itemUnapproved = makeItem({
        status: 'in_progress',
        assignee_id: actor.id,
        requires_approval: true,
        approval_state: 'not_requested',
      });
      const resUnapproved = evaluateTransition('resolve', actor, itemUnapproved, {
        name: 'resolve',
        resolution_note: 'Should fail',
      });
      expect(resUnapproved.ok).toBe(false);
      if (!resUnapproved.ok) {
        expect(resUnapproved.code).toBe('guard_failed');
      }
    });

    it('reopen returns resolved -> in_progress and resets approval_state if approval is required', () => {
      const item = makeItem({
        status: 'resolved',
        assignee_id: actor.id,
        requires_approval: true,
        approval_state: 'approved',
        resolved_at: new Date(),
      });
      const res = evaluateTransition('reopen', actor, item, {
        name: 'reopen',
        reason: 'Issue recurred',
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.patch.status).toBe('in_progress');
        expect(res.patch.approval_state).toBe('not_requested');
        expect(res.patch.resolved_at).toBe(null);
      }
    });

    it('close transitions resolved -> closed with completed reason', () => {
      const item = makeItem({
        status: 'resolved',
        reporter_id: actor.id,
      });
      const res = evaluateTransition('close', actor, item, { name: 'close' });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.patch.status).toBe('closed');
        expect(res.patch.close_reason).toBe('completed');
      }
    });

    it('cancel transitions non-closed -> closed with cancelled reason and requires reason', () => {
      const item = makeItem({
        status: 'in_progress',
        reporter_id: actor.id,
      });
      const res = evaluateTransition('cancel', actor, item, {
        name: 'cancel',
        reason: 'No longer needed',
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.patch.status).toBe('closed');
        expect(res.patch.close_reason).toBe('cancelled');
      }
    });
  });

  describe('illegal transition pairs are rejected', () => {
    const statuses: ItemStatus[] = ['open', 'in_progress', 'blocked', 'pending_approval', 'resolved'];
    const transitions = Object.keys(TRANSITIONS) as TransitionName[];

    it('rejects every (from, transition) pair not in the specification', () => {
      for (const status of statuses) {
        for (const name of transitions) {
          const def = TRANSITIONS[name];
          if (!def.from.includes(status)) {
            const item = makeItem({ status, assignee_id: actor.id });
            const res = evaluateTransition(name, admin, item, {
              name,
              reason: 'test reason',
              resolution_note: 'test note',
              note: 'test note',
              target_assignee_id: 'user-2',
            });
            expect(res.ok).toBe(false);
            if (!res.ok) {
              expect(res.code).toBe('invalid_transition');
            }
          }
        }
      }
    });
  });
});
