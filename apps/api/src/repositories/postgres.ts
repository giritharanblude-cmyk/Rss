import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { otpCodes, users } from '../db/schema';
import { DuplicateMasterError } from '../errors';
import type {
  NewOtp,
  NewUser,
  OtpPurpose,
  OtpRecord,
  OtpRepository,
  UserRecord,
  UserRepository,
} from './types';

type UserRow = typeof users.$inferSelect;
type OtpRow = typeof otpCodes.$inferSelect;

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
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

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async findByName(name: string): Promise<UserRecord | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.name}) = lower(${name.trim()})`)
      .limit(1);
    const row = rows[0];
    return row ? toUser(row) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    const row = rows[0];
    return row ? toUser(row) : null;
  }

  async listMembers(): Promise<UserRecord[]> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.role, 'member'))
      .orderBy(desc(users.createdAt));
    return rows.map(toUser);
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
          email: user.email.trim().toLowerCase(),
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
      throw error;
    }
    const row = rows[0];
    if (!row) {
      throw new Error('User was not created');
    }
    return toUser(row);
  }

  async setDisabled(id: string, disabled: boolean): Promise<UserRecord | null> {
    const rows = await this.db.update(users).set({ disabled }).where(eq(users.id, id)).returning();
    const row = rows[0];
    return row ? toUser(row) : null;
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
