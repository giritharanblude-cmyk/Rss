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

The script writes compressed custom-format dumps, reports failures without printing credentials, and retains the seven newest dumps. Schedule it with the host's protected scheduler/secret mechanism and monitor its logs.

To validate or restore a dump, use a **new disposable database**, not production. Set `BACKUP_FILE`, `DATABASE_ADMIN_URL` (a protected URL for a database with permission to create databases), and `RESTORE_DATABASE_URL` (a protected URL to the newly created disposable database):

```sh
pg_restore --list "$BACKUP_FILE"
createdb --maintenance-db="$DATABASE_ADMIN_URL" "$RESTORE_DATABASE_NAME"
pg_restore --exit-on-error --no-owner --dbname="$RESTORE_DATABASE_URL" "$BACKUP_FILE"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c '\dt'
```

Review the restored schema and application data before treating the backup as usable. Keep the disposable database isolated from production, and drop it only after validation. For an approved production recovery, restore into a new database first, verify it, then coordinate the connection switch; do not overwrite a live database as a test.

## OpenWA session archive

Set `OPENWA_SESSION_DIR` to the OpenWA service's actual persistent session directory and `OPENWA_BACKUP_DIR` to a protected location outside that directory. The session archive contains account credentials; restrict access to the archive and its storage. Verify the source path before scheduling because OpenWA may run separately from the API container.

```sh
node deploy/backup-openwa.mjs --dry-run
node deploy/backup-openwa.mjs
```

The script writes compressed archives and retains the seven newest. Schedule it weekly using the host's protected scheduler environment (for example, Sunday at 03:00 with `0 3 * * 0`). Monitor its logs and confirm that each archive is created successfully.

To restore, work on the host that runs OpenWA. Set `OPENWA_ARCHIVE`, `OPENWA_SESSION_DIR`, `OPENWA_USER`, and `OPENWA_GROUP` to the verified archive, configured session path, and service account. Stop OpenWA, extract to a new sibling staging directory, inspect it, and only then swap it into place. Keep the archive and current session directory intact until validation:

```sh
tar -tzf "$OPENWA_ARCHIVE"
sudo systemctl stop openwa
RESTORE_STAGING="$(sudo mktemp -d "${OPENWA_SESSION_DIR}.restore.XXXXXX")"
sudo tar --extract --gzip --file "$OPENWA_ARCHIVE" --directory "$RESTORE_STAGING" --same-owner --same-permissions
sudo find "$RESTORE_STAGING" -maxdepth 2 -type f -print
PRE_RESTORE="${OPENWA_SESSION_DIR}.pre-restore-$(date +%Y%m%dT%H%M%S)"
if [ -e "$OPENWA_SESSION_DIR" ]; then sudo mv "$OPENWA_SESSION_DIR" "$PRE_RESTORE"; fi
sudo mv "$RESTORE_STAGING" "$OPENWA_SESSION_DIR"
sudo chown -R "$OPENWA_USER:$OPENWA_GROUP" "$OPENWA_SESSION_DIR"
sudo systemctl start openwa
sudo systemctl status --no-pager openwa
```

Confirm the service reconnects and the expected account session is usable. If it does not, stop OpenWA, move the failed restore aside, move `$PRE_RESTORE` back to `$OPENWA_SESSION_DIR` (when a previous directory existed), correct ownership, and restart. Keep the prior directory and archive until recovery is verified; session data is sensitive.

## Neon asleep or over its limit

If Neon has scaled to zero, allow the first connection to wake it and retry after checking `/api/health`. For a quota or storage warning, check the Neon dashboard and the app's database-size indicator, then verify retention is running before investigating growth. Do not delete database data manually; retain a backup before approved cleanup.

## Encryption-key rotation

The rotation utility re-encrypts saved SMTP settings and recipient email/phone values in a single database transaction. Before starting, make and verify a database backup, retain both keys in the protected secret manager, and arrange a maintenance window. Never put key values in command arguments or logs.

On the API host, stop the API and prepare a shell with `OLD_SETTINGS_ENCRYPTION_KEY` set to the currently deployed key and `NEW_SETTINGS_ENCRYPTION_KEY` set to a newly generated 32-byte key (hex or Base64). Build the image containing the rotation utility, then run it once against the production database:

```sh
docker compose --env-file .env -f deploy/docker-compose.yml stop api
docker compose --env-file .env -f deploy/docker-compose.yml build api
docker compose --env-file .env -f deploy/docker-compose.yml run --rm --no-deps \
  -e OLD_SETTINGS_ENCRYPTION_KEY -e NEW_SETTINGS_ENCRYPTION_KEY \
  api node apps/api/dist/scripts/rotate-encryption-key.js
```

After a successful rotation, update `SETTINGS_ENCRYPTION_KEY` in the protected `.env` or secret manager to the new key, then start the API and verify `/api/health`, saved email settings, recipient contact behavior, and a test delivery before ending the maintenance window. Keep the old key securely available until all checks pass and a fresh backup is verified.

The database changes are atomic: interruption before commit rolls them back, so restart with the old key. If the transaction committed but the new key has not been deployed (or the new-key startup check fails), keep the API stopped and run the utility in reverse, setting `OLD_SETTINGS_ENCRYPTION_KEY` to the new key and `NEW_SETTINGS_ENCRYPTION_KEY` to the original key; restore the original `SETTINGS_ENCRYPTION_KEY` and restart. Do not discard either key or the pre-rotation backup until recovery is confirmed. Production key generation, custody, and access/recovery policy remain a human task (`7.8.4`).

## VM reclaimed or unavailable

Free VM providers may reclaim idle instances; do not rely on artificial keep-alive traffic. Monitor the provider account and keep deployment configuration, database backups, and the OpenWA session archive separate from the VM. After reclaim, provision a replacement, restore the firewall and persistent data, deploy using this guide, restore a verified database backup only when needed, and confirm the Netlify proxy and health check before reopening traffic.
