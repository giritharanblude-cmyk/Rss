import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newsItems } from './db/schema';
import { MemoryFeedRepository } from './repositories/memory-feeds';
import { runDueFeedsOnce, runRetention } from './rss/background';
import { CATEGORY_RULES, categorize } from './rss/categories';
import {
  clampSummary,
  headlineSimilarity,
  matchesSourceTopics,
  normalizeLink,
  stripHtml,
} from './rss/normalize';
import { FeedService } from './rss/service';

const rssFixture = readFileSync(
  path.join(process.cwd(), 'src', 'rss', 'fixtures', 'sample.rss'),
  'utf8',
);
const atomFixture = readFileSync(
  path.join(process.cwd(), 'src', 'rss', 'fixtures', 'sample.atom'),
  'utf8',
);
const now = new Date('2026-11-03T12:00:00.000Z');

function sourceInput(
  overrides: Partial<{
    name: string;
    mode: 'all' | 'topics';
    topics: string[];
    region: string | null;
    active: boolean;
  }> = {},
) {
  const name = overrides.name ?? 'Source';
  return {
    name,
    website: 'https://news.example.test',
    rssUrl: `https://${name.toLowerCase().replace(/\s+/g, '-')}.example.test/feed`,
    mode: overrides.mode ?? 'all',
    topics: overrides.topics ?? [],
    region: overrides.region ?? null,
    intervalMinutes: 60 as const,
    active: overrides.active ?? true,
  };
}

function feedXml(title: string, link: string, date = 'Tue, 03 Nov 2026 10:00:00 GMT'): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title><link>https://feed.example.test</link><description>Test feed</description><item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate><description>Short test summary.</description></item></channel></rss>`;
}

function response(xml: string, status = 200, headers?: HeadersInit): Response {
  return new Response(status === 304 ? null : xml, { status, headers });
}

describe('feed normalization and categorization', () => {
  it('strips HTML and clamps summaries at a word boundary', () => {
    expect(stripHtml('<p>Health <strong>news</strong> &amp; updates</p>')).toBe(
      'Health news & updates',
    );
    const summary = clampSummary(`${'word '.repeat(60)}`, 40);
    expect(summary.length).toBeLessThanOrEqual(40);
    expect(summary.endsWith('…')).toBe(true);
    expect(summary.slice(0, -1)).not.toMatch(/\s$/);
  });

  it('assigns each configured category and a single uncategorized fallback', () => {
    expect(CATEGORY_RULES).toHaveLength(6);
    expect(categorize('Vaccine outbreak advisory', '')).toBe('Outbreaks and public health');
    expect(categorize('Drug recall and approval', '')).toBe('Drugs and approvals');
    expect(categorize('Clinical trial phase 3 study', '')).toBe('Clinical trials and research');
    expect(categorize('Telemedicine EHR wearable', '')).toBe('Digital health and AI');
    expect(categorize('Health policy guideline regulation', '')).toBe('Policy and regulation');
    expect(categorize('Hospital acquisition partnership', '')).toBe('Hospitals and industry');
    expect(categorize('A local clinic opens its doors', '')).toBe('Uncategorized');
    expect(categorize('A VACCINE advisory', '')).toBe('Outbreaks and public health');
    expect(categorize('A vaccine and drug recall', '')).toBe('Outbreaks and public health');
    expect(categorize('Vaccination program launched', '')).toBe('Uncategorized');
  });

  it('normalizes links by removing tracking parameters and trailing slashes', () => {
    expect(normalizeLink('https://News.Example.test/story/?utm_source=mail&fbclid=abc#top')).toBe(
      'https://news.example.test/story',
    );
  });

  it('filters specific topics and optional region without affecting all-updates mode', () => {
    expect(
      matchesSourceTopics(
        { mode: 'topics', topics: ['vaccine'], region: 'north' },
        'North region vaccine advisory',
        '',
      ),
    ).toBe(true);
    expect(
      matchesSourceTopics(
        { mode: 'topics', topics: ['vaccine'], region: 'south' },
        'North region vaccine advisory',
        '',
      ),
    ).toBe(false);
    expect(
      matchesSourceTopics(
        { mode: 'topics', topics: ['vaccine'], region: null },
        'Hospital funding',
        '',
      ),
    ).toBe(false);
    expect(
      matchesSourceTopics({ mode: 'topics', topics: [], region: null }, 'Vaccine advisory', ''),
    ).toBe(false);
    expect(
      matchesSourceTopics({ mode: 'all', topics: [], region: null }, 'Hospital funding', ''),
    ).toBe(true);
  });
});

