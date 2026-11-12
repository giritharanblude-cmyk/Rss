import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createMasterIfNone } from '../auth/seed';
import { hashPassword } from '../auth/passwords';
import { buildApp, type AppDeps } from '../app';
import { loadConfig } from '../config';
import { MockEmailSender } from '../email';
import { ManagedEmailSender } from '../email/managed';
import { AlertPreviewService } from '../alerts/preview';
import { DeliveryService } from '../delivery/service';
import { MockWhatsAppAdapter } from '../delivery/whatsapp';
import { ConnectionMonitor } from '../delivery/connections';
import { MemoryOtpRepository, MemoryUserRepository } from '../repositories/memory';
import { MemoryFeedRepository, MemoryFeedTestJobRepository } from '../repositories/memory-feeds';
import { MemoryRecipientRepository } from '../repositories/memory-recipients';
import { MemoryDeliveryRepository } from '../repositories/memory-deliveries';
import { MemoryConnectionRepository } from '../repositories/memory-connections';
import { MemorySettingsRepository } from '../repositories/memory-settings';
import type { SettingsRepository } from '../repositories/settings';
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
  managedEmail: ManagedEmailSender;
  clock: Clock;
  master: UserRecord;
  feeds: MemoryFeedRepository;
  feedJobs: MemoryFeedTestJobRepository;
  recipients: MemoryRecipientRepository;
  deliveries: MemoryDeliveryRepository;
  whatsapp: MockWhatsAppAdapter;
  deliveryService: DeliveryService;
  connections: MemoryConnectionRepository;
  connectionMonitor: ConnectionMonitor;
  settings: SettingsRepository;
};

export type TestContextOptions = Pick<
  AppDeps,
  'originSecret' | 'originSecretEnforced' | 'otp' | 'lockout' | 'rateLimits' | 'publicOrigin'
> &
  Partial<Pick<AppDeps, 'databaseSizeBytes'>> & {
    nodeEnv?: 'test' | 'production';
    settings?: SettingsRepository;
  };

export async function createTestContext(options: TestContextOptions = {}): Promise<TestContext> {
  const { nodeEnv = 'test', databaseSizeBytes = async () => 0, ...testOptions } = options;
  const config = loadConfig({
    NODE_ENV: nodeEnv,
    JWT_SECRET,
    SETTINGS_ENCRYPTION_KEY: '9f'.repeat(32),
    ...(nodeEnv === 'production'
      ? {
          DATABASE_URL: 'postgresql://db.example.test/app',
          ORIGIN_SECRET: testOptions.originSecret,
          ORIGIN_SECRET_ENFORCED: testOptions.originSecretEnforced ? 'true' : 'false',
          PUBLIC_APP_ORIGIN: testOptions.publicOrigin ?? 'https://news.example.test',
        }
      : {}),
  });
  const clock = createClock();
  const users = new MemoryUserRepository(clock.now);
  const master = await createMasterIfNone(users, {
    name: 'Admin',
    email: 'admin@example.com',
    password: 'master-password-1',
  });
  const otps = new MemoryOtpRepository(clock.now);
  const email = new MockEmailSender();
  const managedEmail = new ManagedEmailSender(email);
  const feeds = new MemoryFeedRepository(master.id);
  const feedJobs = new MemoryFeedTestJobRepository();
  const recipients = new MemoryRecipientRepository(feeds, master.id);
  const deliveries = new MemoryDeliveryRepository(recipients, feeds);
  const whatsapp = new MockWhatsAppAdapter();
  const connections = new MemoryConnectionRepository();
  const settings = testOptions.settings ?? new MemorySettingsRepository();
  const connectionMonitor = new ConnectionMonitor(connections, managedEmail, whatsapp, clock.now);
  const previews = new AlertPreviewService(recipients, recipients, recipients, clock.now);
  const deliveryService = new DeliveryService(
    deliveries,
    recipients,
    recipients,
    previews,
    managedEmail,
    whatsapp,
    {
      now: clock.now,
      publicOrigin: 'https://news.example.test',
      throttleMs: () => 0,
    },
  );

  const app = buildApp({
    users,
    otps,
    sources: feeds,
    news: feeds,
    dashboard: feeds,
    recipients,
    alertRules: recipients,
    alertPreview: recipients,
    deliveries,
    deliveryService,
    connectionMonitor,
    whatsapp,
    managedEmail,
    settings,
    settingsEncryptionKey: config.SETTINGS_ENCRYPTION_KEY,
    feedJobs,
    email,
    adminEmail: 'admin@example.com',
    jwtSecret: config.JWT_SECRET,
    databaseSizeBytes,
    sessionTtlSeconds: 3600,
    cookieSecure: config.NODE_ENV === 'production',
    now: clock.now,
    rateLimits: { login: 1000, verify: 1000, resend: 1000, password: 1000, windowMs: 60_000 },
    ...testOptions,
  });

  return {
    app,
    users,
    otps,
    email,
    managedEmail,
    clock,
    master,
    feeds,
    feedJobs,
    recipients,
    deliveries,
    whatsapp,
    deliveryService,
    connections,
    connectionMonitor,
    settings,
  };
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
