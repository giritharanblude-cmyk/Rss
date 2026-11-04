import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  changePasswordBodySchema,
  loginBodySchema,
  type PublicUser,
  resendOtpBodySchema,
  verifyOtpBodySchema,
} from '@healthcare/shared';
import type { AuthService } from '../auth/service';
import { HttpError, UnauthorizedError } from '../errors';
import type { UserRecord } from '../repositories/types';
import { verifySession } from '../auth/tokens';

export type AuthRouteOptions = {
  auth: AuthService;
  jwtSecret: string;
  sessionTtlSeconds: number;
  cookieSecure: boolean;
  rateLimits: {
    login: number;
    verify: number;
    resend: number;
    password: number;
    windowMs: number;
  };
};

export const SESSION_COOKIE = 'session';

export function toPublicUser(user: UserRecord): PublicUser {
  return { id: user.id, name: user.name, role: user.role };
}

export function parseBody<T>(
  schema: {
    safeParse: (
      value: unknown,
    ) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } };
  },
  body: unknown,
): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0]?.message ?? 'Check the form and try again.');
  }
  return result.data;
}

export async function readUser(
  request: FastifyRequest,
  auth: AuthService,
  jwtSecret: string,
): Promise<UserRecord> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) {
    throw new UnauthorizedError();
  }
  const session = await verifySession(token, jwtSecret);
  return auth.authenticate(session);
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const { auth, jwtSecret, sessionTtlSeconds, cookieSecure, rateLimits } = options;

  const cookieOptions = {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: sessionTtlSeconds,
  };

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: rateLimits.login, timeWindow: rateLimits.windowMs } } },
    async (request, reply) => {
      const body = parseBody(loginBodySchema, request.body);
      await auth.login(body.name, body.password);
      return reply
        .code(202)
        .send({ status: 'otp_sent', message: 'Check the admin email for the 6-digit code.' });
    },
  );

  app.post(
    '/api/auth/verify-otp',
    { config: { rateLimit: { max: rateLimits.verify, timeWindow: rateLimits.windowMs } } },
    async (request, reply) => {
      const body = parseBody(verifyOtpBodySchema, request.body);
      const { user, token } = await auth.verifyLogin(body.name, body.code);
      reply.setCookie(SESSION_COOKIE, token, cookieOptions);
      return reply.send({ user: toPublicUser(user) });
    },
  );

  app.post(
    '/api/auth/resend-otp',
    { config: { rateLimit: { max: rateLimits.resend, timeWindow: rateLimits.windowMs } } },
    async (request, reply) => {
      const body = parseBody(resendOtpBodySchema, request.body);
      await auth.resendLoginCode(body.name);
      return reply
        .code(202)
        .send({ status: 'otp_sent', message: 'Check the admin email for the 6-digit code.' });
    },
  );

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (request, reply) => {
    const user = await readUser(request, auth, jwtSecret);
    return reply.send({ user: toPublicUser(user) });
  });

  app.post(
    '/api/auth/password-otp',
    { config: { rateLimit: { max: rateLimits.password, timeWindow: rateLimits.windowMs } } },
    async (request, reply) => {
      const user = await readUser(request, auth, jwtSecret);
      await auth.requestPasswordCode(user.id);
      return reply
        .code(202)
        .send({ status: 'otp_sent', message: 'Check the admin email for the 6-digit code.' });
    },
  );

  app.post(
    '/api/auth/change-password',
    { config: { rateLimit: { max: rateLimits.password, timeWindow: rateLimits.windowMs } } },
    async (request, reply) => {
      const user = await readUser(request, auth, jwtSecret);
      const body = parseBody(changePasswordBodySchema, request.body);
      await auth.changePassword(user.id, body.currentPassword, body.code, body.newPassword);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.code(204).send();
    },
  );
}

declare module 'fastify' {
  interface FastifyInstance {
    jwtSecret: string;
  }
}
