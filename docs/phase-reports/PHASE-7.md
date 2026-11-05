# Phase 7 — Hardening, Deployment, and Handover

Date: 2026-11-05  
Branch: `phase/7-hardening-deploy`  
Milestone: **Code Complete, Deploy Pending** — development milestone only; not production approval.
Gate mode: MANUAL — not passed; Phase 7 remains open.

## Milestone decision

The user accepted Phase 7 as **Code Complete, Deploy Pending**. This records acceptance of a development milestone only. It does not assert live integration, production readiness, deployment completion, or closure of the Phase 7 gate.

## Delivered

- Added route input validation, session-cookie/security-header/CSRF checks, log redaction, origin-secret enforcement, structured request logs, and component health reporting.
- Reviewed hot database query paths and added bounded pagination to collection APIs with corresponding web controls and regression tests.
- Added PostgreSQL backup/restore procedures, a compressed OpenWA session archive with seven-file rotation, and staged restore/rollback instructions. A PostgreSQL 18 custom-format dump was restored into a disposable database and fixture data was verified; archive extraction is covered by a regression test.
- Fixed migration of legacy recipient contacts beginning with `contact:` and added transactional encryption-key rotation for SMTP settings and recipient contacts, with tests for new-key reads and interrupted-transaction rollback.
- Updated the operations runbook, README, and requirements traceability. The nine live-account requirement groups and two performance tasks are explicitly Deferred, not completed.

## Final verification

Full gate run on Node `20.19.5` after implementation commits through `fd669d0`:

| Check | Exit code | Result |
|---|---:|---|
| `npm run lint` | 0 | PASS |
| `npm run typecheck` | 0 | PASS |
| `npm test` | 0 | PASS — API 86, web 17, shared 2 |
| `npm run build` | 0 | PASS |
| `npm run test:e2e -w @healthcare/web` | 0 | PASS — Playwright 2 passed |
| `npm audit` (2026-11-05 recorded run) | 1 | 16 moderate, 0 high, 0 critical; moderate findings are documented and no high/critical issue was reported |
| PostgreSQL disposable restore | 0 | PASS — PostgreSQL 18 custom dump restored and fixture data read back |

The Playwright suite uses fixed API fixtures and is not evidence of live API/provider integration. The disposable restore proves local archive tooling only, not a live Neon restore or installed production backup schedule.

## Approved Deferred items

The user approved the following nine live-account requirement groups as **Deferred**, not completed. Each has a reason, prerequisite, and verification criterion in `docs/requirements/TRACEABILITY.md`:

| Requirement group | Reason | Prerequisite | Verification before deployment |
|---|---|---|---|
| R003 — Login OTP through Hostinger email | Needs live account | Deployed app, production SMTP, controlled mailbox | Receive a real OTP and verify valid, expired, and invalid OTP behavior |
| R008 — Password-change OTP and member administration | Needs live account | Deployed app, production SMTP, master and controlled member accounts | Receive real password-change OTP, complete the change, and confirm old session rejection |
| R018–R020 — Live dashboard and connection indicators | Needs live service accounts | Deployed app with live Neon, SMTP, and OpenWA credentials | Confirm dashboard metrics and connection indicators reflect actual services |
| R069 — WhatsApp updates via OpenWA | Needs live WhatsApp/OpenWA account | Reachable OpenWA service, API credentials, linked account | Establish a real session and deliver a test update |
| R070 — Admin sender to recipient profile number | Needs live WhatsApp/OpenWA account | Linked sender and consented controlled recipient | Confirm real message reaches the configured recipient number from the sender |
| R072–R083 — WhatsApp digest formatting and STOP | Needs live WhatsApp/OpenWA account | Linked sender and consented controlled recipient | Inspect actual digest and confirm STOP changes consent and prevents subsequent sends |
| R084 — Email updates | Needs live email account | Production SMTP and controlled mailbox | Send and receive a real update |
| R085 — Configured email sender to recipient | Needs live email account | Production SMTP sender and controlled recipient mailbox | Confirm a real delivery and configured sender/recipient |
| R087–R096 — Email content and preference links | Needs live email account | Production SMTP and controlled mailbox with active links | Inspect a real message and exercise its links, unsubscribe, and topic updates |

The two human-approved performance deferrals are also still open and are not represented as delivered:

| Task | Deferred work | Reason and revisit criteria |
|---|---|---|
| 7.2.1 | Additional database indexes | Explicitly excluded from this Phase 7 scope. Revisit with renewed authorization and representative query plans/data; add only justified indexes and verify plans, migration, and regression tests. |
| 7.2.5 | Route-level bundle splitting | Explicitly excluded from this Phase 7 scope. Revisit with renewed authorization and bundle profiling; verify route splitting and a production build without the bundle-size warning. |

The user also accepted **Code Complete, Deploy Pending** as a development milestone. The nine live-account groups remain Deferred and their actual verification is outstanding.

R129, Netlify hosting, is a separate approved Deferred requirement (in addition to the nine live-account groups above). Its reason is “needs live Netlify account; verify before deploy”; prerequisite: provisioned site, environment access, domain/DNS, and deployed API origin; verification: confirm HTTPS, the public app/API proxy, and rejection of direct-origin requests without the secret.

## Outstanding deployment and release blockers

- Direct-origin bypass verification (`7.1.9`) and live Netlify/Neon latency verification (`7.2.6`) have not been performed.
- Backup jobs have not been installed, scheduled, or verified on the real VM and Neon host (`7.4.4`).
- No production Netlify site/domain/HTTPS configuration or production VM/firewall/persistent-volume deployment has been completed (`7.5.4`–`7.5.5`).
- Live production credentials and secrets for Neon, SMTP, OpenWA, JWT, settings encryption, and origin protection remain prerequisites (`7.5.6`).
- A fresh deployment from the documentation on a clean VM and clean Netlify site remains unverified (`7.7.4`).
- The encryption backfill has not been run against a copy of the production database (`7.8.1`), and production key custody/recovery has not been established (`7.8.4`).
- The live-account requirements listed above still require their stated prerequisites and checks. The local mocked Playwright/API tests do not satisfy them.
- Local buildable work still open includes route benchmarking (`7.2.4`) and the plain-language user guide (`7.6.3`).
- Release tag `v1.0.0` was not created and remains gated on final human approval (`7.7.5`).

## Git and gate state

Latest locally validated implementation commit: `fd669d0` (`feat(security): rotate encryption keys transactionally`). The worktree was clean before this documentation update. The local `origin` remote has no `phase/7-hardening-deploy` tracking ref; `git log origin/phase/7-hardening-deploy` fails because that ref is absent, and `git ls-remote --heads origin phase/7-hardening-deploy` returned no matching branch. Pushing the current local branch would publish its unpushed implementation commits in addition to the requested documentation commit, so no such push is performed under the documentation-only push constraint.

No merge or tag was performed. Phase 7 remains open; deployment approval has not been granted.
