import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve(__dirname, '../../../deploy/backup-postgres.mjs');
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

    const { stdout } = await execFileAsync(process.execPath, [scriptPath, '--dry-run'], {
      env: { ...process.env, BACKUP_DIR: temporaryDirectory },
    });
    const result = JSON.parse(stdout) as { retained: number; pruned: string[] };

    expect(result.retained).toBe(7);
    expect(result.pruned).toHaveLength(2);
    await expect(readdir(temporaryDirectory)).resolves.toHaveLength(8);
  });
});
