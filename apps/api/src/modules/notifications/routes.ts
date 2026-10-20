import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requireActor } from '../../http/auth.js';
import { listNotifications, markRead } from './service.js';

export const notificationsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/notifications', async (request, reply) => {
    const actor = await requireActor(request);
    const query = request.query as {
      cursor?: string;
      limit?: string;
      unread?: string | boolean;
    };
    const result = await listNotifications(actor, query);
    return reply.status(200).send(result);
  });

  app.post('/notifications/read', async (request, reply) => {
    const actor = await requireActor(request);
    const body = (request.body as { up_to_id?: string | number }) || {};
    const result = await markRead(actor, body.up_to_id);
    return reply.status(200).send(result);
  });
};
