import { randomUUID } from 'node:crypto';
import type { SourceInput } from '@healthcare/shared';
import type { FeedTestResponse } from '@healthcare/shared';
import type {
  NewsRecord,
  NewNews,
  NewsRepository,
  RetentionRepository,
  SourceRecord,
  SourceRepository,
} from './feeds';
import type {
  DashboardNewsItem,
  DashboardRepository,
  DashboardSummary,
  NewsFeedFilters,
} from './dashboard';
import type { FeedTestJobRepository } from './feed-jobs';

function cloneSource(source: SourceRecord): SourceRecord {
  return {
    ...source,
    lastFetchedAt: source.lastFetchedAt && new Date(source.lastFetchedAt),
    createdAt: new Date(source.createdAt),
  };
}

function cloneNews(news: NewsRecord): NewsRecord {
  return {
    ...news,
    publishedAt: news.publishedAt && new Date(news.publishedAt),
    fetchedAt: new Date(news.fetchedAt),
  };
}

export class MemoryFeedRepository
  implements SourceRepository, NewsRepository, RetentionRepository, DashboardRepository
{
  constructor(private readonly defaultOwnerUserId = 'test-owner') {}

  private readonly sources = new Map<string, SourceRecord>();
  private readonly news = new Map<string, NewsRecord>();
  private readonly deliveries: {
    id: string;
    ownerUserId: string;
    queuedAt: Date;
    status: string;
  }[] = [];
  private readonly recipientsCounts = new Map<string, number>();
  private readonly connections = { whatsapp: false, email: false };

  async listSources(ownerUserId?: string): Promise<SourceRecord[]> {
    return [...this.sources.values()]
      .filter((source) => !ownerUserId || source.ownerUserId === ownerUserId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(cloneSource);
  }

  async findSource(id: string, ownerUserId?: string): Promise<SourceRecord | null> {
    const source = this.sources.get(id);
    return source && (!ownerUserId || source.ownerUserId === ownerUserId)
      ? cloneSource(source)
      : null;
  }

  async createSource(
    input: SourceInput,
    ownerUserId = this.defaultOwnerUserId,
  ): Promise<SourceRecord> {
    const source: SourceRecord = {
      ...input,
      id: randomUUID(),
      ownerUserId,
      lastFetchedAt: null,
      lastStatus: null,
      etag: null,
      lastModified: null,
      createdAt: new Date(),
    };
    this.sources.set(source.id, source);
    return cloneSource(source);
  }

  async updateSource(
    id: string,
    updates: Partial<SourceInput>,
    ownerUserId?: string,
  ): Promise<SourceRecord | null> {
    const source = this.sources.get(id);
    if (!source || (ownerUserId && source.ownerUserId !== ownerUserId)) return null;
    Object.assign(source, updates);
    return cloneSource(source);
  }

  async deleteSource(id: string, ownerUserId?: string): Promise<boolean> {
    const source = this.sources.get(id);
    if (!source || (ownerUserId && source.ownerUserId !== ownerUserId)) return false;
    const deleted = this.sources.delete(id);
    if (deleted) {
      for (const [newsId, item] of this.news) {
        if (item.sourceId === id) this.news.delete(newsId);
      }
    }
    return deleted;
  }

  async updateFetchState(
    id: string,
    values: { fetchedAt: Date; status: string; etag?: string | null; lastModified?: string | null },
  ): Promise<void> {
    const source = this.sources.get(id);
    if (!source) return;
    source.lastFetchedAt = values.fetchedAt;
    source.lastStatus = values.status;
    if (values.etag !== undefined) source.etag = values.etag;
    if (values.lastModified !== undefined) source.lastModified = values.lastModified;
  }

  async listDueSources(now: Date): Promise<SourceRecord[]> {
    return [...this.sources.values()]
      .filter(
        (source) =>
          source.active &&
          (!source.lastFetchedAt ||
            source.lastFetchedAt.getTime() + source.intervalMinutes * 60_000 <= now.getTime()),
      )
      .map(cloneSource);
  }

  async findDedupeCandidates(linkNormalized: string, since: Date): Promise<NewsRecord[]> {
    return [...this.news.values()]
      .filter(
        (item) =>
          item.linkNormalized === linkNormalized || item.fetchedAt.getTime() >= since.getTime(),
      )
      .map(cloneNews);
  }

  async createNewsItem(input: NewNews): Promise<NewsRecord> {
    const item: NewsRecord = {
      ...input,
      id: randomUUID(),
      fetchedAt: new Date(),
      important: input.important ?? false,
      duplicateOf: input.duplicateOf ?? null,
    };
    this.news.set(item.id, item);
    return cloneNews(item);
  }

  async setDuplicateOf(ids: string[], canonicalId: string): Promise<void> {
    for (const id of ids) {
      const item = this.news.get(id);
      if (item && id !== canonicalId) item.duplicateOf = canonicalId;
    }
  }

  async clearDuplicateOf(ids: string[]): Promise<void> {
    for (const id of ids) {
      const item = this.news.get(id);
      if (item) item.duplicateOf = null;
    }
  }

  async deleteNewsBefore(cutoff: Date): Promise<number> {
    let deleted = 0;
    for (const [id, item] of this.news) {
      if ((item.publishedAt ?? item.fetchedAt) < cutoff) {
        this.news.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }

  async deleteDeliveriesBefore(cutoff: Date): Promise<number> {
    const retained = this.deliveries.filter((delivery) => delivery.queuedAt >= cutoff);
    const deleted = this.deliveries.length - retained.length;
    this.deliveries.splice(0, this.deliveries.length, ...retained);
    return deleted;
  }

  async addDeliveryForTest(
    queuedAt: Date,
    ownerUserId = this.defaultOwnerUserId,
  ): Promise<void> {
    this.deliveries.push({
      id: randomUUID(),
      ownerUserId,
      queuedAt,
      status: 'pending',
    });
  }

  async addDeliveryStatusForTest(
    queuedAt: Date,
    status: string,
    ownerUserId = this.defaultOwnerUserId,
  ): Promise<void> {
    this.deliveries.push({ id: randomUUID(), ownerUserId, queuedAt, status });
  }

  setRecipientsCountForTest(count: number, ownerUserId = this.defaultOwnerUserId): void {
    this.recipientsCounts.set(ownerUserId, count);
  }

  setConnectionStatusForTest(service: 'whatsapp' | 'email', connected: boolean): void {
    this.connections[service] = connected;
  }

  async addNewsForTest(
    input: Partial<NewsRecord> & Pick<NewsRecord, 'sourceId' | 'headline'>,
    fetchedAt: Date,
  ): Promise<void> {
    const id = input.id ?? randomUUID();
    this.news.set(id, {
      id,
      sourceId: input.sourceId,
      headline: input.headline,
      summary: input.summary ?? '',
      link: input.link ?? 'https://example.test/',
      linkNormalized: input.linkNormalized ?? 'https://example.test/',
      headlineSignature: input.headlineSignature ?? '',
      category: input.category ?? 'Uncategorized',
      publishedAt: input.publishedAt ?? null,
      fetchedAt,
      important: input.important ?? false,
      duplicateOf: input.duplicateOf ?? null,
    });
  }

  async listNewsForTest(): Promise<NewsRecord[]> {
    return [...this.news.values()].map(cloneNews);
  }

  async countDeliveriesForTest(): Promise<number> {
    return this.deliveries.length;
  }

  async getSummary(
    todayStart: Date,
    latestLimit: number,
    ownerUserId?: string,
  ): Promise<DashboardSummary> {
    const activityStart = new Date(todayStart);
    activityStart.setUTCDate(activityStart.getUTCDate() - 6);
    const dayAfterToday = new Date(todayStart);
    dayAfterToday.setUTCDate(dayAfterToday.getUTCDate() + 1);
    const visibleSources = [...this.sources.values()].filter(
      (source) => !ownerUserId || source.ownerUserId === ownerUserId,
    );
    const sourceIds = new Set(visibleSources.map((source) => source.id));
    const activeSources = visibleSources.filter((source) => source.active).length;
    const visibleNews = [...this.news.values()].filter(
      (item) => !item.duplicateOf && sourceIds.has(item.sourceId),
    );
    const latestItems = visibleNews
      .sort((a, b) => this.sortDate(b).getTime() - this.sortDate(a).getTime())
      .slice(0, latestLimit)
      .map((item) => this.toDashboardItem(item));
    const visibleDeliveries = this.deliveries.filter(
      (delivery) => !ownerUserId || delivery.ownerUserId === ownerUserId,
    );
    const todayDeliveries = visibleDeliveries.filter((delivery) => delivery.queuedAt >= todayStart);
    const itemsByDate = new Map<string, number>();
    for (const item of visibleNews) {
      const timestamp = this.sortDate(item);
      if (timestamp < activityStart || timestamp >= dayAfterToday) continue;
      const date = this.localDateKey(timestamp);
      itemsByDate.set(date, (itemsByDate.get(date) ?? 0) + 1);
    }
    const deliveriesByDate = new Map<string, number>();
    for (const delivery of visibleDeliveries) {
      if (delivery.queuedAt < activityStart || delivery.queuedAt >= dayAfterToday) continue;
      const date = this.localDateKey(delivery.queuedAt);
      deliveriesByDate.set(date, (deliveriesByDate.get(date) ?? 0) + 1);
    }
    const dailyActivity = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(activityStart);
      date.setUTCDate(date.getUTCDate() + index);
      const key = this.localDateKey(date);
      return {
        date: key,
        items: itemsByDate.get(key) ?? 0,
        deliveries: deliveriesByDate.get(key) ?? 0,
      };
    });
    const lastFetch = visibleSources
      .map((source) => source.lastFetchedAt)
      .filter((date): date is Date => date !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      itemsToday: visibleNews.filter((item) => this.sortDate(item) >= todayStart).length,
      activeSources,
      recipients: ownerUserId
        ? (this.recipientsCounts.get(ownerUserId) ?? 0)
        : [...this.recipientsCounts.values()].reduce((total, count) => total + count, 0),
      deliveriesToday: todayDeliveries.length,
      failedDeliveries: visibleDeliveries.filter((delivery) => delivery.status === 'failed').length,
      dailyActivity,
      deliveryOutcomes: {
        delivered: visibleDeliveries.filter((delivery) => delivery.status === 'delivered').length,
        failed: visibleDeliveries.filter((delivery) => delivery.status === 'failed').length,
      },
      latestItems,
      lastFetchAt: lastFetch ?? null,
      connections: { ...this.connections },
    };
  }

  async listNews(filters: NewsFeedFilters): Promise<{ items: DashboardNewsItem[]; total: number }> {
    const query = filters.query?.toLocaleLowerCase();
    const matching = [...this.news.values()]
      .filter((item) => !item.duplicateOf)
      .filter(
        (item) =>
          !filters.ownerUserId ||
          this.sources.get(item.sourceId)?.ownerUserId === filters.ownerUserId,
      )
      .filter((item) => !filters.category || item.category === filters.category)
      .filter((item) => !filters.sourceId || item.sourceId === filters.sourceId)
      .filter((item) => !filters.from || (item.publishedAt && item.publishedAt >= filters.from))
      .filter(
        (item) =>
          !filters.toExclusive || (item.publishedAt && item.publishedAt < filters.toExclusive),
      )
      .filter(
        (item) =>
          !query ||
          item.headline.toLocaleLowerCase().includes(query) ||
          item.summary.toLocaleLowerCase().includes(query),
      )
      .sort((a, b) => this.sortDate(b).getTime() - this.sortDate(a).getTime());
    const start = (filters.page - 1) * filters.pageSize;
    return {
      items: matching
        .slice(start, start + filters.pageSize)
        .map((item) => this.toDashboardItem(item)),
      total: matching.length,
    };
  }

  async setImportant(id: string, important: boolean): Promise<boolean> {
    const item = this.news.get(id);
    if (!item || item.duplicateOf) return false;
    item.important = important;
    return true;
  }

  private sortDate(item: NewsRecord): Date {
    return item.publishedAt ?? item.fetchedAt;
  }

  private localDateKey(value: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
  }

  private toDashboardItem(item: NewsRecord): DashboardNewsItem {
    return {
      id: item.id,
      sourceId: item.sourceId,
      sourceName: this.sources.get(item.sourceId)?.name ?? 'Unknown source',
      headline: item.headline,
      summary: item.summary,
      link: item.link,
      category: item.category,
      publishedAt: item.publishedAt,
      fetchedAt: item.fetchedAt,
      important: item.important,
    };
  }
}

export class MemoryFeedTestJobRepository implements FeedTestJobRepository {
  private readonly jobs = new Map<string, FeedTestResponse & { rssUrl: string }>();

  async enqueueFeedTest(rssUrl: string): Promise<FeedTestResponse> {
    const job = { id: randomUUID(), status: 'queued' as const, rssUrl };
    this.jobs.set(job.id, job);
    return { id: job.id, status: job.status };
  }

  async getFeedTest(id: string): Promise<FeedTestResponse | null> {
    const stored = this.jobs.get(id);
    if (!stored) return null;
    const { rssUrl: _rssUrl, ...job } = stored;
    return job;
  }

  async claimNextFeedTest(
    _now: Date,
    _lockUntil: Date,
  ): Promise<{ id: string; rssUrl: string } | null> {
    const job = [...this.jobs.values()].find((candidate) => candidate.status === 'queued');
    if (!job) return null;
    this.jobs.set(job.id, { ...job, status: 'running' });
    return { id: job.id, rssUrl: job.rssUrl };
  }

  async completeFeedTest(
    id: string,
    result: { itemCount: number; sampleHeadlines: string[] },
  ): Promise<void> {
    const job = this.jobs.get(id);
    if (job) this.jobs.set(id, { ...job, status: 'done', ...result });
  }

  async failFeedTest(id: string, message: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job) this.jobs.set(id, { ...job, status: 'failed', message });
  }
}
