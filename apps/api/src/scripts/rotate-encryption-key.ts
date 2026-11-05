import { createPool } from '../db/client';
import { rotateEncryptionKey } from '../db/rotate-encryption-key';

async function main(): Promise<void> {
  const { DATABASE_URL, OLD_SETTINGS_ENCRYPTION_KEY, NEW_SETTINGS_ENCRYPTION_KEY } = process.env;
  if (!DATABASE_URL || !OLD_SETTINGS_ENCRYPTION_KEY || !NEW_SETTINGS_ENCRYPTION_KEY) {
    throw new Error(
      'DATABASE_URL, OLD_SETTINGS_ENCRYPTION_KEY, and NEW_SETTINGS_ENCRYPTION_KEY are required.',
    );
  }

  const pool = createPool(DATABASE_URL);
  try {
    const result = await rotateEncryptionKey(
      pool,
      OLD_SETTINGS_ENCRYPTION_KEY,
      NEW_SETTINGS_ENCRYPTION_KEY,
    );
    process.stdout.write(`${JSON.stringify({ event: 'settings_key_rotation_completed', ...result })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  process.stderr.write(
    `${JSON.stringify({
      event: 'settings_key_rotation_failed',
      message: 'Key rotation failed; verify the database and configured keys.',
    })}\n`,
  );
  process.exitCode = 1;
});
