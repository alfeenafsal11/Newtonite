import { describe, it, expect, beforeAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { FastifyInstance } from 'fastify';
import { createUser, createTeam, addTeamMember } from '../helpers/factory.js';

describe('Platform & Auth endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  it('echoes X-Request-Id header when supplied, or generates one', async () => {
    const customId = 'custom-request-id-12345';
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: {
        'x-request-id': customId,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBe(customId);

    const resGenerated = await app.inject({
      method: 'GET',
      url: '/healthz',
    });
    expect(resGenerated.statusCode).toBe(200);
    expect(resGenerated.headers['x-request-id']).toBeDefined();
  });

  it('healthz and readyz return 200', async () => {
    const resHealth = await app.inject({ method: 'GET', url: '/healthz' });
    expect(resHealth.statusCode).toBe(200);
    expect(resHealth.json()).toEqual({ status: 'ok' });

    const resReady = await app.inject({ method: 'GET', url: '/readyz' });
    expect(resReady.statusCode).toBe(200);
    expect(resReady.json()).toEqual({ status: 'ready' });
  });

  it('login with valid credentials returns token and user', async () => {
    const email = `auth_test_login_${crypto.randomUUID().slice(0, 8)}@opsflow.test`;
    const user = await createUser({ email });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email,
        password: 'Passw0rd!demo',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeDefined();
    expect(body.user.email).toBe(email);
  });

  it('login with invalid password returns 401 unauthenticated with uniform envelope', async () => {
    const email = `auth_test_fail_${crypto.randomUUID().slice(0, 8)}@opsflow.test`;
    await createUser({ email });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email,
        password: 'wrong_password',
      },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('unauthenticated');
    expect(body.error.request_id).toBeDefined();
  });

  it('GET /me returns user profile and memberships', async () => {
    const email = `me_test_${crypto.randomUUID().slice(0, 8)}@opsflow.test`;
    const user = await createUser({ email });
    const team = await createTeam('Test Team Alpha', 'test-alpha');
    await addTeamMember(team.id, user.id, 'member');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: {
        authorization: `Bearer ${user.token}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe(email);
    expect(body.memberships).toHaveLength(1);
    expect(body.memberships[0].team_id).toBe(team.id);
    expect(body.memberships[0].role).toBe('member');
  });

  it('logout revokes the token so subsequent requests return 401', async () => {
    const email = `logout_test_${crypto.randomUUID().slice(0, 8)}@opsflow.test`;
    const user = await createUser({ email });

    // Validate token works first
    const resBefore = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(resBefore.statusCode).toBe(200);

    // Call logout
    const resLogout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(resLogout.statusCode).toBe(200);

    // Call with old token again -> 401
    const resAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(resAfter.statusCode).toBe(401);
    expect(resAfter.json().error.code).toBe('unauthenticated');
  });
});
