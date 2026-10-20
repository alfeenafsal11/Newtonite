import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { LoginBodySchema } from '../../http/schemas.js';
import { login, logout, getMe } from './service.js';
import { requireActor } from '../../http/auth.js';

export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/auth/login', async (request, reply) => {
    const body = LoginBodySchema.parse(request.body);
    const result = await login(body.email, body.password);
    return reply.status(200).send(result);
  });

  app.post('/auth/logout', async (request, reply) => {
    const actor = await requireActor(request);
    const result = await logout(actor);
    return reply.status(200).send(result);
  });

  app.get('/me', async (request, reply) => {
    const actor = await requireActor(request);
    const result = await getMe(actor);
    return reply.status(200).send(result);
  });
};
