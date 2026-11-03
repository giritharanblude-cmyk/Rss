# Architecture

Healthcare RSS News Reader. One public URL, a static React app on Netlify, and one always-on Node service on a free VM. The database is Neon Postgres. Everything runs on free tiers.

## One URL, three free pieces

```
Browser ──► https://news.example.com   (Netlify free tier)
                 │ static React app
                 │ /api/*  ── rewrite (proxy) ──►  Backend on free VM  (always on)
                 │                                   ├─ REST API
                 │                                   ├─ Scheduler (RSS fetch, digests, retries)
                 │                                   ├─ OpenWA client (WhatsApp session)
                 │                                   └─ SMTP client (Hostinger)
                 │                                          │
                 │                                          ▼
                 │                                   Neon Postgres (free tier)
```

The browser only ever sees `https://news.example.com`. Netlify forwards `/api/*` to the VM. The database, mailbox, and origin host are never exposed to users.

Why the split:

- Netlify cannot run a long-lived process.
- OpenWA must hold a persistent WhatsApp Web session.
- The scheduler must fire on a timer.
- Therefore the whole backend is one Node service on the VM. Netlify Functions are not used in this project.

## Free-tier map

| Piece | Service | Notes |
|---|---|---|
| Frontend + single URL | Netlify free tier | Static build plus a proxy rewrite. Keep the build small. |
| Database | Neon Postgres free tier | Pooled connection string with `sslmode=require`. Compute scales to zero; retry with backoff on connect. |
| Backend host | Oracle Cloud Always Free ARM (fallback: home machine behind Cloudflare Tunnel) | Plain `docker compose` by default. |
| Email | Hostinger mailbox over SMTP | Port 465 SSL or 587 STARTTLS. |
| WhatsApp | OpenWA on the VM | Session stored on a persistent Docker volume. |
| HTTPS for the VM | Caddy (automatic certificates) or Cloudflare Tunnel | Needs a subdomain such as `origin.example.com` that only Netlify uses. |

Verified limits and their implications are recorded in `DECISIONS.md`.

## Netlify proxy rules (single URL)

`netlify.toml` order matters: the `/api/*` rule comes before the SPA fallback.

```toml
[[redirects]]
  from = "/api/*"
  to = "https://origin.example.com/api/:splat"
  status = 200
  force = true
  headers = { X-Origin-Secret = "set-in-netlify-env-not-in-repo" }

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

Rules:

- Never commit the real secret.
- Verify how Netlify supplies a secret header to a proxied request. Environment substitution in `netlify.toml` is not guaranteed. If it cannot be done cleanly, restrict the VM firewall/Caddy to Netlify's published egress behaviour or use Cloudflare Access. Never ship an open, unauthenticated origin.
- The backend rejects any `/api/*` request lacking the correct `X-Origin-Secret`, except public tokenised routes that arrive through the single URL.
- Cookies are same-site because the browser sees one site: `httpOnly`, `Secure`, `SameSite=Lax`. No CORS configuration; never wildcard CORS.
- Netlify proxy requests are cut off at roughly 26 seconds. Every API call finishes quickly; long work (fetching all feeds, sending a digest, large exports) runs as a background job and returns a job status the UI polls.

## Live updates without long connections

No Server-Sent Events or WebSockets through the proxy.

- The dashboard polls `GET /api/dashboard/live` every 5 seconds (10 seconds when the tab is hidden, paused when offline).
- `ETag` / `If-None-Match` makes unchanged responses nearly free (304).
- Connection lights come from the same endpoint.
- The interval is a single config constant.

## Running Chromium for OpenWA on ARM

- Base image `node:20-bookworm-slim` (multi-arch).
- Install system `chromium` with `apt`; point `CHROME_PATH=/usr/bin/chromium`.
- Use safe container `--no-sandbox` flags.
- `PUPPETEER_SKIP_DOWNLOAD=true` during install.
- Build and test on arm64 with `docker buildx --platform linux/arm64`.
- Container memory limit starts at 1.5 GB; restart policy `unless-stopped`.
- The WhatsApp session folder is a named volume; losing it means rescanning the QR code.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript, Tailwind CSS, React Router, TanStack Query |
| Backend | Node.js 20 + TypeScript, Fastify, zod, pino |
| Database access | PostgreSQL via `pg` + Drizzle ORM, with migrations |
| RSS parsing | `rss-parser` with custom timeout and user agent |
| Scheduler | `node-cron` plus a DB-backed job table so jobs survive restarts |
| Email | `nodemailer` over Hostinger SMTP |
| WhatsApp | OpenWA (`@open-wa/wa-automate`) behind an adapter interface |
| Auth | Argon2id password hashing, signed JWT in an httpOnly cookie, hashed OTP table with expiry |
| Tests | Vitest (unit and API), Playwright (UI smoke) |
| Timezone | Store UTC; display and schedule in `Asia/Kolkata` by default |

## Repo layout

```
/apps/web        React app (Netlify)
/apps/api        Fastify backend + scheduler + OpenWA (Docker, VM)
/packages/shared zod schemas and shared types
/deploy          docker-compose.yml, Caddyfile, backup scripts
/docs            requirements, phase reports, runbook
netlify.toml  .env.example  AGENTS.md  PROGRESS.md
```

## Staying inside the free database limits

- Nightly retention job: delete `news_items` older than 90 days and `deliveries` older than 180 days. Both configurable.
- Index only what is needed; never store duplicate text.
- `GET /api/health` reports approximate database size; Settings warns at 70% of the known cap.

## Data model

Created in Phase 1 and extended only by migration.

- `users` (id, name, password_hash, role: `master` | `member`, email, created_at, disabled)
- `otp_codes` (id, user_id, purpose: `login` | `password_change`, code_hash, expires_at, attempts, used_at)
- `sources` (id, name, website, rss_url, mode: `all` | `topics`, topics[], region, interval_minutes: 30 | 60 | 360, active, last_fetched_at, last_status, etag, last_modified)
- `news_items` (id, source_id, headline, summary, link, link_normalized, headline_signature, category, published_at, fetched_at, important, duplicate_of)
- `recipients` (id, name, whatsapp_e164, email, topics[], channel: `whatsapp` | `email` | `both`, consent_status: `granted` | `revoked` | `pending`, consent_at, consent_note, unsubscribe_token)
- `alert_rules` (id, kind: `digest` | `instant`, days_of_week[], time_local, timezone, topics[], channels[], active)
- `deliveries` (id, recipient_id, channel, kind, subject_or_ref, status: `pending` | `delivered` | `retrying` | `failed`, attempts, last_error, queued_at, sent_at, news_item_ids[])
- `jobs` (id, type, payload, run_at, status, attempts, locked_until)
- `settings` (key, encrypted_value): SMTP details and admin sender info; secrets encrypted at rest
- `connection_status` (service: `whatsapp` | `email`, state, checked_at, detail)
