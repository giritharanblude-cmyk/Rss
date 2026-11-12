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
  private readonly sources = new Map<string, SourceRecord>();
  private readonly news = new Map<string, NewsRecord>();
  private readonly deliveries: { id: string; queuedAt: Date; status: string }[] = [];
  private recipientsCount = 0;
  private readonly connections = { whatsapp: false, email: false };

  async listSources(): Promise<SourceRecord[]> {
    return [...this.sources.values()].sort((a, b) => a.name.localeCompare(b.name)).map(cloneSource);
  }

  async findSource(id: string): Promise<SourceRecord | null> {
    const source = this.sources.get(id);
    return source ? cloneSource(source) : null;
  }

  async createSource(input: SourceInput): Promise<SourceRecord> {
    const source: SourceRecord = {
      ...input,
      id: randomUUID(),
      lastFetchedAt: null,
      lastStatus: null,
      etag: null,
      lastModified: null,
      createdAt: new Date(),
    };
    this.sources.set(source.id, source);
    return cloneSource(source);
  }

  async updateSource(id: string, updates: Partial<SourceInput>): Promise<SourceRecord | null> {
    const source = this.sources.get(id);
    if (!source) return null;
    Object.assign(source, updates);
    return cloneSource(source);
  }

  async deleteSource(id: string): Promise<boolean> {
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

  async addDeliveryForTest(queuedAt: Date): Promise<void> {
    this.deliveries.push({ id: randomUUID(), queuedAt, status: 'pending' });
  }

  async addDeliveryStatusForTest(queuedAt: Date, status: string): Promise<void> {
    this.deliveries.push({ id: randomUUID(), queuedAt, status });
  }

  setRecipientsCountForTest(count: number): void {
    this.recipientsCount = count;
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

  async getSummary(todayStart: Date, latestLimit: number): Promise<DashboardSummary> {
    const activityStart = new Date(todayStart);
    activityStart.setUTCDate(activityStart.getUTCDate() - 6);
    const dayAfterToday = new Date(todayStart);
    dayAfterToday.setUTCDate(dayAfterToday.getUTCDate() + 1);
    const activeSources = [...this.sources.values()].filter((source) => source.active).length;
    const visibleNews = [...this.news.values()].filter((item) => !item.duplicateOf);
    const latestItems = visibleNews
      .sort((a, b) => this.sortDate(b).getTime() - this.sortDate(a).getTime())
      .slice(0, latestLimit)
      .map((item) => this.toDashboardItem(item));
    const todayDeliveries = this.deliveries.filter((delivery) => delivery.queuedAt >= todayStart);
    const itemsByDate = new Map<string, number>();
    for (const item of visibleNews) {
      const timestamp = this.sortDate(item);
      if (timestamp < activityStart || timestamp >= dayAfterToday) continue;
      const date = this.localDateKey(timestamp);
      itemsByDate.set(date, (itemsByDate.get(date) ?? 0) + 1);
    }
    const deliveriesByDate = new Map<string, number>();
    for (const delivery of this.deliveries) {
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
    const lastFetch = [...this.sources.values()]
      .map((source) => source.lastFetchedAt)
      .filter((date): date is Date => date !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      itemsToday: visibleNews.filter((item) => this.sortDate(item) >= todayStart).length,
      activeSources,
      recipients: this.recipientsCount,
      deliveriesToday: todayDeliveries.length,
      failedDeliveries: this.deliveries.filter((delivery) => delivery.status === 'failed').length,
      dailyActivity,
      deliveryOutcomes: {
        delivered: this.deliveries.filter((delivery) => delivery.status === 'delivered').length,
        failed: this.deliveries.filter((delivery) => delivery.status === 'failed').length,
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
