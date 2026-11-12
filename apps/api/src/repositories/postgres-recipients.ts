import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { TOPIC_CATEGORIES, type AlertRuleInput, type RecipientInput } from '@healthcare/shared';
import type { Database } from '../db/client';
import { alertRules, deliveries, newsItems, recipients, sources } from '../db/schema';
import {
  decryptRecipientContact,
  encryptRecipientContact,
  validateSettingsEncryptionKey,
} from '../settings/secrets';
import type { NewsCategory } from '../rss/categories';
import type {
  AlertPreviewRepository,
  AlertRuleRecord,
  AlertRuleRepository,
  PreviewNewsRecord,
  RecipientRecord,
  RecipientRepository,
} from './recipients';

type RecipientRow = typeof recipients.$inferSelect;
type AlertRuleRow = typeof alertRules.$inferSelect;

function toRecipient(row: RecipientRow, encryptionKey: string): RecipientRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    whatsappE164: row.whatsappE164
      ? decryptRecipientContact(row.whatsappE164, encryptionKey)
      : null,
    email: row.email ? decryptRecipientContact(row.email, encryptionKey) : null,
    topics: TOPIC_CATEGORIES.filter((topic) => row.topics.includes(topic)),
    channel: row.channel,
    unsubscribeToken: row.unsubscribeToken,
    consentStatus: row.consentStatus,
    consentAt: row.consentAt,
    consentNote: row.consentNote,
    createdAt: row.createdAt,
  };
}

function toAlertRule(row: AlertRuleRow): AlertRuleRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    kind: row.kind,
    daysOfWeek: row.daysOfWeek,
    timeLocal: row.timeLocal,
    timezone: row.timezone,
    topics: TOPIC_CATEGORIES.filter((topic) => row.topics.includes(topic)),
    channels: row.channels.filter(
      (channel): channel is 'email' | 'whatsapp' => channel === 'email' || channel === 'whatsapp',
    ),
    active: row.active,
    createdAt: row.createdAt,
  };
}

