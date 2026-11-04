# Phase 3 — Landing Page, Live Dashboard, and News Feed

Date: 2026-11-04  
Gate mode: MANUAL

## What was built

- Authenticated `GET /api/dashboard/live` with India-local daily metrics, latest non-duplicate items, connection states, and content-based ETags that return `304` for unchanged snapshots.
- Authenticated news listing with category, source, date-range, and keyword filters, stable newest-first pagination, and an importance toggle.
- Dashboard with six module entries, username and role, live summary cards, connection indicators, and latest items.
- News Feed with safe external article links, two-line summaries, filters, pagination, working importance controls, and disabled send buttons clearly labeled as not connected yet.
- Dashboard polling every five seconds, slowed to ten seconds when hidden and paused while offline.
- Playwright browser smoke coverage for polling updates and 360px/desktop layouts.

## How to run

```bash
npm ci
npm run dev
npm run test:e2e -w @healthcare/web
```

The API uses the configured PostgreSQL database. The browser smoke test intercepts API calls with deterministic fixtures.

## Verification

| Check                                 | Result                                                     |
| ------------------------------------- | ---------------------------------------------------------- |
| `npm run lint`                        | PASS                                                       |
| `npm run typecheck`                   | PASS — shared, API, and web                                |
| `npm test`                            | PASS — API 44/44, web 5/5, shared 2/2                      |
| `npm run build`                       | PASS — shared, API, and web                                |
| `npm run test:e2e -w @healthcare/web` | PASS — dashboard polling, News Feed, and responsive layout |
| Focused Prettier check                | PASS — all Phase 3 files                                   |
| Secret review                         | PASS — no real credentials found                           |

The production web build reports an 806.21 kB minified JavaScript chunk (194.76 kB gzip), above Vite's 500 kB advisory threshold.

## Known gaps / blocked

1. Database-backed integration was not run against Neon because credentials are unavailable; API behavior is tested with the in-memory repositories. See `OPEN_QUESTIONS.md` item 15.
2. WhatsApp and email indicators read persisted connection status only; real checks remain in Phase 5.
3. The Playwright smoke test uses mocked API responses, not a live PostgreSQL instance.
4. Failed-delivery count covers all retained failed deliveries; the deliveries-today metric is day-limited.

## Acceptance evidence

- Dashboard metrics, connection states, authentication, and conditional ETags: `apps/api/src/dashboard.test.ts`.
- Category/source/date/search filters, duplicate exclusion, pagination, and marking important: `apps/api/src/dashboard.test.ts`.
- News Feed interactions and safe article links: `apps/web/src/pages/NewsFeedPage.test.tsx`.
- Poll-driven dashboard updates, six navigation entries, and mobile/desktop overflow checks: `apps/web/e2e/dashboard.e2e.ts`.
- Polling intervals and offline pause: `apps/web/src/pages/HomePage.tsx`.
- Feed items expose only headline, summary, source, category, dates, and link; duplicate rows are excluded by `apps/api/src/repositories/postgres-dashboard.ts`.
