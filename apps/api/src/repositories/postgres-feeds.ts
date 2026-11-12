import { and, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { deliveries, newsItems, sources } from '../db/schema';
import type { NewsCategory } from '../rss/categories';
import type {
  NewsRecord,
  NewNews,
  NewsRepository,
  RetentionRepository,
  SourceRecord,
  SourceRepository,
} from './feeds';
import type { SourceInput } from '@healthcare/shared';

type SourceRow = typeof sources.$inferSelect;
type NewsRow = typeof newsItems.$inferSelect;

function toSource(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    website: row.website,
    rssUrl: row.rssUrl,
    mode: row.mode,
    topics: row.topics,
    region: row.region,
    intervalMinutes: row.intervalMinutes as SourceInput['intervalMinutes'],
    active: row.active,
    lastFetchedAt: row.lastFetchedAt,
    lastStatus: row.lastStatus,
    etag: row.etag,
    lastModified: row.lastModified,
    createdAt: row.createdAt,
  };
}

function toNews(row: NewsRow): NewsRecord {
  return {
    id: row.id,
    sourceId: row.sourceId,
    headline: row.headline,
    summary: row.summary,
    link: row.link,
    linkNormalized: row.linkNormalized,
    headlineSignature: row.headlineSignature,
    category: row.category as NewsCategory,
    publishedAt: row.publishedAt,
    fetchedAt: row.fetchedAt,
    important: row.important,
    duplicateOf: row.duplicateOf,
  };
}

export class PostgresFeedRepository
  implements SourceRepository, NewsRepository, RetentionRepository
{
  constructor(private readonly db: Database) {}

  async listSources(ownerUserId?: string): Promise<SourceRecord[]> {
    const rows = await this.db
      .select()
      .from(sources)
      .where(ownerUserId ? eq(sources.ownerUserId, ownerUserId) : undefined)
      .orderBy(sources.name);
    return rows.map(toSource);
  }

  async findSource(id: string, ownerUserId?: string): Promise<SourceRecord | null> {
    const rows = await this.db
      .select()
      .from(sources)
      .where(and(eq(sources.id, id), ...(ownerUserId ? [eq(sources.ownerUserId, ownerUserId)] : [])))
      .limit(1);
    return rows[0] ? toSource(rows[0]) : null;
  }

  async createSource(input: SourceInput, ownerUserId: string): Promise<SourceRecord> {
    const rows = await this.db
      .insert(sources)
      .values({
        ...input,
        ownerUserId,
        region: input.region || null,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Source was not created');
    return toSource(row);
  }

  async updateSource(
    id: string,
    updates: Partial<SourceInput>,
    ownerUserId?: string,
  ): Promise<SourceRecord | null> {
    const values = {
      ...updates,
      ...(updates.region !== undefined ? { region: updates.region || null } : {}),
    };
    const rows = await this.db
      .update(sources)
      .set(values)
      .where(and(eq(sources.id, id), ...(ownerUserId ? [eq(sources.ownerUserId, ownerUserId)] : [])))
      .returning();
    return rows[0] ? toSource(rows[0]) : null;
  }

  async deleteSource(id: string, ownerUserId?: string): Promise<boolean> {
    const rows = await this.db
      .delete(sources)
      .where(and(eq(sources.id, id), ...(ownerUserId ? [eq(sources.ownerUserId, ownerUserId)] : [])))
      .returning({ id: sources.id });
    return rows.length === 1;
  }

  async updateFetchState(
    id: string,
    values: { fetchedAt: Date; status: string; etag?: string | null; lastModified?: string | null },
  ): Promise<void> {
    await this.db
      .update(sources)
      .set({
        lastFetchedAt: values.fetchedAt,
        lastStatus: values.status,
        ...(values.etag !== undefined ? { etag: values.etag } : {}),
        ...(values.lastModified !== undefined ? { lastModified: values.lastModified } : {}),
      })
      .where(eq(sources.id, id));
  }

  async listDueSources(now: Date): Promise<SourceRecord[]> {
    const due = or(
      isNull(sources.lastFetchedAt),
      sql`${sources.lastFetchedAt} + (${sources.intervalMinutes} * interval '1 minute') <= ${now}`,
    );
    const rows = await this.db
      .select()
      .from(sources)
      .where(and(eq(sources.active, true), due));
    return rows.map(toSource);
  }

  async findDedupeCandidates(linkNormalized: string, since: Date): Promise<NewsRecord[]> {
    const rows = await this.db
      .select()
      .from(newsItems)
      .where(or(eq(newsItems.linkNormalized, linkNormalized), gte(newsItems.fetchedAt, since)));
    return rows.map(toNews);
  }

  async createNewsItem(news: NewNews): Promise<NewsRecord> {
    const rows = await this.db.insert(newsItems).values(news).returning();
    const row = rows[0];
    if (!row) throw new Error('News item was not created');
    return toNews(row);
  }

  async setDuplicateOf(ids: string[], canonicalId: string): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(newsItems)
      .set({ duplicateOf: canonicalId })
      .where(inArray(newsItems.id, ids));
  }

  async clearDuplicateOf(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.update(newsItems).set({ duplicateOf: null }).where(inArray(newsItems.id, ids));
  }

  async deleteNewsBefore(cutoff: Date): Promise<number> {
    const rows = await this.db
      .delete(newsItems)
      .where(
        or(
          lt(newsItems.publishedAt, cutoff),
          and(isNull(newsItems.publishedAt), lt(newsItems.fetchedAt, cutoff)),
        ),
      )
      .returning({ id: newsItems.id });
    return rows.length;
  }

  async deleteDeliveriesBefore(cutoff: Date): Promise<number> {
    const rows = await this.db
      .delete(deliveries)
      .where(lt(deliveries.queuedAt, cutoff))
      .returning({ id: deliveries.id });
    return rows.length;
  }
}
