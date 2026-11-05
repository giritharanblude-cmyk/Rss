# Healthcare RSS News Reader

A single-URL web app for collecting healthcare news from RSS feeds, classifying and deduplicating items, and sending consent-based email and WhatsApp updates. The React app is served by Netlify; a Fastify API runs on a VM, with PostgreSQL hosted separately. The app stores feed headlines, summaries, and links, not full articles.

## Requirements

- Node.js 20 and npm
- PostgreSQL for a local API instance
- External SMTP and OpenWA services for live email and WhatsApp delivery

## Local setup

Install dependencies and configure the API environment using the variable names and safe placeholders in `.env.example`. The API reads environment variables from its process; do not commit a populated `.env`.

```sh
npm ci
npm run dev -w @healthcare/api
```

The API requires `JWT_SECRET` and `SETTINGS_ENCRYPTION_KEY`; a working database and `MASTER_EMAIL` are required for normal startup. Database migrations run when the API starts. Create the initial master with `MASTER_NAME`, `MASTER_EMAIL`, `MASTER_PASSWORD`, `DATABASE_URL`, and `SETTINGS_ENCRYPTION_KEY` set in the operator environment:

```sh
npm run seed:master -w @healthcare/api
```

Run the web development server separately:

```sh
npm run dev -w @healthcare/web
```

The production app uses Netlify to proxy `/api/*` to the API. For full browser-to-API development, provide a local proxy for that path; the Vite server alone serves the frontend.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e -w @healthcare/web
```

## Deployment

Review [the architecture](docs/ARCHITECTURE.md) and follow [the operations runbook](docs/RUNBOOK.md). Production secrets belong in the host or Netlify environment, never in the repository. `.env.example` lists application settings; the runbook describes the Netlify edge secret, Caddy origin, backups, and operational recovery.
