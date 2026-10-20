import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createUser, createTeam, addTeamMember } from '../helpers/factory.js';

describe('Optimistic Locking & Concurrency Tests (CB2)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  it('(1) Two PATCH with the same expected_version concurrently yield exactly one 200 and one 409 version_conflict', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, userA.id, 'member');
    await addTeamMember(team.id, userB.id, 'member');

    // Create item at version 1
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${userA.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'engineering_problem',
        title: 'Initial Title for Race',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const item = createRes.json();
    expect(item.version).toBe(1);

    // Fire two concurrent updates with expected_version: 1
    const [resA, resB] = await Promise.all([
      app.inject({
        method: 'PATCH',
        url: `/api/v1/items/${item.id}`,
        headers: {
          authorization: `Bearer ${userA.token}`,
          'idempotency-key': `k-a-${crypto.randomUUID()}`,
        },
        payload: {
          expected_version: 1,
          title: 'Title by User A',
        },
      }),
      app.inject({
        method: 'PATCH',
        url: `/api/v1/items/${item.id}`,
        headers: {
          authorization: `Bearer ${userB.token}`,
          'idempotency-key': `k-b-${crypto.randomUUID()}`,
        },
        payload: {
          expected_version: 1,
          title: 'Title by User B',
        },
      }),
    ]);

    const statuses = [resA.statusCode, resB.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    const conflictRes = resA.statusCode === 409 ? resA : resB;
    const winnerRes = resA.statusCode === 200 ? resA : resB;

    const conflictBody = conflictRes.json();
    expect(conflictBody.error.code).toBe('version_conflict');
    expect(conflictBody.error.details.current).toBeDefined();
    expect(conflictBody.error.details.current.version).toBe(2);

    // Final state matches the winner and version is 2
    const finalItemRes = await app.inject({
      method: 'GET',
      url: `/api/v1/items/${item.id}`,
      headers: { authorization: `Bearer ${userA.token}` },
    });
    expect(finalItemRes.statusCode).toBe(200);
    const finalItem = finalItemRes.json();
    expect(finalItem.version).toBe(2);
    expect(finalItem.title).toBe(winnerRes.json().title);
  });

  it('(2) Stale expected_version on update is rejected with 409', async () => {
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
        title: 'Item to test stale version',
      },
    });
    const item = createRes.json();

    const staleRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${item.id}`,
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        expected_version: 999, // Stale
        title: 'Will not apply',
      },
    });

    expect(staleRes.statusCode).toBe(409);
    expect(staleRes.json().error.code).toBe('version_conflict');
    expect(staleRes.json().error.details.current.version).toBe(item.version);
  });

  it('(3) Comments do not bump version and do not conflict with edits', async () => {
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
        type: 'operational_task',
        title: 'Item for Comment Version Test',
      },
    });
    const item = createRes.json();
    expect(item.version).toBe(1);

    // Add a comment
    const commentRes = await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/comments`,
      headers: {
        authorization: `Bearer ${user.token}`,
      },
      payload: {
        body: 'This is a test comment that must not bump version',
      },
    });
    expect(commentRes.statusCode).toBe(201);

    // Item version must still be 1!
    const checkRes = await app.inject({
      method: 'GET',
      url: `/api/v1/items/${item.id}`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(checkRes.json().version).toBe(1);

    // An edit with expected_version: 1 must succeed without conflict!
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${item.id}`,
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        expected_version: 1,
        title: 'Updated After Comment Without Conflict',
      },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().version).toBe(2);
  });

  it('(4) 50 rapid sequential updates with correct versions all succeed and version equals 51', async () => {
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
        type: 'operational_task',
        title: 'Sequential 50 Updates Base',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const item = createRes.json();
    let currentVersion = item.version; // 1

    for (let i = 1; i <= 50; i++) {
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/items/${item.id}`,
        headers: {
          authorization: `Bearer ${user.token}`,
          'idempotency-key': `seq-${i}-${crypto.randomUUID()}`,
        },
        payload: {
          expected_version: currentVersion,
          title: `Sequential Update Step ${i}`,
        },
      });

      expect(patchRes.statusCode).toBe(200);
      currentVersion = patchRes.json().version;
      expect(currentVersion).toBe(i + 1);
    }

    expect(currentVersion).toBe(51);
  });
});
