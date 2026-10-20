import pg from 'pg';
import { loadConfig } from '../config.js';

let pool: pg.Pool | null = null;

export function getPool(overrideUrl?: string): pg.Pool {
  if (pool) {
    return pool;
  }
  const config = loadConfig();
  const connectionString = overrideUrl || config.DATABASE_URL;
  pool = new pg.Pool({
    connectionString,
    max: config.PG_POOL_MAX,
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
