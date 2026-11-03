# Phase 0 — Discovery, Foundation, and Free-Stack Proof

Date: 2026-11-03
Gate mode: MANUAL

## What was built

- State files: `PROGRESS.md`, `DECISIONS.md`, `OPEN_QUESTIONS.md`, `.env.example`.
- `docs/ARCHITECTURE.md`, `docs/MASTER_PROMPT.md`, requirements docx copy under `docs/requirements/`.
- npm-workspaces monorepo: `apps/api` (Fastify + TypeScript), `apps/web` (React + Vite + TypeScript), `packages/shared` (zod schemas).
- Tooling: TypeScript strict (`tsconfig.base.json`), ESLint 10 flat config, Prettier, Vitest (+ Testing Library/jsdom), GitHub Actions CI (`lint`, `typecheck`, `test`, `build`).
- `GET /api/health` returning a zod-validated payload, with an API test and unit test for the schema.
- Placeholder web page with a Testing Library test.
- `netlify.toml` (API proxy before SPA fallback), `apps/api/Dockerfile` (multi-stage, system Chromium, non-root-friendly flags), `deploy/docker-compose.yml` (mem limit 1.5 GB, restart policy, OpenWA volume).

## How to run

```bash
npm ci
npm run lint && npm run typecheck && npm test && npm run build
npm run dev                      # API on :3001, web on :5173
docker compose -f deploy/docker-compose.yml up --build
curl http://localhost:3001/api/health
```

## Verification (actually run)

| Check | Result |
|---|---|
| `npm run lint` | exit 0, no output |
| `npm run typecheck` | exit 0 (shared build, api, web, shared) |
| `npm test` | exit 0 — api 1/1, web 1/1, shared 2/2 |
| `npm run build` | exit 0 — vite build 16 modules, `dist/assets/index-*.js` 219.77 kB (68.72 kB gzip) |
| `docker compose up` + `curl /api/health` | `{"status":"ok","service":"healthcare-rss-api","version":"0.0.0","uptimeSeconds":1596,...}` |
| `docker buildx build --platform linux/arm64` | success, image `healthcare-rss-api:phase0-arm64` |
| Chromium in arm64 image | `Chromium 156.0.8078.73 built on Debian GNU/Linux 12 (bookworm)` (`--version`) |
| `npm run db:proof -w @healthcare/api` | not completed — no Neon credentials (see gaps) |

## Known gaps / blocked

1. **Neon proof needs credentials.** The shell's `DATABASE_URL` is an unrelated local project string (`postgresql+psycopg2://...@localhost/sangad`), not Neon and not supported by `pg`. It was not used. `npm run db:proof -w @healthcare/api` is ready and runs the trivial `_phase0_check` migration once the pooled Neon string is provided.
2. **Headless Chromium render under QEMU.** The arm64 image builds and the Chromium binary runs, but `--dump-dom` hangs under QEMU emulation on this x86 Windows host. Run the full headless smoke on a real arm64 VM before Phase 7 deployment.
3. **Netlify header substitution** remains unverified (OPEN_QUESTIONS 18); origin protection fallback must be chosen before deployment.

## Assumptions used

- One master account with master-created members (Section 8 item 1).
- Free-tier limits recorded 2026-11-03 (Netlify 300 credits, Neon 1 GB/100 CU-h, Oracle A1 2 OCPU/12 GB) in `DECISIONS.md`.
- No later-phase modules were built.
