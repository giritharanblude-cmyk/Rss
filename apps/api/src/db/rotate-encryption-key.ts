import type { Pool } from 'pg';
import {
  decryptRecipientContact,
  decryptSettings,
  encryptRecipientContact,
  encryptSettings,
  validateSettingsEncryptionKey,
} from '../settings/secrets';

type RecipientContactRow = {
  id: string;
  whatsapp_e164: string | null;
  email: string | null;
};

type EncryptedSettingRow = {
  key: string;
  encrypted_value: string;
};

export async function rotateEncryptionKey(
  pool: Pool,
  oldKey: string,
  newKey: string,
): Promise<{ recipients: number; settings: number }> {
  validateSettingsEncryptionKey(oldKey);
  validateSettingsEncryptionKey(newKey);
  if (oldKey === newKey) throw new Error('The old and new encryption keys must differ.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const recipients = await client.query<RecipientContactRow>(
      `SELECT id, whatsapp_e164, email
       FROM recipients
       WHERE whatsapp_e164 IS NOT NULL OR email IS NOT NULL
       FOR UPDATE`,
    );
    const encryptedSettings = await client.query<EncryptedSettingRow>(
      `SELECT key, encrypted_value
       FROM settings
       WHERE key = 'smtp_transport'
       FOR UPDATE`,
    );

    for (const recipient of recipients.rows) {
      await client.query(
        `UPDATE recipients
         SET whatsapp_e164 = $2, email = $3
         WHERE id = $1`,
        [
          recipient.id,
          recipient.whatsapp_e164
            ? encryptRecipientContact(
                decryptRecipientContact(recipient.whatsapp_e164, oldKey),
                newKey,
              )
            : null,
          recipient.email
            ? encryptRecipientContact(decryptRecipientContact(recipient.email, oldKey), newKey)
            : null,
        ],
      );
    }

    for (const setting of encryptedSettings.rows) {
      await client.query(
        `UPDATE settings
         SET encrypted_value = $2
         WHERE key = $1`,
        [setting.key, encryptSettings(decryptSettings(setting.encrypted_value, oldKey), newKey)],
      );
    }

    await client.query('COMMIT');
    return { recipients: recipients.rows.length, settings: encryptedSettings.rows.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
