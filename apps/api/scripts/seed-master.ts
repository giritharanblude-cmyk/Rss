import { loadConfig } from '../src/config';
import { createDatabase, createPool, waitForDatabase } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { createMasterIfNone } from '../src/auth/seed';
import { PostgresUserRepository } from '../src/repositories/postgres';

async function main(): Promise<void> {
  const config = loadConfig();
  const name = config.MASTER_NAME;
  const email = config.MASTER_EMAIL;
  const password = config.MASTER_PASSWORD;

  if (!config.DATABASE_URL) {
    process.stderr.write('DATABASE_URL is not set.\n');
    process.exitCode = 1;
    return;
  }
  if (!name || !email || !password) {
    process.stderr.write('MASTER_NAME, MASTER_EMAIL and MASTER_PASSWORD must be set.\n');
    process.exitCode = 1;
    return;
  }

  const pool = createPool(config.DATABASE_URL);
  try {
    await waitForDatabase(pool);
    await runMigrations(pool);
    const users = new PostgresUserRepository(createDatabase(pool));
    const user = await createMasterIfNone(users, { name, email, password });
    process.stdout.write(`Master user created: ${user.name} <${user.email}>\n`);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
