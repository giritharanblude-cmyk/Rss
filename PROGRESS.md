# PROGRESS

Current phase: 5
Gate mode: MANUAL
Last green commit: 4bc6d58

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

Phase 5 implementation and validation are complete on `phase/5-delivery`; awaiting manual approval. Real Neon, SMTP, and WhatsApp verification remain blocked on credentials (items 15–17). The OpenWA socket client does not expose QR or linked-account status; scan QR on the external OpenWA service host and treat the app's status as socket connectivity only.

### Open Phase 5 items — WhatsApp session and contact data

- **Confirm session storage placement:** Architecture says the OpenWA WhatsApp Web session is on the backend VM in a persistent Docker volume (`docs/ARCHITECTURE.md:35-38,85`), but Compose mounts `openwa_session:/data/openwa` into the API service while OpenWA is configured as a separate socket service (`deploy/docker-compose.yml:32-39`, `.env.example:38-39`). Verify the external OpenWA process actually uses persistent storage at that location; current configuration does not establish that.
- **Document and restrict OpenWA access:** The API connects to the configured socket URL with `OPENWA_API_KEY` (`apps/api/src/delivery/openwa.ts:24-29`, `deploy/docker-compose.yml:32-33`). The external service retains the WhatsApp Web session (`docs/ARCHITECTURE.md:25,37`), but its host-level access policy and network restrictions are not specified here. Document who administers the host and restrict the socket to the API and authorized operators.
- **Define session migration and recovery:** The session is stateful; losing its volume requires rescanning the QR code (`docs/ARCHITECTURE.md:85`). Document backup/restore and migration to a machine under our control, including transferring the persistent session and updating `OPENWA_SOCKET_URL`/`OPENWA_API_KEY` (`.env.example:38-39`); rescan if the session cannot be preserved.
- **Recipient contact data is plaintext:** Recipient phone and email are ordinary `text` columns, alongside name, topics, consent note, and unsubscribe token (`apps/api/src/db/schema.ts:118-127`); the Postgres repository reads phone/email directly (`apps/api/src/repositories/postgres-recipients.ts:25-29`). AES-256-GCM encryption is applied to saved SMTP settings, not recipient records (`apps/api/src/routes/settings.ts:45-51`, `apps/api/src/settings/secrets.ts:13-20`). Decide and document the database/storage protection and access controls for this personal data.
