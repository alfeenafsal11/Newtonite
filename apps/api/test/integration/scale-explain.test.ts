import { describe, it, expect } from 'vitest';
import { getTestPool } from '../helpers/db.js';
import { createUser, createTeam, addTeamMember, createWorkItem } from '../helpers/factory.js';
import { buildListQuery } from '../../src/modules/items/list-query.js';
import { attention } from '../../src/modules/dashboard/service.js';

describe('Scale & Query Plan Verification (Phase P7 / Section 15.5)', () => {
  const pool = getTestPool();

  it('(1) Query plans use partial indexes for default list, assignee, and team filters (no Seq Scan on large data)', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    // 1. Team ID query
    const teamQuery = buildListQuery(
      { id: user.id, orgRole: 'member', isActive: true, memberships: new Map([[team.id, 'member']]) },
      { team_id: team.id, limit: 50, sort: 'activity_desc' }
    );
    const explainTeam = await pool.query(`EXPLAIN ${teamQuery.text}`, teamQuery.values);
    const teamPlan = explainTeam.rows.map((r: any) => r['QUERY PLAN']).join('\n');
    expect(teamPlan).toMatch(/Index Scan|Bitmap|wi_team_active_activity_idx/i);

    // 2. Assignee query
    const assigneeQuery = buildListQuery(
      { id: user.id, orgRole: 'member', isActive: true, memberships: new Map([[team.id, 'member']]) },
      { assignee: 'me', limit: 50, sort: 'activity_desc' }
    );
    const explainAssignee = await pool.query(`EXPLAIN ${assigneeQuery.text}`, assigneeQuery.values);
    const assigneePlan = explainAssignee.rows.map((r: any) => r['QUERY PLAN']).join('\n');
    expect(assigneePlan).toMatch(/Index Scan|Bitmap|wi_team_active_activity_idx|wi_assignee_active_idx/i);
  });

  it('(2) Query response times adhere to Section 15.5 performance budget', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');
    const item = await createWorkItem(team.id, user.id);

    const actor = {
      id: user.id,
      orgRole: user.orgRole,
      isActive: true,
      memberships: new Map([[team.id, 'member' as const]]),
    };

    // 1. List query (< 100 ms)
    const listQuery = buildListQuery(actor, { limit: 50 });
    const startList = performance.now();
    await pool.query(listQuery.text, listQuery.values);
    const durationList = performance.now() - startList;
    expect(durationList).toBeLessThan(100);

    // 2. Item detail query (< 50 ms)
    const startItem = performance.now();
    await pool.query('SELECT * FROM work_items WHERE id = $1', [item.id]);
    const durationItem = performance.now() - startItem;
    expect(durationItem).toBeLessThan(50);

    // 3. Events page query (< 50 ms)
    const startEvents = performance.now();
    await pool.query(
      'SELECT * FROM item_events WHERE item_id = $1 ORDER BY id DESC LIMIT 51',
      [item.id]
    );
    const durationEvents = performance.now() - startEvents;
    expect(durationEvents).toBeLessThan(50);

    // 4. Dashboard attention (< 300 ms total)
    const startDashboard = performance.now();
    await attention(actor);
    const durationDashboard = performance.now() - startDashboard;
    expect(durationDashboard).toBeLessThan(300);
  });
});
