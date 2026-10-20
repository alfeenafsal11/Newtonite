import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import argon2 from 'argon2';
import runner from 'node-pg-migrate';
import { getPool } from './pool.js';
import { Config } from '../config.js';
import { runOnce } from '../worker/outbox.js';
import { staleSweep, overdueSweep, autoCloseResolved, cleanup } from '../worker/scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function bootstrapDatabase(config: Config) {
  const pool = getPool(config.DATABASE_URL);

  console.log('[Bootstrap] Checking database status...');

  // 1. Check if tables exist
  let tablesExist = false;
  try {
    const tableRes = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'`
    );
    tablesExist = tableRes.rows.length > 0;
  } catch (err: any) {
    console.warn('[Bootstrap] Error checking tables:', err.message);
  }

  // 2. Run migrations if tables do not exist
  if (!tablesExist) {
    console.log('[Bootstrap] Schema not detected. Running migrations...');
    try {
      const migrationsDir = path.resolve(__dirname, '../../migrations');
      if (fs.existsSync(migrationsDir)) {
        await (runner as any)({
          databaseUrl: config.DATABASE_URL,
          dir: migrationsDir,
          direction: 'up',
          migrationsTable: 'pgmigrations',
          verbose: false,
        });
        console.log('[Bootstrap] Migrations applied via node-pg-migrate.');
      } else {
        throw new Error(`Migrations directory not found at ${migrationsDir}`);
      }
    } catch (migErr: any) {
      console.warn('[Bootstrap] node-pg-migrate runner failed, attempting direct init SQL fallback...', migErr.message);
      const possibleInitPaths = [
        path.resolve(__dirname, '../../migrations/1700000000000_init.sql'),
        path.resolve(process.cwd(), 'apps/api/migrations/1700000000000_init.sql'),
        path.resolve(process.cwd(), 'migrations/1700000000000_init.sql'),
      ];
      const sqlPath = possibleInitPaths.find((p) => fs.existsSync(p));
      if (sqlPath) {
        const sql = fs.readFileSync(sqlPath, 'utf8');
        await pool.query(sql);
        console.log('[Bootstrap] Initial schema applied successfully from init.sql.');
      } else {
        console.error('[Bootstrap] Could not find init.sql migration fallback!');
      }
    }
  }

  // 3. Check if demo seed data exists
  try {
    const userCountRes = await pool.query(`SELECT count(*)::int as count FROM users`);
    const count = userCountRes.rows[0]?.count || 0;
    if (count === 0) {
      console.log('[Bootstrap] No users found. Seeding demo accounts and teams...');
      await seedDemoData(pool);
      console.log('[Bootstrap] Demo data successfully seeded.');
    } else {
      console.log(`[Bootstrap] Database already contains ${count} users. Skipping seed.`);
    }
  } catch (seedErr: any) {
    console.error('[Bootstrap] Failed to verify or seed demo data:', seedErr.message);
  }

  // 4. Start transactional outbox worker loop in background
  if (process.env.RUN_WORKER !== 'false') {
    startBackgroundWorker(pool, config);
  }
}

