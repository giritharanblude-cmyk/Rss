import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const postgresScriptPath = path.resolve(__dirname, '../../../deploy/backup-postgres.mjs');
const openWaScriptPath = path.resolve(__dirname, '../../../deploy/backup-openwa.mjs');
let temporaryDirectory: string;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

describe('PostgreSQL backup script', () => {
  it('dry-runs seven-file retention without creating or deleting backups', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'rss-backup-test-'));
    for (let index = 0; index < 8; index += 1) {
      const timestamp = `20260101T00000${index}000Z`;
      const file = path.join(temporaryDirectory, `postgres-${timestamp}-00000000-0000-4000-8000-000000000000.dump`);
      await writeFile(file, 'fixture');
      const time = new Date(1_700_000_000_000 + index * 1000);
      await utimes(file, time, time);
    }

    const { stdout } = await execFileAsync(process.execPath, [postgresScriptPath, '--dry-run'], {
      env: { ...process.env, BACKUP_DIR: temporaryDirectory },
    });
    const result = JSON.parse(stdout) as { retained: number; pruned: string[] };

    expect(result.retained).toBe(7);
    expect(result.pruned).toHaveLength(2);
    await expect(readdir(temporaryDirectory)).resolves.toHaveLength(8);
  });
});

describe('OpenWA session archive script', () => {
  it('creates a compressed archive of the session directory', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'rss-openwa-backup-test-'));
    const sessionDirectory = path.join(temporaryDirectory, 'session');
    const backupDirectory = path.join(temporaryDirectory, 'backups');
    await mkdir(sessionDirectory);
    await writeFile(path.join(sessionDirectory, 'session.json'), '{"session":"fixture"}');

    const { stdout } = await execFileAsync(process.execPath, [openWaScriptPath], {
      env: {
        ...process.env,
        OPENWA_SESSION_DIR: sessionDirectory,
        OPENWA_BACKUP_DIR: backupDirectory,
      },
    });
    const result = JSON.parse(stdout) as { output: string; retained: number };
    const archivePath = path.join(backupDirectory, result.output);

    expect(result.retained).toBe(1);
    await expect(readdir(backupDirectory)).resolves.toEqual([result.output]);
    await expect(execFileAsync('tar', ['-tzf', archivePath])).resolves.toMatchObject({
      stdout: expect.stringContaining('session.json'),
    });
  });

  it('dry-runs seven-archive retention without deleting existing archives', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'rss-openwa-backup-test-'));
    const sessionDirectory = path.join(temporaryDirectory, 'session');
    const backupDirectory = path.join(temporaryDirectory, 'backups');
    await mkdir(sessionDirectory);
    await mkdir(backupDirectory);
    await writeFile(path.join(sessionDirectory, 'session.json'), '{"session":"fixture"}');
    for (let index = 0; index < 8; index += 1) {
      const timestamp = `20260101T00000${index}000Z`;
      const file = path.join(
        backupDirectory,
        `openwa-${timestamp}-00000000-0000-4000-8000-000000000000.tar.gz`,
      );
      await writeFile(file, 'fixture');
      const time = new Date(1_700_000_000_000 + index * 1000);
      await utimes(file, time, time);
    }

    const { stdout } = await execFileAsync(process.execPath, [openWaScriptPath, '--dry-run'], {
      env: {
        ...process.env,
        OPENWA_SESSION_DIR: sessionDirectory,
        OPENWA_BACKUP_DIR: backupDirectory,
      },
    });
    const result = JSON.parse(stdout) as { retained: number; pruned: string[] };

    expect(result.retained).toBe(7);
    expect(result.pruned).toHaveLength(2);
    await expect(readdir(backupDirectory)).resolves.toHaveLength(8);
  });

  it('rotates archives to seven files after creating a new archive', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'rss-openwa-backup-test-'));
    const sessionDirectory = path.join(temporaryDirectory, 'session');
    const backupDirectory = path.join(temporaryDirectory, 'backups');
    await mkdir(sessionDirectory);
    await mkdir(backupDirectory);
    await writeFile(path.join(sessionDirectory, 'session.json'), '{"session":"fixture"}');
    for (let index = 0; index < 8; index += 1) {
      const timestamp = `20260101T00000${index}000Z`;
      const file = path.join(
        backupDirectory,
        `openwa-${timestamp}-00000000-0000-4000-8000-000000000000.tar.gz`,
      );
      await writeFile(file, 'fixture');
      const time = new Date(1_700_000_000_000 + index * 1000);
      await utimes(file, time, time);
    }

    const { stdout } = await execFileAsync(process.execPath, [openWaScriptPath], {
      env: {
        ...process.env,
        OPENWA_SESSION_DIR: sessionDirectory,
        OPENWA_BACKUP_DIR: backupDirectory,
      },
    });
    const result = JSON.parse(stdout) as { output: string; retained: number; pruned: string[] };
    const names = await readdir(backupDirectory);

    expect(result.retained).toBe(7);
    expect(result.pruned).toHaveLength(2);
    expect(names).toHaveLength(7);
    expect(names).toContain(result.output);
    expect(names).not.toContain('openwa-20260101T000000000Z-00000000-0000-4000-8000-000000000000.tar.gz');
    expect(names).not.toContain('openwa-20260101T000001000Z-00000000-0000-4000-8000-000000000000.tar.gz');
  });

  it('refuses to archive an empty session directory', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'rss-openwa-backup-test-'));
    const sessionDirectory = path.join(temporaryDirectory, 'session');
    await mkdir(sessionDirectory);

    await expect(
      execFileAsync(process.execPath, [openWaScriptPath], {
        env: {
          ...process.env,
          OPENWA_SESSION_DIR: sessionDirectory,
          OPENWA_BACKUP_DIR: path.join(temporaryDirectory, 'backups'),
        },
      }),
    ).rejects.toMatchObject({ code: 1 });
  });
});
