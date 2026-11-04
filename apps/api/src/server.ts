import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase, createPool, waitForDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { createEmailSender } from './email';
import { PostgresOtpRepository, PostgresUserRepository } from './repositories/postgres';
import { PostgresFeedRepository } from './repositories/postgres-feeds';
import { PostgresFeedTestJobRepository } from './repositories/postgres-feed-jobs';
import { PostgresDashboardRepository } from './repositories/postgres-dashboard';
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
  const app = buildApp({
    users: new PostgresUserRepository(db),
    otps: new PostgresOtpRepository(db),
    sources: feeds,
    news: feeds,
    dashboard: new PostgresDashboardRepository(db),
    feedJobs,
    email: createEmailSender(config),
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
