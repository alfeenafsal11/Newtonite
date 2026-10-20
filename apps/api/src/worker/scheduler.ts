import pg from 'pg';
import { withTx } from '../db/tx.js';
import { insertEvent, insertOutbox, notifyChanged } from '../modules/items/repo.js';
import { HANDLERS_FOR } from '../domain/events.js';

export async function staleSweep(pool: pg.Pool): Promise<number> {
  return await withTx(async (client) => {
    // Acquire transactional advisory lock
    const lockRes = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock(hashtext('opsflow:staleSweep')) AS locked`
    );
    if (!lockRes.rows[0]?.locked) {
      return 0; // Another instance is running staleSweep
    }

    const itemsRes = await client.query<{
      id: string;
      team_id: string;
      version: number;
      stale_at: Date;
    }>(
      `SELECT id, team_id, version, stale_at
       FROM work_items
       WHERE status NOT IN ('resolved', 'closed')
         AND stale_at IS NOT NULL
         AND stale_at < now()
         AND stale_notified_at IS NULL
       LIMIT 200
       FOR UPDATE SKIP LOCKED`
    );

    for (const item of itemsRes.rows) {
      await client.query(
        `UPDATE work_items
         SET stale_notified_at = now()
         WHERE id = $1`,
        [item.id]
      );

      const event = await insertEvent(client, {
        item_id: item.id,
        team_id: item.team_id,
        actor_id: null,
        type: 'stale_flagged',
        payload: { stale_at: item.stale_at },
        item_version: item.version,
      });

      await insertOutbox(client, event.id, HANDLERS_FOR['stale_flagged'] || []);
      await notifyChanged(client, {
        item_id: item.id,
        team_id: item.team_id,
        version: item.version,
        type: 'stale_flagged',
        event_id: event.id,
      });
    }

    return itemsRes.rows.length;
  }, { pool });
}

export async function overdueSweep(pool: pg.Pool): Promise<number> {
  return await withTx(async (client) => {
    const lockRes = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock(hashtext('opsflow:overdueSweep')) AS locked`
    );
    if (!lockRes.rows[0]?.locked) {
      return 0;
    }

    const itemsRes = await client.query<{
      id: string;
      team_id: string;
      version: number;
      due_at: Date;
    }>(
      `SELECT id, team_id, version, due_at
       FROM work_items
       WHERE status NOT IN ('resolved', 'closed')
         AND due_at IS NOT NULL
         AND due_at < now()
         AND overdue_notified_at IS NULL
       LIMIT 200
       FOR UPDATE SKIP LOCKED`
    );

    for (const item of itemsRes.rows) {
      await client.query(
        `UPDATE work_items
         SET overdue_notified_at = now()
         WHERE id = $1`,
        [item.id]
      );

      const event = await insertEvent(client, {
        item_id: item.id,
        team_id: item.team_id,
        actor_id: null,
        type: 'overdue_flagged',
        payload: { due_at: item.due_at },
        item_version: item.version,
      });

      await insertOutbox(client, event.id, HANDLERS_FOR['overdue_flagged'] || []);
      await notifyChanged(client, {
        item_id: item.id,
        team_id: item.team_id,
        version: item.version,
        type: 'overdue_flagged',
        event_id: event.id,
      });
    }

    return itemsRes.rows.length;
  }, { pool });
}

export async function autoCloseResolved(
  pool: pg.Pool,
  autoCloseDays = 7
): Promise<number> {
  return await withTx(async (client) => {
    const lockRes = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock(hashtext('opsflow:autoCloseResolved')) AS locked`
    );
    if (!lockRes.rows[0]?.locked) {
      return 0;
    }

    const itemsRes = await client.query<{
      id: string;
      team_id: string;
      version: number;
      resolved_at: Date;
    }>(
      `SELECT id, team_id, version, resolved_at
       FROM work_items
       WHERE status = 'resolved'
         AND resolved_at < now() - make_interval(days => $1)
       LIMIT 200
       FOR UPDATE SKIP LOCKED`,
      [autoCloseDays]
    );

    for (const item of itemsRes.rows) {
      const nextVersion = item.version + 1;
      await client.query(
        `UPDATE work_items
         SET status = 'closed',
             close_reason = 'auto_closed',
             closed_at = now(),
             version = $2
         WHERE id = $1`,
        [item.id, nextVersion]
      );

      const event = await insertEvent(client, {
        item_id: item.id,
        team_id: item.team_id,
        actor_id: null,
        type: 'auto_closed',
        payload: { transition: 'auto_close' },
        item_version: nextVersion,
      });

      await insertOutbox(client, event.id, HANDLERS_FOR['auto_closed'] || []);
      await notifyChanged(client, {
        item_id: item.id,
        team_id: item.team_id,
        version: nextVersion,
        type: 'auto_closed',
        event_id: event.id,
      });
    }

    return itemsRes.rows.length;
  }, { pool });
}

export async function cleanup(
  pool: pg.Pool,
  idempotencyTtlHours = 24
): Promise<{ deletedKeys: number; deletedOutbox: number }> {
  return await withTx(async (client) => {
    const lockRes = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock(hashtext('opsflow:cleanup')) AS locked`
    );
    if (!lockRes.rows[0]?.locked) {
      return { deletedKeys: 0, deletedOutbox: 0 };
    }

    const keysRes = await client.query(
      `DELETE FROM idempotency_keys
       WHERE created_at < now() - make_interval(hours => $1)`,
      [idempotencyTtlHours]
    );

    const outboxRes = await client.query(
      `DELETE FROM outbox
       WHERE status = 'done'
         AND completed_at < now() - INTERVAL '7 days'`
    );

    return {
      deletedKeys: keysRes.rowCount || 0,
      deletedOutbox: outboxRes.rowCount || 0,
    };
  }, { pool });
}
