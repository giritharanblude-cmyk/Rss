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
import type { EmailSender } from '../email/types';
import { HttpError } from '../errors';
import type { UserRecord } from '../repositories/types';
import { parseBody, readUser } from './auth';
import { paginate } from './pagination';

export type MemberRouteOptions = {
  auth: AuthService;
  members: MemberService;
  email: EmailSender;
  jwtSecret: string;
  publicOrigin: string;
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
  const { auth, members, email, jwtSecret, publicOrigin } = options;

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
    try {
      await email.send({
        to: member.email,
        subject: 'Your Healthcare News account details',
        text: [
          `Hello ${member.name},`,
          '',
          'Your Healthcare News account has been created.',
          `Username: ${member.name}`,
          `Email: ${member.email}`,
          `Initial password: ${body.password}`,
          `Sign in: ${new URL('/login', publicOrigin).toString()}`,
          '',
          'Please change your password after signing in.',
        ].join('\n'),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.message ? error.message : 'Unknown email error.';
      throw new HttpError(
        502,
        `Member account created, but the login details email could not be sent: ${reason}`,
      );
    }
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