describe('RSS and Atom fetching', () => {
  it('parses RSS and Atom feeds and stores no article body', async () => {
    const repo = new MemoryFeedRepository();
    const source = await repo.createSource(sourceInput());
    const service = new FeedService(repo, repo, {
      now: () => now,
      fetcher: async (url) =>
        response(url.toString().startsWith('https://atom') ? atomFixture : rssFixture),
    });

    await service.fetchSource(source);
    const atom = await repo.createSource({
      ...sourceInput({ name: 'Atom' }),
      rssUrl: 'https://atom.example.test/feed',
    });
    await service.fetchSource(atom);
    const items = await repo.listNewsForTest();

    expect(items).toHaveLength(3);
    expect(items.some((item) => item.category === 'Clinical trials and research')).toBe(true);
    expect(items.map((item) => Object.keys(item))).not.toContain('body');
    expect(items.every((item) => !JSON.stringify(item).includes('Long article body'))).toBe(true);
    expect(Object.keys(newsItems)).not.toContain('body');
    expect(Object.keys(newsItems)).not.toContain('articleBody');
  });

  it('collects all updates or only matching configured topics', async () => {
    const repo = new MemoryFeedRepository();
    const all = await repo.createSource(sourceInput({ name: 'All' }));
    const topicOnly = await repo.createSource(
      sourceInput({ name: 'Topics', mode: 'topics', topics: ['vaccine'] }),
    );
    const service = new FeedService(repo, repo, {
      now: () => now,
      fetcher: async () => response(rssFixture),
    });

    await service.fetchSource(all);
    const topicResult = await service.fetchSource(topicOnly);
    const items = await repo.listNewsForTest();

    expect(items.filter((item) => item.sourceId === all.id)).toHaveLength(2);
    expect(topicResult.insertedCount).toBe(0);
    expect(topicResult.duplicateCount).toBe(1);
    expect(items.filter((item) => item.sourceId === topicOnly.id)).toHaveLength(1);
  });

  it('deduplicates tracking-link variants and keeps the earliest canonical item', async () => {
    const repo = new MemoryFeedRepository();
    const first = await repo.createSource(sourceInput({ name: 'First' }));
    const second = await repo.createSource(sourceInput({ name: 'Second' }));
    const firstFeed = feedXml(
      'A vaccine advisory for the region',
      'https://news.example.test/story?utm_source=one',
    );
    const secondFeed = feedXml(
      'A vaccine advisory for the region',
      'https://news.example.test/story?fbclid=two',
      'Mon, 02 Nov 2026 10:00:00 GMT',
    );
    const service = new FeedService(repo, repo, {
      now: () => now,
      fetcher: async (url) => response(url.toString().includes('first.') ? firstFeed : secondFeed),
    });

    await service.fetchSource(first);
    const result = await service.fetchSource(second);
    const items = await repo.listNewsForTest();

    expect(result.duplicateCount).toBe(1);
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.sourceId === first.id)?.duplicateOf).toBe(
      items.find((item) => item.sourceId === second.id)?.id,
    );
    expect(items.find((item) => item.sourceId === second.id)?.duplicateOf).toBeNull();
  });

  it('deduplicates highly similar headlines but retains a similar non-duplicate story', async () => {
    const repo = new MemoryFeedRepository();
    const first = await repo.createSource(sourceInput({ name: 'First' }));
    const second = await repo.createSource(sourceInput({ name: 'Second' }));
    const third = await repo.createSource(sourceInput({ name: 'Third' }));
    const headline =
      'Regional health officials issue new vaccine advisory after unusual cases rise in nearby districts';
    const service = new FeedService(repo, repo, {
      now: () => now,
      fetcher: async (url) => {
        if (url.toString().includes('first.')) {
          return response(feedXml(headline, 'https://first.example.test/a'));
        }
        if (url.toString().includes('second.')) {
          return response(
            feedXml(headline.replace('Regional', 'Local'), 'https://second.example.test/b'),
          );
        }
        return response(
          feedXml(
            'Vaccine advisory for children after regional cases rise',
            'https://third.example.test/c',
          ),
        );
      },
    });

    await service.fetchSource(first);
    const duplicate = await service.fetchSource(second);
    const separate = await service.fetchSource(third);
    const items = await repo.listNewsForTest();

    expect(
      headlineSimilarity(headline, headline.replace('Regional', 'Local')),
    ).toBeGreaterThanOrEqual(0.85);
    expect(duplicate.duplicateCount).toBe(1);
    expect(separate.insertedCount).toBe(1);
    expect(items).toHaveLength(3);
  });

  it('sends conditional headers and handles not-modified responses', async () => {
    const repo = new MemoryFeedRepository();
    const source = await repo.createSource(sourceInput());
    await repo.updateFetchState(source.id, {
      fetchedAt: new Date(now.getTime() - 3_600_000),
      status: 'ok',
      etag: '"feed-v1"',
      lastModified: 'Mon, 02 Nov 2026 10:00:00 GMT',
    });
    let requestHeaders: Headers | undefined;
    const service = new FeedService(repo, repo, {
      now: () => now,
      fetcher: async (_url, init) => {
        requestHeaders = new Headers(init?.headers);
        return response('', 304);
      },
    });

    const result = await service.fetchSource((await repo.findSource(source.id))!);
    const updated = await repo.findSource(source.id);

    expect(requestHeaders?.get('if-none-match')).toBe('"feed-v1"');
    expect(requestHeaders?.get('if-modified-since')).toBe('Mon, 02 Nov 2026 10:00:00 GMT');
    expect(result.itemCount).toBe(0);
    expect(updated?.lastStatus).toBe('not_modified');
  });

  it('retries transient errors and isolates failed feeds from healthy feeds', async () => {
    const repo = new MemoryFeedRepository();
    const broken = await repo.createSource(sourceInput({ name: 'Broken' }));
    const healthy = await repo.createSource(sourceInput({ name: 'Healthy' }));
    let retries = 0;
    const service = new FeedService(repo, repo, {
      now: () => now,
      fetcher: async (url) => {
        if (url.toString().includes('broken.')) {
          retries += 1;
          return response('unavailable', 404);
        }
        return response(rssFixture);
      },
      log: () => undefined,
    });

    const log = vi.fn();
    await runDueFeedsOnce(repo, service, now, log);

    expect(retries).toBe(3);
    expect(log).toHaveBeenCalledOnce();
    expect((await repo.findSource(broken.id))?.lastStatus).toBe('Feed returned HTTP 404');
    expect((await repo.findSource(healthy.id))?.lastStatus).toBe('ok');
    expect((await repo.listNewsForTest()).some((item) => item.sourceId === healthy.id)).toBe(true);
  });

  it('handles timeout, malformed XML, and 404 feeds without stopping another source', async () => {
    const repo = new MemoryFeedRepository();
    const notFound = await repo.createSource(sourceInput({ name: 'Not Found' }));
    const malformed = await repo.createSource(sourceInput({ name: 'Malformed' }));
    const timedOut = await repo.createSource(sourceInput({ name: 'Timed Out' }));
    const healthy = await repo.createSource(sourceInput({ name: 'Healthy' }));
    const service = new FeedService(repo, repo, {
      now: () => now,
      fetcher: async (url) => {
        const address = url.toString();
        if (address.includes('not-found')) return response('missing', 404);
        if (address.includes('malformed')) return response('<rss><channel><item><title>');
        if (address.includes('timed-out')) throw new DOMException('Timed out', 'TimeoutError');
        return response(rssFixture);
      },
      log: () => undefined,
    });
    const log = vi.fn();

    await runDueFeedsOnce(repo, service, now, log);

    expect(log).toHaveBeenCalledTimes(3);
    expect((await repo.findSource(notFound.id))?.lastStatus).toBe('Feed returned HTTP 404');
    expect((await repo.findSource(malformed.id))?.lastStatus).toBe('feed_error');
    expect((await repo.findSource(timedOut.id))?.lastStatus).toBe('timeout');
    expect((await repo.findSource(healthy.id))?.lastStatus).toBe('ok');
  });
});

describe('retention', () => {
  afterEach(() => vi.restoreAllMocks());

  it('removes news and delivery records older than their configured limits', async () => {
    const repo = new MemoryFeedRepository();
    await repo.addNewsForTest(
      { sourceId: 'old-source', headline: 'Old story' },
      new Date('2026-01-01T00:00:00Z'),
    );
    await repo.addNewsForTest(
      { sourceId: 'new-source', headline: 'Recent story' },
      new Date('2026-10-01T00:00:00Z'),
    );
    await repo.addDeliveryForTest(new Date('2026-01-01T00:00:00Z'));
    await repo.addDeliveryForTest(new Date('2026-10-01T00:00:00Z'));

    const result = await runRetention(repo, {
      newsDays: 90,
      deliveryDays: 180,
      now: () => now,
    });

    expect(result).toEqual({ newsDeleted: 1, deliveriesDeleted: 1 });
    expect((await repo.listNewsForTest()).map((item) => item.headline)).toEqual(['Recent story']);
    expect(await repo.countDeliveriesForTest()).toBe(1);
  });
});
