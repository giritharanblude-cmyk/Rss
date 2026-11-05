#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const retentionCount = 7;
const archivePattern = /^openwa-\d{8}T\d{9}Z-[\da-f-]+\.tar\.gz$/;

function archiveName(now) {
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace('.', '');
  return `openwa-${timestamp}-${randomUUID()}.tar.gz`;
}

async function listArchives(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const archives = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && archivePattern.test(entry.name))
      .map(async (entry) => ({
        name: entry.name,
        path: path.join(directory, entry.name),
        modifiedAt: (await fs.stat(path.join(directory, entry.name))).mtimeMs,
      })),
  );
  return archives.sort((left, right) => right.modifiedAt - left.modifiedAt);
}

function createTar(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar exited with status ${code ?? 'unknown'}.`));
      }
    });
  });
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

export async function runArchive({ env = process.env, dryRun = false, now = new Date() } = {}) {
  if (!env.OPENWA_SESSION_DIR || !env.OPENWA_BACKUP_DIR) {
    throw new Error('OPENWA_SESSION_DIR and OPENWA_BACKUP_DIR must both be configured.');
  }

  const source = await fs.realpath(path.resolve(env.OPENWA_SESSION_DIR));
  const sourceStat = await fs.stat(source);
  if (!sourceStat.isDirectory()) {
    throw new Error('OPENWA_SESSION_DIR must point to a directory.');
  }
  if ((await fs.readdir(source)).length === 0) {
    throw new Error('OPENWA_SESSION_DIR is empty; refusing to create an empty session archive.');
  }

  const directory = path.resolve(env.OPENWA_BACKUP_DIR);
  if (isWithin(source, directory)) {
    throw new Error('OPENWA_BACKUP_DIR must be outside OPENWA_SESSION_DIR.');
  }
  if (dryRun) {
    const existing = await listArchives(directory);
    const allArchives = [{ name: archiveName(now) }, ...existing];
    return {
      event: 'openwa_backup_dry_run',
      output: allArchives[0].name,
      retained: allArchives.slice(0, retentionCount).length,
      pruned: allArchives.slice(retentionCount).map((archive) => archive.name),
    };
  }

  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const canonicalDirectory = await fs.realpath(directory);
  if (isWithin(source, canonicalDirectory)) {
    throw new Error('OPENWA_BACKUP_DIR must be outside OPENWA_SESSION_DIR.');
  }

  const name = archiveName(now);
  const output = path.join(canonicalDirectory, name);
  const temporary = `${output}.partial`;
  const existing = await listArchives(canonicalDirectory);
  const allArchives = [{ name, path: output }, ...existing];
  const pruned = allArchives.slice(retentionCount);
  let created = false;

  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    await handle.close();
    await createTar(env.TAR_BIN || 'tar', ['-czf', temporary, '-C', source, '.']);
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, output);
    created = true;

    for (const archive of pruned) {
      await fs.unlink(archive.path);
    }

    return {
      event: 'openwa_backup_completed',
      output: name,
      retained: allArchives.length - pruned.length,
      pruned: pruned.map((archive) => archive.name),
    };
  } finally {
    if (!created) await fs.rm(temporary, { force: true });
  }
}

async function main() {
  const result = await runArchive({ dryRun: process.argv.includes('--dry-run') });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        event: 'openwa_backup_failed',
        message: error instanceof Error ? error.message : 'Unknown backup failure.',
      })}\n`,
    );
    process.exitCode = 1;
  });
}
