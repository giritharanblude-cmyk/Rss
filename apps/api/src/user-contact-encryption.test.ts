import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { DuplicateContactError } from './errors';
import { migrateUserContacts } from './db/migrate';
import { PostgresUserRepository } from './repositories/postgres';
import { MemoryUserRepository } from './repositories/memory';
import type { Database } from './db/client';
import type { users } from './db/schema';
import {
  decryptRecipientContact,
  hashUserContactLookup,
} from './settings/secrets';

const encryptionKey = '9f'.repeat(32);

describe('user contact encryption', () => {
  it('stores encrypted contacts and finds login emails through their keyed hash', async () => {
    const storage: { row: typeof users.$inferSelect | null } = { row: null };
    let lookups = 0;
    const database = {
      insert: () => ({
        values: (values: typeof users.$inferInsert) => ({
          returning: async () => {
            storage.row = {
              ...values,
              id: '00000000-0000-4000-8000-000000000001',
              createdAt: new Date('2026-11-04T08:00:00.000Z'),
              sessionVersion: 0,
              disabled: false,
              loginFailures: 0,
              lockedUntil: null,
            } as typeof users.$inferSelect;
            return [storage.row];
          },
        }),
      }),
      update: () => ({
        set: (values: Partial<typeof users.$inferSelect>) => ({
          where: () => ({
            returning: async () => {
              if (!storage.row) return [];
              storage.row = { ...storage.row, ...values };
              return [{ id: storage.row.id }];
            },
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              lookups += 1;
              return lookups === 1 || !storage.row ? [] : [storage.row];
            },
          }),
        }),
      }),
    };
    const repository = new PostgresUserRepository(
      database as unknown as Database,
      encryptionKey,
    );
    const created = await repository.create({
      name: 'Mina',
      email: 'Mina@Example.test',
      passwordHash: 'password-hash',
      role: 'member',
    });

    expect(storage.row?.email).toMatch(/^contact:v1\./);
    expect(storage.row?.email).not.toContain('mina@example.test');
    expect(storage.row?.emailLookupHash).toBe(
      hashUserContactLookup('email', 'mina@example.test', encryptionKey),
    );
    expect(created.email).toBe('mina@example.test');

    await repository.updateContacts(created.id, 'new@example.test', '+14155552671');
    expect(storage.row?.email).toMatch(/^contact:v1\./);
    expect(storage.row?.phone).toMatch(/^contact:v1\./);
    expect(storage.row?.email).not.toContain('new@example.test');
    expect(storage.row?.phone).not.toContain('+14155552671');

    const found = await repository.findByLogin(' NEW@example.test ');
    expect(found).toMatchObject({
      id: created.id,
      email: 'new@example.test',
      phone: '+14155552671',
    });
    expect(lookups).toBe(2);
  });

  it('migrates contacts using a transactional backup and verifies decrypted values and hashes', async () => {
    const state = {
      users: [
        {
          id: 'user-1',
          email: 'person@example.test',
          phone: '+14155550123',
          email_lookup_hash: null as string | null,
          phone_lookup_hash: null as string | null,
        },
        {
          id: 'user-2',
          email: 'other@example.test',
          phone: null,
          email_lookup_hash: null as string | null,
          phone_lookup_hash: null as string | null,
        },
      ],
      backup: null as { id: string; email: string; phone: string | null }[] | null,
    };
    let original: typeof state | null = null;
    let backupRead = false;
    let verified = false;
    const client = {
      query: async (statement: string, values?: unknown[]) => {
        const sql = statement.trim().toUpperCase();
        if (sql === 'BEGIN') {
          original = structuredClone(state);
          return { rows: [] };
        }
        if (sql.startsWith('LOCK TABLE USERS')) return { rows: [] };
        if (sql.startsWith('SELECT ID, EMAIL, PHONE, EMAIL_LOOKUP_HASH')) {
          if (backupRead) verified = true;
          return { rows: structuredClone(state.users) };
        }
        if (sql.startsWith('CREATE TEMP TABLE USER_CONTACTS_BACKUP')) {
          state.backup = state.users.map(({ id, email, phone }) => ({ id, email, phone }));
          return { rows: [] };
        }
        if (sql.startsWith('UPDATE USERS')) {
          const [id, email, phone, emailLookupHash, phoneLookupHash] = values as [
            string,
            string,
            string | null,
            string,
            string | null,
          ];
          const user = state.users.find((row) => row.id === id);
          if (user) {
            user.email = email;
            user.phone = phone;
            user.email_lookup_hash = emailLookupHash;
            user.phone_lookup_hash = phoneLookupHash;
          }
          return { rows: [] };
        }
        if (sql === 'SELECT ID, EMAIL, PHONE FROM USER_CONTACTS_BACKUP') {
          backupRead = true;
          return { rows: structuredClone(state.backup ?? []) };
        }
        if (sql === 'ALTER TABLE USERS ALTER COLUMN EMAIL_LOOKUP_HASH SET NOT NULL') {
          return { rows: [] };
        }
        if (sql === 'COMMIT') {
          state.backup = null;
          return { rows: [] };
        }
        if (sql === 'ROLLBACK') {
          if (original) {
            state.users = original.users;
            state.backup = original.backup;
          }
          return { rows: [] };
        }
        throw new Error(`Unexpected SQL in migration test: ${statement}`);
      },
      release: vi.fn(),
    };
    const pool = { connect: async () => client } as unknown as Pool;

    await expect(migrateUserContacts(pool, encryptionKey)).resolves.toBe(2);
    expect(state.backup).toBeNull();
    expect(backupRead).toBe(true);
    expect(verified).toBe(true);
    expect(state.users[0]?.email).toMatch(/^contact:v1\./);
    expect(state.users[0]?.phone).toMatch(/^contact:v1\./);
    expect(state.users[0]?.email).not.toContain('person@example.test');
    expect(state.users[0]?.phone).not.toContain('+14155550123');
    expect(decryptRecipientContact(state.users[0]!.email, encryptionKey)).toBe(
      'person@example.test',
    );
    expect(decryptRecipientContact(state.users[0]!.phone!, encryptionKey)).toBe('+14155550123');
    expect(state.users[0]?.email_lookup_hash).toBe(
      hashUserContactLookup('email', 'person@example.test', encryptionKey),
    );
    expect(state.users[1]?.phone_lookup_hash).toBeNull();
  });

  it('prevents duplicate user email and phone contacts in the memory repository', async () => {
    const users = new MemoryUserRepository();
    const first = await users.create({
      name: 'First',
      email: 'person@example.test',
      passwordHash: 'hash',
      role: 'member',
    });
    const second = await users.create({
      name: 'Second',
      email: 'other@example.test',
      passwordHash: 'hash',
      role: 'member',
    });

    await expect(
      users.create({
        name: 'Duplicate',
        email: 'PERSON@example.test',
        passwordHash: 'hash',
        role: 'member',
      }),
    ).rejects.toBeInstanceOf(DuplicateContactError);
    await users.updateContacts(first.id, first.email, '+14155552671');
    await expect(
      users.updateContacts(second.id, second.email, '+14155552671'),
    ).rejects.toBeInstanceOf(DuplicateContactError);
  });
});
