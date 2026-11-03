import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { healthResponseSchema, type HealthResponse } from '@healthcare/shared';
import { MemberService } from './auth/members';
import { OtpService } from './auth/otp';
import { AuthService } from './auth/service';
import type { EmailSender } from './email';
import { HttpError } from './errors';
import type { OtpRepository, UserRepository } from './repositories/types';
import { registerAuthRoutes } from './routes/auth';
import { registerMemberRoutes } from './routes/members';
import { registerOriginSecret } from './security/origin';

export type AppDeps = {
  users: UserRepository;
  otps: OtpRepository;
  email: EmailSender;
  adminEmail: string;
  jwtSecret: string;
  sessionTtlSeconds?: number;
  cookieSecure?: boolean;
  originSecret?: string;
  originSecretEnforced?: boolean;
  now?: () => Date;
  otp?: {
    ttlSeconds?: number;
    cooldownSeconds?: number;
    maxAttempts?: number;
  };
  lockout?: {
    threshold?: number;
    minutes?: number;
  };
  rateLimits?: {
    login?: number;
    verify?: number;
    resend?: number;
    password?: number;
    windowMs?: number;
  };
};

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  const sessionTtlSeconds = deps.sessionTtlSeconds ?? 8 * 60 * 60;
  const now = deps.now ?? (() => new Date());

  void app.register(cookie);
  void app.register(rateLimit, { global: false });

  registerOriginSecret(app, {
    secret: deps.originSecret,
    enforced: deps.originSecretEnforced ?? false,
  });

  const otpService = new OtpService({
    otps: deps.otps,
    email: deps.email,
    adminEmail: deps.adminEmail,
    now,
    ttlSeconds: deps.otp?.ttlSeconds,
    cooldownSeconds: deps.otp?.cooldownSeconds,
    maxAttempts: deps.otp?.maxAttempts,
  });

  const authService = new AuthService({
    users: deps.users,
    otp: otpService,
    jwtSecret: deps.jwtSecret,
    sessionTtlSeconds,
    now,
    lockoutThreshold: deps.lockout?.threshold,
    lockoutMinutes: deps.lockout?.minutes,
  });

  const memberService = new MemberService(deps.users);

  void app.register(async (routes) => {
    registerAuthRoutes(routes, {
      auth: authService,
      jwtSecret: deps.jwtSecret,
      sessionTtlSeconds,
      cookieSecure: deps.cookieSecure ?? false,
      rateLimits: {
        login: deps.rateLimits?.login ?? 10,
        verify: deps.rateLimits?.verify ?? 20,
        resend: deps.rateLimits?.resend ?? 5,
        password: deps.rateLimits?.password ?? 5,
        windowMs: deps.rateLimits?.windowMs ?? 60_000,
      },
    });

    registerMemberRoutes(routes, {
      auth: authService,
      members: memberService,
      jwtSecret: deps.jwtSecret,
    });
  });

  app.get('/api/health', async (): Promise<HealthResponse> => {
    const payload = {
      status: 'ok' as const,
      service: 'healthcare-rss-api',
      version: '0.0.0',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };

    return healthResponseSchema.parse(payload);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    const failure = error as { statusCode?: number; message?: string };
    const statusCode = typeof failure.statusCode === 'number' ? failure.statusCode : 500;
    if (statusCode === 429) {
      return reply.code(429).send({ error: 'Too many requests. Try again shortly.' });
    }
    if (statusCode === 400) {
      return reply.code(400).send({ error: 'Check the request and try again.' });
    }
    if (statusCode < 500) {
      return reply.code(statusCode).send({ error: failure.message ?? 'Request rejected.' });
    }
    return reply.code(500).send({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
