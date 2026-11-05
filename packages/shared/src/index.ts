import { z } from 'zod';

export * from './auth';
export * from './sources';
export * from './recipients';
export * from './requests';

export const APP_NAME = 'Healthcare RSS Reader';

export const DATABASE_STORAGE_LIMIT_BYTES = 1_000_000_000;

export const healthComponentSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error', 'unknown']),
  detail: z.string().max(120).optional(),
});
export type HealthComponent = z.infer<typeof healthComponentSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
  version: z.string().min(1),
  uptimeSeconds: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  databaseSizeBytes: z.number().int().nonnegative(),
  components: z.object({
    database: healthComponentSchema,
    smtp: healthComponentSchema,
    openwa: healthComponentSchema,
    scheduler: healthComponentSchema,
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
