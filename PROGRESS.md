# PROGRESS

Current phase: 7
Gate mode: MANUAL
Last green commit: f6aeadc

## Phase 0: Discovery, Foundation, and Free-Stack Proof

- [x] Read requirements docx and master prompt; inspect empty repo
- [x] Create state files (PROGRESS, DECISIONS, OPEN_QUESTIONS, .env.example)
- [x] Write docs/ARCHITECTURE.md
- [x] Record verified free-tier limits in DECISIONS.md
- [x] Scaffold monorepo (workspaces, tsconfig, eslint, prettier, vitest, CI)
- [x] Add netlify.toml, API Dockerfile, deploy/docker-compose.yml
- [x] Implement GET /api/health with passing test (verify: `npm test`, `docker compose up`, curl OK)
- [x] Implement placeholder web page with passing test (`App.test.tsx`)
- [x] Free-stack proof: Neon connect + trivial migration — documented "needs credentials"; `db:proof` ready (OPEN_QUESTIONS 15)
- [x] Free-stack proof: arm64 image build (built `linux/arm64`, Chromium 156 launches `--version`)
- [x] Headless Chromium render smoke — documented "needs real arm64 VM"; QEMU hangs locally (OPEN_QUESTIONS 20)
- [x] Run gate checklist and write docs/phase-reports/PHASE-0.md

## Phase 1: Database and Authentication

- [x] Audit existing Phase 1 snapshot against requirements and identify fixes
- [x] Verify full data-model migrations and single-master seed behavior
- [x] Verify login, OTP, password-change, member-management, and origin protection
- [x] Verify rate limiting, generic errors, lockout, and secret-safe logging
- [x] Verify mock and Hostinger SMTP adapters, including status verification (real SMTP needs credentials)
- [x] Verify login and app-shell UI requirements
- [x] Run lint, typecheck, test, and build; resolve Phase 1 regressions
- [x] Complete acceptance-criteria and secret review; document credential blockers
- [x] Write docs/phase-reports/PHASE-1.md and commit completed Phase 1 work (commit 6684ef3)

## Phase 2: RSS Engine

- [x] Inspect existing schema, implement source/news repositories and API routes
- [x] Implement RSS/Atom parsing, normalization, categorization, topic filtering, and deduplication
- [x] Implement background feed fetching with timeout, retry, conditional requests, and isolated failures
- [x] Implement retention job for old news and delivery rows
- [x] Add source management UI with validation, test-feed job, pause, edit, and delete
- [x] Add fixtures and focused tests for RSS, Atom, filtering, categories, dedupe, failures, retention, and schema
- [x] Run lint, typecheck, test, build, and focused format checks (full format check reports 16 untouched files)
- [x] Complete Phase 2 acceptance and secret review; document credential/environment blockers
- [x] Write docs/phase-reports/PHASE-2.md and commit Phase 2 work

Phase 2 approval recorded on 2026-11-04: `APPROVED PHASE 2` for gate commit `d15909c`.

Open items carried forward: `OPEN_QUESTIONS.md` items 15 (live Neon/PostgreSQL verification needs credentials) and 20 (headless Chromium render smoke needs a real arm64 VM); Phase 2 also used fixture feeds rather than live external feeds (see `docs/phase-reports/PHASE-2.md`).

## Phase 3: Landing Page, Live Dashboard, and News Feed

- [x] Implement authenticated live dashboard API, ETag polling, and news-feed queries/importance action
- [x] Build six-module landing navigation and responsive dashboard/news feed UI
- [x] Add focused API and UI tests, including filtering, polling, and 360px layout
- [x] Run lint, typecheck, test, build, and Phase 3 acceptance checks
- [x] Write `docs/phase-reports/PHASE-3.md` and stop at the manual gate (commit d3b7d98)

Phase 3 approval recorded on 2026-11-04: `APPROVED PHASE 3` for gate commit `9a0a6d9`. Clean worktree validation passed from `D:\Rss-phase3` on tag `phase-3-complete`.

## Phase 4: Recipients, Consent, and Alerts and Schedule

- [x] Implement validated recipient management, consent tracking, and token-based public pages
- [x] Implement digest and instant alert rules, consent-safe preview, topic matching, and caps
- [x] Build Recipients and Alerts & Schedule UI and add them to the six-module navigation
- [x] Add focused API, UI, consent, validation, and preview tests
- [x] Run lint, typecheck, test, build, and Phase 4 acceptance checks
- [x] Write `docs/phase-reports/PHASE-4.md` and stop at the manual gate

