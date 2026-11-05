import { z } from 'zod';
import { NEWS_CATEGORIES } from './sources';

export const uuidParamsSchema = z.object({ id: z.string().uuid() });
export const publicTokenParamsSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i),
});

export const recipientListQuerySchema = z.object({ q: z.string().trim().max(120).optional() });

function isValidDateOnly(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidDateOnly, 'Use valid calendar dates.');

export const newsListQuerySchema = z
  .object({
    category: z.enum(NEWS_CATEGORIES).optional(),
    sourceId: z.string().uuid().optional(),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    q: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'The start date must not be after the end date.',
  });

export const deliveryListQuerySchema = z
  .object({
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    channel: z.enum(['email', 'whatsapp']).optional(),
    recipientId: z.string().uuid().optional(),
    status: z.enum(['pending', 'delivered', 'retrying', 'failed']).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'The start date must not be after the end date.',
  });

export const updateNewsImportantBodySchema = z.object({ important: z.boolean() });
export const sendNewsBodySchema = z.object({ channel: z.enum(['email', 'whatsapp']) });
export const emailTestBodySchema = z.object({ to: z.string().trim().email() });

export const smtpSettingsSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(500),
  fromName: z.string().trim().min(1).max(120),
  fromEmail: z.string().trim().email(),
});
