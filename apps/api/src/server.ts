import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase, createPool, waitForDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { createEmailSender } from './email';
import { ManagedEmailSender, smtpSettingsSchema } from './email/managed';
import { decryptSettings } from './settings/secrets';
import { PostgresSettingsRepository } from './repositories/postgres-settings';
import { PostgresOtpRepository, PostgresUserRepository } from './repositories/postgres';
import { PostgresFeedRepository } from './repositories/postgres-feeds';
import { PostgresFeedTestJobRepository } from './repositories/postgres-feed-jobs';
import { PostgresDashboardRepository } from './repositories/postgres-dashboard';
import { PostgresRecipientRepository } from './repositories/postgres-recipients';
import { PostgresDeliveryRepository } from './repositories/postgres-deliveries';
import { AlertPreviewService } from './alerts/preview';
import { DeliveryService } from './delivery/service';
import { OpenWaSocketAdapter } from './delivery/openwa';
import { startDeliveryWorker, startDigestScheduler } from './delivery/background';
import { ConnectionMonitor, startConnectionMonitor } from './delivery/connections';
import { PostgresConnectionRepository } from './repositories/postgres-connections';
import {
  startFeedScheduler,
  startFeedTestWorker,
  startRetentionJob,
  FeedTestQueue,
} from './rss/background';
import { FeedService } from './rss/service';

async function main(): Promise<void> {
  const config = loadConfig();

  if (!config.DATABASE_URL) {
    process.stderr.write('DATABASE_URL is required to start the API.\n');
    process.exit(1);
  }

  const adminEmail = config.MASTER_EMAIL ?? config.MAIL_FROM_EMAIL;
  if (!adminEmail) {
    process.stderr.write('MASTER_EMAIL or MAIL_FROM_EMAIL is required to send OTP emails.\n');
    process.exit(1);
  }

  const pool = createPool(config.DATABASE_URL);
  await waitForDatabase(pool);
  await runMigrations(pool);

  const db = createDatabase(pool);
  const feeds = new PostgresFeedRepository(db);
  const feedJobs = new PostgresFeedTestJobRepository(db);
  const feedService = new FeedService(feeds, feeds);
  const recipients = new PostgresRecipientRepository(db);
  const deliveries = new PostgresDeliveryRepository(db);
  const whatsapp = new OpenWaSocketAdapter({
    socketUrl: config.OPENWA_SOCKET_URL,
    apiKey: config.OPENWA_API_KEY,
  });
  const alertPreviews = new AlertPreviewService(
    recipients,
    recipients,
    recipients,
    () => new Date(),
  );
  const emailSender = new ManagedEmailSender(createEmailSender(config));
  if (config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASSWORD && config.MAIL_FROM_EMAIL) {
    emailSender.configure({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      user: config.SMTP_USER,
      password: config.SMTP_PASSWORD,
      fromName: config.MAIL_FROM_NAME,
      fromEmail: config.MAIL_FROM_EMAIL,
    });
  }
  const settings = new PostgresSettingsRepository(db);
  const storedSmtp = await settings.get('smtp_transport');
  if (storedSmtp) {
    if (!config.SETTINGS_ENCRYPTION_KEY) {
      throw new Error('SETTINGS_ENCRYPTION_KEY is required to decrypt saved email settings.');
    }
    const raw: unknown = JSON.parse(decryptSettings(storedSmtp, config.SETTINGS_ENCRYPTION_KEY));
    const parsed = smtpSettingsSchema.safeParse(raw);
    if (!parsed.success) throw new Error('Saved email settings are invalid.');
    emailSender.configure(parsed.data);
  }
  const deliveryService = new DeliveryService(
    deliveries,
    recipients,
    recipients,
    alertPreviews,
    emailSender,
    whatsapp,
    {
      now: () => new Date(),
      publicOrigin: config.PUBLIC_APP_ORIGIN,
    },
  );
  const connections = new PostgresConnectionRepository(db);
  const connectionMonitor = new ConnectionMonitor(
    connections,
    emailSender,
    whatsapp,
    () => new Date(),
  );
  const app = buildApp({
    users: new PostgresUserRepository(db),
    otps: new PostgresOtpRepository(db),
    sources: feeds,
    news: feeds,
    dashboard: new PostgresDashboardRepository(db),
    recipients,
    alertRules: recipients,
    alertPreview: recipients,
    deliveries,
    deliveryService,
    connections,
    connectionMonitor,
    whatsapp,
    managedEmail: emailSender,
    settings,
    settingsEncryptionKey: config.SETTINGS_ENCRYPTION_KEY,
    feedJobs,
    email: emailSender,
    adminEmail,
    jwtSecret: config.JWT_SECRET,
    sessionTtlSeconds: config.SESSION_TTL_HOURS * 60 * 60,
    cookieSecure: config.NODE_ENV === 'production',
    originSecret: config.ORIGIN_SECRET,
    originSecretEnforced: config.ORIGIN_SECRET_ENFORCED,
  });

  const address = await app.listen({ port: config.PORT, host: config.HOST });
  process.stdout.write(`API listening on ${address}\n`);
  const stopFeeds = startFeedScheduler(feeds, feedService, {
    log: (message, error) => app.log.error({ err: error }, message),
  });
  const stopFeedTests = startFeedTestWorker(
    new FeedTestQueue(feedService, feedJobs),
    (message, error) => app.log.error({ err: error }, message),
  );
  const stopRetention = startRetentionJob(feeds, {
    newsDays: config.RETENTION_NEWS_DAYS,
    deliveryDays: config.RETENTION_DELIVERIES_DAYS,
    log: (message) => app.log.info(message),
  });
  const stopDeliveries = startDeliveryWorker(deliveryService, (message, error) =>
    app.log.error({ err: error }, message),
  );
  const stopDigests = startDigestScheduler(deliveryService, (message, error) =>
    app.log.error({ err: error }, message),
  );
  const stopIncoming = whatsapp.onIncomingMessage((message) => {
    void deliveryService.handleIncoming(message).catch((error: unknown) => {
      app.log.error({ err: error }, 'Could not process incoming WhatsApp message.');
    });
  });
  const stopConnections = startConnectionMonitor(connectionMonitor, (message, error) =>
    app.log.error({ err: error }, message),
  );
  void whatsapp.connect().then(
    () => {},
    (error: unknown) => app.log.warn({ err: error }, 'OpenWA is not connected.'),
  );

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    process.stdout.write(`Received ${signal}, shutting down.\n`);
    stopFeeds();
    stopFeedTests();
    stopRetention();
    stopDeliveries();
    stopDigests();
    stopIncoming();
    stopConnections();
    await app.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  process.stderr.write(
    `API failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