Phase 4 approved on 2026-11-04: `APPROVED PHASE 4` for gate commit `2a3d33c`. Clean worktree validation passed (`npm ci`, lint, typecheck, unit tests, build, and Playwright; Playwright passed on three consecutive runs). Live Neon verification and real SMTP/WhatsApp credentials remain open (see `OPEN_QUESTIONS.md` items 15–17).

## Phase 5: Delivery (WhatsApp, Email, Queue, Delivery Log)

- [x] Implement WhatsApp and email adapters, with safe mock implementations for tests
- [x] Build message templates, consent-safe durable delivery queue, retries, and STOP handling
- [x] Add Settings connection controls, Delivery Log filters/exports/resend, and Send now actions
- [x] Add periodic and on-demand connection status checks for the dashboard
- [x] Add queue, retry, restart-resume, STOP, export, and connection status tests
- [x] Run lint, typecheck, test, build, and Phase 5 acceptance checks
- [x] Write `docs/phase-reports/PHASE-5.md` and stop at the manual gate

Phase 5 approved on 2026-11-04: `APPROVED PHASE 5` for code commit `7552f5b`. The local database copy run was not performed, and the `contact:` prefix edge case is not fixed. Real Neon, SMTP, and WhatsApp verification remain blocked on credentials (items 15–17). The OpenWA socket client does not expose QR or linked-account status; scan QR on the external OpenWA service host and treat the app's status as socket connectivity only.

### Open Phase 5 items — WhatsApp session and contact data

- **Confirm session storage placement:** Architecture says the OpenWA WhatsApp Web session is on the backend VM in a persistent Docker volume (`docs/ARCHITECTURE.md:35-38,85`), but Compose mounts `openwa_session:/data/openwa` into the API service while OpenWA is configured as a separate socket service (`deploy/docker-compose.yml:32-39`, `.env.example:38-39`). Verify the external OpenWA process actually uses persistent storage at that location; current configuration does not establish that.
- **Document and restrict OpenWA access:** The API connects to the configured socket URL with `OPENWA_API_KEY` (`apps/api/src/delivery/openwa.ts:24-29`, `deploy/docker-compose.yml:32-33`). The external service retains the WhatsApp Web session (`docs/ARCHITECTURE.md:25,37`), but its host-level access policy and network restrictions are not specified here. Document who administers the host and restrict the socket to the API and authorized operators.
- **Define session migration and recovery:** The session is stateful; losing its volume requires rescanning the QR code (`docs/ARCHITECTURE.md:85`). Document backup/restore and migration to a machine under our control, including transferring the persistent session and updating `OPENWA_SOCKET_URL`/`OPENWA_API_KEY` (`.env.example:38-39`); rescan if the session cannot be preserved.
- **Recipient contact encryption:** Phone numbers and email addresses are now encrypted at rest using the existing AES-256-GCM helper; repository reads decrypt them for application use. Implemented in `7552f5b`. Name, topics, consent note, and unsubscribe token remain ordinary database fields (`apps/api/src/db/schema.ts:118-127`).

### Phase 5b: Recipient contact encryption verification and key findings

- Commit `7552f5b` verification in a clean worktree: lint passed (exit 0), typecheck passed, 76 tests passed, build passed, and Playwright passed twice (2/2 runs).
- `npm ci` warned that `cosmiconfig@10.0.1` expects Node `^22.18 || >=24`; this machine runs Node `20.19.5`.
- Playwright does not require API environment variables: its webServer starts only the Vite web app (`apps/web/playwright.config.ts:10-14`) and the test intercepts and mocks `/api/**` (`apps/web/e2e/dashboard.e2e.ts:45-63`). Do not treat Playwright as an API startup or environment-variable check.
- **Key management remains open:** Production `SETTINGS_ENCRYPTION_KEY` has not yet been provisioned. There is no documented key backup or rotation procedure and no re-encryption path for changing the key. Preserve the key securely and separately from database backups; do not rotate until a supported re-encryption procedure exists.
- Recipient phone/email filtering runs in application memory after decryption; these values cannot be searched with ordinary database ciphertext predicates. There are no database-level uniqueness checks on recipient phone or email.
- **Before running the backfill on a copy:** it skips any non-null phone or email value prefixed `contact:` (`apps/api/src/db/migrate.ts:28-32`). Check for legacy plaintext values with that prefix on the copy run, because they would be skipped as though encrypted.
- **Open item:** The live database migration/backfill has not yet been run; verify it against a database copy before production.

## Phase 6: Settings, Roles, and UX Completion

Complete and approved on 2026-11-05.

