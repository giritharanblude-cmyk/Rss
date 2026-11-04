# Phase 5 — Delivery

Date: 2026-11-04

Gate mode: MANUAL

## What was built

- Durable email and WhatsApp delivery jobs using the existing `jobs` and `deliveries` tables, with a unique idempotency index and matching Drizzle snapshot.
- Consent recheck immediately before sending, three total attempts with 30-second and 120-second retry delays, and STOP-triggered consent revocation plus a single unsubscribe confirmation.
- Digest and instant-alert scheduling, Send now actions, message templates, and randomized 3–5 second WhatsApp send spacing.
- SMTP settings and test-send controls, with AES-256-GCM encrypted settings at rest and password-free settings responses.
- OpenWA socket adapter, periodic and on-demand connection checks, and delivery status indicators.
- Delivery Log filters, CSV/XLSX exports, failed-delivery resend, Settings and Delivery Log pages, and navigation updates.
- Deployment configuration for a separately hosted OpenWA service reachable from the API container.

The configured OpenWA client reports socket connectivity only; it does not expose QR data or linked-account status. The Settings page explicitly directs operators to scan the QR code on the OpenWA host and does not treat socket connectivity as proof of a linked account.

## Verification

| Check                                    | Result                                                 |
| ---------------------------------------- | ------------------------------------------------------ |
| `npm run lint`                           | PASS                                                   |
| `npm run typecheck`                      | PASS — shared, API, and web                            |
| `npm test`                               | PASS — API 61/61, web 11/11, shared 2/2                |
| `npm run build`                          | PASS — shared, API, and web                            |
| `npm run test:e2e -w @healthcare/web`    | PASS — 1 dashboard/News Feed smoke test                |
| Focused Prettier check                   | PASS — all changed text files                          |
| `npm run db:generate -w @healthcare/api` | PASS — no schema drift                                 |
| XLSX archive/XML validation              | PASS — ZIP integrity and workbook/worksheet XML parsed |
| OpenWA package import on Node 20         | PASS                                                   |

The production web build reports an 840.98 kB minified JavaScript chunk (200.96 kB gzip), above Vite's 500 kB advisory threshold.

## Known gaps / blocked

1. PostgreSQL migration execution and repository behavior were not verified against Neon; credentials are unavailable (see `OPEN_QUESTIONS.md` item 15).
2. Real Hostinger SMTP and WhatsApp sends, account linking, and live connection monitoring were not verified without service credentials (items 16–17).
3. QR provisioning remains on the separately hosted OpenWA service. The installed socket client exposes no QR retrieval API, so this application does not render a QR code or assert linked-account status.
4. Browser-level Playwright coverage remains the dashboard and News Feed smoke test. New Delivery Log and Settings UI behaviors are covered by web component tests; queue, retry, consent, STOP, restart-resume, exports, and connection checks are covered by API tests with mock adapters.

## Acceptance evidence

- Delivery services, templates, retries, and scheduler: `apps/api/src/delivery/`.
- Durable repositories and idempotency migration: `apps/api/src/repositories/postgres-deliveries.ts`, `apps/api/drizzle/0002_delivery_idempotency.sql`, and `apps/api/drizzle/meta/0002_snapshot.json`.
- Settings and delivery endpoints: `apps/api/src/routes/settings.ts` and `apps/api/src/routes/deliveries.ts`.
- Delivery Log, Settings, and Send now UI: `apps/web/src/pages/DeliveryLogPage.tsx`, `apps/web/src/pages/SettingsPage.tsx`, and `apps/web/src/pages/NewsFeedPage.tsx`.
- API acceptance coverage: `apps/api/src/delivery.test.ts`.
- Web acceptance coverage: `apps/web/src/pages/DeliverySettingsPages.test.tsx` and `apps/web/src/pages/NewsFeedPage.test.tsx`.
