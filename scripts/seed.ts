import pg from 'pg';
import argon2 from 'argon2';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://opsflow:opsflow@localhost:5432/opsflow';

async function main() {
  console.log('[Seed] Connecting to database:', DATABASE_URL);
  const pool = new pg.Pool({ connectionString: DATABASE_URL });

  const passwordHash = await argon2.hash('Passw0rd!demo');

  console.log('[Seed] Inserting demo users...');
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
    userMap.set(u.email, res.rows[0].id);
  }

  console.log('[Seed] Inserting teams...');
  const teams = [
    { slug: 'support', name: 'Customer Support' },
    { slug: 'engineering', name: 'Engineering Core' },
    { slug: 'payments', name: 'Payments & Risk' },
    { slug: 'compliance', name: 'Regulatory & Compliance' },
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
    teamMap.set(t.slug, res.rows[0].id);
  }

  console.log('[Seed] Assigning team memberships...');
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

    // multi team user
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

  console.log('[Seed] Inserting sample work items...');
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
      resolutionNote: 'All access logs verified and exported to compliance archive.',
    },
  ];

  for (const item of sampleItems) {
    const teamId = teamMap.get(item.team)!;
    const reporterId = userMap.get(item.reporter)!;
    const assigneeId = item.assignee ? userMap.get(item.assignee) : null;
    const approvalState = item.approvalState || (item.requiresApproval ? 'not_requested' : 'not_required');

    const itemRes = await pool.query<{ id: string }>(
      `INSERT INTO work_items (
         team_id, type, title, description, priority, reporter_id, assignee_id,
         status, requires_approval, approval_state, tags,
         resolution_note, resolved_at, stale_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now() + interval '24 hours')
       RETURNING id`,
      [
        teamId,
        item.type,
        item.title,
        item.description,
        item.priority,
        reporterId,
        assigneeId,
        item.status,
        item.requiresApproval,
        approvalState,
        item.tags,
        item.resolutionNote || null,
        item.status === 'resolved' ? new Date() : null,
      ]
    );

    const itemId = itemRes.rows[0].id;

    // Add reporter and assignee as watchers
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

    // Insert initial event
    await pool.query(
      `INSERT INTO item_events (item_id, team_id, actor_id, type, payload, item_version)
       VALUES ($1, $2, $3, 'item_created', $4, 1)`,
      [itemId, teamId, reporterId, JSON.stringify({ title: item.title })]
    );

    // If pending approval, insert approval row
    if (item.approvalState === 'pending') {
      await pool.query(
        `INSERT INTO approvals (item_id, requested_by, state)
         VALUES ($1, $2, 'pending')`,
        [itemId, reporterId]
      );
    }
  }

  console.log('[Seed] Demo database seeded successfully!');
  await pool.end();
}

main().catch((err) => {
  console.error('[Seed] Error:', err);
  process.exit(1);
});
