import { z } from 'zod';

export * from './auth';
export * from './sources';
export * from './recipients';

export const APP_NAME = 'Healthcare RSS Reader';

export const DATABASE_STORAGE_LIMIT_BYTES = 1_000_000_000;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
  version: z.string().min(1),
  uptimeSeconds: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  databaseSizeBytes: z.number().int().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
