import { loadConfig } from '../config.js';
import { getPool } from '../db/pool.js';
import { runOnce } from './outbox.js';
import { staleSweep, overdueSweep, autoCloseResolved, cleanup } from './scheduler.js';

async function main() {
  const config = loadConfig();
  const pool = getPool(config.DATABASE_URL);

  let isRunning = true;
  let lastStaleSweep = 0;
  let lastOverdueSweep = 0;
  let lastAutoClose = 0;
  let lastCleanup = 0;

  const STALE_INTERVAL_MS = 60 * 1000;
  const OVERDUE_INTERVAL_MS = 60 * 1000;
  const AUTO_CLOSE_INTERVAL_MS = 5 * 60 * 1000;
  const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

  process.on('SIGINT', () => {
    console.log('[Worker] Received SIGINT, shutting down...');
    isRunning = false;
  });

  process.on('SIGTERM', () => {
    console.log('[Worker] Received SIGTERM, shutting down...');
    isRunning = false;
  });

  console.log('[Worker] Starting background worker loop...');

  while (isRunning) {
    try {
      // 1. Process outbox batch
      const processed = await runOnce(pool, 20);

      // 2. Scheduler checks
      const now = Date.now();
      if (now - lastStaleSweep >= STALE_INTERVAL_MS) {
        lastStaleSweep = now;
        await staleSweep(pool).catch((err) =>
          console.error('[Worker] staleSweep error:', err)
        );
      }

      if (now - lastOverdueSweep >= OVERDUE_INTERVAL_MS) {
        lastOverdueSweep = now;
        await overdueSweep(pool).catch((err) =>
          console.error('[Worker] overdueSweep error:', err)
        );
      }

      if (now - lastAutoClose >= AUTO_CLOSE_INTERVAL_MS) {
        lastAutoClose = now;
        await autoCloseResolved(pool, config.AUTO_CLOSE_DAYS).catch((err) =>
          console.error('[Worker] autoCloseResolved error:', err)
        );
      }

      if (now - lastCleanup >= CLEANUP_INTERVAL_MS) {
        lastCleanup = now;
        await cleanup(pool, config.IDEMPOTENCY_TTL_HOURS).catch((err) =>
          console.error('[Worker] cleanup error:', err)
        );
      }

      // If no outbox rows were processed, back off briefly to avoid hot looping
      if (processed === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (err) {
      console.error('[Worker] Unhandled loop error:', err);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  await pool.end();
  console.log('[Worker] Graceful shutdown complete.');
}

main().catch((err) => {
  console.error('[Worker] Fatal error:', err);
  process.exit(1);
});
