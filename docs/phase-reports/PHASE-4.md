# Phase 4 — Recipients, Consent, and Alerts & Schedule

Date: 2026-11-04
Gate mode: MANUAL

## What was built

- Recipient create, edit, search, and delete APIs and UI, with channel-appropriate email/E.164 validation and six selectable healthcare topics.
- Explicit pending/granted/revoked consent states. Granting consent requires a note; revocation immediately removes the recipient from previews.
- Opaque random unsubscribe tokens, public topic-preference pages, and public unsubscribe pages. Token values are never returned by authenticated recipient APIs.
- Digest and instant-important alert-rule CRUD with weekday, local time, timezone, topic, channel, and active settings.
- Consent-safe grouped previews that intersect rule and recipient topics/channels, exclude non-granted recipients, apply per-recipient caps, use the last delivered digest timestamp, and include only important items for instant previews. Previews never send messages.
- Recipients and Alerts & Schedule modules in the application navigation. Delivery Log and Settings remain planned modules.

The existing Phase 1 schema already contains recipients, alert rules, and deliveries, so Phase 4 did not add a migration. The daily 08:00 Asia/Kolkata digest is a UI/preview default and is not persisted until a rule is saved.

## Verification

| Check                                 | Result                                    |
| ------------------------------------- | ----------------------------------------- |
| `npm run lint`                        | PASS                                      |
| `npm run typecheck`                   | PASS — shared, API, and web               |
| `npm test`                            | PASS — API 49/49, web 9/9, shared 2/2     |
| `npm run build`                       | PASS — shared, API, and web               |
| `npm run test:e2e -w @healthcare/web` | PASS — dashboard and News Feed smoke test |
| Focused Prettier check                | PASS — touched files                      |

The production web build reports an 827.93 kB minified JavaScript chunk (198.80 kB gzip), above Vite's 500 kB advisory threshold.

## Known gaps / blocked

1. PostgreSQL behavior was not integration-tested against Neon because credentials are unavailable. API tests use in-memory repositories; see `OPEN_QUESTIONS.md` item 15.
2. Real email and WhatsApp connections and delivery remain unverified without credentials; see items 16–17. Actual sends, scheduling, message construction, retries, and delivery logging remain Phase 5 work.
3. Browser-level Playwright coverage remains the Phase 3 dashboard/News Feed smoke test. Phase 4 recipient, consent, preview, and public-page flows are covered by API and web component tests.
4. Digest history is determined from successful `kind='digest'` delivery rows. Until Phase 5 writes those rows, previews use all retained matching news subject to the configured cap.

## Acceptance evidence

- Recipient contact validation, consent notes, role permissions, public topic updates/unsubscribe, and digest/instant preview exclusions and caps: `apps/api/src/recipients.test.ts`.
- Consent UI, grouped preview UI, public topic management, and unsubscribe: `apps/web/src/pages/Phase4Pages.test.tsx`.
- PostgreSQL repository implementation: `apps/api/src/repositories/postgres-recipients.ts`.
- Public token routes and master-only alert configuration: `apps/api/src/routes/recipients.ts`.
