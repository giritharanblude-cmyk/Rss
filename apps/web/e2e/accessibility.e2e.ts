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

test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:4173/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') {
      await route.fulfill({ json: { user } });
    } else if (url.pathname === '/api/dashboard/live') {
      await route.fulfill({
        json: {
          itemsToday: 1,
          activeSources: 1,
          recipients: 0,
          deliveriesToday: 0,
          failedDeliveries: 0,
          latestItems: [newsItem],
          lastFetchAt: newsItem.fetchedAt,
          connections: { whatsapp: true, email: false },
        },
      });
    } else if (url.pathname === '/api/sources') {
      await route.fulfill({ json: { sources: [source] } });
    } else if (url.pathname === '/api/news') {
      await route.fulfill({ json: { items: [newsItem], page: 1, pageSize: 20, total: 1 } });
    } else {
      await route.fulfill({ json: {} });
    }
  });
});

test('keyboard navigation, labels, and non-colour status cues work', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // The skip link is the first stop and moves focus into the main region.
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  // Connection lights state the condition in words as well as colour.
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await expect(page.getByText('Not working', { exact: true })).toBeVisible();

  // The module navigation is reachable backwards from the main region and
  // activates with the keyboard. Reverse order: Settings, Delivery Log,
  // Alerts, Recipients, Sources, News Feed.
  for (let press = 0; press < 6; press += 1) {
    await page.keyboard.press('Shift+Tab');
  }
  const newsLink = page.getByRole('link', { name: 'News Feed', exact: true });
  await expect(newsLink).toBeFocused();
  const outline = await newsLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.outlineWidth, style: style.outlineStyle };
  });
  expect(outline.style).not.toBe('none');
  expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/news$/);
  await expect(page.getByRole('heading', { name: 'News Feed', level: 1 })).toBeVisible();

  // Every form control has an accessible name.
  const unnamed = await page.locator('input, select, textarea').evaluateAll((elements) =>
    elements
      .filter((element) => {
        const control = element as HTMLInputElement;
        if (control.type === 'hidden') return false;
        const labels = (control as HTMLElement & { labels?: NodeList | null }).labels;
        const name =
          control.getAttribute('aria-label') ??
          control.getAttribute('aria-labelledby') ??
          labels?.[0]?.textContent ??
          '';
        return name.trim().length === 0;
      })
      .map((element) => element.outerHTML),
  );
  expect(unnamed).toEqual([]);

  await expect(page.getByLabel('Keyword')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Read full article' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
});
