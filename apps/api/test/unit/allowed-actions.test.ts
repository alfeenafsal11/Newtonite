import { describe, it, expect } from 'vitest';
import { computeAllowedActions } from '../../src/domain/allowed-actions.js';
import { Actor } from '../../src/domain/permissions.js';
import { ItemRow } from '../../src/domain/transitions.js';

function makeActor(id: string, role = 'member', orgRole: 'member' | 'org_admin' | 'auditor' = 'member'): Actor {
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
    reporter_id: 'u-reporter',
    requires_approval: false,
    approval_state: 'not_required',
    version: 1,
    ...overrides,
  };
}

describe('allowed-actions domain module', () => {
  it('unassigned open item shows claim, cancel (if reporter), comment, update to member', () => {
    const memberReporter = makeActor('u-reporter', 'member');
    const item = makeItem({ status: 'open', assignee_id: null, reporter_id: 'u-reporter' });
    const actions = computeAllowedActions(memberReporter, item);

    expect(actions).toContain('claim');
    expect(actions).toContain('cancel');
    expect(actions).toContain('comment');
    expect(actions).toContain('update');
    expect(actions).not.toContain('release');
    expect(actions).not.toContain('resolve');
  });

  it('assigned in_progress item shows release, assign, block, resolve to assignee', () => {
    const assignee = makeActor('u-assignee', 'member');
    const item = makeItem({ status: 'in_progress', assignee_id: 'u-assignee' });
    const actions = computeAllowedActions(assignee, item);

    expect(actions).toContain('release');
    expect(actions).toContain('assign');
    expect(actions).toContain('block');
    expect(actions).toContain('resolve');
    expect(actions).toContain('comment');
    expect(actions).not.toContain('claim');
    expect(actions).not.toContain('unblock');
  });

  it('blocked item shows unblock to assignee', () => {
    const assignee = makeActor('u-assignee', 'member');
    const item = makeItem({ status: 'blocked', assignee_id: 'u-assignee' });
    const actions = computeAllowedActions(assignee, item);

    expect(actions).toContain('unblock');
    expect(actions).toContain('release');
    expect(actions).not.toContain('resolve');
  });

  it('item requiring approval in in_progress state shows request_approval to assignee', () => {
    const assignee = makeActor('u-assignee', 'member');
    const item = makeItem({
      status: 'in_progress',
      assignee_id: 'u-assignee',
      requires_approval: true,
      approval_state: 'not_requested',
    });
    const actions = computeAllowedActions(assignee, item);

    expect(actions).toContain('request_approval');
    expect(actions).not.toContain('resolve'); // resolve is blocked until approved
  });

  it('item pending approval shows approve/reject to approver who is neither assignee nor requester', () => {
    const approver = makeActor('u-approver', 'approver');
    const item = makeItem({
      status: 'pending_approval',
      assignee_id: 'u-assignee',
      requires_approval: true,
      approval_state: 'pending',
    });
    const actions = computeAllowedActions(approver, item);

    expect(actions).toContain('approve');
    expect(actions).toContain('reject');
  });

  it('auditor has empty write actions even if they can view the item', () => {
    const auditor = makeActor('u-auditor', 'viewer', 'auditor');
    const item = makeItem({ status: 'open' });
    const actions = computeAllowedActions(auditor, item);

    expect(actions).toHaveLength(0);
  });

  it('closed item has no allowed actions except possibly comment/read checks returning empty', () => {
    const member = makeActor('u-assignee', 'member');
    const item = makeItem({ status: 'closed', assignee_id: 'u-assignee' });
    const actions = computeAllowedActions(member, item);

    expect(actions).toHaveLength(0);
  });
});
