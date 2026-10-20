import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import crypto from 'node:crypto';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

const requestContextPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook('onRequest', async (request, reply) => {
    const incomingId = request.headers['x-request-id'];
    const requestId =
      typeof incomingId === 'string' && incomingId.length > 0
        ? incomingId
        : crypto.randomUUID();

    request.requestId = requestId;
    reply.header('X-Request-Id', requestId);
  });
};

export const registerRequestContext = fp(requestContextPlugin);
