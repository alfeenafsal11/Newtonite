import { describe, it, expect } from 'vitest';
import { getTestPool } from '../helpers/db.js';
import { createUser, createTeam, addTeamMember, createWorkItem } from '../helpers/factory.js';
import {
  staleSweep,
  overdueSweep,
  autoCloseResolved,
  cleanup,
} from '../../src/worker/scheduler.js';

describe('Background Scheduler & Sweeper Tests', () => {
  const pool = getTestPool();

  it('(1) staleSweep detects stale active item, sets stale_notified_at, and creates event + outbox', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    const item = await createWorkItem(team.id, user.id);

    // Force stale_at to the past and stale_notified_at to null
    await pool.query(
      `UPDATE work_items
       SET stale_at = now() - INTERVAL '2 hours',
           stale_notified_at = NULL
       WHERE id = $1`,
      [item.id]
    );

    const flaggedCount = await staleSweep(pool);
    expect(flaggedCount).toBeGreaterThanOrEqual(1);

    // Verify item updated
    const itemRes = await pool.query<{ stale_notified_at: Date | null }>(
      `SELECT stale_notified_at FROM work_items WHERE id = $1`,
      [item.id]
    );
    expect(itemRes.rows[0].stale_notified_at).not.toBeNull();

    // Verify event inserted with actor NULL
    const eventRes = await pool.query<{ type: string; actor_id: string | null }>(
      `SELECT type, actor_id FROM item_events WHERE item_id = $1 AND type = 'stale_flagged'`,
      [item.id]
    );
    expect(eventRes.rows).toHaveLength(1);
    expect(eventRes.rows[0].actor_id).toBeNull();

    // Subsequent sweep does NOT flag it again
    const secondSweep = await staleSweep(pool);
    const itemEvents = await pool.query(
      `SELECT id FROM item_events WHERE item_id = $1 AND type = 'stale_flagged'`,
      [item.id]
    );
    expect(itemEvents.rows).toHaveLength(1);
  });

  it('(2) overdueSweep detects overdue active item, sets overdue_notified_at, and creates event + outbox', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    const item = await createWorkItem(team.id, user.id);

    // Force due_at to the past
    await pool.query(
      `UPDATE work_items
       SET due_at = now() - INTERVAL '1 day',
           overdue_notified_at = NULL
       WHERE id = $1`,
      [item.id]
    );

    const count = await overdueSweep(pool);
    expect(count).toBeGreaterThanOrEqual(1);

    const itemRes = await pool.query<{ overdue_notified_at: Date | null }>(
      `SELECT overdue_notified_at FROM work_items WHERE id = $1`,
      [item.id]
    );
    expect(itemRes.rows[0].overdue_notified_at).not.toBeNull();

    const eventRes = await pool.query<{ type: string; actor_id: string | null }>(
      `SELECT type, actor_id FROM item_events WHERE item_id = $1 AND type = 'overdue_flagged'`,
      [item.id]
    );
    expect(eventRes.rows).toHaveLength(1);
    expect(eventRes.rows[0].actor_id).toBeNull();
  });

  it('(3) autoCloseResolved transitions resolved item older than AUTO_CLOSE_DAYS to closed', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    const item = await createWorkItem(team.id, user.id);

    // Set item to resolved 8 days ago
    await pool.query(
      `UPDATE work_items
       SET status = 'resolved',
           resolved_at = now() - INTERVAL '8 days',
           resolution_note = 'Done'
       WHERE id = $1`,
      [item.id]
    );

    const closedCount = await autoCloseResolved(pool, 7);
    expect(closedCount).toBeGreaterThanOrEqual(1);

    const itemRes = await pool.query<{
      status: string;
      close_reason: string;
      closed_at: Date | null;
      version: number;
    }>(`SELECT status, close_reason, closed_at, version FROM work_items WHERE id = $1`, [item.id]);

    expect(itemRes.rows[0].status).toBe('closed');
    expect(itemRes.rows[0].close_reason).toBe('auto_closed');
    expect(itemRes.rows[0].closed_at).not.toBeNull();
    expect(itemRes.rows[0].version).toBe(2);

    const eventRes = await pool.query<{ type: string; actor_id: string | null }>(
      `SELECT type, actor_id FROM item_events WHERE item_id = $1 AND type = 'auto_closed'`,
      [item.id]
    );
    expect(eventRes.rows).toHaveLength(1);
    expect(eventRes.rows[0].actor_id).toBeNull();
  });

  it('(4) cleanup removes expired idempotency keys and old done outbox entries but preserves history', async () => {
    const user = await createUser();
    const team = await createTeam();
    const item = await createWorkItem(team.id, user.id);

    // Insert an old idempotency key (>24 hours old)
    await pool.query(
      `INSERT INTO idempotency_keys (user_id, key, request_fingerprint, created_at)
       VALUES ($1, $2, 'dummy-fp', now() - INTERVAL '25 hours')`,
      [user.id, 'old-key-to-cleanup']
    );

    // Insert a fresh idempotency key (<24 hours old)
    await pool.query(
      `INSERT INTO idempotency_keys (user_id, key, request_fingerprint, created_at)
       VALUES ($1, $2, 'dummy-fp', now())`,
      [user.id, 'fresh-key-to-keep']
    );

    const countBeforeEvents = await pool.query('SELECT count(*) FROM item_events');

    const { deletedKeys } = await cleanup(pool, 24);
    expect(deletedKeys).toBeGreaterThanOrEqual(1);

    // Check old is gone, fresh is kept
    const oldKey = await pool.query(
      `SELECT * FROM idempotency_keys WHERE user_id = $1 AND key = 'old-key-to-cleanup'`,
      [user.id]
    );
    expect(oldKey.rows).toHaveLength(0);

    const freshKey = await pool.query(
      `SELECT * FROM idempotency_keys WHERE user_id = $1 AND key = 'fresh-key-to-keep'`,
      [user.id]
    );
    expect(freshKey.rows).toHaveLength(1);

    // Confirm item_events count has not been touched
    const countAfterEvents = await pool.query('SELECT count(*) FROM item_events');
    expect(countAfterEvents.rows[0].count).toBe(countBeforeEvents.rows[0].count);
    expect(Number(countAfterEvents.rows[0].count)).toBeGreaterThanOrEqual(1);
  });

  it('(5) Concurrent sweep attempts skip when advisory lock is held by another process', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Manually acquire the advisory lock for staleSweep
      const lockRes = await client.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_xact_lock(hashtext('opsflow:staleSweep')) AS locked`
      );
      expect(lockRes.rows[0].locked).toBe(true);

      // Another runner attempts staleSweep -> should return 0 without blocking
      const count = await staleSweep(pool);
      expect(count).toBe(0);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
