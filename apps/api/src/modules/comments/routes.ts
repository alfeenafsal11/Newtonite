import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { CommentBodySchema } from '../../http/schemas.js';
import { addComment, listComments } from './service.js';
import { requireActor } from '../../http/auth.js';

export const commentsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/items/:id/comments', async (request, reply) => {
    const actor = await requireActor(request);
    const { id } = request.params as { id: string };
    const body = CommentBodySchema.parse(request.body);

    const result = await addComment(actor, id, body.body, {
      requestId: request.requestId,
    });

    return reply.status(201).send(result);
  });

  app.get('/items/:id/comments', async (request, reply) => {
    const actor = await requireActor(request);
    const { id } = request.params as { id: string };
    const result = await listComments(actor, id);
    return reply.status(200).send(result);
  });
};
