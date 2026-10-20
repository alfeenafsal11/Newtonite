import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.js';
import { getPool } from './db/pool.js';
import { errorHandler } from './http/errors.js';
import { registerRequestContext } from './http/request-context.js';
import { authPlugin } from './http/auth.js';
import { authRoutes } from './modules/auth/routes.js';
import { itemsRoutes } from './modules/items/routes.js';
import { commentsRoutes } from './modules/comments/routes.js';
import { approvalsRoutes } from './modules/approvals/routes.js';
import { teamsRoutes } from './modules/teams/routes.js';
import { dashboardRoutes } from './modules/dashboard/routes.js';
import { notificationsRoutes } from './modules/notifications/routes.js';
import { streamRoutes } from './modules/stream/routes.js';
import { getStreamHub } from './modules/stream/hub.js';

export function buildApp(opts: FastifyServerOptions = {}): FastifyInstance {
  const config = loadConfig();
  getStreamHub(config.DATABASE_URL, config.SSE_MAX_CONNECTIONS);

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
    ...opts,
  });

  // Global error handler
  app.setErrorHandler(errorHandler);

  // Request context (X-Request-Id)
  app.register(registerRequestContext);

  // Security headers
  app.register(helmet, {
    contentSecurityPolicy: false, // Allows SPA dev and API usage
  });

  // Support empty JSON bodies gracefully for POST actions (claim, release, etc.)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body: string, done) => {
    if (!body || body.trim().length === 0) {
      done(null, {});
      return;
    }
    try {
      const json = JSON.parse(body);
      done(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // CORS
  app.register(cors, {
    origin: [config.WEB_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Idempotent-Replay'],
  });

  // Rate limiting
  app.register(rateLimit, {
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
  });

  // Auth decoration
  app.register(authPlugin);

  // Health check endpoints
  app.get('/healthz', async (_req, reply) => {
    return reply.status(200).send({ status: 'ok' });
  });

  app.get('/readyz', async (_req, reply) => {
    try {
      const pool = getPool();
      await pool.query('SELECT 1');
      return reply.status(200).send({ status: 'ready' });
    } catch {
      return reply.status(503).send({ status: 'not_ready' });
    }
  });

  // API v1 prefix routes
  app.register(async (api) => {
    api.register(authRoutes);
    api.register(itemsRoutes);
    api.register(commentsRoutes);
    api.register(approvalsRoutes);
    api.register(teamsRoutes);
    api.register(dashboardRoutes);
    api.register(notificationsRoutes);
    api.register(streamRoutes);
  }, { prefix: '/api/v1' });

  // Serve static SPA files in production if dist directory exists
  if (config.NODE_ENV === 'production') {
    const webDistPath = path.resolve(process.cwd(), 'apps/web/dist');
    if (fs.existsSync(webDistPath)) {
      app.register(fastifyStatic, {
        root: webDistPath,
        prefix: '/',
      });
      app.setNotFoundHandler((req, reply) => {
        if (req.raw.url && req.raw.url.startsWith('/api')) {
          reply.status(404).send({
            error: {
              code: 'not_found',
              message: 'Endpoint not found',
              request_id: req.headers['x-request-id'] || 'unknown',
            },
          });
        } else {
          reply.sendFile('index.html');
        }
      });
    }
  }

  return app;
}
