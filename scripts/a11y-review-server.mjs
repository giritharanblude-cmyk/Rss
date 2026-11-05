/**
 * Review-only web server for accessibility audits.
 *
 * Serves the production build from `apps/web/dist` and answers `/api/*` with
 * fixed sample data so authenticated pages can be audited without a database
 * or live delivery credentials. This is not part of the deployed application.
 *
 * Usage:
 *   npm run build
 *   node scripts/a11y-review-server.mjs
 *   npx lighthouse@12.8.2 http://127.0.0.1:4180/ --only-categories=accessibility
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'apps', 'web', 'dist');
const now = '2026-11-04T08:00:00.000Z';
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

const user = { id: uuid(1), name: 'Admin', role: 'master' };
const source = {
  id: uuid(2),
  name: 'Health News',
  website: 'https://news.example.test',
  rssUrl: 'https://news.example.test/feed.xml',
  mode: 'all',
  topics: [],
  region: null,
  intervalMinutes: 60,
  active: true,
  lastFetchedAt: now,
  lastStatus: 'ok',
  createdAt: now,
};
const item = {
  id: uuid(3),
  sourceId: source.id,
  sourceName: source.name,
  headline: 'Vaccine advisory for hospitals',
  summary: 'New vaccine guidance for clinicians and hospital teams.',
  link: 'https://news.example.test/story',
  category: 'Outbreaks and public health',
  publishedAt: now,
  fetchedAt: now,
  important: false,
};
const recipient = {
  id: uuid(4),
  name: 'Dr Meera Rao',
  whatsappE164: '+919876543210',
  email: 'meera@example.test',
  topics: ['Outbreaks and public health'],
  channel: 'both',
  consentStatus: 'granted',
  consentAt: now,
  consentNote: 'Agreed on call, 2 Nov',
  createdAt: now,
};

const responses = {
  '/api/auth/me': { user },
  '/api/dashboard/live': {
    itemsToday: 4,
    activeSources: 2,
    recipients: 3,
    deliveriesToday: 6,
    failedDeliveries: 1,
    latestItems: [item],
    lastFetchAt: now,
    connections: { whatsapp: true, email: true },
  },
  '/api/news': { items: [item], page: 1, pageSize: 20, total: 1 },
  '/api/sources': { sources: [source] },
  '/api/recipients': { recipients: [recipient] },
  '/api/alert-rules': { rules: [] },
  '/api/deliveries': { items: [], page: 1, pageSize: 20, total: 0 },
  '/api/settings/email': {
    settings: {
      host: 'smtp.hostinger.com',
      port: 465,
      secure: true,
      user: 'news@example.test',
      fromName: 'Healthcare News Desk',
      fromEmail: 'news@example.test',
    },
    passwordConfigured: true,
  },
  '/api/settings/connections': {
    connections: [
      { service: 'email', state: 'working', checkedAt: now, detail: 'SMTP verified' },
      { service: 'whatsapp', state: 'connected', checkedAt: now, detail: 'Socket connected' },
    ],
  },
  '/api/health': {
    status: 'ok',
    service: 'healthcare-rss-api',
    version: '0.0.0',
    uptimeSeconds: 100,
    timestamp: now,
    databaseSizeBytes: 120_000_000,
  },
  '/api/members': { members: [] },
};

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(responses[url.pathname] ?? {}));
    return;
  }
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = normalize(join(dist, path));
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': contentTypes[extname(file)] ?? 'application/octet-stream',
    });
    response.end(body);
  } catch {
    const body = await readFile(join(dist, 'index.html'));
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(body);
  }
}).listen(4180, '127.0.0.1', () => {
  process.stdout.write('Accessibility review server: http://127.0.0.1:4180\n');
});
