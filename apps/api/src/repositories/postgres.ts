import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { otpCodes, userSessions, users } from '../db/schema';
import { DuplicateContactError, DuplicateMasterError } from '../errors';
import {
  decryptRecipientContact,
  encryptRecipientContact,
  hashUserContactLookup,
  validateSettingsEncryptionKey,
} from '../settings/secrets';
import type {
  NewOtp,
  NewUser,
  NewUserSession,
  OtpPurpose,
  OtpRecord,
  OtpRepository,
  UserRecord,
  UserRepository,
} from './types';

type UserRow = typeof users.$inferSelect;
type OtpRow = typeof otpCodes.$inferSelect;

function toUser(row: UserRow, encryptionKey: string): UserRecord {
  const email = decryptRecipientContact(row.email, encryptionKey);
  const phone = row.phone ? decryptRecipientContact(row.phone, encryptionKey) : null;
  if (row.emailLookupHash !== hashUserContactLookup('email', email, encryptionKey)) {
    throw new Error('Stored user email lookup hash is invalid.');
  }
  if (
    row.phoneLookupHash !==
    (phone === null ? null : hashUserContactLookup('phone', phone, encryptionKey))
  ) {
    throw new Error('Stored user phone lookup hash is invalid.');
  }
  return {
    id: row.id,
    name: row.name,
    email,
    phone,
    role: row.role,
    passwordHash: row.passwordHash,
    sessionVersion: row.sessionVersion,
    disabled: row.disabled,
    loginFailures: row.loginFailures,
    lockedUntil: row.lockedUntil,
    createdAt: row.createdAt,
  };
}

function toOtp(row: OtpRow): OtpRecord {
  return {
    id: row.id,
    userId: row.userId,
    purpose: row.purpose,
    codeHash: row.codeHash,
    expiresAt: row.expiresAt,
    attempts: row.attempts,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  };
}

function isDuplicateContactConstraint(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    (error.constraint === 'users_email_lookup_hash_unique' ||
      error.constraint === 'users_phone_lookup_hash_unique')
  );
}

export class PostgresUserRepository implements UserRepository {
  constructor(
    private readonly db: Database,
    private readonly encryptionKey: string,
  ) {
    validateSettingsEncryptionKey(encryptionKey);
  }

