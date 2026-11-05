# Operations runbook

## Deploy

Keep production values outside Git. Create a host-side `.env` from `.env.example`, restrict its permissions, and set every required value there or through the host's secret manager. The API requires `DATABASE_URL`, `PUBLIC_APP_ORIGIN`, `ORIGIN_SECRET` (at least 16 characters), `JWT_SECRET` (at least 32 characters), `SETTINGS_ENCRYPTION_KEY` (32 bytes encoded as hex or Base64), and `MASTER_EMAIL`. Set `ORIGIN_HOST` to the public Caddy hostname. Compose enables origin-secret enforcement and publishes the API only on loopback.

Set the same `ORIGIN_SECRET` in Netlify's environment with Edge Functions access. Change the example API destination in `netlify.toml` to the deployed origin hostname and redeploy. Point that hostname to the VM. Allow inbound TCP 80/443 and SSH only from the administrator's IP in the cloud firewall; do not expose port 3001. Caddy obtains and renews HTTPS certificates.

From the repository root, start the stack:

```sh
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
docker compose --env-file .env -f deploy/docker-compose.yml ps
```

The API health check must be healthy before Caddy serves it. Confirm the Netlify URL loads, then test login and the connection indicators. Set SMTP and OpenWA variables as needed; the application also supports configuring these connections in Settings. Seed the master once by supplying `MASTER_NAME`, `MASTER_EMAIL`, `MASTER_PASSWORD`, `DATABASE_URL`, and `SETTINGS_ENCRYPTION_KEY` to the operator environment and running `npm run seed:master -w @healthcare/api`.

The example environment file documents optional SMTP (`SMTP_*`, `MAIL_FROM_*`), OpenWA (`OPENWA_*`), master-seed, timezone, retention, and polling settings. Never commit the production `.env`.

## WhatsApp relink

Open the operator interface for the configured OpenWA service, start/restart its session, and scan its QR code with the intended WhatsApp account. Confirm the account remains connected and the WhatsApp indicator updates in Settings. Do not start a second session for the same account. The OpenWA service owns its session data; the API container's named volume is not an OpenWA session backup.

## Stuck delivery queue

Check Delivery Log for failed or retrying rows and use the UI's retry action for a failed delivery. Check API logs with `docker compose --env-file .env -f deploy/docker-compose.yml logs --tail=200 api` and confirm database, SMTP, and OpenWA health. Do not edit queue rows directly in the database; preserve the delivery history.

## PostgreSQL backup and restore

Install the PostgreSQL client tools on the host that runs the backup. Set `DATABASE_URL` and `BACKUP_DIR` in the protected operator environment, then run:

```sh
node deploy/backup-postgres.mjs --dry-run
node deploy/backup-postgres.mjs
```

The script writes compressed custom-format dumps, reports failures without printing credentials, and retains the seven newest dumps. Schedule it with the host's protected scheduler/secret mechanism and monitor its logs. A disposable-database restore check:

```sh
pg_restore --list "$BACKUP_FILE"
pg_restore --exit-on-error --no-owner --dbname="$RESTORE_DATABASE_URL" "$BACKUP_FILE"
```

Restore to a new disposable database first. Do not overwrite production during a restore check.

## OpenWA session archive

Set `OPENWA_SESSION_DIR` to the OpenWA service's actual persistent session directory and `OPENWA_BACKUP_DIR` to a protected location outside that directory. The session archive contains account credentials; restrict access to the archive and its storage. Verify the source path before scheduling because OpenWA may run separately from the API container.

```sh
node deploy/backup-openwa.mjs --dry-run
node deploy/backup-openwa.mjs
```

The script writes compressed archives and retains the seven newest. Schedule it weekly using the host's protected scheduler environment (for example, Sunday at 03:00 with `0 3 * * 0`). Monitor its logs and confirm that each archive is created successfully. Detailed session restore steps are tracked separately in `7.4.3`.

## Neon asleep or over its limit

If Neon has scaled to zero, allow the first connection to wake it and retry after checking `/api/health`. For a quota or storage warning, check the Neon dashboard and the app's database-size indicator, then verify retention is running before investigating growth. Do not delete database data manually; retain a backup before approved cleanup.

## Encryption-key rotation

Key-rotation tooling is not implemented yet (`7.8.3` remains open). Do not replace `SETTINGS_ENCRYPTION_KEY` while encrypted settings or recipient contacts exist; the old key is needed to read them. Before rotation is enabled, use a protected copy of the database, follow the tool's documented dry-run and progress/recovery steps, verify encrypted reads, and only then update the production secret and restart the API. Production key custody and recovery remain a human task (`7.8.4`).

## VM reclaimed or unavailable

Free VM providers may reclaim idle instances; do not rely on artificial keep-alive traffic. Monitor the provider account and keep deployment configuration, database backups, and the OpenWA session archive separate from the VM. After reclaim, provision a replacement, restore the firewall and persistent data, deploy using this guide, restore a verified database backup only when needed, and confirm the Netlify proxy and health check before reopening traffic.
