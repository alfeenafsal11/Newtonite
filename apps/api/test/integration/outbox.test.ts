import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { getTestPool } from '../helpers/db.js';
import { createUser, createTeam, addTeamMember, createWorkItem } from '../helpers/factory.js';
import {
  claimBatch,
  markDone,
  markFailed,
  processOutboxRow,
  runOnce,
  DbOutboxRow,
} from '../../src/worker/outbox.js';
import { insertEvent, insertOutbox, addWatcher } from '../../src/modules/items/repo.js';
import { withTx } from '../../src/db/tx.js';

describe('Outbox & Async Worker Tests (CB7)', () => {
  const pool = getTestPool();

  beforeEach(async () => {
    await pool.query('DELETE FROM outbox');
    await pool.query('DELETE FROM notifications');
  });

  it('(1) Watchers receive notifications; actor is excluded', async () => {
    const actor = await createUser();
    const watcher1 = await createUser();
    const watcher2 = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, actor.id, 'member');
    await addTeamMember(team.id, watcher1.id, 'member');
    await addTeamMember(team.id, watcher2.id, 'member');

    const item = await createWorkItem(team.id, actor.id, { title: 'Async Item' });
    await addWatcher(pool, item.id, actor.id);
    await addWatcher(pool, item.id, watcher1.id);
    await addWatcher(pool, item.id, watcher2.id);

    // Create an event and outbox row
    const event = await withTx(async (client) => {
      const ev = await insertEvent(client, {
        item_id: item.id,
        team_id: team.id,
        actor_id: actor.id,
        type: 'comment_added',
        payload: { body: 'New comment' },
        item_version: 1,
      });
      await insertOutbox(client, ev.id, ['notify_watchers']);
      return ev;
    }, pool);

    // Run outbox worker
    const processed = await runOnce(pool, 10);
    expect(processed).toBeGreaterThanOrEqual(1);

    // Verify notifications: watcher1 and watcher2 received, actor did NOT
    const notifs = await pool.query<{ user_id: string; kind: string }>(
      `SELECT user_id, kind FROM notifications WHERE event_id = $1`,
      [event.id]
    );

    expect(notifs.rows).toHaveLength(2);
    const notifiedUserIds = notifs.rows.map((r) => r.user_id);
    expect(notifiedUserIds).toContain(watcher1.id);
    expect(notifiedUserIds).toContain(watcher2.id);
    expect(notifiedUserIds).not.toContain(actor.id);
  });

  it('(2) Approvers receive notifications on approval_requested; requester and assignee excluded', async () => {
    const requester = await createUser();
    const assignee = await createUser();
    const teamApprover = await createUser();
    const regularMember = await createUser();
    const orgAdmin = await createUser({ org_role: 'org_admin' });
    const team = await createTeam();

    await addTeamMember(team.id, requester.id, 'member');
    await addTeamMember(team.id, assignee.id, 'member');
    await addTeamMember(team.id, teamApprover.id, 'approver');
    await addTeamMember(team.id, regularMember.id, 'member');

    const item = await createWorkItem(team.id, requester.id, {
      title: 'Payment Approval Needed',
      requires_approval: true,
      assignee_id: assignee.id,
    });

    const event = await withTx(async (client) => {
      const ev = await insertEvent(client, {
        item_id: item.id,
        team_id: team.id,
        actor_id: requester.id,
        type: 'approval_requested',
        payload: { requester_id: requester.id },
        item_version: 1,
      });
      await insertOutbox(client, ev.id, ['notify_approvers']);
      return ev;
    }, pool);

    await runOnce(pool, 10);

    const notifs = await pool.query<{ user_id: string; kind: string }>(
      `SELECT user_id, kind FROM notifications WHERE event_id = $1`,
      [event.id]
    );

    const notifiedUserIds = notifs.rows.map((r) => r.user_id);
    expect(notifiedUserIds).toContain(teamApprover.id);
    expect(notifiedUserIds).toContain(orgAdmin.id);
    expect(notifiedUserIds).not.toContain(requester.id);
    expect(notifiedUserIds).not.toContain(assignee.id);
    expect(notifiedUserIds).not.toContain(regularMember.id);
  });

  it('(3) Duplicate handler execution is idempotent (unique constraint deduplication)', async () => {
    const actor = await createUser();
    const watcher = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, actor.id, 'member');
    await addTeamMember(team.id, watcher.id, 'member');

    const item = await createWorkItem(team.id, actor.id);
    await addWatcher(pool, item.id, watcher.id);

    const event = await withTx(async (client) => {
      const ev = await insertEvent(client, {
        item_id: item.id,
        team_id: team.id,
        actor_id: actor.id,
        type: 'status_changed',
        payload: { changes: { status: { from: 'open', to: 'in_progress' } } },
        item_version: 2,
      });
      await insertOutbox(client, ev.id, ['notify_watchers']);
      return ev;
    }, pool);

    // Run outbox twice
    await runOnce(pool, 10);

    // Force outbox row back to pending to simulate retry/redelivery
    await pool.query(
      `UPDATE outbox SET status = 'pending', completed_at = NULL WHERE event_id = $1`,
      [event.id]
    );

    await runOnce(pool, 10);

    // Notifications must still have exactly 1 record for this event and watcher
    const notifs = await pool.query(
      `SELECT * FROM notifications WHERE event_id = $1 AND user_id = $2`,
      [event.id, watcher.id]
    );
    expect(notifs.rows).toHaveLength(1);
  });

  it('(4) Handler failure retries with backoff and becomes dead after max_attempts', async () => {
    const user = await createUser();
    const team = await createTeam();
    const item = await createWorkItem(team.id, user.id);

    // Insert an event and an outbox row with an invalid handler name that fails
    const event = await insertEvent(pool, {
      item_id: item.id,
      team_id: team.id,
      actor_id: user.id,
      type: 'test_event',
      payload: {},
      item_version: 1,
    });

    const outboxRes = await pool.query<{ id: number }>(
      `INSERT INTO outbox (event_id, handler, status, attempts, max_attempts)
       VALUES ($1, 'non_existent_handler', 'pending', 0, 3)
       RETURNING id`,
      [event.id]
    );
    const outboxId = outboxRes.rows[0].id;

    // Attempt 1 -> fails -> attempts=1, status='pending'
    await runOnce(pool, 10);
    let row = (await pool.query<DbOutboxRow>('SELECT * FROM outbox WHERE id = $1', [outboxId])).rows[0];
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.last_error).toContain('Unknown handler');

    // Fast-forward next_attempt_at so it's ready immediately
    await pool.query('UPDATE outbox SET next_attempt_at = now() - INTERVAL \'1 second\' WHERE id = $1', [outboxId]);

    // Attempt 2 -> fails -> attempts=2, status='pending'
    await runOnce(pool, 10);
    row = (await pool.query<DbOutboxRow>('SELECT * FROM outbox WHERE id = $1', [outboxId])).rows[0];
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(2);

    await pool.query('UPDATE outbox SET next_attempt_at = now() - INTERVAL \'1 second\' WHERE id = $1', [outboxId]);

    // Attempt 3 -> fails -> attempts=3 >= max_attempts(3) -> status='dead'
    await runOnce(pool, 10);
    row = (await pool.query<DbOutboxRow>('SELECT * FROM outbox WHERE id = $1', [outboxId])).rows[0];
    expect(row.status).toBe('dead');
    expect(row.attempts).toBe(3);
  });

  it('(5) Concurrent workers with SKIP LOCKED claim mutually exclusive batches without double-processing', async () => {
    const user = await createUser();
    const team = await createTeam();
    const item = await createWorkItem(team.id, user.id);

    // Create 10 events and outbox rows
    for (let i = 0; i < 10; i++) {
      const ev = await insertEvent(pool, {
        item_id: item.id,
        team_id: team.id,
        actor_id: user.id,
        type: 'test_batch',
        payload: { idx: i },
        item_version: i + 1,
      });
      await insertOutbox(pool, ev.id, ['notify_watchers']);
    }

    // Two concurrent workers claim batches
    const [batch1, batch2] = await Promise.all([
      claimBatch(pool, 5, 30),
      claimBatch(pool, 5, 30),
    ]);

    const ids1 = new Set(batch1.map((r) => r.id));
    const ids2 = new Set(batch2.map((r) => r.id));

    // No ID overlap between workers
    for (const id of ids1) {
      expect(ids2.has(id)).toBe(false);
    }
  });

  it('(6) Abandoned/crashed processing row is recovered when locked_until expires', async () => {
    const user = await createUser();
    const team = await createTeam();
    const item = await createWorkItem(team.id, user.id);

    const ev = await insertEvent(pool, {
      item_id: item.id,
      team_id: team.id,
      actor_id: user.id,
      type: 'test_crash',
      payload: {},
      item_version: 1,
    });

    const outboxRes = await pool.query<{ id: number }>(
      `INSERT INTO outbox (event_id, handler, status, attempts, locked_until)
       VALUES ($1, 'notify_watchers', 'processing', 1, now() - INTERVAL '5 seconds')
       RETURNING id`,
      [ev.id]
    );
    const outboxId = outboxRes.rows[0].id;

    // Worker claims batch -> should recover the crashed row
    const claimed = await claimBatch(pool, 10, 30);
    const recovered = claimed.find((r) => r.id === outboxId);
    expect(recovered).toBeDefined();
    expect(recovered!.attempts).toBe(2);
  });
});
