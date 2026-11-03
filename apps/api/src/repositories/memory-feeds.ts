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

export class MemoryFeedRepository implements SourceRepository, NewsRepository, RetentionRepository {
  private readonly sources = new Map<string, SourceRecord>();
  private readonly news = new Map<string, NewsRecord>();
  private readonly deliveries: { id: string; queuedAt: Date }[] = [];

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
    this.deliveries.push({ id: randomUUID(), queuedAt });
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
      duplicateOf: input.duplicateOf ?? null,
    });
  }

  async listNewsForTest(): Promise<NewsRecord[]> {
    return [...this.news.values()].map(cloneNews);
  }

  async countDeliveriesForTest(): Promise<number> {
    return this.deliveries.length;
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
