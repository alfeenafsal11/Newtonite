import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { getTestPool } from '../helpers/db.js';
import { createUser, createTeam, addTeamMember } from '../helpers/factory.js';

describe('Claim Race Integration Tests (CB1)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  it('(1) 20 users concurrently claim the same item -> exactly 1x 200, 19x 409 already_claimed; exactly 1 claimed event', async () => {
    const team = await createTeam();
    const users = await Promise.all(
      Array.from({ length: 20 }).map(async () => {
        const u = await createUser();
        await addTeamMember(team.id, u.id, 'member');
        return u;
      })
    );

    // Create an unassigned item
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${users[0]!.token}`,
        'idempotency-key': `k-create-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'operational_task',
        title: 'Concurrent 20 Claim Race Item',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const item = createRes.json();
    expect(item.assignee).toBeNull();
    expect(item.version).toBe(1);

    // Fire 20 concurrent claim requests with independent keys
    const claimRequests = users.map((u) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/items/${item.id}/claim`,
        headers: {
          authorization: `Bearer ${u.token}`,
          'idempotency-key': `k-claim-${crypto.randomUUID()}`,
        },
      })
    );

    const responses = await Promise.all(claimRequests);

    const successes = responses.filter((r) => r.statusCode === 200);
    const conflicts = responses.filter((r) => r.statusCode === 409);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(19);

    const winnerUser = successes[0]!.json().assignee;
    expect(winnerUser).toBeDefined();

    for (const c of conflicts) {
      const body = c.json();
      expect(body.error.code).toBe('already_claimed');
      expect(body.error.details.assignee.id).toBe(winnerUser.id);
    }

    // Check database state
    const pool = getTestPool();
    const dbItem = await pool.query('SELECT assignee_id, version, status FROM work_items WHERE id = $1', [item.id]);
    expect(dbItem.rows[0].assignee_id).toBe(winnerUser.id);
    expect(dbItem.rows[0].version).toBe(2);
    expect(dbItem.rows[0].status).toBe('in_progress');

    const claimedEvents = await pool.query(
      "SELECT count(*) FROM item_events WHERE item_id = $1 AND type = 'claimed'",
      [item.id]
    );
    expect(Number(claimedEvents.rows[0].count)).toBe(1);
  });

  it('(2) The same user double-claims with different keys -> both 200, one event', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'customer_issue',
        title: 'Double Claim Item',
      },
    });
    const item = createRes.json();

    const res1 = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/claim`,
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k-claim-1-${crypto.randomUUID()}`,
      },
    });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/claim`,
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k-claim-2-${crypto.randomUUID()}`,
      },
    });
    expect(res2.statusCode).toBe(200);

    const pool = getTestPool();
    const claimedEvents = await pool.query(
      "SELECT count(*) FROM item_events WHERE item_id = $1 AND type = 'claimed'",
      [item.id]
    );
    expect(Number(claimedEvents.rows[0].count)).toBe(1);
  });

  it('(3) Claim of an item in resolved/closed/already assigned returns 409', async () => {
    const user1 = await createUser();
    const user2 = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user1.id, 'member');
    await addTeamMember(team.id, user2.id, 'member');

    // Item already assigned to user1
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${user1.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'operational_task',
        title: 'Assigned Item',
      },
    });
    const item = createRes.json();
    await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/claim`,
      headers: {
        authorization: `Bearer ${user1.token}`,
        'idempotency-key': `k-c1-${crypto.randomUUID()}`,
      },
    });

    // User2 tries to claim
    const claimAssigned = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/claim`,
      headers: {
        authorization: `Bearer ${user2.token}`,
        'idempotency-key': `k-c2-${crypto.randomUUID()}`,
      },
    });
    expect(claimAssigned.statusCode).toBe(409);
    expect(claimAssigned.json().error.code).toBe('already_claimed');
  });

  it('(4) Viewer or non-member claim returns 403 or 404', async () => {
    const viewer = await createUser();
    const nonMember = await createUser();
    const creator = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, creator.id, 'member');
    await addTeamMember(team.id, viewer.id, 'viewer');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${creator.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'operational_task',
        title: 'Authz Item',
      },
    });
    const item = createRes.json();

    // Viewer gets 403 forbidden
    const viewerClaim = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/claim`,
      headers: {
        authorization: `Bearer ${viewer.token}`,
        'idempotency-key': `k-v-${crypto.randomUUID()}`,
      },
    });
    expect(viewerClaim.statusCode).toBe(403);

    // Non-member gets 404 not_found
    const nonMemberClaim = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/claim`,
      headers: {
        authorization: `Bearer ${nonMember.token}`,
        'idempotency-key': `k-nm-${crypto.randomUUID()}`,
      },
    });
    expect(nonMemberClaim.statusCode).toBe(404);
  });
});
