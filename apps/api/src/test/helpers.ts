import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createMasterIfNone } from '../auth/seed';
import { hashPassword } from '../auth/passwords';
import { buildApp, type AppDeps } from '../app';
import { MockEmailSender } from '../email';
import { MemoryOtpRepository, MemoryUserRepository } from '../repositories/memory';
import { MemoryFeedRepository, MemoryFeedTestJobRepository } from '../repositories/memory-feeds';
import type { UserRecord } from '../repositories/types';

export const JWT_SECRET = 'test-secret-value-with-at-least-32-chars';

export type Clock = {
  now: () => Date;
  advance: (milliseconds: number) => void;
};

export function createClock(start = '2026-11-03T08:00:00.000Z'): Clock {
  let current = new Date(start);
  return {
    now: () => current,
    advance: (milliseconds) => {
      current = new Date(current.getTime() + milliseconds);
    },
  };
}

export type TestContext = {
  app: FastifyInstance;
  users: MemoryUserRepository;
  otps: MemoryOtpRepository;
  email: MockEmailSender;
  clock: Clock;
  master: UserRecord;
  feeds: MemoryFeedRepository;
  feedJobs: MemoryFeedTestJobRepository;
};

export type TestContextOptions = Pick<
  AppDeps,
  'originSecret' | 'originSecretEnforced' | 'otp' | 'lockout' | 'rateLimits'
>;

export async function createTestContext(options: TestContextOptions = {}): Promise<TestContext> {
  const clock = createClock();
  const users = new MemoryUserRepository(clock.now);
  const otps = new MemoryOtpRepository(clock.now);
  const email = new MockEmailSender();
  const feeds = new MemoryFeedRepository();
  const feedJobs = new MemoryFeedTestJobRepository();

  const app = buildApp({
    users,
    otps,
    sources: feeds,
    news: feeds,
    dashboard: feeds,
    feedJobs,
    email,
    adminEmail: 'admin@example.com',
    jwtSecret: JWT_SECRET,
    sessionTtlSeconds: 3600,
    now: clock.now,
    rateLimits: { login: 1000, verify: 1000, resend: 1000, password: 1000, windowMs: 60_000 },
    ...options,
  });

  const master = await createMasterIfNone(users, {
    name: 'Admin',
    email: 'admin@example.com',
    password: 'master-password-1',
  });

  return { app, users, otps, email, clock, master, feeds, feedJobs };
}

export async function seedMember(
  users: MemoryUserRepository,
  input: { name: string; email: string; password: string },
): Promise<UserRecord> {
  return users.create({
    name: input.name,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    role: 'member',
  });
}

export function latestOtpCode(email: MockEmailSender): string {
  const message = email.sent[email.sent.length - 1];
  if (!message) {
    throw new Error('No email was sent');
  }
  const match = /(\d{6})/.exec(message.text);
  if (!match?.[1]) {
    throw new Error('No code found in the email');
  }
  return match[1];
}

export function sessionCookieFrom(response: LightMyRequestResponse): string {
  const header = response.headers['set-cookie'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) {
    throw new Error('No session cookie was set');
  }
  return raw.split(';')[0] ?? '';
}

export async function loginAndVerify(
  app: FastifyInstance,
  email: MockEmailSender,
  name: string,
  password: string,
): Promise<{ cookie: string; userId: string }> {
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { name, password },
  });
  if (login.statusCode !== 202) {
    throw new Error(`Login failed: ${login.statusCode} ${login.body}`);
  }
  const code = latestOtpCode(email);

  const verify = await app.inject({
    method: 'POST',
    url: '/api/auth/verify-otp',
    payload: { name, code },
  });
  if (verify.statusCode !== 200) {
    throw new Error(`OTP verification failed: ${verify.statusCode} ${verify.body}`);
  }

  const cookie = sessionCookieFrom(verify);
  const body = verify.json() as { user: { id: string } };
  return { cookie, userId: body.user.id };
}