- [x] Audit existing Settings, member-management, role authorization, database-size health reporting, navigation, and shared UI states; record the member permissions decision in `DECISIONS.md`.
- [x] Complete Settings as the single home for WhatsApp and Email connection controls, status, last-checked time, and the database-size warning when storage exceeds 70% of the known cap.
- [x] Move master-only member management into Settings and support adding members, disabling members, and resetting access; keep the main navigation at six modules.
- [x] Enforce role behavior: masters can perform all actions; members can use News Feed, view Delivery Log, and view Sources and Recipients read-only. (commit `7429253`)
- [x] Add shared loading skeletons and toasts, error/retry states, and destructive-action confirmations across the relevant pages. (commit `c915845`)
- [x] Complete and verify the accessibility pass for keyboard navigation, labels, contrast, and non-color status cues (commit `3fd225f`): new Playwright test covers skip link, focus indicator, keyboard navigation, control labels, and word-based status cues; Lighthouse 12.8.2 scored 100 on all seven audited pages (see `docs/phase-reports/PHASE-6.md`).
- [x] Add demo-data seed and clear commands for clearly marked sample sources, items, and recipients (commit `500f48f`), with canonical category values fixed in commit `3fd225f`.
- [x] Stabilize the web test runner for constrained CI memory and fix strict TypeScript test typing regressions (commit `57f6014`).
- [x] Add focused API and UI role checks; on 2026-11-04 `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all exited 0.
- [x] Run demo seed and clear against a disposable review database (2026-11-05): local Docker `postgres:16-alpine`, seed 0 → 2 sources / 2 items / 2 recipients, repeat seed idempotent, clear 0 leaves no rows and preserves a non-demo sentinel row.
- [x] Per-commit checks: `7429253` and `c915845` had lint/typecheck/test exit 0/0/0. The 2026-11-05 fresh-session gate run had lint 0, typecheck 0, test 0 (64 API + 17 web + 2 shared tests), build 0, and Playwright 2/2 serialized; the earlier worker/OOM failures did not recur (item 23 closed). A clean-worktree run at `3fd225f` first crashed two Chromium launches at startup, so Playwright now runs one worker.
- [x] Write `docs/phase-reports/PHASE-6.md` with implementation, run instructions, verification evidence, Lighthouse scores, known gaps, and assumptions.

Phase 6 approved on 2026-11-05: `APPROVED PHASE 6` for gate commit `f6aeadc`; tag `phase-6-complete`. Accepted limits: Lighthouse ran against fixed sample data; demo data was verified on a disposable database only; Playwright runs serially on this host; the 848 kB bundle is deferred to Phase 7; live Neon, SMTP, and WhatsApp remain credential-blocked; `npm audit` reports 16 moderate advisories, none high or critical.

### Phase 6 acceptance criteria

- [x] Settings contains both connection panels with status and last-checked time, plus a database-size warning above 70% of the known cap.
- [x] Member management is available only to masters in Settings; members are blocked from Settings writes and member management.
- [x] Role behavior is verified: masters can do everything; members can use News Feed, view Delivery Log, and view Sources and Recipients without write access.
- [x] The primary navigation contains exactly six modules.
- [x] Empty, loading, and error states are present where applicable; destructive actions require confirmation; feedback uses toasts; accessibility supports keyboard navigation, labels, sufficient contrast, and cues beyond color alone. Evidence: Playwright `e2e/accessibility.e2e.ts` passes and `scripts/a11y-review-server.mjs` exposes the built pages for Lighthouse.
- [x] Demo data can be seeded and cleared cleanly, and sample sources, items, and recipients are identifiable as demo data (`[DEMO]` names/headlines). Verified against a disposable `postgres:16-alpine` container on 2026-11-05.
- [x] Lighthouse accessibility score is at least 90 on the main pages. Scores (Lighthouse 12.8.2, production build, review server with sample API data): dashboard 100, News Feed 100, Sources 100, Recipients 100, Alerts & Schedule 100, Delivery Log 100, Settings 100.
- [x] Lint, typecheck, tests, and build pass (2026-11-05, exits 0/0/0/0); the phase report records evidence for every criterion.

## Phase 7: Hardening, Deployment, and Handover

Planned 2026-11-05 on branch `phase/7-hardening-deploy` from `main` at `f4dacdf`. Reconciled 2026-11-05: 39 unique tasks, each with one classification. Hardening work has been committed in small steps; deployment, backup, docs, and final gate checks remain open.

Existing completion marks for `7.1.3`, `7.1.4`, `7.1.6`, `7.3.1`, and `7.3.2` were verified and retained. The human approved deferring `7.2.1` (extra indexes) and `7.2.5` (bundle splitting); see `DECISIONS.md`. All needs-human items remain open.

Legend: **buildable locally** = can be implemented and verified in this repo on this host; **needs human** = requires an account, external service, credentials, hardware, or final sign-off.

### Task counts

| Classification    | Count  |
| ----------------- | ------ |
| Buildable locally | 28     |
| Needs human       | 11     |
| **Total**         | **39** |

Counts cover the task list below; acceptance criteria are gate checks and are not counted as tasks. Every task has exactly one classification.

### Tasks

**7.1 Security review**

- [x] `7.1.1` buildable locally — Audit every route for input validation and confirm each body, query, and params value is parsed with the shared zod schemas; add regression tests for rejected payloads. (verified on Node 20.19.5: lint/typecheck/test/build passed; API 73, web 17, shared 2)
- [x] `7.1.2` buildable locally — Verify session cookies are `HttpOnly`, `Secure` in production, `SameSite` scoped correctly, and cleared on logout; add tests. (verified on Node 20.19.5: lint/typecheck/test/build passed; API 74, web 17, shared 2)
- [x] `7.1.3` buildable locally — Add CSRF protection for state-changing requests (same-site origin check and/or token) and tests proving cross-origin writes are rejected. (commit `debf2cd`)
- [x] `7.1.4` buildable locally — Add security headers (helmet or equivalent: CSP, HSTS, `X-Content-Type-Options`, frame protection, referrer policy) and assert them in API tests. (commit `debf2cd`)
- [x] `7.1.5` buildable locally — Run `npm audit`; 2026-11-05 results: 16 moderate, 0 high, 0 critical. No high or critical advisories to resolve; triage is recorded in the Phase 7 report.
- [x] `7.1.6` buildable locally — Add log scrubbing so passwords, OTPs, cookies, JWTs, SMTP/OpenWA credentials, recipient contacts, and unsubscribe tokens never reach logs; add tests. (commit `57ac195`)
- [x] `7.1.7` buildable locally — Confirm SMTP passwords and recipient contacts remain encrypted at rest and that no route returns secret values; extend tests. (verified on Node 20.19.5: lint/typecheck/test/build passed; API 74, web 17, shared 2)
- [x] `7.1.8` buildable locally — Enforce the origin secret for API requests and test that browser login requests without it are rejected.
- [ ] `7.1.9` needs human — Verify on the real deployed origin that direct traffic bypassing Netlify is refused.

**7.2 Performance**

- [ ] `7.2.1` buildable locally — Review and add missing indexes for links, `published_at`, category, and delivery status; ship a Drizzle migration plus snapshot. **Deferred by human approval; see `DECISIONS.md`.**
- [x] `7.2.2` buildable locally — Review hot queries (feed, dashboard, deliveries, recipients) for full scans and N+1 patterns; fix and cover with tests. (PostgreSQL filters due sources and eligible recipients before loading rows; query regression tests; lint/typecheck/test/build verified on Node 20.19.5: API 78, web 17, shared 2)
- [x] `7.2.3` buildable locally — Enforce and test pagination limits on every list endpoint. (Bounded and validated pagination for sources, recipients, members, and alert rules; regression-tested list page metadata and rejection of oversized page sizes across list routes; Node 20.19.5 lint/typecheck/test/build verified: API 80, web 17, shared 2)
- [ ] `7.2.4` buildable locally — Benchmark every API route locally and record timings well under the Netlify proxy time limit.
- [ ] `7.2.5` buildable locally — Reduce the deferred 848 kB web bundle via route-level code splitting and re-check the Vite size warning. **Deferred by human approval; see `DECISIONS.md`.**
- [ ] `7.2.6` needs human — Confirm response times under the real Netlify proxy and against live Neon latency.

**7.3 Observability**

- [x] `7.3.1` buildable locally — Add structured JSON logs with request id, route, status, duration, and actor, plus redaction tests. (commit `57ac195`)
- [x] `7.3.2` buildable locally — Extend `/api/health` with per-component status (database, SMTP, OpenWA, scheduler) and tests; keep it safe to expose publicly. (commit `0e60938`)

**7.4 Backups**

- [x] `7.4.1` buildable locally — Add a compressed `pg_dump` backup script with seven-file retention, failure logging, and a dry-run retention test.
- [x] `7.4.2` buildable locally — Write a weekly OpenWA session-volume archive script with rotation. (Added compressed OpenWA session archives, seven-archive retention, safe dry-run, and empty-volume guard; documented weekly host scheduling; archive/rotation regression tests; lint/typecheck/test/build verified on Node 20.19.5: API 84, web 17, shared 2)
- [x] `7.4.3` buildable locally — Document restore steps for both database and OpenWA session archives, and test the restore against a disposable database. (Runbook documents isolated PostgreSQL restore and staged OpenWA recovery/rollback; verified a PostgreSQL 18 custom dump restored into a disposable database with fixture data intact, plus OpenWA archive extraction in regression test; lint/typecheck/test/build verified on Node 20.19.5: API 84, web 17, shared 2)
- [ ] `7.4.4` needs human — Install, schedule, and verify both backup jobs on the real VM and Neon host.

**7.5 Deploy**

- [x] `7.5.1` buildable locally — Configure `netlify.toml` build/publish/SPA/API routes and inject the origin secret at the edge; `.env.example` lists required variables.
- [x] `7.5.2` buildable locally — Bind the API to loopback, require production secrets, add a health check, and validate Docker Compose.
- [x] `7.5.3` buildable locally — Document firewall rules (80/443 plus SSH from a single IP), idle-reclaim limits, and recovery after reclaim in `docs/RUNBOOK.md`.
- [ ] `7.5.4` needs human — Create the Netlify site, set environment variables, attach the custom domain, and confirm HTTPS.
- [ ] `7.5.5` needs human — Provision the Oracle Cloud Always Free VM (or fallback host), apply firewall rules, mount the persistent volume, and start the stack.
- [ ] `7.5.6` needs human — Supply live Neon, SMTP, OpenWA, `JWT_SECRET`, `SETTINGS_ENCRYPTION_KEY`, and `ORIGIN_SECRET` credentials.

**7.6 Documentation**

- [x] `7.6.1` buildable locally — Add `README.md` for the app, local setup, checks, and deployment overview.
- [x] `7.6.2` buildable locally — `docs/RUNBOOK.md` covers deployment, operations, and restore; finalize key-rotation operator steps after tooling task `7.8.3` is implemented. (Documented backup-first, maintenance-window rotation, key cutover, verification, and rollback steps for atomic rotation tooling; lint/typecheck/test/build verified on Node 20.19.5: API 84, web 17, shared 2)
- [ ] `7.6.3` buildable locally — Write `docs/USER_GUIDE.md` in plain language for non-technical staff, per module.

**7.7 Final regression**

- [x] `7.7.1` buildable locally — Run lint, typecheck, tests, build, and Playwright; record evidence. (Node 20.19.5: lint/typecheck/test/build/Playwright exit 0; API 84, web 17, shared 2; Playwright 2 passed)
- [x] `7.7.2` buildable locally — Map all 129 non-empty source paragraphs to a feature, test/evidence, and status in `docs/requirements/TRACEABILITY.md`.
- [ ] `7.7.3` needs human — Approve every requirement marked Deferred and provide the reason recorded in the table.
- [ ] `7.7.4` needs human — Perform the fresh-deploy check on a clean VM and a clean Netlify site from the docs alone.
- [ ] `7.7.5` needs human — Create tag `v1.0.0` after final approval.

**7.8 Data migration and key management (Phase 5 follow-ups)**

- [ ] `7.8.1` needs human — Run the encryption backfill against a copy of the production database and record the result, including any skipped or legacy values.
- [x] `7.8.2` buildable locally — Fix the `contact:` prefix edge case so legacy plaintext phone or email values that start with `contact:` are detected instead of being silently skipped as already encrypted; add tests. (Migration now recognizes only the complete encrypted envelope and encrypts legacy `contact:` values; regression tests verify phone/email remain readable after migration; lint/typecheck/test/build verified on Node 20.19.5: API 84, web 17, shared 2)
- [ ] `7.8.3` buildable locally — Implement `SETTINGS_ENCRYPTION_KEY` rotation with a re-encryption path for SMTP settings and recipient contacts, including tests for re-encrypted reads and interrupted-rotation recovery.
- [ ] `7.8.4` needs human — Establish production key custody: generate and store the key in a secret manager, and document access, recovery, and separation from database backups.

### Phase 7 acceptance criteria

Acceptance criteria are verified at the phase gate; they are gate checks, not tasks, and are excluded from the task counts above.

- [ ] Traceability table lists every requirement as Done, or Deferred with a human-approved reason.
- [ ] `npm audit` shows no high or critical issues, or each is documented.
- [ ] A fresh deploy from the docs alone works on a clean VM and a clean Netlify site, and the app is reachable on the single URL.
- [ ] A request sent directly to the origin without the secret is rejected.
- [ ] Final tag `v1.0.0` is created after human approval.
- [ ] Lint, typecheck, tests, build, and Playwright pass and the phase report records evidence.
- [ ] Backups run on schedule, restore is documented and proven, and the retention and cleanup jobs are active.
