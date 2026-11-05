# Phase 7 — Hardening, Deployment, and Handover

Date: 2026-11-05  
Branch: `phase/7-hardening-deploy`  
Gate mode: MANUAL — not passed; stop for human review.

## Delivered in this scoped run

- Verified the existing completion marks for CSRF, security headers, log redaction, structured logs, and component health.
- Added an enforced-origin-secret rejection test for a browser login request.
- Recorded the dependency audit result: 16 moderate, 0 high, 0 critical. The moderate findings include `esbuild` and `minimatch` in tooling dependency chains and `uuid` through the OpenWA client; npm reports no fix for the latter. No dependency changes were made.
- Added a Netlify Edge Function that injects `ORIGIN_SECRET` only on proxied API requests, and configured the API behind Caddy with its host port bound to loopback. Compose requires production secrets through the operator environment, and its health check supplies the secret without printing it.
- Added a compressed custom-format `pg_dump` script, seven-file rotation, generic failure logging, and a dry-run retention test.
- Added `README.md` and an initial operations runbook.
- Recorded the human-approved deferrals for extra indexes (`7.2.1`) and bundle splitting (`7.2.5`) in `DECISIONS.md`; both checklist tasks remain open. All needs-human tasks remain open.

## Verification

| Check | Result |
|---|---|
| `npm run lint` | PASS — exit 0 |
| `npm run typecheck` | PASS — exit 0 |
| `npm test` | PASS — exit 0; API 72/72, web 17/17, shared 2/2 |
| `npm run build` | PASS — exit 0 |
| `docker compose -f deploy/docker-compose.yml config --quiet` | PASS — exit 0 with non-secret validation placeholders |
| `npm audit` | exit 1; 16 moderate, 0 high, 0 critical |
| PostgreSQL backup dry-run test | PASS — verifies seven-file retention planning without creating or deleting backups |

The test command did not exercise a live PostgreSQL dump or restore. Playwright and a production deployment were not run in this scoped work.

## Gate status and remaining work

The local origin guard test rejects a request without the secret, but the live Netlify-to-origin path and direct-origin bypass still require human deployment verification. No backup schedule, live dump/restore, OpenWA session archive, or production service credentials were installed or verified. `docs/requirements/TRACEABILITY.md` maps all 129 non-empty DOCX paragraphs; its `Partial` and `Open` entries keep the traceability acceptance criterion open pending implementation or explicit human-approved deferrals.

Other open buildable items include full route/cookie/secrets audits, query and pagination/per-route performance work, OpenWA archive and restore testing, the user guide, Playwright regression, and encryption-key migration/rotation. The runbook marks the key-rotation tool as unavailable until `7.8.3` is implemented.

Human-dependent items remain open: deployed-origin and live-latency checks, installing backup jobs, Netlify/VM provisioning and credentials, approval of deferred requirements, fresh-deploy verification, final release tag, production encryption backfill, and key custody.

No merge, tag, or push was performed. The traceability table and final gate review are required before any phase approval.

## Phase 7 commits through backup work

- `f3cbad1` — record completed items and approved deferrals
- `7c7e440` — add origin-secret rejection test
- `8f334ee` — record npm audit triage
- `2dc140d` — finalize secret-free Netlify and VM config
- `a85118c` — add rotating PostgreSQL dump script
- `d437d95` — add minimal deployment runbook
- `00e8ae4` — add README and initial gate report
