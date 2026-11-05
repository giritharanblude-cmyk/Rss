# Phase 1 — Database and Authentication

Date: 2026-11-03
Gate mode: MANUAL

## What was built

- Drizzle schema and migrations for all Phase 1 data-model tables, plus a partial unique index that enforces the single-master invariant in PostgreSQL.
- Environment-based master seed, with duplicate-master handling in the service and database repository.
- Name/password login followed by a hashed, single-use, six-digit OTP; OTP expiry, attempt limit, resend cooldown, and atomic consumption.
- Password change with current-password verification and a fresh OTP.
- Master-only member listing, creation, and disabling.
- Production-required origin-secret protection, route-level rate limits, generic authentication failures, and temporary lockout after repeated bad passwords.
- Mock and Hostinger SMTP email adapters; SMTP verification is implemented.
- Two-step login UI and authenticated shell showing the username and role.
- Node 20-compatible Fastify cookie dependencies and a single-worker API test configuration to avoid Windows worker-process OOM failures.

## How to run

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run db:migrate -w @healthcare/api
npm run seed:master -w @healthcare/api
```

Set `DATABASE_URL`, `JWT_SECRET`, `ORIGIN_SECRET`, and `ORIGIN_SECRET_ENFORCED=true` for production. Set `MASTER_NAME`, `MASTER_PASSWORD`, and `MASTER_EMAIL` before running the seed script. Configure Hostinger SMTP variables to send real OTP email.

## Verification

| Check                                    | Result                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                           | PASS                                                                                                                                    |
| `npm run typecheck`                      | PASS                                                                                                                                    |
| `npm test`                               | PASS — API 23/23, web 3/3, shared 2/2                                                                                                   |
| `npm run build`                          | PASS — shared, API, and web builds                                                                                                      |
| `npm run db:generate -w @healthcare/api` | PASS — generated the single-master uniqueness migration                                                                                 |
| Authentication acceptance tests          | PASS — login, hash storage, wrong password, OTP expiry/reuse/attempt limit, password change, rate limit, and concurrent OTP consumption |
| Member and seed acceptance tests         | PASS — master-only access, duplicate names, single-master behavior, and concurrent seed attempts                                        |
| Origin protection tests                  | PASS — missing/wrong secret rejected when enabled; production config requires enforcement and a secret                                  |
| Login UI tests                           | PASS — credentials step, OTP step, and signed-in username/role                                                                          |
| Secret review                            | PASS — no real credentials found; environment values are placeholders and test credentials are synthetic                                |

## Known gaps / blocked

1. **Neon database proof remains blocked.** The migrations and seed are implemented, but no migration or seed was run against a live database because the real pooled Neon `DATABASE_URL` is unavailable. The unrelated database value in the shell was not used. See `OPEN_QUESTIONS.md` item 15.
2. **Real SMTP delivery remains unverified.** Hostinger credentials and the sender mailbox are needed to confirm OTP delivery and `verify()`. The mock adapter is used in tests. See `OPEN_QUESTIONS.md` item 16.
3. **Origin deployment protection remains a deployment decision.** The API enforces the secret in production, but Netlify header substitution or an origin firewall/Cloudflare Access mechanism still needs confirmation. See `OPEN_QUESTIONS.md` item 18.
4. The Phase 0 arm64 Chromium render smoke still needs a real arm64 VM; QEMU rendering remains deferred to deployment (see `OPEN_QUESTIONS.md` item 20).

## Acceptance evidence

- Full model: `apps/api/src/db/schema.ts`, `apps/api/drizzle/0000_skinny_gambit.sql`, and `apps/api/drizzle/0001_serious_whirlwind.sql`.
- Master seed: `apps/api/scripts/seed-master.ts` and `apps/api/src/auth/seed.ts`.
- Auth and OTP: `apps/api/src/auth.test.ts`; password hashes and OTP hashes are Argon2id.
- Members and single-master rule: `apps/api/src/members.test.ts`.
- Origin enforcement and production config: `apps/api/src/security.test.ts`.
- SMTP adapter: `apps/api/src/email/smtp.ts`; mock adapter: `apps/api/src/email/mock.ts`.
- Login flow and signed-in shell: `apps/web/src/App.test.tsx`.
