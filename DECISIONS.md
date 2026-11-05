# DECISIONS

One entry per decision: date, decision, reason.

## 2026-11-03

- **Architecture: one URL, three free pieces.** Netlify serves the static React app and proxies `/api/*` to a single always-on Node service on a free VM; data lives in Neon Postgres. Reason: Netlify cannot hold an OpenWA session or run a timer; a single URL keeps cookies same-site and secrets off the browser.
- **No Netlify Functions.** The whole backend (API, scheduler, OpenWA) runs as one Dockerised Node service on the VM. Reason: simpler code, all secrets in one place, avoids serverless time limits.
- **Monorepo via npm workspaces** (`apps/web`, `apps/api`, `packages/shared`). `packages/shared` compiles to CommonJS with type declarations; the API consumes it, the web app builds through Vite. Reason: shared zod schemas without bundler complexity.
- **Frontend stack:** React + Vite + TypeScript, Tailwind CSS, React Router, TanStack Query. Tailwind is introduced with the first real UI in Phase 3; Phase 0 ships only the placeholder page.
- **Backend stack:** Node.js 20 + TypeScript, Fastify, zod, pino, PostgreSQL via `pg` + Drizzle (migrations from Phase 1), `rss-parser`, `node-cron` with a DB-backed jobs table, `nodemailer`, OpenWA behind an adapter.
- **Auth:** Argon2id password hashing, signed JWT in an httpOnly cookie, hashed single-use OTPs with expiry.
- **Live updates:** 5-second polling of `GET /api/dashboard/live` (10 s when hidden, paused offline) with `ETag` / `If-None-Match`, not SSE/WebSocket. Reason: the Netlify proxy cuts long-lived connections.
- **Timezone:** store UTC; display and schedule in `Asia/Kolkata` by default (configurable).
- **Neon access:** pooled connection string with `sslmode=require`, connect retry with backoff because compute scales to zero.
- **Chromium for OpenWA on ARM:** base image `node:20-bookworm-slim`, system `chromium` via `apt`, `CHROME_PATH=/usr/bin/chromium`, `PUPPETEER_SKIP_DOWNLOAD=true`, `--no-sandbox` inside the container, arm64 builds via `docker buildx`.
- **Retention:** nightly job deletes `news_items` older than 90 days and `deliveries` older than 180 days, both configurable.

- **Node/package pinning:** Node 20.19.5, npm 10.8.2, TypeScript 6.0.3, ESLint 10 flat config, Prettier 3.9.10, Vitest 4.1.12. Exact versions are pinned in each `package.json`; `npm ci` is used in CI and Docker. Reason: reproducible builds on free CI minutes.
- **Fastify cookie compatibility:** use `@fastify/cookie` 10.0.1 and pin its test injector dependency `light-my-request` to 6.6.0. Reason: the newer cookie plugin/injector dependency chain selected `cookie@2`, which requires Node 22 while this project targets Node 20.
- **Auth race protection:** enforce one master with a PostgreSQL partial unique index and consume OTPs with a conditional update. Reason: service-level check-then-write logic alone cannot prevent concurrent seed or OTP verification requests from violating those invariants.
- **API test workers:** run the API Vitest suite in one thread with file parallelism disabled. Reason: default worker forks crashed with V8 zone out-of-memory errors in the Windows environment; the serialized suite passes.
- **Phase 2 RSS engine:** pin `rss-parser` 3.13.0 for RSS/Atom parsing and `node-cron` 4.6.0 for recurring feed/retention work. Fetch work runs outside HTTP requests, uses a 10-second abort timeout, retries with exponential delay, and stores conditional-request headers. Feed-test requests are persisted in the existing `jobs` table and claimed with expiring locks. Category keywords live in the editable API config `apps/api/src/rss/categories.ts`; feed text, not article bodies, is persisted.
- **`packages/shared` build order:** the root `typecheck`, `test`, and `build` scripts build `@healthcare/shared` first so the API can import its compiled types. Reason: workspace consumers resolve `dist`, avoiding cross-package TS project references in Phase 0.
- **arm64 image proof (2026-11-03):** `docker buildx build --platform linux/arm64` succeeds with the multi-stage Dockerfile; runtime Chromium 156.0.8078.73 launches (`--version`). Headless render (`--dump-dom`) hangs under QEMU on the x86 dev host, so rendering is deferred to a real arm64 VM. Reason: QEMU emulation limitation, not an image defect.

## 2026-11-04

- **Phase 6 member permissions:** The master can perform all actions. Members can browse and filter News Feed, view Delivery Log, and view Sources and Recipients read-only; they cannot access Settings, Alerts, or member management. Marking news important remains master-only because that action can trigger an instant delivery. Reason: keep the specified member access while reserving actions that can initiate sends or change configuration for the master. The existing member API supports create/list/disable but has no reset-access flow; the health endpoint currently has no database-size field.
- **Phase 6 member reset access:** A master sets a replacement member password. The account's disabled state is preserved, and updating the password increments `session_version` so the member's existing sessions are rejected. Reason: provide the requested administrative reset while immediately invalidating sessions that may have been exposed.
- **Phase 6 web test workers:** Run web Vitest with `--maxWorkers=1 --no-file-parallelism`. Reason: the default parallel worker pool exhausted memory on the Windows development host; the serialized suite passes consistently without changing test coverage.

## 2026-11-05

- **Demo data uses canonical category names.** Sample sources, items, and recipients reference only the six `NEWS_CATEGORIES` (plus the demo item category), never ad-hoc names such as "Vaccines" or "Clinical guidance". Reason: recipient topics are parsed with the shared enum schema, so an unknown topic would make the whole recipient list fail; demos must look and validate like real data.
- **Accessibility evidence via a review-only server.** Lighthouse 12.8.2 runs against the production web build served by `scripts/a11y-review-server.mjs`, which returns fixed sample API data. Reason: no live authenticated review environment or credentials are available locally, and accessibility is a property of the rendered page. The script is development tooling only, is not imported by the app, and is not deployed. Lighthouse stays an `npx` invocation so it is not added to runtime dependencies.
- **Durable keyboard/label checks live in Playwright.** `apps/web/e2e/accessibility.e2e.ts` covers the skip link, visible focus indicator, reverse keyboard navigation into the module bar, accessible names on all form controls, one `h1`, and word-based connection states. Reason: those behaviours depend on real browser focus handling and cannot be proven in jsdom unit tests.

## Verified free-tier limits (checked 2026-11-03)

- **Netlify Free:** 300 credits/month, 1 concurrent build, 1 team owner. Production deploy = 15 credits; compute = 5–10 credits/GB-hour; bandwidth = 10–20 credits/GB; web requests = 2–3 credits per 10k. Projects pause when credits run out. Implication: keep the bundle small, cache aggressively, keep API calls short, and do long work as background jobs. The ~26 s proxy cut-off is treated as the operational ceiling.
- **Neon Free:** 1 GB Postgres storage per project (20 GB total across projects), 100 CU-hours per project per month (≈400 h at 0.25 CU), scale-to-zero after 5 minutes idle, 5 GB public egress per project per month, 10 branches, autoscale up to 2 CU. Implication: the 90/180-day retention job and the 70% storage warning are required, not optional.
- **Oracle Cloud Always Free Ampere A1:** 2 OCPUs and 12 GB RAM total (1,500 OCPU-hours + 9,000 GB-hours/month) since June 2026 — down from 4 OCPU/24 GB. Idle reclamation applies if, over 7 days, 95th-percentile CPU < 20%, network < 20%, and memory < 20% (A1). Implication: keep the instance genuinely active and document recovery; do not assume 24 GB.
