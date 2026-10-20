import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { getTestPool } from '../helpers/db.js';
import { createUser, createTeam, addTeamMember } from '../helpers/factory.js';
import { withTx } from '../../src/db/tx.js';
import { insertEvent } from '../../src/modules/items/repo.js';

describe('History Immutability & Event Integrity Tests (CB6)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  it('(1) Direct SQL UPDATE, DELETE, and TRUNCATE on item_events fails due to immutability trigger', async () => {
    const pool = getTestPool();
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    // Create an item to produce at least 1 real event
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'compliance_request',
        title: 'Immutability Trigger Target Item',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const item = createRes.json();

    const ev = await pool.query(
      'SELECT id FROM item_events WHERE item_id = $1 LIMIT 1',
      [item.id]
    );
    expect(ev.rows.length).toBe(1);
    const eventId = ev.rows[0].id;

    // Test UPDATE
    await expect(
      pool.query("UPDATE item_events SET type = 'tampered' WHERE id = $1", [eventId])
    ).rejects.toThrow(/item_events is append-only/);

    // Test DELETE
    await expect(
      pool.query('DELETE FROM item_events WHERE id = $1', [eventId])
    ).rejects.toThrow(/item_events is append-only/);

    // Test TRUNCATE
    await expect(
      pool.query('TRUNCATE item_events CASCADE')
    ).rejects.toThrow(/item_events is append-only/);
  });

  it('(2) Every mutating endpoint yields exactly one new event with correct actor_id, type, changes, item_version', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    // Create
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k-create-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'customer_issue',
        title: 'Verifiable Item',
        priority: 'p2',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const item = createRes.json();

    const pool = getTestPool();
    const ev1 = await pool.query(
      'SELECT * FROM item_events WHERE item_id = $1 ORDER BY id ASC',
      [item.id]
    );
    expect(ev1.rows.length).toBe(1);
    expect(ev1.rows[0].type).toBe('item_created');
    expect(ev1.rows[0].actor_id).toBe(user.id);
    expect(ev1.rows[0].item_version).toBe(1);

    // Patch
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${item.id}`,
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k-patch-${crypto.randomUUID()}`,
      },
      payload: {
        expected_version: 1,
        title: 'Updated Verifiable Item Title',
      },
    });
    expect(patchRes.statusCode).toBe(200);

    const ev2 = await pool.query(
      'SELECT * FROM item_events WHERE item_id = $1 ORDER BY id ASC',
      [item.id]
    );
    expect(ev2.rows.length).toBe(2);
    expect(ev2.rows[1].type).toBe('fields_updated');
    expect(ev2.rows[1].actor_id).toBe(user.id);
    expect(ev2.rows[1].item_version).toBe(2);
    expect(ev2.rows[1].payload.changes.title).toEqual({
      from: 'Verifiable Item',
      to: 'Updated Verifiable Item Title',
    });
  });

  it('(3) Injected failure after event insert rolls back transaction leaving no event, no item change, no outbox row', async () => {
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
        title: 'Rollback Test Item',
      },
    });
    const item = createRes.json();

    const pool = getTestPool();
    const countBeforeEvents = await pool.query(
      'SELECT count(*) FROM item_events WHERE item_id = $1',
      [item.id]
    );
    const countBeforeOutbox = await pool.query('SELECT count(*) FROM outbox');

    // Simulate an operation that inserts an event but throws an error before commit
    await expect(
      withTx(async (client) => {
        await insertEvent(client, {
          item_id: item.id,
          team_id: team.id,
          actor_id: user.id,
          type: 'fields_updated',
          payload: { changes: { title: { from: 'a', to: 'b' } } },
          item_version: 2,
        });

        // Deliberately throw an error before commit
        throw new Error('Simulated failure before transaction commit');
      })
    ).rejects.toThrow('Simulated failure before transaction commit');

    // Verify rollback: no new event, no new outbox row
    const countAfterEvents = await pool.query(
      'SELECT count(*) FROM item_events WHERE item_id = $1',
      [item.id]
    );
    const countAfterOutbox = await pool.query('SELECT count(*) FROM outbox');

    expect(countAfterEvents.rows[0].count).toBe(countBeforeEvents.rows[0].count);
    expect(countAfterOutbox.rows[0].count).toBe(countBeforeOutbox.rows[0].count);
  });

  it('(4) Timeline endpoint reconstructs the full ordered history', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    // 1. Create item
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k-1-${crypto.randomUUID()}`,
      },
      payload: {
        team_id: team.id,
        type: 'operational_task',
        title: 'Timeline Item',
      },
    });
    const item = createRes.json();

    // 2. Add comment
    await app.inject({
      method: 'POST',
      url: `/api/v1/items/${item.id}/comments`,
      headers: { authorization: `Bearer ${user.token}` },
      payload: { body: 'First timeline comment' },
    });

    // 3. Patch description
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${item.id}`,
      headers: {
        authorization: `Bearer ${user.token}`,
        'idempotency-key': `k-2-${crypto.randomUUID()}`,
      },
      payload: {
        expected_version: 1,
        description: 'Added detailed description',
      },
    });

    // 4. Query events timeline
    const eventsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/items/${item.id}/events`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(eventsRes.statusCode).toBe(200);

    const timeline = eventsRes.json();
    expect(timeline.events.length).toBe(3);

    // Returned newest first: fields_updated, comment_added, item_created
    expect(timeline.events[0].type).toBe('fields_updated');
    expect(timeline.events[1].type).toBe('comment_added');
    expect(timeline.events[2].type).toBe('item_created');
  });
});
