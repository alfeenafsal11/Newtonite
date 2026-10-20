import pg from 'pg';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://opsflow:opsflow@localhost:5432/opsflow';

async function main() {
  console.log('[Seed-Load] Starting scale check data generation...');
  const pool = new pg.Pool({ connectionString: DATABASE_URL });

  // 1. Ensure at least one team and user exists
  let userRes = await pool.query<{ id: string }>(`SELECT id FROM users LIMIT 1`);
  if (userRes.rows.length === 0) {
    const u = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, org_role)
       VALUES ('load_tester@opsflow.test', 'Load Tester', 'hash', 'org_admin')
       RETURNING id`
    );
    userRes = u;
  }
  const userId = userRes.rows[0].id;

  let teamRes = await pool.query<{ id: string }>(`SELECT id FROM teams LIMIT 1`);
  if (teamRes.rows.length === 0) {
    const t = await pool.query<{ id: string }>(
      `INSERT INTO teams (name, slug)
       VALUES ('Scale Team', 'scale-team')
       RETURNING id`
    );
    teamRes = t;
  }
  const teamId = teamRes.rows[0].id;

  const startTime = Date.now();

  console.log('[Seed-Load] Generating 20,000 active items and 30,000 closed items...');
  const BATCH_SIZE = 2500;
  const TOTAL_ACTIVE = 20000;
  const TOTAL_CLOSED = 30000;

  // Insert Active items
  for (let b = 0; b < TOTAL_ACTIVE; b += BATCH_SIZE) {
    const rows: string[] = [];
    const count = Math.min(BATCH_SIZE, TOTAL_ACTIVE - b);
    for (let i = 0; i < count; i++) {
      const idx = b + i;
      const status = idx % 3 === 0 ? 'in_progress' : idx % 3 === 1 ? 'open' : 'blocked';
      const assignee = status === 'open' ? 'NULL' : `'${userId}'`;
      const prio = idx % 10 === 0 ? 'p0' : idx % 5 === 0 ? 'p1' : idx % 2 === 0 ? 'p2' : 'p3';
      const type = 'operational_task';
      rows.push(
        `('${teamId}', '${type}', 'Active item ${idx}', 'Description for load test ${idx}', '${prio}', '${userId}', ${assignee}, '${status}', false, 'not_required', '{load,scale}', now() + interval '24 hours', now() - make_interval(secs => ${idx * 10}))`
      );
    }

    await pool.query(
      `INSERT INTO work_items (
         team_id, type, title, description, priority, reporter_id, assignee_id,
         status, requires_approval, approval_state, tags, stale_at, last_activity_at
       )
       VALUES ${rows.join(',\n')}`
    );
    process.stdout.write(`\r[Seed-Load] Active items inserted: ${b + count}/${TOTAL_ACTIVE}`);
  }
  console.log('');

  // Insert Closed items
  for (let b = 0; b < TOTAL_CLOSED; b += BATCH_SIZE) {
    const rows: string[] = [];
    const count = Math.min(BATCH_SIZE, TOTAL_CLOSED - b);
    for (let i = 0; i < count; i++) {
      const idx = b + i;
      rows.push(
        `('${teamId}', 'operational_task', 'Closed item ${idx}', 'Description ${idx}', 'p2', '${userId}', '${userId}', 'closed', false, 'not_required', '{load,closed}', 'completed', now() - make_interval(secs => ${idx * 10}), now() - make_interval(secs => ${idx * 10}))`
      );
    }

    await pool.query(
      `INSERT INTO work_items (
         team_id, type, title, description, priority, reporter_id, assignee_id,
         status, requires_approval, approval_state, tags, close_reason, closed_at, last_activity_at
       )
       VALUES ${rows.join(',\n')}`
    );
    process.stdout.write(`\r[Seed-Load] Closed items inserted: ${b + count}/${TOTAL_CLOSED}`);
  }
  console.log('');

  // Insert 300,000 events
  console.log('[Seed-Load] Generating 300,000 item events...');
  const TOTAL_EVENTS = 300000;
  // Get sample item IDs to attach events to
  const sampleItemsRes = await pool.query<{ id: string }>(
    `SELECT id FROM work_items LIMIT 5000`
  );
  const sampleItemIds = sampleItemsRes.rows.map((r) => r.id);

  for (let b = 0; b < TOTAL_EVENTS; b += 5000) {
    const rows: string[] = [];
    const count = Math.min(5000, TOTAL_EVENTS - b);
    for (let i = 0; i < count; i++) {
      const idx = b + i;
      const itemId = sampleItemIds[idx % sampleItemIds.length];
      rows.push(
        `('${itemId}', '${teamId}', '${userId}', 'fields_updated', '{"load": true}', 1, now() - make_interval(secs => ${idx}))`
      );
    }

    await pool.query(
      `INSERT INTO item_events (item_id, team_id, actor_id, type, payload, item_version, created_at)
       VALUES ${rows.join(',\n')}`
    );
    process.stdout.write(`\r[Seed-Load] Events inserted: ${b + count}/${TOTAL_EVENTS}`);
  }
  console.log('');

  console.log('[Seed-Load] Running PostgreSQL ANALYZE to update query planner statistics...');
  await pool.query('ANALYZE work_items');
  await pool.query('ANALYZE item_events');
  await pool.query('ANALYZE outbox');

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Seed-Load] Completed scale check data generation in ${durationSec}s!`);
  await pool.end();
}

main().catch((err) => {
  console.error('[Seed-Load] Error:', err);
  process.exit(1);
});
