import { expect, test } from '@playwright/test';

const user = {
  id: '00000000-0000-4000-8000-000000000000',
  name: 'Admin',
  role: 'master',
};

const source = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Health News',
  website: 'https://news.example.test',
  rssUrl: 'https://news.example.test/feed.xml',
  mode: 'all',
  topics: [],
  region: null,
  intervalMinutes: 60,
  active: true,
  lastFetchedAt: null,
  lastStatus: null,
  createdAt: '2026-11-03T08:00:00.000Z',
};

const newsItem = {
  id: '00000000-0000-4000-8000-000000000002',
  sourceId: source.id,
  sourceName: source.name,
  headline: 'Vaccine advisory for hospitals',
  summary: 'New vaccine guidance for clinicians.',
  link: 'https://news.example.test/story',
  category: 'Outbreaks and public health',
  publishedAt: '2026-11-03T08:00:00.000Z',
  fetchedAt: '2026-11-03T08:00:00.000Z',
  important: false,
};

const polledItem = {
  ...newsItem,
  id: '00000000-0000-4000-8000-000000000003',
  headline: 'Newly fetched item appears without refresh',
};

test('dashboard and News Feed work at mobile and desktop widths', async ({ page }) => {
  let dashboardPolls = 0;
  await page.route('http://127.0.0.1:4173/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') {
      await route.fulfill({ json: { user } });
    } else if (url.pathname === '/api/dashboard/live') {
      dashboardPolls += 1;
      await route.fulfill({
        headers: { etag: `"smoke-test-${dashboardPolls}"` },
        json: {
          itemsToday: dashboardPolls > 1 ? 2 : 1,
          activeSources: 1,
          recipients: 0,
          deliveriesToday: 0,
          failedDeliveries: 0,
          latestItems: dashboardPolls > 1 ? [polledItem, newsItem] : [newsItem],
          lastFetchAt: newsItem.fetchedAt,
          connections: { whatsapp: false, email: false },
        },
      });
    } else if (url.pathname === '/api/sources') {
      await route.fulfill({ json: { sources: [source] } });
    } else if (url.pathname === '/api/news') {
      await route.fulfill({ json: { items: [newsItem], page: 1, pageSize: 20, total: 1 } });
    } else {
      await route.fulfill({ json: { id: newsItem.id, important: true } });
    }
  });

  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Items today')).toBeVisible();
  await expect(page.getByText('Disconnected')).toBeVisible();
  await expect(page.getByRole('link', { name: polledItem.headline })).toBeVisible({
    timeout: 8_000,
  });
  await expect(
    page.getByRole('navigation', { name: 'Modules' }).locator('.module-link'),
  ).toHaveCount(6);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  await page.getByRole('link', { name: 'News Feed', exact: true }).click();
  await expect(page.getByRole('heading', { name: newsItem.headline })).toBeVisible();
  await page.getByLabel('Keyword').fill('vaccine');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByRole('link', { name: 'Read full article' })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('heading', { name: newsItem.headline })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});
