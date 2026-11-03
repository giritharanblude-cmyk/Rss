import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { createDatabase } from './client';

export async function runMigrations(pool: Pool): Promise<void> {
  const migrationsFolder = path.resolve(__dirname, '..', '..', 'drizzle');
  await migrate(createDatabase(pool), { migrationsFolder });
}
