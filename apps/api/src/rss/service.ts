import Parser from 'rss-parser';
import type { SourceInput } from '@healthcare/shared';
import type { NewsRepository, SourceRecord, SourceRepository } from '../repositories/feeds';
import {
  headlineSimilarity,
  normalizeFeedItem,
  normalizeLink,
  matchesSourceTopics,
} from './normalize';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Logger = (message: string, detail?: unknown) => void;

const parser = new Parser({
  customFields: {
    item: ['content:encoded', 'summary'],
  },
});
const DEDUPE_WINDOW_MS = 72 * 60 * 60 * 1000;

export type FeedFetchResult = {
  itemCount: number;
  insertedCount: number;
  duplicateCount: number;
};

function itemDate(item: { publishedAt: Date | null }, fallback: Date): Date {
  return item.publishedAt ?? fallback;
}

function isDuplicate(
  candidate: {
    linkNormalized: string;
    headline: string;
    publishedAt: Date | null;
    fetchedAt: Date;
  },
  item: { linkNormalized: string; headline: string; publishedAt: Date | null },
  fetchedAt: Date,
): boolean {
  if (candidate.linkNormalized === item.linkNormalized) return true;
  const candidateDate = candidate.publishedAt ?? candidate.fetchedAt;
  const itemDateValue = item.publishedAt ?? fetchedAt;
  return (
    Math.abs(candidateDate.getTime() - itemDateValue.getTime()) <= DEDUPE_WINDOW_MS &&
    headlineSimilarity(candidate.headline, item.headline) >= 0.85
  );
}

async function retry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Feed request failed');
}

export class FeedService {
  private readonly fetcher: FetchLike;
  private readonly now: () => Date;
  private readonly log: Logger;

  constructor(
    private readonly sources: SourceRepository,
    private readonly news: NewsRepository,
    options: { fetcher?: FetchLike; now?: () => Date; log?: Logger } = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? ((message, detail) => console.error(message, detail));
  }

  async fetchSource(source: SourceRecord): Promise<FeedFetchResult> {
    const now = this.now();
    try {
      const { parsed, response } = await retry(async () => {
        const headers = new Headers();
        if (source.etag) headers.set('If-None-Match', source.etag);
        if (source.lastModified) headers.set('If-Modified-Since', source.lastModified);
        const response = await this.fetcher(source.rssUrl, {
          headers,
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status === 304) {
          return { parsed: null, response };
        }
        if (!response.ok) {
          throw new Error(`Feed returned HTTP ${response.status}`);
        }
        const xml = await response.text();
        return { parsed: await parser.parseString(xml), response };
      });

      await this.sources.updateFetchState(source.id, {
        fetchedAt: now,
        status: response.status === 304 ? 'not_modified' : 'ok',
        etag: response.headers.get('etag') ?? source.etag,
        lastModified: response.headers.get('last-modified') ?? source.lastModified,
      });
      if (!parsed) return { itemCount: 0, insertedCount: 0, duplicateCount: 0 };

      let insertedCount = 0;
      let duplicateCount = 0;
      for (const rawItem of parsed.items) {
        const item = normalizeFeedItem({
          title: rawItem.title,
          contentSnippet: rawItem.contentSnippet,
          content: rawItem['content:encoded'] ?? rawItem.content,
          summary: rawItem.summary,
          link: rawItem.link,
          isoDate: rawItem.isoDate,
          pubDate: rawItem.pubDate,
        });
        if (!item || !matchesSourceTopics(source, item.headline, item.summary)) continue;

        const linkNormalized = normalizeLink(item.link);
        const candidates = await this.news.findDedupeCandidates(
          linkNormalized,
          new Date(now.getTime() - DEDUPE_WINDOW_MS),
        );
        const matches = candidates.filter((candidate) =>
          isDuplicate(candidate, { ...item, linkNormalized }, now),
        );
        const newsItem = await this.news.createNewsItem({
          sourceId: source.id,
          headline: item.headline,
          summary: item.summary,
          link: item.link,
          linkNormalized,
          headlineSignature: [...item.headline.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)]
            .map((match) => match[0])
            .join(' '),
          category: item.category,
          publishedAt: item.publishedAt,
          duplicateOf: null,
        });

        if (matches.length > 0) {
          const earliest = [...matches].sort(
            (left, right) => itemDate(left, now).getTime() - itemDate(right, now).getTime(),
          )[0]!;
          const currentDate = item.publishedAt ?? now;
          if (itemDate(earliest, now).getTime() <= currentDate.getTime()) {
            await this.news.setDuplicateOf([newsItem.id], earliest.duplicateOf ?? earliest.id);
          } else {
            await this.news.clearDuplicateOf(matches.map((candidate) => candidate.id));
            await this.news.setDuplicateOf(
              matches.map((candidate) => candidate.id),
              newsItem.id,
            );
          }
          duplicateCount += 1;
        } else {
          insertedCount += 1;
        }
      }

      return { itemCount: parsed.items.length, insertedCount, duplicateCount };
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'TimeoutError'
          ? 'timeout'
          : error instanceof Error && error.message.startsWith('Feed returned HTTP ')
            ? error.message
            : 'feed_error';
      await this.sources.updateFetchState(source.id, {
        fetchedAt: now,
        status: message,
      });
      this.log(`Feed fetch failed for source ${source.id}`, error);
      throw error;
    }
  }

  async testFeed(rssUrl: string): Promise<{ itemCount: number; sampleHeadlines: string[] }> {
    return retry(async () => {
      const response = await this.fetcher(rssUrl, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
      const parsed = await parser.parseString(await response.text());
      const sampleHeadlines = parsed.items
        .map((item) => normalizeFeedItem({ title: item.title, link: item.link }))
        .filter((item) => item !== null)
        .slice(0, 3)
        .map((item) => item.headline);
      return { itemCount: parsed.items.length, sampleHeadlines };
    });
  }
}

export function sourceInputFromRecord(source: SourceRecord): SourceInput {
  return {
    name: source.name,
    website: source.website,
    rssUrl: source.rssUrl,
    mode: source.mode,
    topics: source.topics,
    region: source.region,
    intervalMinutes: source.intervalMinutes,
    active: source.active,
  };
}
