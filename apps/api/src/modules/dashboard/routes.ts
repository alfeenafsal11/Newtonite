import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requireActor } from '../../http/auth.js';
import { attention, overview } from './service.js';

export const dashboardRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/dashboard/attention', async (request, reply) => {
    const actor = await requireActor(request);
    const result = await attention(actor);
    return reply.status(200).send(result);
  });

  app.get('/dashboard/overview', async (request, reply) => {
    const actor = await requireActor(request);
    const { team_id } = request.query as { team_id?: string };
    if (!team_id) {
      return reply.status(400).send({
        error: {
          code: 'validation_error',
          message: 'Query parameter team_id is required',
          request_id: request.requestId,
        },
      });
    }

    const result = await overview(actor, team_id);
    return reply.status(200).send(result);
  });
};
