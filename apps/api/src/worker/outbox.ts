import pg from 'pg';
import { HANDLERS, EventWithItem } from './handlers/index.js';
import { computeBackoffMs } from '../domain/backoff.js';

export interface DbOutboxRow {
  id: number;
  event_id: number;
  handler: string;
  status: 'pending' | 'processing' | 'done' | 'dead';
  attempts: number;
  max_attempts: number;
  next_attempt_at: Date;
  locked_until: Date | null;
  last_error: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export async function claimBatch(
  pool: pg.Pool | pg.PoolClient,
  batchSize = 20,
  lockSeconds = 30
): Promise<DbOutboxRow[]> {
  const res = await pool.query<DbOutboxRow>(
    `UPDATE outbox o
        SET status = 'processing',
            attempts = o.attempts + 1,
            locked_until = now() + make_interval(secs => $2)
      WHERE o.id IN (
        SELECT id FROM outbox
         WHERE (status = 'pending' AND next_attempt_at <= now())
            OR (status = 'processing' AND locked_until < now())
         ORDER BY id
         LIMIT $1
         FOR UPDATE SKIP LOCKED)
     RETURNING o.*`,
    [batchSize, lockSeconds]
  );
  return res.rows;
}

export async function markDone(
  pool: pg.Pool | pg.PoolClient,
  id: number
): Promise<void> {
  await pool.query(
    `UPDATE outbox
        SET status = 'done',
            completed_at = now(),
            locked_until = NULL
      WHERE id = $1`,
    [id]
  );
}

export async function markFailed(
  pool: pg.Pool | pg.PoolClient,
  id: number,
  attempts: number,
  maxAttempts: number,
  errorMessage: string
): Promise<void> {
  if (attempts >= maxAttempts) {
    await pool.query(
      `UPDATE outbox
          SET status = 'dead',
              locked_until = NULL,
              last_error = $2
        WHERE id = $1`,
      [id, errorMessage]
    );
  } else {
    const backoffMs = computeBackoffMs(attempts);
    await pool.query(
      `UPDATE outbox
          SET status = 'pending',
              next_attempt_at = now() + make_interval(secs => $2),
              locked_until = NULL,
              last_error = $3
        WHERE id = $1`,
      [id, backoffMs / 1000, errorMessage]
    );
  }
}

export async function processOutboxRow(
  pool: pg.Pool,
  row: DbOutboxRow
): Promise<boolean> {
  const handlerFn = HANDLERS[row.handler];
  if (!handlerFn) {
    await markFailed(
      pool,
      row.id,
      row.attempts,
      row.max_attempts,
      `Unknown handler: ${row.handler}`
    );
    return false;
  }

  // Load event with item details
  const eventRes = await pool.query<EventWithItem>(
    `SELECT ie.id, ie.item_id, ie.actor_id, ie.type, ie.payload, ie.created_at, wi.team_id
     FROM item_events ie
     JOIN work_items wi ON wi.id = ie.item_id
     WHERE ie.id = $1`,
    [row.event_id]
  );

  if (eventRes.rows.length === 0) {
    await markFailed(
      pool,
      row.id,
      row.attempts,
      row.max_attempts,
      `Event ${row.event_id} not found`
    );
    return false;
  }

  const event = eventRes.rows[0];
  if (!event) {
    return false;
  }

  try {
    await handlerFn(event, pool);
    await markDone(pool, row.id);
    return true;
  } catch (err: any) {
    const message = err?.message || String(err);
    await markFailed(pool, row.id, row.attempts, row.max_attempts, message);
    return false;
  }
}

export async function runOnce(
  pool: pg.Pool,
  batchSize = 20,
  lockSeconds = 30
): Promise<number> {
  const claimed = await claimBatch(pool, batchSize, lockSeconds);
  if (claimed.length === 0) {
    return 0;
  }

  await Promise.allSettled(claimed.map((row) => processOutboxRow(pool, row)));
  return claimed.length;
}
