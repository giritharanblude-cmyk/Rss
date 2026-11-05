# Phase 6 — Settings, Roles, and UX Completion

Date: 2026-11-05

Gate mode: MANUAL

## What was built

- Settings is the single home for email and WhatsApp connection controls, current state, last-checked time, and a database-storage warning above 70% of the known free-tier cap.
- Master-only member management moved into Settings with add, disable, and password-reset actions; the primary navigation stays at exactly six modules.
- Role enforcement: the master can perform every action; members can use News Feed, view Delivery Log, and view Sources and Recipients read-only. Marking news important stays master-only because it can trigger an instant delivery (`DECISIONS.md`, 2026-11-04).
- Shared loading skeletons, status toasts, error banners with retry, empty states, and confirmations for destructive actions across the module pages.
- Accessibility pass: skip link, visible focus outlines, labelled controls, one `h1` per page, reduced-motion support, and status wording alongside every colour-coded dot or badge.
- Demo-data workflow with `[DEMO]`-prefixed sample sources, items, and recipients. Canonical category values replaced invalid demo topics, so the sample recipients also satisfy the shared schema.

## How to run

```powershell
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e -w @healthcare/web
```

Accessibility review (production build plus fixed sample API data; development tooling only):

```powershell
node scripts/a11y-review-server.mjs
npx lighthouse@12.8.2 http://127.0.0.1:4180/ --only-categories=accessibility
```

Repeat the Lighthouse command for `/news`, `/sources`, `/recipients`, `/alerts`, `/deliveries`, and `/settings`.

Run Playwright from `apps/web` (or through the workspace script). Running `npx playwright test` from the repo root picks up the Vitest unit tests because there is no root Playwright config, so it exits 1 with "No tests found"; that is an invocation error, not a test failure.

Demo data against a disposable database:

```powershell
$env:DATABASE_URL="postgres://.../disposable"
$env:SETTINGS_ENCRYPTION_KEY="<32-byte key>"
$env:JWT_SECRET="<at least 32 characters>"
$env:DEMO_DATA_ENABLED="true"
$env:NODE_ENV="development"
npm run demo:seed -w @healthcare/api
npm run demo:clear -w @healthcare/api
```

## Verification

| Check                              | Result                                          |
| ---------------------------------- | ----------------------------------------------- |
| `npm run lint`                     | PASS — exit 0                                   |
| `npm run typecheck`                | PASS — exit 0, shared + API + web               |
| `npm test`                         | PASS — exit 0, API 64/64, web 17/17, shared 2/2 |
| `npm run build`                    | PASS — exit 0, shared + API + web               |
| Playwright (`npx playwright test`) | PASS — 2/2 with one worker (configured)         |
| Focused Prettier check             | PASS — changed files use the project style      |
| Demo seed / clear                  | PASS — see below                                |
| Lighthouse accessibility           | PASS — 100 on all seven audited pages           |

### Lighthouse accessibility scores

Lighthouse 12.8.2, production web build, review server with sample API responses. Scores are the accessibility category score:

| Page              | URL           | Score |
| ----------------- | ------------- | ----- |
| Dashboard         | `/`           | 100   |
| News Feed         | `/news`       | 100   |
| Sources           | `/sources`    | 100   |
| Recipients        | `/recipients` | 100   |
| Alerts & Schedule | `/alerts`     | 100   |
| Delivery Log      | `/deliveries` | 100   |
| Settings          | `/settings`   | 100   |

The review server is `scripts/a11y-review-server.mjs`. It is not imported by the app and is not deployed. Scores were confirmed on pages that had actually rendered (headings and module navigation present), not on a blank document.

### Demo data verification

Run against a disposable Docker `postgres:16-alpine` database on 2026-11-05; the container was removed afterwards.

- `demo:seed` exited 0 and created 2 `[DEMO]` sources, 2 `[DEMO]` items, and 2 `[DEMO]` recipients.
- A second `demo:seed` kept the counts at 2/2/2 (idempotent).
- Recipient phone and email values were stored with the `contact:v1.` encrypted prefix.
- `demo:clear` exited 0 and left 0 sources, 0 items, and 0 recipients.
- A non-demo sentinel source was inserted before seeding; it survived `demo:clear`.

### Accessibility test coverage

`apps/web/e2e/accessibility.e2e.ts` proves:

- the skip link is the first tab stop and moves focus to `#main-content`;
- the module bar is reachable with `Shift+Tab` from the main region and activates with `Enter`;
- the focused link has a visible outline of at least 2px;
- every form control has an accessible name;
- connection states appear as words ("Connected", "Not working") as well as colour;
- each audited page has exactly one `h1`.

## Acceptance evidence

- Settings connection panels, storage warning: `apps/web/src/pages/SettingsPage.tsx`, `apps/api/src/routes/settings.ts`.
- Member management: `apps/web/src/components/MemberManagementPanel.tsx`, `apps/api/src/routes/members.ts`, `apps/api/src/members.test.ts`.
- Role enforcement: `apps/api/src/routes/sources.ts`, `apps/api/src/routes/recipients.ts`, `apps/api/src/routes/settings.ts`, `apps/web/src/components/AppHeader.tsx`, `apps/api/src/security.test.ts`.
- Shared UX states: `apps/web/src/components/LoadingState.tsx`, `apps/web/src/components/Toast.tsx`, `apps/web/src/index.css`.
- Demo data: `apps/api/scripts/demo-data.ts`; `DEMO_DATA_ENABLED` guard in `apps/api/src/config.ts`.
- Accessibility: `apps/web/e2e/accessibility.e2e.ts`, `scripts/a11y-review-server.mjs`, `apps/web/src/index.css`.
- Check output: fresh-session run on 2026-11-05 with exits 0/0/0/0 for lint, typecheck, test, and build.

## Known gaps / blocked

1. Demo data was verified only on a disposable local database. It has not been loaded into the intended hosted review database, which still needs its real `DATABASE_URL` and `SETTINGS_ENCRYPTION_KEY`.
2. Lighthouse ran against a review server with fixed sample API data, not a live authenticated environment. It covers page-level accessibility but not content produced by real feeds or deliveries.
3. Live Neon PostgreSQL, Hostinger SMTP, and WhatsApp/OpenWA verification remain blocked on credentials and service access (`OPEN_QUESTIONS.md` items 15–17).
4. The production build still reports an 848 kB minified JavaScript chunk (203 kB gzip), above Vite's 500 kB advisory threshold. Performance work belongs to Phase 7.
5. The OpenWA socket client exposes connectivity only; QR rendering and linked-account state remain on the external service host (Phase 5 notes).

## Assumptions

- Member access follows the Phase 6 default in `DECISIONS.md`: read-only Sources and Recipients, no Settings, no Alerts, and no important-marking.
- A master resets access by setting a replacement password; the account's disabled state is preserved and existing sessions are invalidated through `session_version`.
- The accessibility review server is accepted as development tooling, not application code.
- `[DEMO] %` remains the reserved marker for demo records; the seed and clear scripts refuse to overwrite non-demo records at the fixed demo IDs.

## Commits

`e31d4cc` docs: permission decision — `5620b89` storage usage — `00ea25b` member management and access resets — `7429253` role boundaries — `c915845` feedback and accessible states — `500f48f` reversible demo workflow — `57f6014` serialized web tests — `825a290` progress record — `3fd225f` demo and accessibility verification.
