import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import * as jose from 'jose';
import { loadConfig } from '../config.js';
import { getPool } from '../db/pool.js';
import { Actor, TeamRole } from '../domain/permissions.js';
import { AppError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor;
  }
}

export interface TokenPayload {
  sub: string;
  tv: number;
}

export async function signToken(user: { id: string; token_version: number }): Promise<string> {
  const config = loadConfig();
  const secretKey = new TextEncoder().encode(config.JWT_SECRET);
  return await new jose.SignJWT({ sub: user.id, tv: user.token_version })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${config.JWT_TTL_HOURS}h`)
    .sign(secretKey);
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const config = loadConfig();
  const secretKey = new TextEncoder().encode(config.JWT_SECRET);
  try {
    const { payload } = await jose.jwtVerify(token, secretKey, {
      algorithms: ['HS256'],
    });
    if (!payload.sub || typeof payload['tv'] !== 'number') {
      throw new Error('Invalid token payload structure');
    }
    return {
      sub: payload.sub,
      tv: payload['tv'] as number,
    };
  } catch (err: any) {
    throw new AppError(401, 'unauthenticated', 'Invalid or expired authentication token', {
      error: err.message,
    });
  }
}

export async function loadActorById(userId: string, expectedTokenVersion?: number): Promise<Actor> {
  const pool = getPool();

  const userRes = await pool.query(
    'SELECT id, email, display_name, org_role, is_active, token_version FROM users WHERE id = $1',
    [userId]
  );

  if (userRes.rows.length === 0) {
    throw new AppError(401, 'unauthenticated', 'User not found or deactivated');
  }

  const u = userRes.rows[0];
  if (!u.is_active) {
    throw new AppError(401, 'unauthenticated', 'User account is deactivated');
  }

  if (expectedTokenVersion !== undefined && u.token_version !== expectedTokenVersion) {
    throw new AppError(401, 'unauthenticated', 'Authentication token has been revoked');
  }

  const membersRes = await pool.query(
    'SELECT team_id, role FROM team_memberships WHERE user_id = $1',
    [userId]
  );

  const memberships = new Map<string, TeamRole>();
  for (const m of membersRes.rows) {
    memberships.set(m.team_id, m.role as TeamRole);
  }

  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    orgRole: u.org_role,
    isActive: u.is_active,
    tokenVersion: u.token_version,
    memberships,
  };
}

export async function requireActor(request: FastifyRequest): Promise<Actor> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(401, 'unauthenticated', 'Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7).trim();
  const payload = await verifyToken(token);
  const actor = await loadActorById(payload.sub, payload.tv);
  request.actor = actor;
  return actor;
}

export async function authenticateHook(request: FastifyRequest, _reply: FastifyReply) {
  // Endpoints that are public (unauthenticated)
  const url = request.raw.url || '';
  if (
    url.startsWith('/healthz') ||
    url.startsWith('/readyz') ||
    url.startsWith('/api/v1/auth/login') ||
    url.startsWith('/stream') // SSE handles token in query or headers
  ) {
    return;
  }

  await requireActor(request);
}

const authPluginInner: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.decorateRequest('actor', undefined);
};

export const authPlugin = fp(authPluginInner);
