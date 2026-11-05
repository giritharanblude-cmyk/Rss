import { z } from 'zod';

export const SOURCE_INTERVALS = [30, 60, 360] as const;
export const NEWS_CATEGORIES = [
  'Outbreaks and public health',
  'Drugs and approvals',
  'Clinical trials and research',
  'Digital health and AI',
  'Policy and regulation',
  'Hospitals and industry',
  'Uncategorized',
] as const;

const httpUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), {
    message: 'Enter a valid HTTP or HTTPS URL',
  });

export const sourceInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  website: httpUrl,
  rssUrl: httpUrl,
  mode: z.enum(['all', 'topics']),
  topics: z.array(z.string().trim().min(1).max(100)).max(20),
  region: z.string().trim().max(120).nullable(),
  intervalMinutes: z
    .number()
    .int()
    .refine(
      (value) => (SOURCE_INTERVALS as readonly number[]).includes(value),
      'Choose 30 minutes, 1 hour, or 6 hours',
    ),
  active: z.boolean().default(true),
});
export const sourceUpdateSchema = sourceInputSchema.partial();
export type SourceInput = z.infer<typeof sourceInputSchema>;

export const sourceSchema = sourceInputSchema.extend({
  id: z.string().uuid(),
  lastFetchedAt: z.string().datetime().nullable(),
  lastStatus: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type Source = z.infer<typeof sourceSchema>;

export const sourceListResponseSchema = z.object({ sources: z.array(sourceSchema) });

export const feedTestInputSchema = z.object({ rssUrl: httpUrl });
export const feedTestResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  message: z.string().optional(),
  itemCount: z.number().int().nonnegative().optional(),
  sampleHeadlines: z.array(z.string()).optional(),
});
export type FeedTestResponse = z.infer<typeof feedTestResponseSchema>;