async function seedDemoData(pool: pg.Pool) {
  const passwordHash = await argon2.hash('Passw0rd!demo');

  const users = [
    { email: 'admin@opsflow.test', name: 'System Admin', orgRole: 'org_admin' },
    { email: 'auditor@opsflow.test', name: 'Compliance Auditor', orgRole: 'auditor' },
    { email: 'support.lead@opsflow.test', name: 'Sarah Lead', orgRole: 'member' },
    { email: 'support.agent1@opsflow.test', name: 'Alex Agent', orgRole: 'member' },
    { email: 'support.agent2@opsflow.test', name: 'Ben Agent', orgRole: 'member' },
    { email: 'eng.approver@opsflow.test', name: 'Elena EngLead', orgRole: 'member' },
    { email: 'eng.dev1@opsflow.test', name: 'David Dev', orgRole: 'member' },
    { email: 'eng.dev2@opsflow.test', name: 'Chloe Dev', orgRole: 'member' },
    { email: 'pay.approver@opsflow.test', name: 'Peter PayLead', orgRole: 'member' },
    { email: 'pay.analyst@opsflow.test', name: 'Alice Analyst', orgRole: 'member' },
    { email: 'compliance.admin@opsflow.test', name: 'Cynthia Compliance', orgRole: 'member' },
    { email: 'viewer@opsflow.test', name: 'Victor Viewer', orgRole: 'member' },
    { email: 'multi@opsflow.test', name: 'Morgan Multi', orgRole: 'member' },
  ];

  const userMap = new Map<string, string>();
  for (const u of users) {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, org_role, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (lower(email)) DO UPDATE
       SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [u.email, u.name, passwordHash, u.orgRole]
    );
    userMap.set(u.email, res.rows[0]!.id);
  }

  const teams = [
    { slug: 'support', name: 'Customer Support' },
    { slug: 'engineering', name: 'Engineering Core' },
    { slug: 'payments', name: 'Payments & Risk' },
    { slug: 'compliance', name: 'Legal & Compliance' },
  ];

  const teamMap = new Map<string, string>();
  for (const t of teams) {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO teams (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [t.name, t.slug]
    );
    teamMap.set(t.slug, res.rows[0]!.id);
  }

  const memberships = [
    { user: 'support.lead@opsflow.test', team: 'support', role: 'admin' },
    { user: 'support.agent1@opsflow.test', team: 'support', role: 'member' },
    { user: 'support.agent2@opsflow.test', team: 'support', role: 'member' },
    { user: 'viewer@opsflow.test', team: 'support', role: 'viewer' },

    { user: 'eng.approver@opsflow.test', team: 'engineering', role: 'approver' },
    { user: 'eng.dev1@opsflow.test', team: 'engineering', role: 'member' },
    { user: 'eng.dev2@opsflow.test', team: 'engineering', role: 'member' },

    { user: 'pay.approver@opsflow.test', team: 'payments', role: 'approver' },
    { user: 'pay.analyst@opsflow.test', team: 'payments', role: 'member' },

    { user: 'compliance.admin@opsflow.test', team: 'compliance', role: 'admin' },

    { user: 'multi@opsflow.test', team: 'support', role: 'member' },
    { user: 'multi@opsflow.test', team: 'payments', role: 'approver' },
    { user: 'multi@opsflow.test', team: 'engineering', role: 'viewer' },
  ];

  for (const m of memberships) {
    const userId = userMap.get(m.user)!;
    const teamId = teamMap.get(m.team)!;
    await pool.query(
      `INSERT INTO team_memberships (team_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [teamId, userId, m.role]
    );
  }

  // Insert sample work items
  const sampleItems = [
    {
      team: 'support',
      reporter: 'support.agent1@opsflow.test',
      assignee: 'support.agent1@opsflow.test',
      type: 'customer_issue',
      title: 'Customer account lockout after password reset',
      description: 'Multiple users reporting 2FA SMS code timeout on mobile login.',
      status: 'in_progress',
      priority: 'p1',
      tags: ['auth', 'customer-facing'],
      requiresApproval: false,
    },
    {
      team: 'support',
      reporter: 'support.agent2@opsflow.test',
      assignee: null,
      type: 'operational_task',
      title: 'Update standard response templates for holiday surge',
      description: 'Review macro templates for shipping inquiry refunds.',
      status: 'open',
      priority: 'p3',
      tags: ['docs', 'templates'],
      requiresApproval: false,
    },
    {
      team: 'payments',
      reporter: 'pay.analyst@opsflow.test',
      assignee: 'pay.analyst@opsflow.test',
      type: 'payment_investigation',
      title: 'High value refund request - Transaction #994821',
      description: 'Customer requests $15,000 refund due to unauthorized merchant billing.',
      status: 'pending_approval',
      priority: 'p0',
      tags: ['refund', 'dispute', 'urgent'],
      requiresApproval: true,
      approvalState: 'pending',
    },
    {
      team: 'engineering',
      reporter: 'eng.dev1@opsflow.test',
      assignee: 'eng.dev1@opsflow.test',
      type: 'production_incident',
      title: 'Redis connection pool exhaustion during peak traffic',
      description: 'Investigating maxclients error logs on cache cluster node-2.',
      status: 'blocked',
      priority: 'p0',
      tags: ['infrastructure', 'incident'],
      requiresApproval: false,
    },
    {
      team: 'compliance',
      reporter: 'compliance.admin@opsflow.test',
      assignee: 'compliance.admin@opsflow.test',
      type: 'compliance_request',
      title: 'Quarterly SOC2 vendor access review audit',
      description: 'Collect access logs for all contractors with production access.',
      status: 'resolved',
      priority: 'p2',
      tags: ['soc2', 'audit'],
      requiresApproval: false,
      resolutionNote: 'All 42 third-party contractor access logs verified and signed off.',
    },
  ];

  for (const item of sampleItems) {
    const teamId = teamMap.get(item.team)!;
    const reporterId = userMap.get(item.reporter)!;
    const assigneeId = item.assignee ? userMap.get(item.assignee) : null;
    const approvalState = item.approvalState || (item.requiresApproval ? 'pending' : 'not_required');

    const itemRes = await pool.query<{ id: string }>(
      `INSERT INTO work_items (
         team_id, type, title, description, status, priority,
         reporter_id, assignee_id, requires_approval, approval_state, tags,
         resolution_note, resolved_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        teamId,
        item.type,
        item.title,
        item.description,
        item.status,
        item.priority,
        reporterId,
        assigneeId,
        item.requiresApproval,
        approvalState,
        item.tags,
        (item as any).resolutionNote || null,
        item.status === 'resolved' ? new Date() : null,
      ]
    );

    const itemId = itemRes.rows[0]!.id;
    await pool.query(
      `INSERT INTO item_watchers (item_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [itemId, reporterId]
    );
    if (assigneeId) {
      await pool.query(
        `INSERT INTO item_watchers (item_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [itemId, assigneeId]
      );
    }

    await pool.query(
      `INSERT INTO item_events (item_id, team_id, actor_id, type, payload, item_version)
       VALUES ($1, $2, $3, 'item_created', $4, 1)`,
      [itemId, teamId, reporterId, JSON.stringify({ title: item.title })]
    );

    if (item.approvalState === 'pending') {
      await pool.query(
        `INSERT INTO approvals (item_id, requested_by, state)
         VALUES ($1, $2, 'pending')`,
        [itemId, reporterId]
      );
    }
  }
}

