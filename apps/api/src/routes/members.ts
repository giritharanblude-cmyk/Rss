import type { FastifyInstance } from 'fastify';
import { createMemberBodySchema, type Member, updateMemberBodySchema } from '@healthcare/shared';
import type { MemberService } from '../auth/members';
import type { AuthService } from '../auth/service';
import type { UserRecord } from '../repositories/types';
import { parseBody, readUser } from './auth';

export type MemberRouteOptions = {
  auth: AuthService;
  members: MemberService;
  jwtSecret: string;
};

export function toMember(user: UserRecord): Member {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    email: user.email,
    disabled: user.disabled,
    createdAt: user.createdAt.toISOString(),
  };
}

export function registerMemberRoutes(app: FastifyInstance, options: MemberRouteOptions): void {
  const { auth, members, jwtSecret } = options;

  app.get('/api/members', async (request, reply) => {
    const actor = await readUser(request, auth, jwtSecret);
    const list = await members.list(actor);
    return reply.send({ members: list.map(toMember) });
  });

  app.post('/api/members', async (request, reply) => {
    const actor = await readUser(request, auth, jwtSecret);
    const body = parseBody(createMemberBodySchema, request.body);
    const member = await members.create(actor, body);
    return reply.code(201).send({ member: toMember(member) });
  });

  app.patch('/api/members/:id', async (request, reply) => {
    const actor = await readUser(request, auth, jwtSecret);
    const body = parseBody(updateMemberBodySchema, request.body);
    const params = request.params as { id?: string };
    if (!params.id) {
      throw new Error('Member id is missing');
    }
    const member = await members.setDisabled(actor, params.id, body.disabled);
    return reply.send({ member: toMember(member) });
  });
}
