import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { settings } from '../db/schema';
import type { SettingsRepository } from './settings';

export class PostgresSettingsRepository implements SettingsRepository {
  constructor(private readonly db: Database) {}

  async get(key: string): Promise<string | null> {
    const rows = await this.db
      .select({ value: settings.encryptedValue })
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    return rows[0]?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key, encryptedValue: value })
      .onConflictDoUpdate({ target: settings.key, set: { encryptedValue: value } });
  }
}
