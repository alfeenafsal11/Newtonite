import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ApprovalRequestSchema, ApprovalDecisionSchema } from '../../http/schemas.js';
import { requestApproval, decideApproval } from './service.js';
import { requireActor } from '../../http/auth.js';

export const approvalsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/items/:id/approval/request', async (request, reply) => {
    const actor = await requireActor(request);
    const { id } = request.params as { id: string };
    const body = ApprovalRequestSchema.parse(request.body);
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    const result = await requestApproval(actor, id, body, {
      idempotencyKey,
      requestId: request.requestId,
    });

    if (result.replayed) {
      reply.header('Idempotent-Replay', 'true');
    }
    return reply.status(result.status).send(result.body);
  });

  app.post('/items/:id/approval/approve', async (request, reply) => {
    const actor = await requireActor(request);
    const { id } = request.params as { id: string };
    const body = ApprovalDecisionSchema.parse(request.body);
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    const result = await decideApproval(actor, id, 'approved', body, {
      idempotencyKey,
      requestId: request.requestId,
    });

    if (result.replayed) {
      reply.header('Idempotent-Replay', 'true');
    }
    return reply.status(result.status).send(result.body);
  });

  app.post('/items/:id/approval/reject', async (request, reply) => {
    const actor = await requireActor(request);
    const { id } = request.params as { id: string };
    const body = ApprovalDecisionSchema.parse(request.body);
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    const result = await decideApproval(actor, id, 'rejected', body, {
      idempotencyKey,
      requestId: request.requestId,
    });

    if (result.replayed) {
      reply.header('Idempotent-Replay', 'true');
    }
    return reply.status(result.status).send(result.body);
  });
};
