import Parser from 'rss-parser';
import type { SourceInput } from '@healthcare/shared';
import type {
  NewsRecord,
  NewsRepository,
  SourceRecord,
  SourceRepository,
} from '../repositories/feeds';
import { safeFetch, validateSafeUrl, type SafeFetcher } from './safe-fetch';
import {
  headlineSimilarity,
  normalizeFeedItem,
  normalizeLink,
  matchesSourceTopics,
} from './normalize';

type Logger = (message: string, detail?: unknown) => void;

const parser = new Parser({
  customFields: {
    item: ['content:encoded', 'summary'],
  },
});
const DEDUPE_WINDOW_MS = 72 * 60 * 60 * 1000;
const NOT_A_FEED_MESSAGE = 'This address is not a news feed.';

type RawFeedItem = {
  title?: string;
  contentSnippet?: string;
  content?: string;
  'content:encoded'?: string;
  summary?: string;
  description?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
};

async function parseFetchedFeed(
  text: string,
): Promise<{ title: string | null; items: RawFeedItem[] }> {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(NOT_A_FEED_MESSAGE, { cause: error });
    }
    if (
      typeof json !== 'object' ||
      json === null ||
      !('version' in json) ||
      typeof json.version !== 'string' ||
      !/^https:\/\/jsonfeed\.org\/version\/1(\.1)?$/.test(json.version) ||
      !('items' in json) ||
      !Array.isArray(json.items)
    ) {
      throw new Error(NOT_A_FEED_MESSAGE);
    }
    return {
      title: 'title' in json && typeof json.title === 'string' ? json.title : null,
      items: json.items.flatMap((item: unknown) => {
        if (typeof item !== 'object' || item === null) return [];
        const entry = item as Record<string, unknown>;
        return [
          {
            title: typeof entry.title === 'string' ? entry.title : undefined,
            content: typeof entry.content_html === 'string' ? entry.content_html : undefined,
            contentSnippet: typeof entry.content_text === 'string' ? entry.content_text : undefined,
            summary: typeof entry.summary === 'string' ? entry.summary : undefined,
            link: typeof entry.url === 'string' ? entry.url : undefined,
            isoDate: typeof entry.date_published === 'string' ? entry.date_published : undefined,
          },
        ];
      }),
    };
  }

  if (!/<(?:rss|rdf:RDF|feed)(?:\s|>)/i.test(trimmed)) {
    throw new Error(NOT_A_FEED_MESSAGE);
  }
  try {
    const parsed = await parser.parseString(trimmed);
    if (!Array.isArray(parsed.items)) {
      throw new Error(NOT_A_FEED_MESSAGE);
    }
    return {
      title:
        typeof (parsed as unknown as { title?: unknown }).title === 'string'
          ? (parsed as unknown as { title: string }).title
          : null,
      items: parsed.items as RawFeedItem[],
    };
  } catch (error) {
    if (error instanceof Error && error.message === NOT_A_FEED_MESSAGE) throw error;
    throw new Error(NOT_A_FEED_MESSAGE, { cause: error });
  }
}

export type FeedFetchResult = {
  itemCount: number;
  insertedCount: number;
  duplicateCount: number;
  skippedCount: number;
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

export type DiscoveredFeed = {
  url: string;
  title: string | null;
  format: 'rss2' | 'rdf' | 'atom';
  itemCount: number;
  sampleHeadlines: string[];
};

export type SkippedFeed = {
  url: string;
  reason: string;
};

export class FeedDiscoveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FeedDiscoveryError';
  }
}

type Parse5Node = {
  nodeName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: Parse5Node[];
};

const FEED_TYPES = new Set(['application/rss+xml', 'application/rdf+xml', 'application/atom+xml']);

