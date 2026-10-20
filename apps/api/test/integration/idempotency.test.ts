import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { getTestPool } from '../helpers/db.js';
import { createUser, createTeam, addTeamMember } from '../helpers/factory.js';

describe('Idempotency Integration Tests (CB3)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  it('(1) 10 concurrent POST /items with the same key+body yield exactly one item row, all responses equal, replays flagged', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    const key = `key-race-${crypto.randomUUID()}`;
    const payload = {
      team_id: team.id,
      type: 'customer_issue',
      title: 'Idempotency concurrent test item',
      priority: 'p2',
    };

    const requests = Array.from({ length: 10 }).map(() =>
      app.inject({
        method: 'POST',
        url: '/api/v1/items',
        headers: {
          authorization: `Bearer ${user.token}`,
          'idempotency-key': key,
        },
        payload,
      })
    );

    const responses = await Promise.all(requests);

    // All should be 201
    for (const r of responses) {
      expect(r.statusCode).toBe(201);
    }

    const firstBody = responses[0]!.json();
    for (const r of responses) {
      expect(r.json()).toEqual(firstBody);
    }

    // Exactly one row created in work_items
    const pool = getTestPool();
    const dbCount = await pool.query('SELECT count(*) FROM work_items WHERE id = $1', [firstBody.id]);
    expect(Number(dbCount.rows[0].count)).toBe(1);

    // At least 9 of them should have Idempotent-Replay header
    const replayHeaders = responses.filter((r) => r.headers['idempotent-replay'] === 'true');
    expect(replayHeaders.length).toBe(9);
  });

  it('(2) Same key with a different body returns 422 idempotency_key_reuse', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    const key = `key-reuse-${crypto.randomUUID()}`;

    // First request
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': key,
      },
      payload: {
        team_id: team.id,
        type: 'customer_issue',
        title: 'Original Title',
      },
    });
    expect(res1.statusCode).toBe(201);

    // Second request with different title
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': key,
      },
      payload: {
        team_id: team.id,
        type: 'customer_issue',
        title: 'Different Title',
      },
    });
    expect(res2.statusCode).toBe(422);
    expect(res2.json().error.code).toBe('idempotency_key_reuse');
  });

  it('(3) Same key by a different user is independent', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, userA.id, 'member');
    await addTeamMember(team.id, userB.id, 'member');

    const sharedKey = `shared-key-${crypto.randomUUID()}`;

    const resA = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${userA.token}`,
        'idempotency-key': sharedKey,
      },
      payload: {
        team_id: team.id,
        type: 'customer_issue',
        title: 'User A Item',
      },
    });
    expect(resA.statusCode).toBe(201);

    const resB = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${userB.token}`,
        'idempotency-key': sharedKey,
      },
      payload: {
        team_id: team.id,
        type: 'customer_issue',
        title: 'User B Item',
      },
    });
    expect(resB.statusCode).toBe(201);

    expect(resA.json().id).not.toBe(resB.json().id);
  });

  it('(4) A request that fails with 409 does not store a key; retry re-evaluates', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    // Create item at version 1
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k1-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'customer_issue',
        title: 'Version Test Item',
      },
    });
    const item = createRes.json();

    // Patch item to bump version to 2
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${item.id}`,
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k2-${crypto.randomUUID()}`,
      },
      payload: {
        expected_version: 1,
        title: 'Updated Title Once',
      },
    });

    // Send a patch with stale expected_version = 1 -> 409
    const failedKey = `failed-key-${crypto.randomUUID()}`;
    const failRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${item.id}`,
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': failedKey,
      },
      payload: {
        expected_version: 1,
        title: 'Attempt with stale version',
      },
    });
    expect(failRes.statusCode).toBe(409);

    // Verify key was NOT stored
    const pool = getTestPool();
    const keyCheck = await pool.query(
      'SELECT response_status FROM idempotency_keys WHERE user_id = $1 AND key = $2',
      [user.id, failedKey]
    );
    expect(keyCheck.rows.length).toBe(0);
  });

  it('(5) Missing key on a mutation returns 400 idempotency_key_required', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${user.token}`,
      },
      payload: {
        team_id: team.id,
        type: 'customer_issue',
        title: 'Missing Key',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('idempotency_key_required');
  });

  it('(6) Sequential retry after success returns replay with identical body and no new event', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    const key = `seq-retry-${crypto.randomUUID()}`;
    const payload = {
      team_id: team.id,
      type: 'customer_issue',
      title: 'Sequential Test',
    };

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': key,
      },
      payload,
    });
    expect(res1.statusCode).toBe(201);
    const item = res1.json();

    const pool = getTestPool();
    const eventsBefore = await pool.query(
      'SELECT count(*) FROM item_events WHERE item_id = $1',
      [item.id]
    );
    expect(Number(eventsBefore.rows[0].count)).toBe(1);

    // Retry
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': key,
      },
      payload,
    });
    expect(res2.statusCode).toBe(201);
    expect(res2.headers['idempotent-replay']).toBe('true');
    expect(res2.json()).toEqual(item);

    const eventsAfter = await pool.query(
      'SELECT count(*) FROM item_events WHERE item_id = $1',
      [item.id]
    );
    expect(Number(eventsAfter.rows[0].count)).toBe(1);
  });
});
