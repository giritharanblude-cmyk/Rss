import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),
  TIMEZONE: z.string().default('Asia/Kolkata'),
  PUBLIC_APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  SETTINGS_ENCRYPTION_KEY: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  ORIGIN_SECRET: z.string().min(16).optional(),
  ORIGIN_SECRET_ENFORCED: booleanString.default(false),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 30)
    .default(8),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: booleanString.default(true),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  OPENWA_SOCKET_URL: z.string().url().optional(),
  OPENWA_API_KEY: z.string().min(1).optional(),
  MAIL_FROM_NAME: z.string().default('Healthcare News Desk'),
  MAIL_FROM_EMAIL: z.string().email().optional(),
  MASTER_NAME: z.string().min(1).optional(),
  MASTER_EMAIL: z.string().email().optional(),
  MASTER_PASSWORD: z.string().min(8).optional(),
  RETENTION_NEWS_DAYS: z.coerce.number().int().positive().default(90),
  RETENTION_DELIVERIES_DAYS: z.coerce.number().int().positive().default(180),
  DASHBOARD_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  DASHBOARD_POLL_INTERVAL_HIDDEN_MS: z.coerce.number().int().positive().default(10000),
});

export type AppConfig = z.infer<typeof envSchema> & {
  smtpConfigured: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const smtpConfigured = Boolean(
    parsed.SMTP_HOST && parsed.SMTP_USER && parsed.SMTP_PASSWORD && parsed.MAIL_FROM_EMAIL,
  );

  if (parsed.NODE_ENV === 'production') {
    if (!parsed.DATABASE_URL) {
      throw new Error('DATABASE_URL is required in production');
    }
    if (!parsed.ORIGIN_SECRET_ENFORCED) {
      throw new Error('ORIGIN_SECRET_ENFORCED must be true in production');
    }
    if (!parsed.ORIGIN_SECRET) {
      throw new Error('ORIGIN_SECRET is required in production');
    }
    if (parsed.PUBLIC_APP_ORIGIN === 'http://localhost:5173') {
      throw new Error('PUBLIC_APP_ORIGIN must be set in production');
    }
  }

  return { ...parsed, smtpConfigured };
}
