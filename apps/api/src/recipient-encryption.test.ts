import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { RecipientInput } from '@healthcare/shared';
import type { recipients } from './db/schema';
import type { Database } from './db/client';
import { migrateRecipientContacts } from './db/migrate';
import { PostgresRecipientRepository } from './repositories/postgres-recipients';
import {
  decryptRecipientContact,
  encryptRecipientContact,
  isEncryptedRecipientContact,
} from './settings/secrets';

const encryptionKey = '9f'.repeat(32);

type StoredContact = {
  id: string;
  whatsapp_e164: string | null;
  email: string | null;
};

describe('recipient contact encryption', () => {
  it('stores email and WhatsApp values encrypted in the recipient database layer', async () => {
    const storage: { row: typeof recipients.$inferSelect | null } = { row: null };
    const database = {
      insert: () => ({
        values: (values: typeof recipients.$inferInsert) => ({
          returning: async () => {
            storage.row = {
              ...values,
              id: '00000000-0000-4000-8000-000000000001',
              createdAt: new Date('2026-11-04T08:00:00.000Z'),
              consentStatus: 'pending',
              consentAt: null,
              consentNote: null,
            } as typeof recipients.$inferSelect;
            return [storage.row];
          },
        }),
      }),
      update: () => ({
        set: (values: Partial<typeof recipients.$inferSelect>) => ({
          where: () => ({
            returning: async () => {
              if (!storage.row) return [];
              storage.row = { ...storage.row, ...values };
              return [storage.row];
            },
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => (storage.row ? [storage.row] : []),
          }),
          orderBy: async () => (storage.row ? [storage.row] : []),
        }),
      }),
    };
    const repository = new PostgresRecipientRepository(
      database as unknown as Database,
      encryptionKey,
    );
    const input: RecipientInput = {
      name: 'Asha',
      whatsappE164: '+919876543210',
      email: 'asha@example.test',
      topics: ['Outbreaks and public health'],
      channel: 'both',
    };

    const created = await repository.createRecipient(input, 'a'.repeat(64));
    expect(storage.row?.whatsappE164).not.toBe(input.whatsappE164);
    expect(storage.row?.email).not.toBe(input.email);
    expect(storage.row?.whatsappE164).toMatch(/^contact:v1\./);
    expect(storage.row?.email).toMatch(/^contact:v1\./);
    expect(storage.row?.whatsappE164).not.toContain(input.whatsappE164);
    expect(storage.row?.email).not.toContain(input.email);
    expect(created).toMatchObject(input);
    expect(await repository.findRecipient(created.id)).toMatchObject(input);
    const updatedInput: RecipientInput = {
      ...input,
      whatsappE164: '+14155550123',
      email: 'asha.updated@example.test',
    };
    expect(await repository.updateRecipient(created.id, updatedInput)).toMatchObject(updatedInput);
    expect(storage.row?.whatsappE164).not.toBe(updatedInput.whatsappE164);
    expect(storage.row?.email).not.toBe(updatedInput.email);
    expect(storage.row?.whatsappE164).toMatch(/^contact:v1\./);
    expect(storage.row?.email).toMatch(/^contact:v1\./);
    expect(storage.row?.whatsappE164).not.toContain(updatedInput.whatsappE164);
    expect(storage.row?.email).not.toContain(updatedInput.email);
    expect(await repository.listRecipients('asha.updated@example.test')).toMatchObject([
      updatedInput,
    ]);
  });

  it('encrypts legacy plaintext rows once and preserves already encrypted data', async () => {
    const legacy: StoredContact[] = [
      {
        id: 'legacy',
        whatsapp_e164: '+919876543210',
        email: 'asha@example.test',
      },
      {
        id: 'legacy-contact-prefix',
        whatsapp_e164: 'contact:+14155550123',
        email: 'contact:asha@example.test',
      },
      {
        id: 'already-encrypted',
        whatsapp_e164: encryptRecipientContact('+14155550123', encryptionKey),
        email: null,
      },
    ];
    const client = {
      query: async (statement: string, values?: unknown[]) => {
        const sql = statement.trim().toUpperCase();
        if (sql.startsWith('SELECT')) {
          return {
            rows: legacy.filter(
              (row) =>
                (row.whatsapp_e164 !== null && !isEncryptedRecipientContact(row.whatsapp_e164)) ||
                (row.email !== null && !isEncryptedRecipientContact(row.email)),
            ),
          };
        }
        if (sql.startsWith('UPDATE')) {
          const [id, phone, email] = values as [string, string | null, string | null];
          const row = legacy.find((record) => record.id === id);
          if (row) {
            row.whatsapp_e164 = phone;
            row.email = email;
          }
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: vi.fn(),
    };
    const pool = {
      connect: async () => client,
    } as unknown as Pool;

    expect(await migrateRecipientContacts(pool, encryptionKey)).toBe(2);
    const migrated = legacy[0]!;
    expect(migrated.whatsapp_e164).not.toBe('+919876543210');
    expect(migrated.email).not.toBe('asha@example.test');
    expect(decryptRecipientContact(migrated.whatsapp_e164!, encryptionKey)).toBe('+919876543210');
    expect(decryptRecipientContact(migrated.email!, encryptionKey)).toBe('asha@example.test');
    const prefixedLegacy = legacy[1]!;
    expect(prefixedLegacy.whatsapp_e164).not.toContain('contact:+14155550123');
    expect(prefixedLegacy.email).not.toContain('contact:asha@example.test');
    expect(decryptRecipientContact(prefixedLegacy.whatsapp_e164!, encryptionKey)).toBe(
      'contact:+14155550123',
    );
    expect(decryptRecipientContact(prefixedLegacy.email!, encryptionKey)).toBe(
      'contact:asha@example.test',
    );
    const encryptedExisting = legacy[2]!.whatsapp_e164;
    expect(await migrateRecipientContacts(pool, encryptionKey)).toBe(0);
    expect(legacy[2]!.whatsapp_e164).toBe(encryptedExisting);
    expect(client.release).toHaveBeenCalledTimes(2);
  });
});
