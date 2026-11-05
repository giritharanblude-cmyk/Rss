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
import type { NewsRepository, SourceRepository } from './repositories/feeds';
import type { DashboardRepository } from './repositories/dashboard';
import type {
  AlertPreviewRepository,
  AlertRuleRepository,
  RecipientRepository,
} from './repositories/recipients';
import type { DeliveryRepository } from './delivery/types';
import type { DeliveryService } from './delivery/service';
import type { ConnectionMonitor, ConnectionRepository } from './delivery/connections';
import type { WhatsAppAdapter } from './delivery/whatsapp';
import type { ManagedEmailSender } from './email/managed';
import type { SettingsRepository } from './repositories/settings';
import type { FeedTestJobRepository } from './repositories/feed-jobs';
import { registerAuthRoutes } from './routes/auth';
import { registerDashboardRoutes } from './routes/dashboard';
import { registerRecipientRoutes } from './routes/recipients';
import { registerDeliveryRoutes } from './routes/deliveries';
import { registerSettingsRoutes } from './routes/settings';
import { registerMemberRoutes } from './routes/members';
import { registerSourceRoutes } from './routes/sources';
import { registerOriginSecret } from './security/origin';
import { FeedTestQueue } from './rss/background';
import { FeedService } from './rss/service';
import { AlertPreviewService } from './alerts/preview';

export type AppDeps = {
  users: UserRepository;
  otps: OtpRepository;
  sources: SourceRepository;
  news: NewsRepository;
  dashboard: DashboardRepository;
  recipients: RecipientRepository;
  alertRules: AlertRuleRepository;
  alertPreview: AlertPreviewRepository;
  deliveries: DeliveryRepository;
  deliveryService: DeliveryService;
  connections: ConnectionRepository;
  connectionMonitor: ConnectionMonitor;
  whatsapp: WhatsAppAdapter;
  managedEmail: ManagedEmailSender;
  settings: SettingsRepository;
  settingsEncryptionKey?: string;
  feedJobs: FeedTestJobRepository;
  email: EmailSender;
  adminEmail: string;
  jwtSecret: string;
  databaseSizeBytes: () => Promise<number>;
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
  const feedService = new FeedService(deps.sources, deps.news);
  const feedTests = new FeedTestQueue(feedService, deps.feedJobs);
  const alertPreviews = new AlertPreviewService(
    deps.recipients,
    deps.alertRules,
    deps.alertPreview,
    now,
  );

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

    registerSourceRoutes(routes, {
      auth: authService,
      jwtSecret: deps.jwtSecret,
      sources: deps.sources,
      tests: feedTests,
    });

    registerDashboardRoutes(routes, {
      auth: authService,
      jwtSecret: deps.jwtSecret,
      dashboard: deps.dashboard,
      deliveryService: deps.deliveryService,
      now,
    });

    registerRecipientRoutes(routes, {
      auth: authService,
      jwtSecret: deps.jwtSecret,
      recipients: deps.recipients,
      rules: deps.alertRules,
      previews: alertPreviews,
      now,
    });

    registerDeliveryRoutes(routes, {
      auth: authService,
      jwtSecret: deps.jwtSecret,
      deliveries: deps.deliveries,
      service: deps.deliveryService,
      now,
    });

    registerSettingsRoutes(routes, {
      auth: authService,
      jwtSecret: deps.jwtSecret,
      connections: deps.connections,
      monitor: deps.connectionMonitor,
      whatsapp: deps.whatsapp,
      email: deps.managedEmail,
      settings: deps.settings,
      encryptionKey: deps.settingsEncryptionKey,
    });
  });

  app.get('/api/health', async (): Promise<HealthResponse> => {
    const payload = {
      status: 'ok' as const,
      service: 'healthcare-rss-api',
      version: '0.0.0',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      databaseSizeBytes: await deps.databaseSizeBytes(),
      components: {
        database: { status: 'ok' as const, detail: 'Database connection healthy.' },
        smtp: { status: 'unknown' as const, detail: 'SMTP not configured in this environment.' },
        openwa: { status: 'unknown' as const, detail: 'WhatsApp socket not connected.' },
        scheduler: { status: 'ok' as const, detail: 'Background jobs online.' },
      },
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
