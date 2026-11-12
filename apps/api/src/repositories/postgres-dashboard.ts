import { and, count, desc, eq, gte, ilike, isNull, lt, max, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client';
import { connectionStatus, deliveries, newsItems, recipients, sources } from '../db/schema';
import type {
  DashboardNewsItem,
  DashboardRepository,
  DashboardSummary,
  NewsFeedFilters,
} from './dashboard';

function toDashboardItem(
  row: typeof newsItems.$inferSelect,
  sourceName: string,
): DashboardNewsItem {
  return {
    id: row.id,
    sourceId: row.sourceId,
    sourceName,
    headline: row.headline,
    summary: row.summary,
    link: row.link,
    category: row.category as DashboardNewsItem['category'],
    publishedAt: row.publishedAt,
    fetchedAt: row.fetchedAt,
    important: row.important,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function localDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

export class PostgresDashboardRepository implements DashboardRepository {
  constructor(private readonly db: Database) {}

  async getSummary(todayStart: Date, latestLimit: number): Promise<DashboardSummary> {
    const activityStart = new Date(todayStart);
    activityStart.setUTCDate(activityStart.getUTCDate() - 6);
    const dayAfterToday = new Date(todayStart);
    dayAfterToday.setUTCDate(dayAfterToday.getUTCDate() + 1);
    const itemDate = sql<string>`to_char(
      coalesce(${newsItems.publishedAt}, ${newsItems.fetchedAt}) AT TIME ZONE 'Asia/Kolkata',
      'YYYY-MM-DD'
    )`;
    const deliveryDate = sql<string>`to_char(
      ${deliveries.queuedAt} AT TIME ZONE 'Asia/Kolkata',
      'YYYY-MM-DD'
    )`;
    const [
      itemCount,
      sourceCount,
      recipientCount,
      deliveryCount,
      failedCount,
      deliveredCount,
      latestRows,
      latestFetch,
      statuses,
      itemDays,
      deliveryDays,
    ] = await Promise.all([
      this.db
        .select({ value: count() })
        .from(newsItems)
        .where(
          and(
            isNull(newsItems.duplicateOf),
            or(
              gte(newsItems.publishedAt, todayStart),
              and(isNull(newsItems.publishedAt), gte(newsItems.fetchedAt, todayStart)),
            ),
          ),
        ),
      this.db.select({ value: count() }).from(sources).where(eq(sources.active, true)),
      this.db.select({ value: count() }).from(recipients),
      this.db
        .select({ value: count() })
        .from(deliveries)
        .where(gte(deliveries.queuedAt, todayStart)),
      this.db.select({ value: count() }).from(deliveries).where(eq(deliveries.status, 'failed')),
      this.db.select({ value: count() }).from(deliveries).where(eq(deliveries.status, 'delivered')),
      this.db
        .select({ item: newsItems, sourceName: sources.name })
        .from(newsItems)
        .innerJoin(sources, eq(newsItems.sourceId, sources.id))
        .where(isNull(newsItems.duplicateOf))
        .orderBy(
          sql`coalesce(${newsItems.publishedAt}, ${newsItems.fetchedAt}) desc`,
          desc(newsItems.id),
        )
        .limit(latestLimit),
      this.db.select({ value: max(sources.lastFetchedAt) }).from(sources),
      this.db
        .select({ service: connectionStatus.service, state: connectionStatus.state })
        .from(connectionStatus),
      this.db
        .select({ date: itemDate, value: count() })
        .from(newsItems)
        .where(
          and(
            isNull(newsItems.duplicateOf),
            or(
              and(
                gte(newsItems.publishedAt, activityStart),
                lt(newsItems.publishedAt, dayAfterToday),
              ),
              and(
                isNull(newsItems.publishedAt),
                gte(newsItems.fetchedAt, activityStart),
                lt(newsItems.fetchedAt, dayAfterToday),
              ),
            ),
          ),
        )
        .groupBy(itemDate),
      this.db
        .select({ date: deliveryDate, value: count() })
        .from(deliveries)
        .where(and(gte(deliveries.queuedAt, activityStart), lt(deliveries.queuedAt, dayAfterToday)))
        .groupBy(deliveryDate),
    ]);

    const stateByService = new Map(statuses.map((row) => [row.service, row.state.toLowerCase()]));
    const itemsByDate = new Map(itemDays.map((row) => [row.date, Number(row.value)]));
    const deliveriesByDate = new Map(deliveryDays.map((row) => [row.date, Number(row.value)]));
    const dailyActivity = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(activityStart);
      date.setUTCDate(date.getUTCDate() + index);
      const key = localDateKey(date);
      return {
        date: key,
        items: itemsByDate.get(key) ?? 0,
        deliveries: deliveriesByDate.get(key) ?? 0,
      };
    });
    return {
      itemsToday: Number(itemCount[0]?.value ?? 0),
      activeSources: Number(sourceCount[0]?.value ?? 0),
      recipients: Number(recipientCount[0]?.value ?? 0),
      deliveriesToday: Number(deliveryCount[0]?.value ?? 0),
      failedDeliveries: Number(failedCount[0]?.value ?? 0),
      dailyActivity,
      deliveryOutcomes: {
        delivered: Number(deliveredCount[0]?.value ?? 0),
        failed: Number(failedCount[0]?.value ?? 0),
      },
      latestItems: latestRows.map((row) => toDashboardItem(row.item, row.sourceName)),
      lastFetchAt: latestFetch[0]?.value ?? null,
      connections: {
        whatsapp: stateByService.get('whatsapp') === 'connected',
        email: stateByService.get('email') === 'working',
      },
    };
  }

  async listNews(filters: NewsFeedFilters): Promise<{ items: DashboardNewsItem[]; total: number }> {
    const conditions: SQL[] = [isNull(newsItems.duplicateOf)];
    if (filters.ownerUserId) conditions.push(eq(sources.ownerUserId, filters.ownerUserId));
    if (filters.category) conditions.push(eq(newsItems.category, filters.category));
    if (filters.sourceId) conditions.push(eq(newsItems.sourceId, filters.sourceId));
    if (filters.from) conditions.push(gte(newsItems.publishedAt, filters.from));
    if (filters.toExclusive) conditions.push(lt(newsItems.publishedAt, filters.toExclusive));
    if (filters.query) {
      const pattern = `%${escapeLike(filters.query)}%`;
      conditions.push(or(ilike(newsItems.headline, pattern), ilike(newsItems.summary, pattern))!);
    }
    const where = and(...conditions);
    const [rows, countRows] = await Promise.all([
      this.db
        .select({ item: newsItems, sourceName: sources.name })
        .from(newsItems)
        .innerJoin(sources, eq(newsItems.sourceId, sources.id))
        .where(where)
        .orderBy(
          sql`coalesce(${newsItems.publishedAt}, ${newsItems.fetchedAt}) desc`,
          desc(newsItems.id),
        )
        .limit(filters.pageSize)
        .offset((filters.page - 1) * filters.pageSize),
      this.db
        .select({ value: count() })
        .from(newsItems)
        .innerJoin(sources, eq(newsItems.sourceId, sources.id))
        .where(where),
    ]);
    return {
      items: rows.map((row) => toDashboardItem(row.item, row.sourceName)),
      total: Number(countRows[0]?.value ?? 0),
    };
  }

  async setImportant(id: string, important: boolean): Promise<boolean> {
    const rows = await this.db
      .update(newsItems)
      .set({ important })
      .where(and(eq(newsItems.id, id), isNull(newsItems.duplicateOf)))
      .returning({ id: newsItems.id });
    return rows.length === 1;
  }
}