export class PostgresRecipientRepository
  implements RecipientRepository, AlertRuleRepository, AlertPreviewRepository
{
  constructor(
    private readonly db: Database,
    private readonly encryptionKey: string,
  ) {
    validateSettingsEncryptionKey(encryptionKey);
  }

  async listRecipients(query?: string, ownerUserId?: string): Promise<RecipientRecord[]> {
    const rows = await this.db
      .select()
      .from(recipients)
      .where(ownerUserId ? eq(recipients.ownerUserId, ownerUserId) : undefined)
      .orderBy(recipients.name);
    const records = rows.map((row) => toRecipient(row, this.encryptionKey));
    const needle = query?.trim().toLocaleLowerCase();
    return needle
      ? records.filter(
          (recipient) =>
            recipient.name.toLocaleLowerCase().includes(needle) ||
            recipient.email?.toLocaleLowerCase().includes(needle) ||
            recipient.whatsappE164?.toLocaleLowerCase().includes(needle),
        )
      : records;
  }

  async findRecipient(id: string, ownerUserId?: string): Promise<RecipientRecord | null> {
    const rows = await this.db
      .select()
      .from(recipients)
      .where(
        and(eq(recipients.id, id), ...(ownerUserId ? [eq(recipients.ownerUserId, ownerUserId)] : [])),
      )
      .limit(1);
    return rows[0] ? toRecipient(rows[0], this.encryptionKey) : null;
  }

  async findByUnsubscribeToken(token: string): Promise<RecipientRecord | null> {
    const rows = await this.db
      .select()
      .from(recipients)
      .where(eq(recipients.unsubscribeToken, token))
      .limit(1);
    return rows[0] ? toRecipient(rows[0], this.encryptionKey) : null;
  }

  async findByWhatsappE164(phone: string): Promise<RecipientRecord | null> {
    const rows = await this.db.select().from(recipients).where(isNotNull(recipients.whatsappE164));
    const match = rows.find(
      (row) =>
        row.whatsappE164 !== null &&
        decryptRecipientContact(row.whatsappE164, this.encryptionKey) === phone,
    );
    return match ? toRecipient(match, this.encryptionKey) : null;
  }

  async createRecipient(
    input: RecipientInput,
    unsubscribeToken: string,
    ownerUserId: string,
  ): Promise<RecipientRecord> {
    const rows = await this.db
      .insert(recipients)
      .values({
        ...input,
        ownerUserId,
        whatsappE164: input.whatsappE164
          ? encryptRecipientContact(input.whatsappE164, this.encryptionKey)
          : null,
        email: input.email ? encryptRecipientContact(input.email, this.encryptionKey) : null,
        topics: [...input.topics],
        unsubscribeToken,
        consentStatus: 'pending',
        consentAt: null,
        consentNote: null,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Recipient was not created');
    return toRecipient(row, this.encryptionKey);
  }

  async updateRecipient(
    id: string,
    input: RecipientInput,
    ownerUserId?: string,
  ): Promise<RecipientRecord | null> {
    const rows = await this.db
      .update(recipients)
      .set({
        ...input,
        whatsappE164: input.whatsappE164
          ? encryptRecipientContact(input.whatsappE164, this.encryptionKey)
          : null,
        email: input.email ? encryptRecipientContact(input.email, this.encryptionKey) : null,
        topics: [...input.topics],
      })
      .where(
        and(eq(recipients.id, id), ...(ownerUserId ? [eq(recipients.ownerUserId, ownerUserId)] : [])),
      )
      .returning();
    return rows[0] ? toRecipient(rows[0], this.encryptionKey) : null;
  }

  async setConsent(
    id: string,
    status: RecipientRecord['consentStatus'],
    at: Date,
    note: string | null,
    ownerUserId?: string,
  ): Promise<RecipientRecord | null> {
    const rows = await this.db
      .update(recipients)
      .set({
        consentStatus: status,
        consentAt: status === 'pending' ? null : at,
        consentNote: status === 'pending' ? null : note,
      })
      .where(
        and(eq(recipients.id, id), ...(ownerUserId ? [eq(recipients.ownerUserId, ownerUserId)] : [])),
      )
      .returning();
    return rows[0] ? toRecipient(rows[0], this.encryptionKey) : null;
  }

  async deleteRecipient(id: string, ownerUserId?: string): Promise<boolean> {
    const rows = await this.db
      .delete(recipients)
      .where(
        and(eq(recipients.id, id), ...(ownerUserId ? [eq(recipients.ownerUserId, ownerUserId)] : [])),
      )
      .returning({ id: recipients.id });
    return rows.length === 1;
  }

  async updateTopicsByToken(
    token: string,
    topics: RecipientInput['topics'],
  ): Promise<RecipientRecord | null> {
    const rows = await this.db
      .update(recipients)
      .set({ topics })
      .where(eq(recipients.unsubscribeToken, token))
      .returning();
    return rows[0] ? toRecipient(rows[0], this.encryptionKey) : null;
  }

  async listAlertRules(ownerUserId?: string): Promise<AlertRuleRecord[]> {
    const rows = await this.db
      .select()
      .from(alertRules)
      .where(ownerUserId ? eq(alertRules.ownerUserId, ownerUserId) : undefined)
      .orderBy(alertRules.createdAt);
    return rows.map(toAlertRule);
  }

  async createAlertRule(input: AlertRuleInput, ownerUserId: string): Promise<AlertRuleRecord> {
    const rows = await this.db
      .insert(alertRules)
      .values({
        ...input,
        ownerUserId,
        daysOfWeek: [...input.daysOfWeek],
        topics: [...input.topics],
        channels: [...input.channels],
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Alert rule was not created');
    return toAlertRule(row);
  }

  async updateAlertRule(
    id: string,
    input: AlertRuleInput,
    ownerUserId?: string,
  ): Promise<AlertRuleRecord | null> {
    const rows = await this.db
      .update(alertRules)
      .set({
        ...input,
        daysOfWeek: [...input.daysOfWeek],
        topics: [...input.topics],
        channels: [...input.channels],
      })
      .where(
        and(eq(alertRules.id, id), ...(ownerUserId ? [eq(alertRules.ownerUserId, ownerUserId)] : [])),
      )
      .returning();
    return rows[0] ? toAlertRule(rows[0]) : null;
  }

  async deleteAlertRule(id: string, ownerUserId?: string): Promise<boolean> {
    const rows = await this.db
      .delete(alertRules)
      .where(
        and(eq(alertRules.id, id), ...(ownerUserId ? [eq(alertRules.ownerUserId, ownerUserId)] : [])),
      )
      .returning({ id: alertRules.id });
    return rows.length === 1;
  }

  async lastDigestAt(recipientId: string): Promise<Date | null> {
    const rows = await this.db
      .select({ at: sql<Date | null>`max(${deliveries.sentAt})` })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.recipientId, recipientId),
          eq(deliveries.kind, 'digest'),
          eq(deliveries.status, 'delivered'),
        ),
      );
    return rows[0]?.at ?? null;
  }

  async listPreviewNews(options: {
    ownerUserId: string;
    since: Date | null;
    importantOnly: boolean;
    categories: NewsCategory[];
    limit: number;
  }): Promise<PreviewNewsRecord[]> {
    if (!options.categories.length) return [];
    const conditions = [
      isNull(newsItems.duplicateOf),
      inArray(newsItems.category, options.categories),
      ...(options.importantOnly ? [eq(newsItems.important, true)] : []),
      ...(options.since
        ? [
            or(
              gte(newsItems.publishedAt, options.since),
              and(isNull(newsItems.publishedAt), gte(newsItems.fetchedAt, options.since)),
            )!,
          ]
        : []),
    ];
    const rows = await this.db
      .select({ item: newsItems, sourceName: sources.name })
      .from(newsItems)
      .innerJoin(sources, eq(newsItems.sourceId, sources.id))
      .where(and(...conditions, eq(sources.ownerUserId, options.ownerUserId)))
      .orderBy(
        sql`coalesce(${newsItems.publishedAt}, ${newsItems.fetchedAt}) desc`,
        desc(newsItems.id),
      )
      .limit(options.limit);
    return rows.map(({ item, sourceName }) => ({
      id: item.id,
      headline: item.headline,
      summary: item.summary,
      link: item.link,
      category: item.category as NewsCategory,
      sourceName,
      publishedAt: item.publishedAt,
      fetchedAt: item.fetchedAt,
      important: item.important,
    }));
  }
}

export function newRecipientToken(): string {
  return randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
}
