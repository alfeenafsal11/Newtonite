import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { getTestPool } from '../helpers/db.js';
import { createUser, createTeam, addTeamMember, createWorkItem } from '../helpers/factory.js';

describe('Pagination & Search Integration Tests (Phase P6)', () => {
  let app: FastifyInstance;
  const pool = getTestPool();

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('(1) Keyset pagination traverses multiple pages with next_cursor without gaps or duplicates', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    // Create 7 items
    const createdIds: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const item = await createWorkItem(team.id, user.id, {
        title: `Item ${i}`,
      });
      createdIds.push(item.id);
    }

    // Page 1: limit 3
    const resPage1 = await app.inject({
      method: 'GET',
      url: `/api/v1/items?team_id=${team.id}&limit=3`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(resPage1.statusCode).toBe(200);
    const body1 = resPage1.json();
    expect(body1.items).toHaveLength(3);
    expect(body1.next_cursor).not.toBeNull();

    // Page 2: limit 3 with cursor
    const resPage2 = await app.inject({
      method: 'GET',
      url: `/api/v1/items?team_id=${team.id}&limit=3&cursor=${encodeURIComponent(body1.next_cursor)}`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(resPage2.statusCode).toBe(200);
    const body2 = resPage2.json();
    expect(body2.items).toHaveLength(3);
    expect(body2.next_cursor).not.toBeNull();

    // Page 3: limit 3 with cursor -> should have remaining 1 item and no next_cursor
    const resPage3 = await app.inject({
      method: 'GET',
      url: `/api/v1/items?team_id=${team.id}&limit=3&cursor=${encodeURIComponent(body2.next_cursor)}`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(resPage3.statusCode).toBe(200);
    const body3 = resPage3.json();
    expect(body3.items).toHaveLength(1);
    expect(body3.next_cursor).toBeNull();

    // Ensure all 7 items returned without duplication
    const allIds = [
      ...body1.items.map((i: any) => i.id),
      ...body2.items.map((i: any) => i.id),
      ...body3.items.map((i: any) => i.id),
    ];
    expect(new Set(allIds).size).toBe(7);
  });

  it('(2) Closed items are excluded by default, included only with include_closed=true', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    const openItem = await createWorkItem(team.id, user.id, { title: 'Open Item', status: 'open' });
    const closedItem = await createWorkItem(team.id, user.id, { title: 'Closed Item', status: 'closed' });

    // Default request (include_closed omitted)
    const defaultRes = await app.inject({
      method: 'GET',
      url: `/api/v1/items?team_id=${team.id}`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    const defaultItems = defaultRes.json().items;
    const defaultIds = defaultItems.map((i: any) => i.id);
    expect(defaultIds).toContain(openItem.id);
    expect(defaultIds).not.toContain(closedItem.id);

    // With include_closed=true
    const includeRes = await app.inject({
      method: 'GET',
      url: `/api/v1/items?team_id=${team.id}&include_closed=true`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    const includeIds = includeRes.json().items.map((i: any) => i.id);
    expect(includeIds).toContain(openItem.id);
    expect(includeIds).toContain(closedItem.id);
  });

  it('(3) Search by exact key/number and text query with websearch/ILIKE', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    const uniqueTerm = `uniquepaymentbug_${crypto.randomUUID().slice(0, 6)}`;
    const item1 = await createWorkItem(team.id, user.id, {
      title: `Critical ${uniqueTerm} in checkout`,
      description: 'Customer payment failed during stripe settlement',
    });
    const item2 = await createWorkItem(team.id, user.id, {
      title: 'Routine maintenance',
      description: 'Server updates',
    });

    // 1. Search by exact OPS-<number>
    const resByKey = await app.inject({
      method: 'GET',
      url: `/api/v1/items?team_id=${team.id}&q=OPS-${item1.number}`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(resByKey.statusCode).toBe(200);
    const byKeyItems = resByKey.json().items;
    expect(byKeyItems).toHaveLength(1);
    expect(byKeyItems[0].id).toBe(item1.id);

    // 2. Search by number alone
    const resByNum = await app.inject({
      method: 'GET',
      url: `/api/v1/items?team_id=${team.id}&q=${item1.number}`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(resByNum.statusCode).toBe(200);
    expect(resByNum.json().items[0].id).toBe(item1.id);

    // 3. Search by text query
    const resByText = await app.inject({
      method: 'GET',
      url: `/api/v1/items?team_id=${team.id}&q=${uniqueTerm}`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(resByText.statusCode).toBe(200);
    const textItems = resByText.json().items;
    expect(textItems).toHaveLength(1);
    expect(textItems[0].id).toBe(item1.id);
  });

  it('(4) Filters: assignee=me, tag, priority, type, overdue, and awaiting_my_approval', async () => {
    const user = await createUser();
    const otherUser = await createUser();
    const approver = await createUser();
    const team = await createTeam();

    await addTeamMember(team.id, user.id, 'member');
    await addTeamMember(team.id, otherUser.id, 'member');
    await addTeamMember(team.id, approver.id, 'approver');

    // Item 1: assigned to user, priority p0, tag 'security', overdue
    const item1 = await createWorkItem(team.id, otherUser.id, {
      title: 'Item 1',
      assignee_id: user.id,
      priority: 'p0',
      tags: ['security', 'urgent'],
      due_at: new Date(Date.now() - 3600000).toISOString(),
    });

    // Item 2: assigned to otherUser, pending approval
    const item2 = await createWorkItem(team.id, otherUser.id, {
      title: 'Item 2',
      assignee_id: otherUser.id,
      priority: 'p1',
      tags: ['compliance'],
      status: 'pending_approval',
      requires_approval: true,
      approval_state: 'pending',
    });

    // Filter assignee=me
    const resMe = await app.inject({
      method: 'GET',
      url: `/api/v1/items?team_id=${team.id}&assignee=me`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    const meIds = resMe.json().items.map((i: any) => i.id);
    expect(meIds).toContain(item1.id);
    expect(meIds).not.toContain(item2.id);

    // Filter tag=security
    const resTag = await app.inject({
      method: 'GET',
      url: `/api/v1/items?team_id=${team.id}&tag=security`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    const tagIds = resTag.json().items.map((i: any) => i.id);
    expect(tagIds).toContain(item1.id);
    expect(tagIds).not.toContain(item2.id);

    // Filter priority=p0
    const resPrio = await app.inject({
      method: 'GET',
      url: `/api/v1/items?team_id=${team.id}&priority=p0`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    const prioIds = resPrio.json().items.map((i: any) => i.id);
    expect(prioIds).toContain(item1.id);
    expect(prioIds).not.toContain(item2.id);

    // Filter due=overdue
    const resDue = await app.inject({
      method: 'GET',
      url: `/api/v1/items?team_id=${team.id}&due=overdue`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    const dueIds = resDue.json().items.map((i: any) => i.id);
    expect(dueIds).toContain(item1.id);

    // Filter awaiting_my_approval=true for approver
    const resAppr = await app.inject({
      method: 'GET',
      url: `/api/v1/items?team_id=${team.id}&awaiting_my_approval=true`,
      headers: { authorization: `Bearer ${approver.token}` },
    });
    const apprIds = resAppr.json().items.map((i: any) => i.id);
    expect(apprIds).toContain(item2.id);
  });

  it('(5) Dashboard attention returns bounded counts and sections', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    await createWorkItem(team.id, user.id, {
      title: 'Active Item',
      assignee_id: user.id,
      status: 'in_progress',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/attention',
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sections).toHaveLength(6);

    const keys = body.sections.map((s: any) => s.key);
    expect(keys).toContain('awaiting_my_approval');
    expect(keys).toContain('my_overdue');
    expect(keys).toContain('my_stale');
    expect(keys).toContain('my_active');
    expect(keys).toContain('unassigned_in_my_teams');
    expect(keys).toContain('unread_notifications');
  });

  it('(6) Dashboard overview returns team breakdown and metrics', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    await createWorkItem(team.id, user.id, {
      title: 'Overview Task',
      status: 'in_progress',
      priority: 'p1',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboard/overview?team_id=${team.id}`,
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.team_id).toBe(team.id);
    expect(body.by_status).toBeDefined();
    expect(body.by_priority).toBeDefined();
    expect(body.last_7_days).toBeDefined();
  });
});
