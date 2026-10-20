import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { getTestPool } from '../helpers/db.js';
import { createUser, createTeam, addTeamMember, createWorkItem } from '../helpers/factory.js';
import { getStreamHub } from '../../src/modules/stream/hub.js';

describe('SSE Stream & Authorization Integration Tests (Phase P6)', () => {
  let app: FastifyInstance;
  const pool = getTestPool();

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('(1) Connecting without auth returns 401 unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/stream',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthenticated');
  });

  it('(2) Authorized client connects and receives stream headers and connected comment', async () => {
    const user = await createUser();
    const team = await createTeam();
    await addTeamMember(team.id, user.id, 'member');

    const hub = getStreamHub();
    const timer = setTimeout(() => {
      for (const conn of (hub as any).connections.values()) {
        try {
          conn.reply.raw.end();
        } catch {
          // ignore
        }
      }
    }, 50);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/stream',
      headers: { authorization: `Bearer ${user.token}` },
    });

    clearTimeout(timer);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain(': connected\n\n');
  });

  it('(3) Cross-team event filtering: User in Team A receives Team A events; User in Team B does not', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const orgAdmin = await createUser({ orgRole: 'org_admin' });

    const teamA = await createTeam();
    const teamB = await createTeam();

    await addTeamMember(teamA.id, userA.id, 'member');
    await addTeamMember(teamB.id, userB.id, 'member');

    const hub = getStreamHub();

    // Mock replies to capture written SSE messages
    const receivedA: string[] = [];
    const receivedB: string[] = [];
    const receivedAdmin: string[] = [];

    const mockReplyA = {
      raw: {
        write: (chunk: string) => receivedA.push(chunk),
        end: () => {},
      },
    } as any;

    const mockReplyB = {
      raw: {
        write: (chunk: string) => receivedB.push(chunk),
        end: () => {},
      },
    } as any;

    const mockReplyAdmin = {
      raw: {
        write: (chunk: string) => receivedAdmin.push(chunk),
        end: () => {},
      },
    } as any;

    const mockReq = { raw: { on: () => {} } } as any;

    // Register connections
    const actorA = {
      id: userA.id,
      orgRole: userA.orgRole,
      isActive: true,
      memberships: new Map([[teamA.id, 'member' as const]]),
    };
    const actorB = {
      id: userB.id,
      orgRole: userB.orgRole,
      isActive: true,
      memberships: new Map([[teamB.id, 'member' as const]]),
    };
    const actorAdmin = {
      id: orgAdmin.id,
      orgRole: orgAdmin.orgRole,
      isActive: true,
      memberships: new Map(),
    };

    hub.register(actorA, mockReq, mockReplyA);
    hub.register(actorB, mockReq, mockReplyB);
    hub.register(actorAdmin, mockReq, mockReplyAdmin);

    // Broadcast an event that belongs to Team A
    hub.broadcast({
      item_id: '11111111-1111-1111-1111-111111111111',
      team_id: teamA.id,
      version: 1,
      type: 'item_created',
      event_id: 101,
    });

    // Check message delivery: User A and Admin got it; User B did NOT
    const hasItemA = (msgs: string[]) => msgs.some((m) => m.includes('11111111-1111-1111-1111-111111111111'));
    expect(hasItemA(receivedA)).toBe(true);
    expect(hasItemA(receivedAdmin)).toBe(true);
    expect(hasItemA(receivedB)).toBe(false);

    // Broadcast an event that belongs to Team B
    hub.broadcast({
      item_id: '22222222-2222-2222-2222-222222222222',
      team_id: teamB.id,
      version: 2,
      type: 'claimed',
      event_id: 102,
    });

    const hasItemB = (msgs: string[]) => msgs.some((m) => m.includes('22222222-2222-2222-2222-222222222222'));
    expect(hasItemB(receivedB)).toBe(true);
    expect(hasItemB(receivedAdmin)).toBe(true);
    expect(hasItemB(receivedA)).toBe(false);
  });
});
