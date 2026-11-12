import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { createDatabase } from './client';
import {
  decryptRecipientContact,
  encryptRecipientContact,
  hashUserContactLookup,
  isEncryptedRecipientContact,
  validateSettingsEncryptionKey,
} from '../settings/secrets';

export async function runMigrations(pool: Pool, encryptionKey: string): Promise<void> {
  validateSettingsEncryptionKey(encryptionKey);
  const migrationsFolder = path.resolve(__dirname, '..', '..', 'drizzle');
  await migrate(createDatabase(pool), { migrationsFolder });
  await migrateUserContacts(pool, encryptionKey);
  await migrateRecipientContacts(pool, encryptionKey);
}

type UserContactRow = {
  id: string;
  email: string;
  phone: string | null;
  email_lookup_hash: string | null;
  phone_lookup_hash: string | null;
};

type UserContactBackupRow = Pick<UserContactRow, 'id' | 'email' | 'phone'>;

export async function migrateUserContacts(pool: Pool, encryptionKey: string): Promise<number> {
  validateSettingsEncryptionKey(encryptionKey);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const result = await client.query<UserContactRow>(
      `SELECT id, email, phone, email_lookup_hash, phone_lookup_hash
       FROM users
       FOR UPDATE`,
    );
    const decoded = result.rows.map((row) => ({
      row,
      email: isEncryptedRecipientContact(row.email)
        ? decryptRecipientContact(row.email, encryptionKey)
        : row.email,
      phone:
        row.phone === null
          ? null
          : isEncryptedRecipientContact(row.phone)
            ? decryptRecipientContact(row.phone, encryptionKey)
            : row.phone,
    }));
    assertUniqueUserContacts(decoded);
    const needsMigration = decoded.some(
      (contact) =>
        !isEncryptedRecipientContact(contact.row.email) ||
        contact.row.email_lookup_hash !==
          hashUserContactLookup('email', contact.email, encryptionKey) ||
        (contact.phone !== null &&
          (!isEncryptedRecipientContact(contact.row.phone!) ||
            contact.row.phone_lookup_hash !==
              hashUserContactLookup('phone', contact.phone, encryptionKey))) ||
        (contact.phone === null && contact.row.phone_lookup_hash !== null),
    );
    if (needsMigration) {
      await client.query(
        `CREATE TEMP TABLE user_contacts_backup ON COMMIT DROP AS
         SELECT id, email, phone FROM users`,
      );
    }

    let updated = 0;
    for (const contact of decoded) {
      const emailLookupHash = hashUserContactLookup('email', contact.email, encryptionKey);
      const phoneLookupHash = contact.phone
        ? hashUserContactLookup('phone', contact.phone, encryptionKey)
        : null;
      const email = isEncryptedRecipientContact(contact.row.email)
        ? contact.row.email
        : encryptRecipientContact(contact.email, encryptionKey);
      const phone =
        contact.phone === null
          ? null
          : isEncryptedRecipientContact(contact.row.phone!)
            ? contact.row.phone
            : encryptRecipientContact(contact.phone, encryptionKey);
      if (
        email !== contact.row.email ||
        phone !== contact.row.phone ||
        emailLookupHash !== contact.row.email_lookup_hash ||
        phoneLookupHash !== contact.row.phone_lookup_hash
      ) {
        await client.query(
          `UPDATE users
           SET email = $2, phone = $3, email_lookup_hash = $4, phone_lookup_hash = $5
           WHERE id = $1`,
          [contact.row.id, email, phone, emailLookupHash, phoneLookupHash],
        );
        updated += 1;
      }
    }

    if (needsMigration) {
      const backup = await client.query<UserContactBackupRow>(
        'SELECT id, email, phone FROM user_contacts_backup',
      );
      const current = await client.query<UserContactRow>(
        `SELECT id, email, phone, email_lookup_hash, phone_lookup_hash FROM users`,
      );
      verifyUserContactMigration(backup.rows, current.rows, encryptionKey);
    }
    await client.query('ALTER TABLE users ALTER COLUMN email_lookup_hash SET NOT NULL');
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function assertUniqueUserContacts(
  contacts: { row: UserContactRow; email: string; phone: string | null }[],
): void {
  const emails = new Set<string>();
  const phones = new Set<string>();
  for (const contact of contacts) {
    const email = contact.email.trim().toLowerCase();
    if (emails.has(email)) {
      throw new Error('Cannot encrypt user contacts: duplicate email addresses must be resolved.');
    }
    emails.add(email);
    if (contact.phone) {
      const phone = contact.phone.trim();
      if (phones.has(phone)) {
        throw new Error('Cannot encrypt user contacts: duplicate phone numbers must be resolved.');
      }
      phones.add(phone);
    }
  }
}

function verifyUserContactMigration(
  backup: UserContactBackupRow[],
  current: UserContactRow[],
  encryptionKey: string,
): void {
  if (backup.length !== current.length) {
    throw new Error('User contact migration verification failed: row count changed.');
  }
  const currentById = new Map(current.map((row) => [row.id, row]));
  for (const original of backup) {
    const row = currentById.get(original.id);
    if (!row || !isEncryptedRecipientContact(row.email)) {
      throw new Error('User contact migration verification failed: email is not encrypted.');
    }
    const email = decryptRecipientContact(row.email, encryptionKey);
    const originalEmail = isEncryptedRecipientContact(original.email)
      ? decryptRecipientContact(original.email, encryptionKey)
      : original.email;
    if (
      email !== originalEmail ||
      row.email_lookup_hash !== hashUserContactLookup('email', email, encryptionKey)
    ) {
      throw new Error('User contact migration verification failed: email does not match backup.');
    }
    if (row.phone !== null) {
      if (!isEncryptedRecipientContact(row.phone)) {
        throw new Error('User contact migration verification failed: phone is not encrypted.');
      }
      const phone = decryptRecipientContact(row.phone, encryptionKey);
      const originalPhone =
        original.phone === null
          ? null
          : isEncryptedRecipientContact(original.phone)
            ? decryptRecipientContact(original.phone, encryptionKey)
            : original.phone;
      if (
        phone !== originalPhone ||
        row.phone_lookup_hash !== hashUserContactLookup('phone', phone, encryptionKey)
      ) {
        throw new Error('User contact migration verification failed: phone does not match backup.');
      }
    } else if (row.phone_lookup_hash !== null || original.phone !== null) {
      throw new Error('User contact migration verification failed: phone does not match backup.');
    }
  }
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
       WHERE (whatsapp_e164 IS NOT NULL AND whatsapp_e164 !~ $1)
          OR (email IS NOT NULL AND email !~ $1)
       FOR UPDATE`,
      ['^contact:v1\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]*$'],
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
