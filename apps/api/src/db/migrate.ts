import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { createDatabase } from './client';
import {
  encryptRecipientContact,
  isEncryptedRecipientContact,
  validateSettingsEncryptionKey,
} from '../settings/secrets';

export async function runMigrations(pool: Pool, encryptionKey: string): Promise<void> {
  validateSettingsEncryptionKey(encryptionKey);
  const migrationsFolder = path.resolve(__dirname, '..', '..', 'drizzle');
  await migrate(createDatabase(pool), { migrationsFolder });
  await migrateRecipientContacts(pool, encryptionKey);
}

export async function migrateRecipientContacts(pool: Pool, encryptionKey: string): Promise<number> {
  validateSettingsEncryptionKey(encryptionKey);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{
      id: string;
      whatsapp_e164: string | null;
      email: string | null;
    }>(
      `SELECT id, whatsapp_e164, email
       FROM recipients
       WHERE (whatsapp_e164 IS NOT NULL AND left(whatsapp_e164, 8) <> 'contact:')
          OR (email IS NOT NULL AND left(email, 8) <> 'contact:')
       FOR UPDATE`,
    );
    let updated = 0;
    for (const row of result.rows) {
      await client.query(
        `UPDATE recipients
         SET whatsapp_e164 = $2, email = $3
         WHERE id = $1`,
        [
          row.id,
          row.whatsapp_e164 && !isEncryptedRecipientContact(row.whatsapp_e164)
            ? encryptRecipientContact(row.whatsapp_e164, encryptionKey)
            : row.whatsapp_e164,
          row.email && !isEncryptedRecipientContact(row.email)
            ? encryptRecipientContact(row.email, encryptionKey)
            : row.email,
        ],
      );
      updated += 1;
    }
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
