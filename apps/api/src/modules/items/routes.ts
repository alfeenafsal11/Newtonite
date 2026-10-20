import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  CreateItemBodySchema,
  PatchItemBodySchema,
  AssignBodySchema,
  TransitionBodySchema,
  TransferBodySchema,
} from '../../http/schemas.js';
import {
  createItem,
  getItemDto,
  listItems,
  patchItem,
  claimItem,
  releaseItem,
  assignItem,
  transitionItem,
  transferItem,
  listEvents,
} from './service.js';
import { requireActor } from '../../http/auth.js';
import { ListItemsParams } from './list-query.js';

export const itemsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/items', async (request, reply) => {
    const actor = await requireActor(request);
    const query = request.query as ListItemsParams;
    const result = await listItems(actor, query);
    return reply.status(200).send(result);
  });
  app.post('/items', async (request, reply) => {
    const actor = await requireActor(request);
    const body = CreateItemBodySchema.parse(request.body);
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    const result = await createItem(actor, body, {
      idempotencyKey,
      requestId: request.requestId,
    });

    if (result.replayed) {
      reply.header('Idempotent-Replay', 'true');
    }
    return reply.status(result.status).send(result.body);
  });

  app.get('/items/:id', async (request, reply) => {
    const actor = await requireActor(request);
    const { id } = request.params as { id: string };
    const result = await getItemDto(actor, id);
    return reply.status(200).send(result);
  });

  app.patch('/items/:id', async (request, reply) => {
    const actor = await requireActor(request);
    const { id } = request.params as { id: string };
    const body = PatchItemBodySchema.parse(request.body);
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    const result = await patchItem(actor, id, body, {
      idempotencyKey,
      requestId: request.requestId,
    });

    if (result.replayed) {
      reply.header('Idempotent-Replay', 'true');
    }
    return reply.status(result.status).send(result.body);
  });

  app.post('/items/:id/claim', async (request, reply) => {
    const actor = await requireActor(request);
    const { id } = request.params as { id: string };
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    const result = await claimItem(actor, id, {
      idempotencyKey,
      requestId: request.requestId,
    });

    if (result.replayed) {
      reply.header('Idempotent-Replay', 'true');
    }
    return reply.status(result.status).send(result.body);
  });

  app.post('/items/:id/release', async (request, reply) => {
    const actor = await requireActor(request);
    const { id } = request.params as { id: string };
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    const result = await releaseItem(actor, id, {
      idempotencyKey,
      requestId: request.requestId,
    });

    if (result.replayed) {
      reply.header('Idempotent-Replay', 'true');
    }
    return reply.status(result.status).send(result.body);
  });

  app.post('/items/:id/assign', async (request, reply) => {
    const actor = await requireActor(request);
    const { id } = request.params as { id: string };
    const body = AssignBodySchema.parse(request.body);
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    const result = await assignItem(actor, id, body, {
      idempotencyKey,
      requestId: request.requestId,
    });

    if (result.replayed) {
      reply.header('Idempotent-Replay', 'true');
    }
    return reply.status(result.status).send(result.body);
  });

  app.post('/items/:id/transition', async (request, reply) => {
    const actor = await requireActor(request);
    const { id } = request.params as { id: string };
    const body = TransitionBodySchema.parse(request.body);
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    const result = await transitionItem(actor, id, body, {
      idempotencyKey,
      requestId: request.requestId,
    });

    if (result.replayed) {
      reply.header('Idempotent-Replay', 'true');
    }
    return reply.status(result.status).send(result.body);
  });

  app.post('/items/:id/transfer', async (request, reply) => {
    const actor = await requireActor(request);
    const { id } = request.params as { id: string };
    const body = TransferBodySchema.parse(request.body);
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    const result = await transferItem(actor, id, body, {
      idempotencyKey,
      requestId: request.requestId,
    });

    if (result.replayed) {
      reply.header('Idempotent-Replay', 'true');
    }
    return reply.status(result.status).send(result.body);
  });

  app.get('/items/:id/events', async (request, reply) => {
    const actor = await requireActor(request);
    const { id } = request.params as { id: string };
    const query = request.query as { cursor?: string; limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 50;

    const result = await listEvents(actor, id, query.cursor, limit);
    return reply.status(200).send(result);
  });
};
