import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requireActor } from '../../http/auth.js';
import { getStreamHub } from './hub.js';

export const streamRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/stream', async (request, reply) => {
    const actor = await requireActor(request);
    const hub = getStreamHub();

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');

    const registered = hub.register(actor, request, reply);
    if (!registered) {
      reply.raw.writeHead(503, { 'Content-Type': 'application/json' });
      reply.raw.end(
        JSON.stringify({
          error: {
            code: 'sse_capacity',
            message: 'SSE connection limit reached',
            request_id: request.requestId,
          },
        })
      );
      return;
    }

    reply.raw.writeHead(200);
    reply.raw.write(': connected\n\n');
  });
};
