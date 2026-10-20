import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { getTestPool } from '../helpers/db.js';
import { createUser, createTeam, addTeamMember } from '../helpers/factory.js';

describe('Workflow & Approval Integration Tests (CB4)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  it('(1) Item with requires_approval cannot resolve before approved', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    // Create item requiring approval
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'payment_investigation',
        title: 'Payment needing approval',
        requires_approval: true,
      },
    });
    const item = createRes.json();
    expect(item.requires_approval).toBe(true);
    expect(item.approval_state).toBe('not_requested');

    // Claim to become assignee
    await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/claim`,
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k-c-${crypto.randomUUID()}`,
      },
    });

    // Attempt to resolve directly -> 409 guard_failed
    const resolveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/transition`,
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k-res-${crypto.randomUUID()}`,
      },
      payload: {
        expected_version: 2,
        name: 'resolve',
        resolution_note: 'Resolved directly without approval',
      },
    });
    expect(resolveRes.statusCode).toBe(409);
    expect(resolveRes.json().error.code).toBe('guard_failed');
  });

  it('(2) Separation of duties: requester cannot approve; assignee cannot approve; regular member cannot approve', async () => {
    const assignee = await createUser();
    const otherMember = await createUser();
    const approver = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, assignee.id, 'approver'); // Assignee has approver role, but is assignee!
    await addTeamMember(team.id, otherMember.id, 'member');
    await addTeamMember(team.id, approver.id, 'approver');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${assignee.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'compliance_request',
        title: 'Compliance Separation of Duties Test',
        requires_approval: true,
      },
    });
    const item = createRes.json();

    // Claim
    await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/claim`,
      headers: {
        authorization: `Bearer ${assignee.token}`,
        'idempotency-key': `k-c-${crypto.randomUUID()}`,
      },
    });

    // Request approval (assignee is also requester)
    const reqRes = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/approval/request`,
      headers: {
        authorization: `Bearer ${assignee.token}`,
        'idempotency-key': `k-req-${crypto.randomUUID()}`,
      },
      payload: { expected_version: 2 },
    });
    expect(reqRes.statusCode).toBe(200);

    // Assignee tries to approve own work -> 403
    const selfApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/approval/approve`,
      headers: {
        authorization: `Bearer ${assignee.token}`,
        'idempotency-key': `k-self-${crypto.randomUUID()}`,
      },
      payload: { expected_version: 3 },
    });
    expect(selfApprove.statusCode).toBe(403);

    // Regular member without approver role tries to approve -> 403
    const memberApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/approval/approve`,
      headers: {
        authorization: `Bearer ${otherMember.token}`,
        'idempotency-key': `k-mem-${crypto.randomUUID()}`,
      },
      payload: { expected_version: 3 },
    });
    expect(memberApprove.statusCode).toBe(403);

    // Independent approver succeeds -> 200
    const validApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/approval/approve`,
      headers: {
        authorization: `Bearer ${approver.token}`,
        'idempotency-key': `k-valid-${crypto.randomUUID()}`,
      },
      payload: { expected_version: 3, note: 'Approved by independent approver' },
    });
    expect(validApprove.statusCode).toBe(200);
    expect(validApprove.json().approval_state).toBe('approved');
  });

  it('(3) Concurrent approve and reject -> exactly one succeeds, the other 409', async () => {
    const assignee = await createUser();
    const approverA = await createUser();
    const approverB = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, assignee.id, 'member');
    await addTeamMember(team.id, approverA.id, 'approver');
    await addTeamMember(team.id, approverB.id, 'approver');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${assignee.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'compliance_request',
        title: 'Concurrent Decision Test',
        requires_approval: true,
      },
    });
    const item = createRes.json();

    // Claim
    await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/claim`,
      headers: {
        authorization: `Bearer ${assignee.token}`,
        'idempotency-key': `k-c-${crypto.randomUUID()}`,
      },
    });

    // Request approval
    await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/approval/request`,
      headers: {
        authorization: `Bearer ${assignee.token}`,
        'idempotency-key': `k-req-${crypto.randomUUID()}`,
      },
      payload: { expected_version: 2 },
    });

    // Fire concurrent approve and reject with expected_version: 3
    const [resApprove, resReject] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/items/${item.id}/approval/approve`,
        headers: {
          authorization: `Bearer ${approverA.token}`,
          'idempotency-key': `k-app-${crypto.randomUUID()}`,
        },
        payload: { expected_version: 3, note: 'Looks good' },
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/items/${item.id}/approval/reject`,
        headers: {
          authorization: `Bearer ${approverB.token}`,
          'idempotency-key': `k-rej-${crypto.randomUUID()}`,
        },
        payload: { expected_version: 3, note: 'Not compliant' },
      }),
    ]);

    const statuses = [resApprove.statusCode, resReject.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    const pool = getTestPool();
    const decidedRows = await pool.query(
      `SELECT count(*) FROM approvals WHERE item_id = $1 AND state IN ('approved', 'rejected')`,
      [item.id]
    );
    expect(Number(decidedRows.rows[0].count)).toBe(1);
  });

  it('(4) Reject -> request_approval again allowed -> approve -> resolve works', async () => {
    const assignee = await createUser();
    const approver = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, assignee.id, 'member');
    await addTeamMember(team.id, approver.id, 'approver');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${assignee.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'compliance_request',
        title: 'Full Lifecycle Workflow Test',
        requires_approval: true,
      },
    });
    const item = createRes.json();

    // 1. Claim
    const claimRes = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/claim`,
      headers: {
        authorization: `Bearer ${assignee.token}`,
        'idempotency-key': `k-c-${crypto.randomUUID()}`,
      },
    });
    let v = claimRes.json().version; // 2

    // 2. Request approval
    const req1 = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/approval/request`,
      headers: {
        authorization: `Bearer ${assignee.token}`,
        'idempotency-key': `k-r1-${crypto.randomUUID()}`,
      },
      payload: { expected_version: v },
    });
    expect(req1.statusCode).toBe(200);
    v = req1.json().version; // 3

    // 3. Reject
    const rej = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/approval/reject`,
      headers: {
        authorization: `Bearer ${approver.token}`,
        'idempotency-key': `k-rej-${crypto.randomUUID()}`,
      },
      payload: { expected_version: v, note: 'Please attach evidence' },
    });
    expect(rej.statusCode).toBe(200);
    expect(rej.json().approval_state).toBe('rejected');
    v = rej.json().version; // 4

    // 4. Request approval again
    const req2 = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/approval/request`,
      headers: {
        authorization: `Bearer ${assignee.token}`,
        'idempotency-key': `k-r2-${crypto.randomUUID()}`,
      },
      payload: { expected_version: v },
    });
    expect(req2.statusCode).toBe(200);
    expect(req2.json().approval_state).toBe('pending');
    v = req2.json().version; // 5

    // 5. Approve
    const appRes = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/approval/approve`,
      headers: {
        authorization: `Bearer ${approver.token}`,
        'idempotency-key': `k-app-${crypto.randomUUID()}`,
      },
      payload: { expected_version: v, note: 'Evidence verified' },
    });
    expect(appRes.statusCode).toBe(200);
    expect(appRes.json().approval_state).toBe('approved');
    v = appRes.json().version; // 6

    // 6. Resolve
    const resRes = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/transition`,
      headers: {
        authorization: `Bearer ${assignee.token}`,
        'idempotency-key': `k-res-${crypto.randomUUID()}`,
      },
      payload: {
        expected_version: v,
        name: 'resolve',
        resolution_note: 'Completed with verified approval',
      },
    });
    expect(resRes.statusCode).toBe(200);
    expect(resRes.json().status).toBe('resolved');
  });

  it('(5) Reopen of resolved approval-required item resets approval_state and requires re-approval', async () => {
    const assignee = await createUser();
    const approver = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, assignee.id, 'member');
    await addTeamMember(team.id, approver.id, 'approver');

    // Create, claim, request approval, approve, resolve
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${assignee.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'compliance_request',
        title: 'Reopen Approval Reset Test',
        requires_approval: true,
      },
    });
    const item = createRes.json();
    await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/claim`,
      headers: { authorization: `Bearer ${assignee.token}`, 'idempotency-key': `k-${crypto.randomUUID()}` },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/approval/request`,
      headers: { authorization: `Bearer ${assignee.token}`, 'idempotency-key': `k-${crypto.randomUUID()}` },
      payload: { expected_version: 2 },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/approval/approve`,
      headers: { authorization: `Bearer ${approver.token}`, 'idempotency-key': `k-${crypto.randomUUID()}` },
      payload: { expected_version: 3, note: 'Approved' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/transition`,
      headers: { authorization: `Bearer ${assignee.token}`, 'idempotency-key': `k-${crypto.randomUUID()}` },
      payload: { expected_version: 4, name: 'resolve', resolution_note: 'Resolved' },
    });
    expect(res.statusCode).toBe(200);

    // Reopen
    const reopenRes = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/transition`,
      headers: {
        authorization: `Bearer ${assignee.token}`,
        'idempotency-key': `k-reopen-${crypto.randomUUID()}`,
      },
      payload: {
        expected_version: 5,
        name: 'reopen',
        reason: 'Issue reopened for additional verification',
      },
    });
    expect(reopenRes.statusCode).toBe(200);
    const reopened = reopenRes.json();
    expect(reopened.status).toBe('in_progress');
    expect(reopened.approval_state).toBe('not_requested'); // Reset!
  });

  it('(6) closed is terminal; cannot transition out of closed', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'admin');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'operational_task',
        title: 'Cancel To Close Item',
      },
    });
    const item = createRes.json();

    // Cancel to close
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/transition`,
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k-canc-${crypto.randomUUID()}`,
      },
      payload: {
        expected_version: 1,
        name: 'cancel',
        reason: 'Discarding task',
      },
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().status).toBe('closed');

    // Attempt reopen or other transition -> 409
    const reopenRes = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/transition`,
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k-reopen-${crypto.randomUUID()}`,
      },
      payload: {
        expected_version: 2,
        name: 'reopen',
        reason: 'Cannot reopen closed item',
      },
    });
    expect(reopenRes.statusCode).toBe(409);
    expect(reopenRes.json().error.code).toBe('invalid_transition');
  });

  it('(7) Two simultaneous request_approval yield exactly one pending approval row', async () => {
    const assignee = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, assignee.id, 'member');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${assignee.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'compliance_request',
        title: 'Concurrent Request Approval Item',
        requires_approval: true,
      },
    });
    const item = createRes.json();
    await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/claim`,
      headers: { authorization: `Bearer ${assignee.token}`, 'idempotency-key': `k-${crypto.randomUUID()}` },
    });

    const [req1, req2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/items/${item.id}/approval/request`,
        headers: {
          authorization: `Bearer ${assignee.token}`,
          'idempotency-key': `k-r1-${crypto.randomUUID()}`,
        },
        payload: { expected_version: 2 },
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/items/${item.id}/approval/request`,
        headers: {
          authorization: `Bearer ${assignee.token}`,
          'idempotency-key': `k-r2-${crypto.randomUUID()}`,
        },
        payload: { expected_version: 2 },
      }),
    ]);

    const statuses = [req1.statusCode, req2.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    const pool = getTestPool();
    const count = await pool.query(
      `SELECT count(*) FROM approvals WHERE item_id = $1 AND state = 'pending'`,
      [item.id]
    );
    expect(Number(count.rows[0].count)).toBe(1);
  });
});
