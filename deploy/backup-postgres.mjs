#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const retentionCount = 7;
const backupPattern = /^postgres-\d{8}T\d{9}Z-[\da-f-]+\.dump$/;

function backupName(now) {
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace('.', '');
  return `postgres-${timestamp}-${randomUUID()}.dump`;
}

async function listBackups(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const backups = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && backupPattern.test(entry.name))
      .map(async (entry) => ({
        name: entry.name,
        path: path.join(directory, entry.name),
        modifiedAt: (await fs.stat(path.join(directory, entry.name))).mtimeMs,
      })),
  );
  return backups.sort((left, right) => right.modifiedAt - left.modifiedAt);
}

function pgPassEscape(value) {
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
}

async function createPgPassFile(databaseUrl) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol.');
  }

  const host = url.hostname;
  const port = url.port || '5432';
  const user = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  if (!host || !user || !database) {
    throw new Error('DATABASE_URL must include a host, user, and database.');
  }

  const file = path.join(os.tmpdir(), `rss-pgpass-${process.pid}-${randomUUID()}`);
  const contents = [
    host,
    port,
    database,
    user,
    decodeURIComponent(url.password),
  ]
    .map(pgPassEscape)
    .join(':');
  await fs.writeFile(file, `${contents}\n`, { flag: 'wx', mode: 0o600 });

  return {
    file,
    host,
    port,
    user,
    database,
    sslMode: url.searchParams.get('sslmode'),
    sslRootCert: url.searchParams.get('sslrootcert'),
  };
}

function runPgDump(executable, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pg_dump exited with status ${code ?? 'unknown'}.`));
      }
    });
  });
}

export async function runBackup({ env = process.env, dryRun = false, now = new Date() } = {}) {
  const directory = path.resolve(env.BACKUP_DIR || path.join(process.cwd(), 'backups'));
  const name = backupName(now);
  const output = path.join(directory, name);
  const existing = await listBackups(directory);
  const allBackups = [{ name, path: output }, ...existing];
  const retained = allBackups.slice(0, retentionCount);
  const pruned = allBackups.slice(retentionCount);

  if (dryRun) {
    return {
      event: 'postgres_backup_dry_run',
      output: name,
      retained: retained.length,
      pruned: pruned.map((backup) => backup.name),
    };
  }

  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to create a backup.');
  }

  await fs.mkdir(directory, { recursive: true });
  const temporary = `${output}.partial`;
  let pgPass;
  try {
    pgPass = await createPgPassFile(env.DATABASE_URL);
    const childEnv = { ...env, PGPASSFILE: pgPass.file };
    delete childEnv.DATABASE_URL;
    if (pgPass.sslMode) childEnv.PGSSLMODE = pgPass.sslMode;
    if (pgPass.sslRootCert) childEnv.PGSSLROOTCERT = pgPass.sslRootCert;
    await runPgDump(
      env.PG_DUMP_BIN || 'pg_dump',
      [
        '--no-password',
        '--format=custom',
        '--compress=6',
        '--host',
        pgPass.host,
        '--port',
        pgPass.port,
        '--username',
        pgPass.user,
        '--dbname',
        pgPass.database,
        '--file',
        temporary,
      ],
      childEnv,
    );
    await fs.rename(temporary, output);

    for (const backup of pruned) {
      await fs.unlink(backup.path);
    }

    return {
      event: 'postgres_backup_completed',
      output: name,
      retained: retained.length,
      pruned: pruned.map((backup) => backup.name),
    };
  } finally {
    await fs.rm(temporary, { force: true });
    if (pgPass) await fs.rm(pgPass.file, { force: true });
  }
}

async function main() {
  const result = await runBackup({ dryRun: process.argv.includes('--dry-run') });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        event: 'postgres_backup_failed',
        message: error instanceof Error ? error.message : 'Unknown backup failure.',
      })}\n`,
    );
    process.exitCode = 1;
  });
}
