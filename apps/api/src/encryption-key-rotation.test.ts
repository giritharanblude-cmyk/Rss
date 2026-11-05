import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { rotateEncryptionKey } from './db/rotate-encryption-key';
import {
  decryptRecipientContact,
  decryptSettings,
  encryptRecipientContact,
  encryptSettings,
} from './settings/secrets';

const oldKey = '9f'.repeat(32);
const newKey = 'a1'.repeat(32);

type RotationState = {
  recipients: { id: string; whatsapp_e164: string | null; email: string | null }[];
  settings: { key: string; encrypted_value: string }[];
};

function rotationPool(
  state: RotationState,
  failOnSettingsUpdate = false,
): { pool: Pool; rollback: ReturnType<typeof vi.fn> } {
  let snapshot: RotationState | null = null;
  const rollback = vi.fn(async () => {
    if (snapshot) {
      state.recipients = snapshot.recipients;
      state.settings = snapshot.settings;
    }
  });
  const client = {
    query: async (statement: string, values?: unknown[]) => {
      const sql = statement.trim().toUpperCase();
      if (sql === 'BEGIN') {
        snapshot = structuredClone(state);
        return { rows: [] };
      }
      if (sql === 'COMMIT') return { rows: [] };
      if (sql === 'ROLLBACK') {
        await rollback();
        return { rows: [] };
      }
      if (sql.startsWith('SELECT ID, WHATSAPP_E164, EMAIL')) {
        return { rows: structuredClone(state.recipients) };
      }
      if (sql.startsWith('SELECT KEY, ENCRYPTED_VALUE')) {
        return { rows: structuredClone(state.settings) };
      }
      if (sql.startsWith('UPDATE RECIPIENTS')) {
        const [id, phone, email] = values as [string, string | null, string | null];
        const recipient = state.recipients.find((row) => row.id === id);
        if (recipient) {
          recipient.whatsapp_e164 = phone;
          recipient.email = email;
        }
        return { rows: [] };
      }
      if (sql.startsWith('UPDATE SETTINGS')) {
        if (failOnSettingsUpdate) throw new Error('Simulated settings update failure');
        const [key, encryptedValue] = values as [string, string];
        const setting = state.settings.find((row) => row.key === key);
        if (setting) setting.encrypted_value = encryptedValue;
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in rotation test: ${statement}`);
    },
    release: vi.fn(),
  };
  return {
    pool: { connect: async () => client } as unknown as Pool,
    rollback,
  };
}

function initialState(): RotationState {
  return {
    recipients: [
      {
        id: 'recipient-1',
        whatsapp_e164: encryptRecipientContact('+14155550123', oldKey),
        email: encryptRecipientContact('person@example.test', oldKey),
      },
    ],
    settings: [
      {
        key: 'smtp_transport',
        encrypted_value: encryptSettings(
          JSON.stringify({ host: 'smtp.example.test', password: 'mail-secret' }),
          oldKey,
        ),
      },
    ],
  };
}

describe('encryption key rotation', () => {
  it('re-encrypts recipient contacts and SMTP settings for reads with the new key', async () => {
    const state = initialState();
    const { pool } = rotationPool(state);

    await expect(rotateEncryptionKey(pool, oldKey, newKey)).resolves.toEqual({
      recipients: 1,
      settings: 1,
    });

    expect(decryptRecipientContact(state.recipients[0]!.whatsapp_e164!, newKey)).toBe(
      '+14155550123',
    );
    expect(decryptRecipientContact(state.recipients[0]!.email!, newKey)).toBe(
      'person@example.test',
    );
    expect(
      JSON.parse(decryptSettings(state.settings[0]!.encrypted_value, newKey)),
    ).toMatchObject({ host: 'smtp.example.test', password: 'mail-secret' });
    expect(() => decryptRecipientContact(state.recipients[0]!.email!, oldKey)).toThrow();
    expect(() => decryptSettings(state.settings[0]!.encrypted_value, oldKey)).toThrow();
  });

  it('rolls back all contact changes if an interrupted rotation fails before commit', async () => {
    const state = initialState();
    const original = structuredClone(state);
    const { pool, rollback } = rotationPool(state, true);

    await expect(rotateEncryptionKey(pool, oldKey, newKey)).rejects.toThrow(
      'Simulated settings update failure',
    );

    expect(state).toEqual(original);
    expect(decryptRecipientContact(state.recipients[0]!.whatsapp_e164!, oldKey)).toBe(
      '+14155550123',
    );
    expect(rollback).toHaveBeenCalledOnce();
  });
});
