import { randomUUID } from 'node:crypto';
import { DuplicateContactError, DuplicateMasterError } from '../errors';
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

function cloneUser(user: UserRecord): UserRecord {
  return { ...user };
}

function cloneOtp(otp: OtpRecord): OtpRecord {
  return { ...otp };
}

export class MemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, UserRecord>();
  private readonly sessions = new Map<string, { userId: string; lastActiveAt: Date }>();
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  async findByName(name: string): Promise<UserRecord | null> {
    const key = name.trim().toLowerCase();
    for (const user of this.users.values()) {
      if (user.name.trim().toLowerCase() === key) {
        return cloneUser(user);
      }
    }
    return null;
  }

  async findByLogin(identifier: string): Promise<UserRecord | null> {
    const key = identifier.trim().toLowerCase();
    for (const user of this.users.values()) {
      if (user.name.trim().toLowerCase() === key || user.email.trim().toLowerCase() === key) {
        return cloneUser(user);
      }
    }
    return null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const user = this.users.get(id);
    return user ? cloneUser(user) : null;
  }

  async listMembers(): Promise<UserRecord[]> {
    return [...this.users.values()]
      .filter((user) => user.role === 'member')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(cloneUser);
  }

  async countMasters(): Promise<number> {
    return [...this.users.values()].filter((user) => user.role === 'master').length;
  }

  async create(user: NewUser): Promise<UserRecord> {
    if (
      user.role === 'master' &&
      [...this.users.values()].some((candidate) => candidate.role === 'master')
    ) {
      throw new DuplicateMasterError();
    }
    const key = user.name.trim().toLowerCase();
    const exists = [...this.users.values()].some(
      (candidate) => candidate.name.trim().toLowerCase() === key,
    );
    if (exists) {
      throw new Error('name is already in use');
    }
    const email = user.email.trim().toLowerCase();
    if ([...this.users.values()].some((candidate) => candidate.email === email)) {
      throw new DuplicateContactError();
    }
    const record: UserRecord = {
      id: randomUUID(),
      name: user.name.trim(),
      email,
      phone: null,
      role: user.role,
      passwordHash: user.passwordHash,
      sessionVersion: 0,
      disabled: false,
      loginFailures: 0,
      lockedUntil: null,
      createdAt: this.now(),
    };
    this.users.set(record.id, record);
    return cloneUser(record);
  }

  async createSession(session: NewUserSession): Promise<void> {
    if (!this.users.has(session.userId)) {
      throw new Error('Session user was not found');
    }
    this.sessions.set(session.id, {
      userId: session.userId,
      lastActiveAt: new Date(session.lastActiveAt),
    });
  }

  async touchSession(
    id: string,
    userId: string,
    idleAfter: Date,
    lastActiveAt: Date,
  ): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId || session.lastActiveAt <= idleAfter) {
      return false;
    }
    session.lastActiveAt = new Date(lastActiveAt);
    return true;
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async setDisabled(id: string, disabled: boolean): Promise<UserRecord | null> {
    const user = this.users.get(id);
    if (!user) {
      return null;
    }
    user.disabled = disabled;
    return cloneUser(user);
  }

  async updateContacts(id: string, email: string, phone: string | null): Promise<boolean> {
    const user = this.users.get(id);
    if (!user) return false;
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = phone?.trim() || null;
    if (
      [...this.users.values()].some(
        (candidate) =>
          candidate.id !== id &&
          (candidate.email === normalizedEmail ||
            (normalizedPhone !== null && candidate.phone === normalizedPhone)),
      )
    ) {
      throw new DuplicateContactError();
    }
    user.email = normalizedEmail;
    user.phone = normalizedPhone;
    return true;
  }

  async deleteMember(id: string): Promise<boolean> {
    const user = this.users.get(id);
    if (user?.role !== 'member') {
      return false;
    }
    this.users.delete(id);
    for (const [sessionId, session] of this.sessions) {
      if (session.userId === id) this.sessions.delete(sessionId);
    }
    return true;
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<boolean> {
    const user = this.users.get(id);
    if (!user) {
      return false;
    }
    user.passwordHash = passwordHash;
    user.sessionVersion += 1;
    user.loginFailures = 0;
    user.lockedUntil = null;
    return true;
  }

  async recordLoginFailure(id: string): Promise<number> {
    const user = this.users.get(id);
    if (!user) {
      return 0;
    }
    user.loginFailures += 1;
    return user.loginFailures;
  }

  async resetLoginFailures(id: string): Promise<void> {
    const user = this.users.get(id);
    if (!user) {
      return;
    }
    user.loginFailures = 0;
    user.lockedUntil = null;
  }

  async lockUntil(id: string, when: Date): Promise<void> {
    const user = this.users.get(id);
    if (user) {
      user.lockedUntil = when;
    }
  }
}

export class MemoryOtpRepository implements OtpRepository {
  private readonly otps: OtpRecord[] = [];
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  async create(otp: NewOtp): Promise<OtpRecord> {
    const record: OtpRecord = {
      id: randomUUID(),
      userId: otp.userId,
      purpose: otp.purpose,
      codeHash: otp.codeHash,
      expiresAt: otp.expiresAt,
      attempts: 0,
      usedAt: null,
      createdAt: this.now(),
    };
    this.otps.push(record);
    return cloneOtp(record);
  }

  async findLatest(userId: string, purpose: OtpPurpose): Promise<OtpRecord | null> {
    const matches = this.otps
      .filter((otp) => otp.userId === userId && otp.purpose === purpose)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const latest = matches[0];
    return latest ? cloneOtp(latest) : null;
  }

  async findLatestActive(
    userId: string,
    purpose: OtpPurpose,
    now: Date,
  ): Promise<OtpRecord | null> {
    const matches = this.otps
      .filter(
        (otp) =>
          otp.userId === userId &&
          otp.purpose === purpose &&
          otp.usedAt === null &&
          otp.expiresAt.getTime() > now.getTime(),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const latest = matches[0];
    return latest ? cloneOtp(latest) : null;
  }

  async incrementAttempts(id: string, maxAttempts: number): Promise<number> {
    const otp = this.otps.find((candidate) => candidate.id === id);
    if (!otp) {
      return 0;
    }
    if (otp.usedAt || otp.attempts >= maxAttempts) {
      return otp.attempts;
    }
    otp.attempts += 1;
    return otp.attempts;
  }

  async consumeIfActive(id: string, now: Date, maxAttempts: number): Promise<boolean> {
    const otp = this.otps.find((candidate) => candidate.id === id);
    if (
      !otp ||
      otp.usedAt ||
      otp.expiresAt.getTime() <= now.getTime() ||
      otp.attempts >= maxAttempts
    ) {
      return false;
    }
    otp.usedAt = now;
    return true;
  }

  async markUsed(id: string, when: Date): Promise<void> {
    const otp = this.otps.find((candidate) => candidate.id === id);
    if (otp) {
      otp.usedAt = when;
    }
  }

  async invalidateActive(userId: string, purpose: OtpPurpose, when: Date): Promise<void> {
    for (const otp of this.otps) {
      if (otp.userId === userId && otp.purpose === purpose && otp.usedAt === null) {
        otp.usedAt = when;
      }
    }
  }

  async expire(id: string): Promise<void> {
    const otp = this.otps.find((candidate) => candidate.id === id);
    if (otp) {
      otp.expiresAt = new Date(0);
    }
  }
}
