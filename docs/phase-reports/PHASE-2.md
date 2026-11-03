# Phase 2 — RSS Engine

Date: 2026-11-03
Gate mode: MANUAL

## What was built

- Shared source input/response schemas and the seven news categories.
- Authenticated source listing and master-only source create, edit, pause, delete, and feed-test API routes.
- Sources UI with HTTP(S) URL and interval validation, topic/region filters, source actions, and asynchronous feed-test status polling.
- RSS and Atom fetching with per-source intervals, a 10-second timeout, three attempts with exponential backoff, conditional ETag/Last-Modified requests, and isolated source failures.
- Summary normalization, HTML removal, word-boundary clamping, whole-phrase category rules, Specific Topics/region filtering, normalized-link and headline deduplication, and earliest-item canonical handling.
- Scheduled feed fetching and retention; feed-test requests are persisted in the existing `jobs` table and processed by a background worker with expiring claims.
- Tests and fixture feeds covering RSS/Atom, categories, filtering, normalization, deduplication, broken feeds, route authorization, the Sources form, retention, and the absence of an article-body field.

## How to run

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The API requires the existing `DATABASE_URL` configuration for PostgreSQL-backed source, news, retention, and job repositories. Feed fetching, retention, and feed-test processing start with the API server.

## Verification

| Check                       | Result                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`              | PASS                                                                                                                                           |
| `npm run typecheck`         | PASS — shared, API, and web                                                                                                                    |
| `npm test`                  | PASS — API 41/41, web 4/4, shared 2/2                                                                                                          |
| `npm run build`             | PASS — shared, API, and web                                                                                                                    |
| Focused Prettier check      | PASS — all Phase 2 files                                                                                                                       |
| Full `npm run format:check` | BLOCKED by existing formatting drift in 16 untouched files (including Phase 1 sources and existing docs); Phase 2 files pass the focused check |
| Secret review               | PASS — no untracked environment/credential files or real credentials found                                                                     |

## Known gaps / blocked

1. **Live Neon/PostgreSQL verification remains blocked.** No database migration or repository integration was exercised against the real pooled Neon URL because credentials are unavailable. Phase 2 reuses the existing `jobs` table and adds no schema migration. See `OPEN_QUESTIONS.md` item 15.
2. The Phase 0 arm64 Chromium render smoke still needs a real arm64 VM; QEMU rendering remains deferred to deployment (see `OPEN_QUESTIONS.md` item 20).
3. RSS behavior was verified with deterministic fixture feeds and mocked fetch responses; no live external feed was used for acceptance testing.

## Acceptance evidence

- Fetching, normalization, categorization, topic filtering, deduplication, and retention: `apps/api/src/rss.test.ts`.
- Source and feed-test route validation and authorization: `apps/api/src/sources.test.ts`.
- Persisted feed-test queue behavior: `apps/api/src/feed-jobs.test.ts` and `apps/api/src/repositories/postgres-feed-jobs.ts`.
- RSS/Atom fixtures: `apps/api/src/rss/fixtures/sample.rss` and `sample.atom`.
- Source form validation: `apps/web/src/pages/SourcesPage.test.tsx`.
- Database schema contains no article-body column: assertion against `apps/api/src/db/schema.ts` in `rss.test.ts`.