function startBackgroundWorker(pool: pg.Pool, config: Config) {
  let isRunning = true;
  let lastStaleSweep = 0;
  let lastOverdueSweep = 0;
  let lastAutoClose = 0;
  let lastCleanup = 0;

  const STALE_INTERVAL_MS = 60 * 1000;
  const OVERDUE_INTERVAL_MS = 60 * 1000;
  const AUTO_CLOSE_INTERVAL_MS = 5 * 60 * 1000;
  const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

  process.on('SIGTERM', () => { isRunning = false; });
  process.on('SIGINT', () => { isRunning = false; });

  console.log('[Worker] In-process transactional outbox processor initialized.');

  (async () => {
    while (isRunning) {
      try {
        const processed = await runOnce(pool, 20);

        const now = Date.now();
        if (now - lastStaleSweep >= STALE_INTERVAL_MS) {
          lastStaleSweep = now;
          await staleSweep(pool).catch((e) => console.error('[Worker] staleSweep error:', e));
        }

        if (now - lastOverdueSweep >= OVERDUE_INTERVAL_MS) {
          lastOverdueSweep = now;
          await overdueSweep(pool).catch((e) => console.error('[Worker] overdueSweep error:', e));
        }

        if (now - lastAutoClose >= AUTO_CLOSE_INTERVAL_MS) {
          lastAutoClose = now;
          await autoCloseResolved(pool, config.AUTO_CLOSE_DAYS).catch((e) =>
            console.error('[Worker] autoCloseResolved error:', e)
          );
        }

        if (now - lastCleanup >= CLEANUP_INTERVAL_MS) {
          lastCleanup = now;
          await cleanup(pool, config.IDEMPOTENCY_TTL_HOURS).catch((e) =>
            console.error('[Worker] cleanup error:', e)
          );
        }

        if (processed === 0) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (err: any) {
        console.error('[Worker] Loop error:', err?.message || err);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  })().catch((err) => console.error('[Worker] Background task terminated:', err));
}
