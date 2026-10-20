import pg from 'pg';
import { getPool } from './pool.js';
import { mapPgError } from './errors.js';

export interface TxOptions {
  retries?: number;
  pool?: pg.Pool;
}

export async function withTx<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  opts?: TxOptions
): Promise<T> {
  const p = opts?.pool || getPool();
  const maxRetries = opts?.retries ?? 3;
  let attempt = 0;

  while (true) {
    attempt++;
    const client = await p.connect();

    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query("SET LOCAL statement_timeout = '10s'");

      const result = await fn(client);

      await client.query('COMMIT');
      return result;
    } catch (err: any) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback failure if connection was lost
      }

      const code = err?.code;
      // 40001 = serialization_failure, 40P01 = deadlock_detected
      if ((code === '40001' || code === '40P01') && attempt <= maxRetries) {
        // Jittered backoff between 20ms and 100ms
        const delay = Math.floor(20 + Math.random() * 80);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw mapPgError(err);
    } finally {
      client.release();
    }
  }
}
