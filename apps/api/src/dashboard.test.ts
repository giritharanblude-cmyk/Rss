import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, loginAndVerify, seedMember, type TestContext } from './test/helpers';

let context: TestContext;

afterEach(async () => context.app.close());

const sourceInput = {
  name: 'Health News',
  website: 'https://news.example.test',
  rssUrl: 'https://news.example.test/feed.xml',
  mode: 'all' as const,
  topics: [],
  region: null,
  intervalMinutes: 60 as const,
  active: true,
};

describe('dashboard and news routes', () => {
  it('returns live metrics and serves an unchanged snapshot with 304', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const source = await context.feeds.createSource(sourceInput);
    await context.feeds.updateFetchState(source.id, {
      fetchedAt: context.clock.now(),
      status: 'ok',
    });
    await context.feeds.addNewsForTest(
      {
        sourceId: source.id,
        headline: 'New vaccine advisory',
        summary: 'A new public health advisory.',
        category: 'Outbreaks and public health',
        publishedAt: context.clock.now(),
      },
      context.clock.now(),
    );
    context.feeds.setRecipientsCountForTest(3);
    context.feeds.setConnectionStatusForTest('whatsapp', true);
    context.feeds.setConnectionStatusForTest('email', true);
    await context.feeds.addDeliveryStatusForTest(context.clock.now(), 'pending');
    await context.feeds.addDeliveryStatusForTest(
      new Date(context.clock.now().getTime() - 24 * 60 * 60_000),
      'failed',
    );

    const response = await context.app.inject({
      method: 'GET',
      url: '/api/dashboard/live',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      itemsToday: 1,
      activeSources: 1,
      recipients: 3,
      deliveriesToday: 1,
      failedDeliveries: 1,
      connections: { whatsapp: true, email: true },
      latestItems: [{ headline: 'New vaccine advisory', sourceName: 'Health News' }],
    });
    const etag = response.headers.etag;
    expect(etag).toBeTruthy();

    const unchanged = await context.app.inject({
      method: 'GET',
      url: '/api/dashboard/live',
      headers: { cookie, 'if-none-match': etag },
    });
    expect(unchanged.statusCode).toBe(304);
  });

  it('allows masters to mark items important while members can only read news', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const source = await context.feeds.createSource(sourceInput);
    const publishedAt = context.clock.now();
    await context.feeds.addNewsForTest(
      {
        sourceId: source.id,
        headline: 'Vaccine advisory for hospitals',
        summary: 'New vaccine information for clinicians.',
        category: 'Outbreaks and public health',
        publishedAt,
      },
      publishedAt,
    );
    await context.feeds.addNewsForTest(
      {
        sourceId: source.id,
        headline: 'Funding announcement',
        summary: 'Hospital funding news.',
        category: 'Hospitals and industry',
        publishedAt,
        duplicateOf: '00000000-0000-4000-8000-000000000001',
      },
      publishedAt,
    );
    await context.feeds.addNewsForTest(
      {
        sourceId: source.id,
        headline: 'Funding announcement',
        summary: 'Hospital funding news.',
        category: 'Hospitals and industry',
        publishedAt: new Date(publishedAt.getTime() - 60 * 60_000),
      },
      new Date(publishedAt.getTime() - 60 * 60_000),
    );
    await context.feeds.addNewsForTest(
      {
        id: '00000000-0000-4000-8000-000000000004',
        sourceId: source.id,
        headline: 'Earlier health research update',
        summary: 'A prior-day update.',
        category: 'Clinical trials and research',
        publishedAt: new Date('2026-11-02T18:00:00.000Z'),
      },
      new Date('2026-11-02T18:00:00.000Z'),
    );

    const result = await context.app.inject({
      method: 'GET',
      url: `/api/news?category=${encodeURIComponent('Outbreaks and public health')}&sourceId=${source.id}&q=vaccine&from=2026-11-03&to=2026-11-03&page=1&pageSize=1`,
      headers: { cookie },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      total: 1,
      items: [{ headline: 'Vaccine advisory for hospitals', important: false }],
    });
    const item = (result.json() as { items: { id: string }[] }).items[0];
    if (!item) throw new Error('Expected a filtered news item.');

    const update = await context.app.inject({
      method: 'PATCH',
      url: `/api/news/${item.id}/important`,
      headers: { cookie },
      payload: { important: true },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({ id: item.id, important: true });

    const member = await seedMember(context.users, {
      name: 'Mina',
      email: 'mina@example.test',
      password: 'member-password-1',
    });
    const { cookie: memberCookie } = await loginAndVerify(
      context.app,
      context.email,
      member.name,
      'member-password-1',
    );
    const memberRead = await context.app.inject({
      method: 'GET',
      url: `/api/news?sourceId=${source.id}`,
      headers: { cookie: memberCookie },
    });
    const memberUpdate = await context.app.inject({
      method: 'PATCH',
      url: `/api/news/${item.id}/important`,
      headers: { cookie: memberCookie },
      payload: { important: false },
    });
    expect(memberRead.statusCode).toBe(200);
    expect(memberUpdate.statusCode).toBe(403);

    const filteredAgain = await context.app.inject({
      method: 'GET',
      url: `/api/news?sourceId=${source.id}`,
      headers: { cookie },
    });
    const allNews = filteredAgain.json() as {
      items: { id: string; important: boolean }[];
      total: number;
    };
    expect(allNews.total).toBe(3);
    expect(allNews.items[0]).toMatchObject({ id: item.id, important: true });
    const secondPage = await context.app.inject({
      method: 'GET',
      url: `/api/news?sourceId=${source.id}&page=2&pageSize=1`,
      headers: { cookie },
    });
    expect(secondPage.json()).toMatchObject({
      page: 2,
      total: 3,
      items: [{ headline: 'Funding announcement' }],
    });
  });

  it('rejects invalid date ranges and unauthenticated access', async () => {
    context = await createTestContext();
    const anonymous = await context.app.inject({ method: 'GET', url: '/api/news' });
    const invalid = await context.app.inject({
      method: 'GET',
      url: '/api/news?from=2026-11-05&to=2026-11-04',
      headers: {
        cookie: (await loginAndVerify(context.app, context.email, 'Admin', 'master-password-1'))
          .cookie,
      },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(400);
  });
});
