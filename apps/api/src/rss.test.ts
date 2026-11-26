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
  it('discovers at most five valid RSS or Atom links and skips failed candidates', async () => {
    const repo = new MemoryFeedRepository();
    const service = new FeedService(repo, repo, {
      fetcher: async (url) => {
        if (url.toString() === 'https://site.example.test/') {
          return response(`<!doctype html><html><head>
            <link rel="alternate" type="application/rss+xml" href="/valid.xml">
            <link rel="alternate" type="application/atom+xml" href="/missing.xml">
            <link rel="alternate" type="application/rss+xml" href="/broken.xml">
            <link rel="stylesheet" type="application/rss+xml" href="/ignored.xml">
          </head></html>`);
        }
        if (url.toString().endsWith('/missing.xml')) return response('missing', 404);
        if (url.toString().endsWith('/broken.xml')) return response('<!doctype html><html>not feed</html>');
        return response(rssFixture);
      },
      validateUrl: async () => undefined,
    });

    const result = await service.discoverFeeds('https://site.example.test/');

    expect(result.feeds).toHaveLength(1);
    expect(result.feeds[0]).toMatchObject({
      url: 'https://site.example.test/valid.xml',
      format: 'rss2',
      itemCount: 2,
    });
    expect(result.feeds[0]?.sampleHeadlines).toHaveLength(2);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://site.example.test/missing.xml',
          reason: 'HTTP 404',
        }),
        expect.objectContaining({
          url: 'https://site.example.test/broken.xml',
        }),
      ]),
    );
  });

  it('reads Link headers and probes the eight common same-origin paths only when declarations are absent', async () => {
    const repo = new MemoryFeedRepository();
    const headerProbeCalls: string[] = [];
    const headerService = new FeedService(repo, repo, {
      fetcher: async (_url) =>
        response(
          rssFixture,
          200,
          {
            link: '<https://site.example.test/rss.xml>; rel="alternate"; type="application/rss+xml"',
          },
        ),
      validateUrl: async () => undefined,
    });

    const headerResult = await headerService.discoverFeeds('https://site.example.test/');
    expect(headerResult.feeds).toHaveLength(1);
    expect(headerResult.feeds[0]?.format).toBe('rss2');

    const fallbackService = new FeedService(repo, repo, {
      fetcher: async (url) => {
        const address = url.toString();
        if (address === 'https://site.example.test/') {
          return response('<!doctype html><html><head></head><body>No feed declared</body></html>');
        }
        headerProbeCalls.push(address);
        if (address === 'https://site.example.test/rss.xml') {
          return response(rssFixture);
        }
        return response('missing', 404);
      },
      validateUrl: async () => undefined,
    });

    const fallbackResult = await fallbackService.discoverFeeds('https://site.example.test/');
    expect(headerProbeCalls).toHaveLength(8);
    expect(fallbackResult.feeds).toHaveLength(1);
    expect(fallbackResult.feeds[0]?.format).toBe('rss2');
  });

  it('rejects HTML, sitemap XML, invalid XML and empty RSS feeds', async () => {
    const repo = new MemoryFeedRepository();
    const service = new FeedService(repo, repo, {
      fetcher: async (url) => {
        if (url.toString() === 'https://site.example.test/') {
          return response(`<!doctype html><html><head>
            <link rel="alternate" type="application/rss+xml" href="/html.xml">
            <link rel="alternate" type="application/rss+xml" href="/sitemap.xml">
            <link rel="alternate" type="application/rss+xml" href="/invalid.xml">
            <link rel="alternate" type="application/rss+xml" href="/empty.xml">
          </head></html>`);
        }
        if (url.toString().endsWith('/html.xml')) return response('<html><body>Not a feed</body></html>');
        if (url.toString().endsWith('/sitemap.xml')) {
          return response('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
        }
        if (url.toString().endsWith('/invalid.xml')) return response('<rss><channel>');
        return response('<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title><link>https://site.example.test</link><description>Empty</description></channel></rss>');
      },
      validateUrl: async () => undefined,
    });

    const result = await service.discoverFeeds('https://site.example.test/');
    expect(result.feeds).toHaveLength(0);
    expect(result.skipped).toHaveLength(4);
  });

  it('discovers qualifying body and footer anchors, resolves relatives, and ignores duplicates and cross-origin links', async () => {
    const repo = new MemoryFeedRepository();
    const websiteCalls: string[] = [];
    const candidateCalls: string[] = [];
    const service = new FeedService(repo, repo, {
      fetcher: async (url) => {
        const address = url.toString();
        if (address === 'https://site.example.test/') {
          websiteCalls.push(address);
          return response(`<!doctype html><html><body>
            <a href="/rss.xml">RSS</a>
            <footer><a href="/footer-feed">RSS Feed</a></footer>
            <a href="/subscribe">Subscribe to updates</a>
            <a href="/feed.xml">Footer RSS</a>
            <a href="https://outside.example.test/rss.xml">External RSS</a>
            <a href="/bare.xml">Downloads</a>
            <a href="/duplicate">News feed</a>
          </body></html>`);
        }
        candidateCalls.push(address);
        if (address === 'https://site.example.test/rss.xml') return response(rssFixture);
        if (address === 'https://site.example.test/subscribe') {
          return response('<!doctype html><html><body>Not a feed</body></html>');
        }
        if (address.endsWith('/footer-feed')) return response(rssFixture);
        return response('missing', 404);
      },
      validateUrl: async () => undefined,
    });

    const result = await service.discoverFeeds('https://site.example.test/');

    expect(websiteCalls).toEqual(['https://site.example.test/']);
    expect(candidateCalls).toContain('https://site.example.test/rss.xml');
    expect(candidateCalls).toContain('https://site.example.test/subscribe');
    expect(candidateCalls).toContain('https://site.example.test/footer-feed');
    expect(candidateCalls).not.toContain('https://outside.example.test/rss.xml');
    expect(candidateCalls).not.toContain('https://site.example.test/bare.xml');
    expect(result.feeds.some((feed) => feed.url.endsWith('/rss.xml'))).toBe(true);
  });

  it('fetches and validates a same-origin body link ending in /rss.cms', async () => {
    const repo = new MemoryFeedRepository();
    const candidateCalls: string[] = [];
    const service = new FeedService(repo, repo, {
      fetcher: async (url) => {
        const address = url.toString();
        if (address === 'https://site.example.test/') {
          return response('<!doctype html><html><body><a href="/rss.cms">Archive</a></body></html>');
        }
        candidateCalls.push(address);
        return address === 'https://site.example.test/rss.cms'
          ? response(rssFixture)
          : response('missing', 404);
      },
      validateUrl: async () => undefined,
    });

    const result = await service.discoverFeeds('https://site.example.test/');

    expect(candidateCalls).toContain('https://site.example.test/rss.cms');
    expect(result.feeds).toHaveLength(1);
    expect(result.feeds[0]).toMatchObject({
      url: 'https://site.example.test/rss.cms',
      format: 'rss2',
    });
  });

  it('caps body candidates at three and keeps a duplicate of a Phase 1 candidate from being fetched twice', async () => {
    const repo = new MemoryFeedRepository();
    const candidateCalls: string[] = [];
    const service = new FeedService(repo, repo, {
      fetcher: async (url) => {
        const address = url.toString();
        if (address === 'https://site.example.test/') {
          return response(`<!doctype html><html><body>
            <a href="/rss.xml">RSS</a>
            <a href="/feed/one">RSS</a>
            <a href="/feed/two">Subscribe</a>
            <a href="/feed/three">Atom</a>
            <a href="/feed/four">XML Feed</a>
          </body></html>`, 200, {
            link: '<https://site.example.test/rss.xml>; rel="alternate"; type="application/rss+xml"',
          });
        }
        candidateCalls.push(address);
        return response('missing', 404);
      },
      validateUrl: async () => undefined,
    });

    await service.discoverFeeds('https://site.example.test/');

    expect(candidateCalls.filter((address) => address === 'https://site.example.test/rss.xml')).toHaveLength(1);
    expect(candidateCalls.filter((address) => address.includes('/feed/')).length).toBeLessThanOrEqual(3);
  });

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
    expect(result.skippedCount).toBe(0);
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.sourceId === first.id)?.duplicateOf).toBe(
      items.find((item) => item.sourceId === second.id)?.id,
    );
    expect(items.find((item) => item.sourceId === second.id)?.duplicateOf).toBeNull();
  });

  it('skips a previously stored normalized link for the same source and reports the count', async () => {
    const repo = new MemoryFeedRepository();
    const source = await repo.createSource(sourceInput());
    let fetchCount = 0;
    const service = new FeedService(repo, repo, {
      now: () => now,
      fetcher: async () => {
        fetchCount += 1;
        return response(
          feedXml(
            fetchCount === 1 ? 'A vaccine advisory for the region' : 'A completely different story',
            fetchCount === 1
              ? 'https://news.example.test/story/?utm_source=mail'
              : 'https://news.example.test/story',
          ),
        );
      },
    });

    const first = await service.fetchSource(source);
    const second = await service.fetchSource(source);
    const items = await repo.listNewsForTest();

    expect(first.insertedCount).toBe(1);
    expect(first.skippedCount).toBe(0);
    expect(second).toMatchObject({
      itemCount: 1,
      insertedCount: 0,
      duplicateCount: 0,
      skippedCount: 1,
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.sourceId).toBe(source.id);
  });

  it('stores a new same-source item when another item in that fetch is skipped', async () => {
    const repo = new MemoryFeedRepository();
    const source = await repo.createSource(sourceInput());
    let feed = feedXml('A vaccine advisory for the region', 'https://news.example.test/story');
    const service = new FeedService(repo, repo, {
      now: () => now,
      fetcher: async () => response(feed),
    });

    await service.fetchSource(source);
    feed = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Test</title><link>https://feed.example.test</link><description>Test feed</description>
          <item>
            <title>A vaccine advisory for the region</title>
            <link>https://news.example.test/story</link>
            <pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate>
            <description>Short test summary.</description>
          </item>
          <item>
            <title>Hospital funding announcement</title>
            <link>https://news.example.test/funding</link>
            <pubDate>Tue, 03 Nov 2026 11:00:00 GMT</pubDate>
            <description>Another short summary.</description>
          </item>
        </channel>
      </rss>`;

    const result = await service.fetchSource(source);
    const items = await repo.listNewsForTest();

    expect(result.insertedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(items).toHaveLength(2);
    expect(items.some((item) => item.link === 'https://news.example.test/funding')).toBe(true);
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
    expect(updated?.lastStatus).toBe('no_new_items');
  });

  it('sets ok for new items and no_new_items for only duplicates', async () => {
    const repo = new MemoryFeedRepository();
    const source = await repo.createSource(sourceInput());
    const service = new FeedService(repo, repo, {
      now: () => now,
      fetcher: async () => response(feedXml('A new advisory', 'https://news.example.test/new')),
    });

    await service.fetchSource(source);
    expect((await repo.findSource(source.id))?.lastStatus).toBe('ok');

    await service.fetchSource((await repo.findSource(source.id))!);
    expect((await repo.findSource(source.id))?.lastStatus).toBe('no_new_items');
  });

  it('rejects web pages and keeps valid empty RSS feeds as no new items', async () => {
    const repo = new MemoryFeedRepository();
    const page = await repo.createSource(sourceInput({ name: 'Web page' }));
    const empty = await repo.createSource(sourceInput({ name: 'Empty feed' }));
    const service = new FeedService(repo, repo, {
      now: () => now,
      fetcher: async (url) =>
        url.toString().includes('web-page')
          ? response('<!doctype html><html><body>News website</body></html>')
          : response(
              '<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title><link>https://news.example.test</link><description>Empty</description></channel></rss>',
            ),
      log: () => undefined,
    });

    await expect(service.fetchSource(page)).rejects.toThrow(
      'This address is not a news feed.',
    );
    expect((await repo.findSource(page.id))?.lastStatus).toBe('feed_error');
    expect((await repo.findSource(page.id))?.lastErrorMessage).toBe(
      'This address is not a news feed.',
    );

    await service.fetchSource(empty);
    expect((await repo.findSource(empty.id))?.lastStatus).toBe('no_new_items');
  });

  it('marks a valid RSS feed with items as ok', async () => {
    const repo = new MemoryFeedRepository();
    const source = await repo.createSource(sourceInput());
    const service = new FeedService(repo, repo, {
      now: () => now,
      fetcher: async () => response(feedXml('A new advisory', 'https://news.example.test/item')),
    });

    await service.fetchSource(source);
    expect((await repo.findSource(source.id))?.lastStatus).toBe('ok');
  });

  it('stores a fetch failure message and clears it after a later success', async () => {
    const repo = new MemoryFeedRepository();
    const source = await repo.createSource(sourceInput());
    let failing = true;
    const service = new FeedService(repo, repo, {
      now: () => now,
      fetcher: async () => {
        if (failing) return response('unavailable', 404);
        return response(feedXml('Recovered advisory', 'https://news.example.test/recovered'));
      },
      log: () => undefined,
    });

    await expect(service.fetchSource(source)).rejects.toThrow('Feed returned HTTP 404');
    expect((await repo.findSource(source.id))?.lastErrorMessage).toBe('Feed returned HTTP 404');

    failing = false;
    await service.fetchSource((await repo.findSource(source.id))!);
    expect((await repo.findSource(source.id))?.lastErrorMessage).toBeNull();
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
