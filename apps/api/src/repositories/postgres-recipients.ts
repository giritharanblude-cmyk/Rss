import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { TOPIC_CATEGORIES, type AlertRuleInput, type RecipientInput } from '@healthcare/shared';
import type { Database } from '../db/client';
import { alertRules, deliveries, newsItems, recipients, sources } from '../db/schema';
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

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function toRecipient(row: RecipientRow): RecipientRecord {
  return {
    id: row.id,
    name: row.name,
    whatsappE164: row.whatsappE164,
    email: row.email,
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
  constructor(private readonly db: Database) {}

  async listRecipients(query?: string): Promise<RecipientRecord[]> {
    const pattern = query ? `%${escapeLike(query)}%` : undefined;
    const where = pattern
      ? or(ilike(recipients.name, pattern), ilike(recipients.email, pattern))
      : undefined;
    const rows = await this.db.select().from(recipients).where(where).orderBy(recipients.name);
    return rows.map(toRecipient);
  }

  async findRecipient(id: string): Promise<RecipientRecord | null> {
    const rows = await this.db.select().from(recipients).where(eq(recipients.id, id)).limit(1);
    return rows[0] ? toRecipient(rows[0]) : null;
  }

  async findByUnsubscribeToken(token: string): Promise<RecipientRecord | null> {
    const rows = await this.db
      .select()
      .from(recipients)
      .where(eq(recipients.unsubscribeToken, token))
      .limit(1);
    return rows[0] ? toRecipient(rows[0]) : null;
  }

  async createRecipient(input: RecipientInput, unsubscribeToken: string): Promise<RecipientRecord> {
    const rows = await this.db
      .insert(recipients)
      .values({
        ...input,
        topics: [...input.topics],
        unsubscribeToken,
        consentStatus: 'pending',
        consentAt: null,
        consentNote: null,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Recipient was not created');
    return toRecipient(row);
  }

  async updateRecipient(id: string, input: RecipientInput): Promise<RecipientRecord | null> {
    const rows = await this.db
      .update(recipients)
      .set({ ...input, topics: [...input.topics] })
      .where(eq(recipients.id, id))
      .returning();
    return rows[0] ? toRecipient(rows[0]) : null;
  }

  async setConsent(
    id: string,
    status: RecipientRecord['consentStatus'],
    at: Date,
    note: string | null,
  ): Promise<RecipientRecord | null> {
    const rows = await this.db
      .update(recipients)
      .set({
        consentStatus: status,
        consentAt: status === 'pending' ? null : at,
        consentNote: status === 'pending' ? null : note,
      })
      .where(eq(recipients.id, id))
      .returning();
    return rows[0] ? toRecipient(rows[0]) : null;
  }

  async deleteRecipient(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(recipients)
      .where(eq(recipients.id, id))
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
    return rows[0] ? toRecipient(rows[0]) : null;
  }

  async listAlertRules(): Promise<AlertRuleRecord[]> {
    const rows = await this.db.select().from(alertRules).orderBy(alertRules.createdAt);
    return rows.map(toAlertRule);
  }

  async createAlertRule(input: AlertRuleInput): Promise<AlertRuleRecord> {
    const rows = await this.db
      .insert(alertRules)
      .values({
        ...input,
        daysOfWeek: [...input.daysOfWeek],
        topics: [...input.topics],
        channels: [...input.channels],
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Alert rule was not created');
    return toAlertRule(row);
  }

  async updateAlertRule(id: string, input: AlertRuleInput): Promise<AlertRuleRecord | null> {
    const rows = await this.db
      .update(alertRules)
      .set({
        ...input,
        daysOfWeek: [...input.daysOfWeek],
        topics: [...input.topics],
        channels: [...input.channels],
      })
      .where(eq(alertRules.id, id))
      .returning();
    return rows[0] ? toAlertRule(rows[0]) : null;
  }

  async deleteAlertRule(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(alertRules)
      .where(eq(alertRules.id, id))
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
      .where(and(...conditions))
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
