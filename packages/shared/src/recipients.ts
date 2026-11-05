import { z } from 'zod';
import { NEWS_CATEGORIES } from './sources';

export const TOPIC_CATEGORIES = NEWS_CATEGORIES.filter(
  (category): category is Exclude<(typeof NEWS_CATEGORIES)[number], 'Uncategorized'> =>
    category !== 'Uncategorized',
);
export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];

export const recipientChannelSchema = z.enum(['whatsapp', 'email', 'both']);
export const consentStatusSchema = z.enum(['pending', 'granted', 'revoked']);
export const alertKindSchema = z.enum(['digest', 'instant']);
export const alertChannelSchema = z.enum(['whatsapp', 'email']);

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid E.164 number, such as +919876543210')
  .nullable();

const emailSchema = z.string().trim().email('Enter a valid email address').nullable();

export const recipientInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter the recipient name').max(120),
    whatsappE164: phoneSchema,
    email: emailSchema,
    topics: z.array(z.enum(TOPIC_CATEGORIES)).max(TOPIC_CATEGORIES.length),
    channel: recipientChannelSchema,
  })
  .refine(
    (value) =>
      (value.channel === 'email' && value.email !== null) ||
      (value.channel === 'whatsapp' && value.whatsappE164 !== null) ||
      (value.channel === 'both' && value.email !== null && value.whatsappE164 !== null),
    { message: 'Provide the contact details required by the selected channel.' },
  );
export type RecipientInput = z.infer<typeof recipientInputSchema>;

export const recipientSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  whatsappE164: z.null(),
  hasWhatsapp: z.boolean(),
  email: z.null(),
  hasEmail: z.boolean(),
  topics: z.array(z.enum(TOPIC_CATEGORIES)).max(TOPIC_CATEGORIES.length),
  channel: recipientChannelSchema,
  consentStatus: consentStatusSchema,
  consentAt: z.string().datetime().nullable(),
  consentNote: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type Recipient = z.infer<typeof recipientSchema>;

export const consentUpdateSchema = z
  .object({
    status: consentStatusSchema,
    note: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.status !== 'granted' || Boolean(value.note?.trim()), {
    message: 'A note is required to confirm consent.',
  });

export const publicTopicsUpdateSchema = z.object({
  topics: z.array(z.enum(TOPIC_CATEGORIES)).max(TOPIC_CATEGORIES.length),
});

export const alertRuleInputSchema = z
  .object({
    kind: alertKindSchema,
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7),
    timeLocal: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM time'),
    timezone: z.string().trim().min(1).max(80),
    topics: z.array(z.enum(TOPIC_CATEGORIES)).max(TOPIC_CATEGORIES.length),
    channels: z.array(alertChannelSchema).min(1).max(2),
    active: z.boolean(),
  })
  .refine((value) => new Set(value.daysOfWeek).size === value.daysOfWeek.length, {
    message: 'Choose each weekday only once.',
  });
export type AlertRuleInput = z.infer<typeof alertRuleInputSchema>;

export const alertRuleSchema = alertRuleInputSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type AlertRule = z.infer<typeof alertRuleSchema>;

export const alertPreviewInputSchema = z.object({
  kind: alertKindSchema,
  ruleId: z.string().uuid().optional(),
  rule: alertRuleInputSchema.optional(),
  limit: z.number().int().min(1).max(50).default(10),
});
export type AlertPreviewInput = z.infer<typeof alertPreviewInputSchema>;

export const recipientListResponseSchema = z.object({ recipients: z.array(recipientSchema) });
export const alertRuleListResponseSchema = z.object({ rules: z.array(alertRuleSchema) });