function findLinkHeaderCandidates(header: string | null, baseUrl: string): string[] {
  if (!header) return [];
  const links = new Set<string>();
  for (const entry of header.split(/,(?=\s*<)/)) {
    const match = /^<([^>]+)>/.exec(entry.trim());
    if (!match) continue;
    const parameters = entry
      .slice(match[0].length)
      .split(';')
      .map((part) => part.trim());
    const rel = parameters
      .find((part) => /^rel=/i.test(part))
      ?.replace(/^rel=/i, '')
      .replace(/^["']|["']$/g, '');
    const type = parameters
      .find((part) => /^type=/i.test(part))
      ?.replace(/^type=/i, '')
      .replace(/^["']|["']$/g, '')
      .split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (!rel?.toLowerCase().split(/\s+/).includes('alternate') || !type || !FEED_TYPES.has(type))
      continue;
    try {
      const url = new URL(match[1]!, baseUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') links.add(url.href);
    } catch {
      continue;
    }
  }
  return [...links];
}

async function findHtmlFeedLinks(html: string, baseUrl: string): Promise<string[]> {
  const { parse } = await import('parse5');
  const document = parse(html) as Parse5Node;
  const links = new Set<string>();

  function visit(node: Parse5Node): void {
    if (node.nodeName === 'link') {
      const attrs = new Map(
        (node.attrs ?? []).map((attr) => [attr.name.toLowerCase(), attr.value]),
      );
      const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
      const type = (attrs.get('type') ?? '').split(';', 1)[0]?.trim().toLowerCase();
      const href = attrs.get('href');
      if (rel.includes('alternate') && href && FEED_TYPES.has(type ?? '')) {
        try {
          const url = new URL(href, baseUrl);
          if (url.protocol === 'http:' || url.protocol === 'https:') links.add(url.href);
        } catch {
          // Ignore malformed declarations.
        }
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
  }

  visit(document);
  return [...links];
}

function textContent(node: Parse5Node): string {
  if (node.nodeName === '#text') {
    return node.value ?? '';
  }
  return (node.childNodes ?? []).map(textContent).join(' ');
}

async function findBodyFeedLinks(html: string, baseUrl: string, origin: string): Promise<string[]> {
  const { parse } = await import('parse5');
  const document = parse(html) as Parse5Node;
  const links: string[] = [];
  const seen = new Set<string>();
  const signalWords = /\b(?:rss|atom|feed|feeds|subscribe|xml)\b/i;

  function visit(node: Parse5Node): void {
    if (node.nodeName === 'a') {
      const attrs = new Map(
        (node.attrs ?? []).map((attr) => [attr.name.toLowerCase(), attr.value]),
      );
      const href = attrs.get('href');
      if (href) {
        try {
          const url = new URL(href, baseUrl);
          if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin) {
            const path = url.pathname.toLowerCase();
            const pathSignal =
              /\/(?:feed\/?|rss(?:\.xml|\.cms)?|feed\.xml|atom\.xml|index\.xml)$/.test(path);
            const textSignal = signalWords.test(textContent(node).replace(/\s+/g, ' ').trim());
            if ((pathSignal || textSignal) && !seen.has(url.href)) {
              seen.add(url.href);
              links.push(url.href);
            }
          }
        } catch {
          // Ignore invalid and cross-origin links.
        }
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
  }

  visit(document);
  return links.slice(0, 3);
}

async function validateFetchedFeed(text: string): Promise<{
  title: string | null;
  format: 'rss2' | 'rdf' | 'atom';
  items: RawFeedItem[];
}> {
  const trimmed = text.trim();
  if (!trimmed || /^<(?:!doctype\s+)?html\b/i.test(trimmed)) {
    throw new Error(NOT_A_FEED_MESSAGE);
  }
  if (/<(?:sitemap(?:index)?|urlset)\b/i.test(trimmed)) {
    throw new Error(NOT_A_FEED_MESSAGE);
  }

  const rss2 = /<rss\b[^>]*\bversion\s*=\s*(["'])2\.0\1/i.test(trimmed);
  const rdf = /<rdf:RDF\b/i.test(trimmed);
  const atom = /<(?:atom:)?feed\b/i.test(trimmed);
  if (!rss2 && !rdf && !atom) {
    throw new Error(NOT_A_FEED_MESSAGE);
  }

  let parsed: Awaited<ReturnType<typeof parser.parseString>>;
  try {
    parsed = await parser.parseString(trimmed);
  } catch (error) {
    throw new Error(NOT_A_FEED_MESSAGE, { cause: error });
  }

  const validItems = parsed.items.flatMap((item) => {
    const normalized = normalizeFeedItem({
      title: item.title,
      contentSnippet: item.contentSnippet,
      content: item['content:encoded'] ?? item.content,
      summary: item.summary,
      link: item.link,
      isoDate: item.isoDate,
      pubDate: item.pubDate,
    });
    return normalized ? [item as RawFeedItem] : [];
  });
  if (validItems.length === 0) {
    throw new Error(NOT_A_FEED_MESSAGE);
  }

  return {
    title:
      typeof (parsed as unknown as { title?: unknown }).title === 'string'
        ? (parsed as unknown as { title: string }).title
        : null,
    format: rss2 ? 'rss2' : rdf ? 'rdf' : 'atom',
    items: validItems,
  };
}

export class FeedService {
  private readonly fetcher: SafeFetcher;
  private readonly now: () => Date;
  private readonly log: Logger;
  private readonly validateUrl: (input: string | URL) => Promise<void>;
  private readonly onNewsItemsSaved?: (items: NewsRecord[], ownerUserId: string) => Promise<void>;

  constructor(
    private readonly sources: SourceRepository,
    private readonly news: NewsRepository,
    options: {
      fetcher?: SafeFetcher;
      now?: () => Date;
      log?: Logger;
      validateUrl?: (input: string | URL) => Promise<void>;
      onNewsItemsSaved?: (items: NewsRecord[], ownerUserId: string) => Promise<void>;
    } = {},
  ) {
    this.fetcher = options.fetcher ?? safeFetch;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? ((message, detail) => console.error(message, detail));
    this.validateUrl = options.validateUrl ?? validateSafeUrl;
    this.onNewsItemsSaved = options.onNewsItemsSaved;
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
        const text = await response.text();
        return { parsed: await parseFetchedFeed(text), response };
      });

      if (!parsed) {
        await this.sources.updateFetchState(source.id, {
          fetchedAt: now,
          status: 'no_new_items',
          lastErrorMessage: null,
          etag: response.headers.get('etag') ?? source.etag,
          lastModified: response.headers.get('last-modified') ?? source.lastModified,
        });
        return { itemCount: 0, insertedCount: 0, duplicateCount: 0, skippedCount: 0 };
      }

      let insertedCount = 0;
      let duplicateCount = 0;
      let skippedCount = 0;
      const savedNewsItems: NewsRecord[] = [];
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
        if (
          candidates.some(
            (candidate) =>
              candidate.sourceId === source.id && candidate.linkNormalized === linkNormalized,
          )
        ) {
          skippedCount += 1;
          continue;
        }
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

        let isDuplicateItem = false;
        if (matches.length > 0) {
          const earliest = [...matches].sort(
            (left, right) => itemDate(left, now).getTime() - itemDate(right, now).getTime(),
          )[0]!;
          const currentDate = item.publishedAt ?? now;
          if (itemDate(earliest, now).getTime() <= currentDate.getTime()) {
            await this.news.setDuplicateOf([newsItem.id], earliest.duplicateOf ?? earliest.id);
            isDuplicateItem = true;
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
        if (!isDuplicateItem) savedNewsItems.push(newsItem);
      }

      if (savedNewsItems.length) {
        await this.onNewsItemsSaved?.(savedNewsItems, source.ownerUserId);
      }

      await this.sources.updateFetchState(source.id, {
        fetchedAt: now,
        status: insertedCount > 0 ? 'ok' : 'no_new_items',
        lastErrorMessage: null,
        etag: response.headers.get('etag') ?? source.etag,
        lastModified: response.headers.get('last-modified') ?? source.lastModified,
      });
      return { itemCount: parsed.items.length, insertedCount, duplicateCount, skippedCount };
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
        lastErrorMessage:
          error instanceof Error && error.message ? error.message : 'Feed request failed',
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
      const parsed = await parseFetchedFeed(await response.text());
      const sampleHeadlines = parsed.items
        .map((item) => normalizeFeedItem({ title: item.title, link: item.link }))
        .filter((item) => item !== null)
        .slice(0, 3)
        .map((item) => item.headline);
      return { itemCount: parsed.items.length, sampleHeadlines };
    });
  }

  async discoverFeeds(
    siteUrl: string,
  ): Promise<{ feeds: DiscoveredFeed[]; skipped: SkippedFeed[] }> {
    await this.validateUrl(siteUrl);
    const response = await this.fetcher(siteUrl, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new FeedDiscoveryError(`The website returned HTTP ${response.status}.`);
    }

    const html = await response.text();
    const finalUrl = response.url || siteUrl;
    const originalOrigin = new URL(siteUrl).origin;
    const candidates = new Set<string>();
    for (const url of findLinkHeaderCandidates(response.headers.get('link'), finalUrl)) {
      candidates.add(url);
    }
    for (const url of await findHtmlFeedLinks(html, finalUrl)) {
      candidates.add(url);
    }

    let candidateUrls = [...candidates].slice(0, 5);
    let probingFallback = false;
    if (candidateUrls.length === 0) {
      probingFallback = true;
      const probePaths = [
        '/feed/',
        '/feed',
        '/rss',
        '/rss.xml',
        '/feed.xml',
        '/atom.xml',
        '/index.xml',
        '/?feed=rss2',
      ];
      candidateUrls = probePaths.map((path) => new URL(path, originalOrigin).href);
    }

    const phaseOneCandidates = new Set(candidateUrls);
    const bodyCandidates = await findBodyFeedLinks(html, finalUrl, originalOrigin);
    for (const url of bodyCandidates) {
      if (!phaseOneCandidates.has(url) && !candidateUrls.includes(url)) {
        candidateUrls.push(url);
      }
    }

    const feeds: DiscoveredFeed[] = [];
    const skipped: SkippedFeed[] = [];
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextIndex < candidateUrls.length) {
        const index = nextIndex;
        nextIndex += 1;
        const url = candidateUrls[index]!;
        try {
          await this.validateUrl(url);
          const feedResponse = await this.fetcher(url, {
            signal: AbortSignal.timeout(10_000),
          });
          if (probingFallback && new URL(feedResponse.url || url).origin !== originalOrigin) {
            skipped.push({ url, reason: 'Feed redirected outside the website origin.' });
            continue;
          }
          if (!feedResponse.ok) {
            skipped.push({ url, reason: `HTTP ${feedResponse.status}` });
            continue;
          }
          const parsed = await validateFetchedFeed(await feedResponse.text());
          const sampleHeadlines = parsed.items
            .map((item) => normalizeFeedItem({ title: item.title, link: item.link }))
            .filter((item) => item !== null)
            .slice(0, 3)
            .map((item) => item.headline);
          feeds.push({
            url,
            title: parsed.title,
            format: parsed.format,
            itemCount: parsed.items.length,
            sampleHeadlines,
          });
        } catch (error) {
          skipped.push({
            url,
            reason: error instanceof Error ? error.message : 'Could not read this feed.',
          });
        }
      }
    };

    await Promise.all(
      Array.from({ length: candidateUrls.length > 0 ? Math.min(4, candidateUrls.length) : 0 }, () =>
        worker(),
      ),
    );

    return { feeds: feeds.slice(0, 5), skipped };
  }

  async discoverFeedLinks(siteUrl: string): Promise<string[]> {
    const result = await this.discoverFeeds(siteUrl);
    return result.feeds.map((feed) => feed.url);
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
