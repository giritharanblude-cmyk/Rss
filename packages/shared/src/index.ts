import { z } from 'zod';

export * from './auth';

export const APP_NAME = 'Healthcare RSS Reader';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
  version: z.string().min(1),
  uptimeSeconds: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
