import { createPool, waitForDatabase } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    process.stderr.write('DATABASE_URL is not set.\n');
    process.exitCode = 1;
    return;
  }

  const pool = createPool(connectionString);
  try {
    await waitForDatabase(pool);
    await runMigrations(pool);
    process.stdout.write('Migrations applied.\n');
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Migration failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
