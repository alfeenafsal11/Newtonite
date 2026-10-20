import pg from 'pg';
import { loadConfig } from '../../src/config.js';
import { getPool } from '../../src/db/pool.js';

export function getTestPool(): pg.Pool {
  const config = loadConfig();
  const testUrl = config.DATABASE_URL_TEST || config.DATABASE_URL;
  return getPool(testUrl);
}
