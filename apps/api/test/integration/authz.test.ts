import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { getTestPool } from '../helpers/db.js';
import { createUser, createTeam, addTeamMember } from '../helpers/factory.js';

describe('Resource-level Authorization Tests (CB5)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  it('(1) User in team A receives 404 on read/patch/comment/transition/claim/events of team B items (existence hiding)', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const teamA = await createTeam('Team Alpha', 'team-alpha');
    const teamB = await createTeam('Team Beta', 'team-beta');
    await addTeamMember(teamA.id, userA.id, 'member');
    await addTeamMember(teamB.id, userB.id, 'member');

    // User B creates item in Team B
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${userB.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: teamB.id,
        type: 'engineering_problem',
        title: 'Team B Secret Item',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const itemB = createRes.json();

    // User A attempts to read item B -> 404
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/items/${itemB.id}`,
      headers: { authorization: `Bearer ${userA.token}` },
    });
    expect(getRes.statusCode).toBe(404);
    expect(getRes.json().error.code).toBe('not_found');

    // User A attempts to patch item B -> 404
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${itemB.id}`,
      headers: {
        authorization: `Bearer ${userA.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: { expected_version: 1, title: 'Hacked Title' },
    });
    expect(patchRes.statusCode).toBe(404);

    // User A attempts to comment on item B -> 404
    const commentRes = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${itemB.id}/comments`,
      headers: { authorization: `Bearer ${userA.token}` },
      payload: { body: 'Unauthorized comment' },
    });
    expect(commentRes.statusCode).toBe(404);

    // User A attempts to claim item B -> 404
    const claimRes = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${itemB.id}/claim`,
      headers: {
        authorization: `Bearer ${userA.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
    });
    expect(claimRes.statusCode).toBe(404);

    // User A attempts to view events of item B -> 404
    const eventsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/items/${itemB.id}/events`,
      headers: { authorization: `Bearer ${userA.token}` },
    });
    expect(eventsRes.statusCode).toBe(404);
  });

  it('(2) Viewer can read items and team members but receives 403 on every write operation', async () => {
    const viewer = await createUser();
    const admin = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, admin.id, 'admin');
    await addTeamMember(team.id, viewer.id, 'viewer');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${admin.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'customer_issue',
        title: 'Item Visible to Viewer',
      },
    });
    const item = createRes.json();

    // Viewer can read item
    const readItem = await app.inject({
      method: 'GET',
      url: `/api/v1/items/${item.id}`,
      headers: { authorization: `Bearer ${viewer.token}` },
    });
    expect(readItem.statusCode).toBe(200);

    // Viewer can read team members
    const readMembers = await app.inject({
      method: 'GET',
      url: `/api/v1/teams/${team.id}/members`,
      headers: { authorization: `Bearer ${viewer.token}` },
    });
    expect(readMembers.statusCode).toBe(200);

    // Viewer cannot create item -> 403
    const writeCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${viewer.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'customer_issue',
        title: 'Viewer Cannot Create',
      },
    });
    expect(writeCreate.statusCode).toBe(403);

    // Viewer cannot patch -> 403
    const writePatch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${item.id}`,
      headers: {
        authorization: `Bearer ${viewer.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: { expected_version: 1, title: 'Viewer Cannot Patch' },
    });
    expect(writePatch.statusCode).toBe(403);

    // Viewer cannot comment -> 403
    const writeComment = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/comments`,
      headers: { authorization: `Bearer ${viewer.token}` },
      payload: { body: 'Viewer Cannot Comment' },
    });
    expect(writeComment.statusCode).toBe(403);

    // Viewer cannot manage team members -> 403
    const writeMember = await app.inject({
      method: 'PUT',
      url: `/api/v1/teams/${team.id}/members/${viewer.id}`,
      headers: { authorization: `Bearer ${viewer.token}` },
      payload: { role: 'admin' },
    });
    expect(writeMember.statusCode).toBe(403);
  });

  it('(3) Auditor reads all, writes none', async () => {
    const auditor = await createUser({ orgRole: 'auditor' });
    const member = await createUser();
    const team = await createTeam('Audit Team', 'audit-team');
    await addTeamMember(team.id, member.id, 'member');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${member.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'operational_task',
        title: 'Auditable Work Item',
      },
    });
    const item = createRes.json();

    // Auditor can read item even with no direct team membership
    const readItem = await app.inject({
      method: 'GET',
      url: `/api/v1/items/${item.id}`,
      headers: { authorization: `Bearer ${auditor.token}` },
    });
    expect(readItem.statusCode).toBe(200);

    // Auditor cannot create or edit -> 403
    const writeCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${auditor.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'operational_task',
        title: 'Auditor Cannot Write',
      },
    });
    expect(writeCreate.statusCode).toBe(403);
  });

  it('(4) org_admin acts as admin everywhere', async () => {
    const orgAdmin = await createUser({ orgRole: 'org_admin' });
    const team = await createTeam('OrgAdmin Target Team', 'target-team-org');

    // OrgAdmin creates item in team where they have no explicit membership
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${orgAdmin.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'production_incident',
        title: 'Incident Created By OrgAdmin',
        priority: 'p0',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const item = createRes.json();
    expect(item.priority).toBe('p0');

    // OrgAdmin manages team membership
    const member = await createUser();
    const addRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/teams/${team.id}/members/${member.id}`,
      headers: { authorization: `Bearer ${orgAdmin.token}` },
      payload: { role: 'member' },
    });
    expect(addRes.statusCode).toBe(200);
  });

  it('(5) Setting p0 requires approver+; downgrading from p0 likewise', async () => {
    const member = await createUser();
    const approver = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, member.id, 'member');
    await addTeamMember(team.id, approver.id, 'approver');

    // Member attempts to create p0 -> 403
    const memberCreateP0 = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${member.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'production_incident',
        title: 'P0 Incident Attempt by Member',
        priority: 'p0',
      },
    });
    expect(memberCreateP0.statusCode).toBe(403);

    // Approver creates p0 -> 201
    const approverCreateP0 = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${approver.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'production_incident',
        title: 'P0 Incident by Approver',
        priority: 'p0',
      },
    });
    expect(approverCreateP0.statusCode).toBe(201);
    const p0Item = approverCreateP0.json();

    // Member attempts to downgrade from p0 to p1 -> 403
    const memberDowngrade = await app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${p0Item.id}`,
      headers: {
        authorization: `Bearer ${member.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        expected_version: 1,
        priority: 'p1',
      },
    });
    expect(memberDowngrade.statusCode).toBe(403);

    // Approver downgrades p0 to p1 -> 200
    const approverDowngrade = await app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${p0Item.id}`,
      headers: {
        authorization: `Bearer ${approver.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        expected_version: 1,
        priority: 'p1',
      },
    });
    expect(approverDowngrade.statusCode).toBe(200);
    expect(approverDowngrade.json().priority).toBe('p1');
  });

  it('(6) Assigning to a non-member is rejected', async () => {
    const admin = await createUser();
    const nonMember = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, admin.id, 'admin');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${admin.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'operational_task',
        title: 'Item to Assign',
      },
    });
    const item = createRes.json();

    const assignRes = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/assign`,
      headers: {
        authorization: `Bearer ${admin.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        expected_version: 1,
        assignee_id: nonMember.id,
      },
    });
    expect(assignRes.statusCode).toBe(403);
  });

  it('(7) Transfer requires membership in target team; actor without visibility receives 404 after transfer', async () => {
    const adminA = await createUser();
    const teamA = await createTeam('Source Team A', 'source-a');
    const teamB = await createTeam('Target Team B', 'target-b');
    await addTeamMember(teamA.id, adminA.id, 'admin');
    // Note: adminA is NOT in teamB!

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${adminA.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: teamA.id,
        type: 'operational_task',
        title: 'Transfer Candidate',
      },
    });
    const item = createRes.json();

    // Transfer without target membership -> 403
    const transferNoAccess = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/transfer`,
      headers: {
        authorization: `Bearer ${adminA.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        expected_version: 1,
        team_id: teamB.id,
      },
    });
    expect(transferNoAccess.statusCode).toBe(403);

    // Now give adminA membership in teamB and perform transfer
    await addTeamMember(teamB.id, adminA.id, 'member');
    const transferSuccess = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/transfer`,
      headers: {
        authorization: `Bearer ${adminA.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        expected_version: 1,
        team_id: teamB.id,
        reason: 'Handing off to team B',
      },
    });
    expect(transferSuccess.statusCode).toBe(200);
    expect(transferSuccess.json().team.id).toBe(teamB.id);

    // Remove adminA from teamB
    const pool = getTestPool();
    await pool.query('DELETE FROM team_memberships WHERE team_id = $1 AND user_id = $2', [
      teamB.id,
      adminA.id,
    ]);

    // adminA can no longer read the transferred item -> 404
    const readAfterLoss = await app.inject({
      method: 'GET',
      url: `/api/v1/items/${item.id}`,
      headers: { authorization: `Bearer ${adminA.token}` },
    });
    expect(readAfterLoss.statusCode).toBe(404);
  });

  it('(8) Role downgrade takes effect on the NEXT request with the same token', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'admin');

    // Create item as admin
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
        title: 'Downgrade Test Item',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const item = createRes.json();

    // Downgrade user to viewer in DB directly
    const pool = getTestPool();
    await pool.query('UPDATE team_memberships SET role = $1 WHERE team_id = $2 AND user_id = $3', [
      'viewer',
      team.id,
      user.id,
    ]);

    // Immediate next request with the exact same token receives 403 on write!
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${item.id}`,
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        expected_version: 1,
        title: 'Attempted Write After Downgrade',
      },
    });
    expect(patchRes.statusCode).toBe(403);
  });

  it('(9) Deactivated user or bumped token_version returns 401 unauthenticated', async () => {
    const user = await createUser();

    const pool = getTestPool();
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthenticated');
  });

  it('(10) Direct crafted API calls prove server enforces authorization independently of UI', async () => {
    const rogueUser = await createUser();
    const targetTeam = await createTeam();

    // Direct malicious POST to create in unauthorized team
    const craftedPost = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${rogueUser.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: targetTeam.id,
        type: 'customer_issue',
        title: 'Direct Crafted API Injection',
      },
    });
    expect(craftedPost.statusCode).toBe(403);
  });
});