  async findByName(name: string): Promise<UserRecord | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.name}) = lower(${name.trim()})`)
      .limit(1);
    const row = rows[0];
    return row ? toUser(row, this.encryptionKey) : null;
  }

  async findByLogin(identifier: string): Promise<UserRecord | null> {
    const userByName = await this.findByName(identifier);
    if (userByName) return userByName;
    const emailLookupHash = hashUserContactLookup('email', identifier, this.encryptionKey);
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.emailLookupHash, emailLookupHash))
      .limit(1);
    const row = rows[0];
    return row ? toUser(row, this.encryptionKey) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    const row = rows[0];
    return row ? toUser(row, this.encryptionKey) : null;
  }

  async listMembers(): Promise<UserRecord[]> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.role, 'member'))
      .orderBy(desc(users.createdAt));
    return rows.map((row) => toUser(row, this.encryptionKey));
  }

  async countMasters(): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(users)
      .where(eq(users.role, 'master'));
    return Number(rows[0]?.value ?? 0);
  }

  async create(user: NewUser): Promise<UserRecord> {
    let rows: UserRow[];
    try {
      rows = await this.db
        .insert(users)
        .values({
          name: user.name.trim(),
          nameKey: user.name.trim().toLowerCase(),
          email: encryptRecipientContact(user.email.trim().toLowerCase(), this.encryptionKey),
          emailLookupHash: hashUserContactLookup('email', user.email, this.encryptionKey),
          phone: null,
          phoneLookupHash: null,
          passwordHash: user.passwordHash,
          role: user.role,
        })
        .returning();
    } catch (error) {
      if (
        user.role === 'master' &&
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505' &&
        'constraint' in error &&
        error.constraint === 'users_single_master_unique'
      ) {
        throw new DuplicateMasterError();
      }
      if (isDuplicateContactConstraint(error)) {
        throw new DuplicateContactError();
      }
      throw error;
    }
    const row = rows[0];
    if (!row) {
      throw new Error('User was not created');
    }
    return toUser(row, this.encryptionKey);
  }

  async createSession(session: NewUserSession): Promise<void> {
    await this.db.insert(userSessions).values(session);
  }

  async touchSession(
    id: string,
    userId: string,
    idleAfter: Date,
    lastActiveAt: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .update(userSessions)
      .set({ lastActiveAt })
      .where(
        and(
          eq(userSessions.id, id),
          eq(userSessions.userId, userId),
          gt(userSessions.lastActiveAt, idleAfter),
        ),
      )
      .returning({ id: userSessions.id });
    return rows.length === 1;
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.delete(userSessions).where(eq(userSessions.id, id));
  }

  async setDisabled(id: string, disabled: boolean): Promise<UserRecord | null> {
    const rows = await this.db.update(users).set({ disabled }).where(eq(users.id, id)).returning();
    const row = rows[0];
    return row ? toUser(row, this.encryptionKey) : null;
  }

  async updateContacts(id: string, email: string, phone: string | null): Promise<boolean> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = phone?.trim() || null;
    try {
      const rows = await this.db
        .update(users)
        .set({
          email: encryptRecipientContact(normalizedEmail, this.encryptionKey),
          emailLookupHash: hashUserContactLookup('email', normalizedEmail, this.encryptionKey),
          phone: normalizedPhone
            ? encryptRecipientContact(normalizedPhone, this.encryptionKey)
            : null,
          phoneLookupHash: normalizedPhone
            ? hashUserContactLookup('phone', normalizedPhone, this.encryptionKey)
            : null,
        })
        .where(eq(users.id, id))
        .returning({ id: users.id });
      return rows.length === 1;
    } catch (error) {
      if (isDuplicateContactConstraint(error)) {
        throw new DuplicateContactError();
      }
      throw error;
    }
  }

  async deleteMember(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(users)
      .where(and(eq(users.id, id), eq(users.role, 'member')))
      .returning({ id: users.id });
    return rows.length === 1;
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<boolean> {
    const rows = await this.db
      .update(users)
      .set({
        passwordHash,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        loginFailures: 0,
        lockedUntil: null,
      })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    return rows.length === 1;
  }

  async recordLoginFailure(id: string): Promise<number> {
    const rows = await this.db
      .update(users)
      .set({ loginFailures: sql`${users.loginFailures} + 1` })
      .where(eq(users.id, id))
      .returning({ failures: users.loginFailures });
    return Number(rows[0]?.failures ?? 1);
  }

  async resetLoginFailures(id: string): Promise<void> {
    await this.db
      .update(users)
      .set({ loginFailures: 0, lockedUntil: null })
      .where(eq(users.id, id));
  }

  async lockUntil(id: string, when: Date): Promise<void> {
    await this.db.update(users).set({ lockedUntil: when }).where(eq(users.id, id));
  }
}

export class PostgresOtpRepository implements OtpRepository {
  constructor(private readonly db: Database) {}

  async create(otp: NewOtp): Promise<OtpRecord> {
    const rows = await this.db.insert(otpCodes).values(otp).returning();
    const row = rows[0];
    if (!row) {
      throw new Error('OTP was not created');
    }
    return toOtp(row);
  }

  async findLatest(userId: string, purpose: OtpPurpose): Promise<OtpRecord | null> {
    const rows = await this.db
      .select()
      .from(otpCodes)
      .where(and(eq(otpCodes.userId, userId), eq(otpCodes.purpose, purpose)))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    const row = rows[0];
    return row ? toOtp(row) : null;
  }

  async findLatestActive(
    userId: string,
    purpose: OtpPurpose,
    now: Date,
  ): Promise<OtpRecord | null> {
    const rows = await this.db
      .select()
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.userId, userId),
          eq(otpCodes.purpose, purpose),
          isNull(otpCodes.usedAt),
          sql`${otpCodes.expiresAt} > ${now}`,
        ),
      )
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    const row = rows[0];
    return row ? toOtp(row) : null;
  }

  async incrementAttempts(id: string, maxAttempts: number): Promise<number> {
    const rows = await this.db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(
        and(
          eq(otpCodes.id, id),
          isNull(otpCodes.usedAt),
          sql`${otpCodes.attempts} < ${maxAttempts}`,
        ),
      )
      .returning({ attempts: otpCodes.attempts });
    return Number(rows[0]?.attempts ?? maxAttempts);
  }

  async consumeIfActive(id: string, now: Date, maxAttempts: number): Promise<boolean> {
    const rows = await this.db
      .update(otpCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(otpCodes.id, id),
          isNull(otpCodes.usedAt),
          sql`${otpCodes.expiresAt} > ${now}`,
          sql`${otpCodes.attempts} < ${maxAttempts}`,
        ),
      )
      .returning({ id: otpCodes.id });
    return rows.length === 1;
  }

  async markUsed(id: string, when: Date): Promise<void> {
    await this.db.update(otpCodes).set({ usedAt: when }).where(eq(otpCodes.id, id));
  }

  async invalidateActive(userId: string, purpose: OtpPurpose, when: Date): Promise<void> {
    await this.db
      .update(otpCodes)
      .set({ usedAt: when })
      .where(
        and(eq(otpCodes.userId, userId), eq(otpCodes.purpose, purpose), isNull(otpCodes.usedAt)),
      );
  }
}
