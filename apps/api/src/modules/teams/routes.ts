import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { MemberRoleBodySchema } from '../../http/schemas.js';
import { listTeamsFor, listMembers, setMemberRole, removeMember } from './service.js';
import { requireActor } from '../../http/auth.js';

export const teamsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/teams', async (request, reply) => {
    const actor = await requireActor(request);
    const result = await listTeamsFor(actor);
    return reply.status(200).send(result);
  });

  app.get('/teams/:teamId/members', async (request, reply) => {
    const actor = await requireActor(request);
    const { teamId } = request.params as { teamId: string };
    const result = await listMembers(actor, teamId);
    return reply.status(200).send(result);
  });

  app.put('/teams/:teamId/members/:userId', async (request, reply) => {
    const actor = await requireActor(request);
    const { teamId, userId } = request.params as { teamId: string; userId: string };
    const body = MemberRoleBodySchema.parse(request.body);

    const result = await setMemberRole(actor, teamId, userId, body.role);
    return reply.status(200).send(result);
  });

  app.delete('/teams/:teamId/members/:userId', async (request, reply) => {
    const actor = await requireActor(request);
    const { teamId, userId } = request.params as { teamId: string; userId: string };

    const result = await removeMember(actor, teamId, userId);
    return reply.status(200).send(result);
  });
};
