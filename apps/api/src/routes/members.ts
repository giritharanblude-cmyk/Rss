import type { FastifyInstance } from 'fastify';
import {
  createMemberBodySchema,
  listPaginationQuerySchema,
  type Member,
  resetMemberPasswordBodySchema,
  updateMemberBodySchema,
  uuidParamsSchema,
} from '@healthcare/shared';
import type { MemberService } from '../auth/members';
import type { AuthService } from '../auth/service';
import { HttpError } from '../errors';
import type { UserRecord } from '../repositories/types';
import { parseBody, readUser } from './auth';
import { paginate } from './pagination';

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
    const query = listPaginationQuerySchema.safeParse(request.query);
    if (!query.success) throw new HttpError(400, 'Check the member page and page size.');
    const list = await members.list(actor);
    const page = paginate(list, query.data.page, query.data.pageSize);
    return reply.send({
      members: page.items.map(toMember),
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
    });
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
    const params = uuidParamsSchema.safeParse(request.params);
    if (!params.success) throw new HttpError(400, 'Check the member id and try again.');
    const member = await members.setDisabled(actor, params.data.id, body.disabled);
    return reply.send({ member: toMember(member) });
  });

  app.post('/api/members/:id/reset-password', async (request, reply) => {
    const actor = await readUser(request, auth, jwtSecret);
    const body = parseBody(resetMemberPasswordBodySchema, request.body);
    const params = uuidParamsSchema.safeParse(request.params);
    if (!params.success) throw new HttpError(400, 'Check the member id and try again.');
    await members.resetPassword(actor, params.data.id, body);
    return reply.code(204).send();
  });
}
