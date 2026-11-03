import { randomUUID } from 'node:crypto';
import type {
  NewOtp,
  NewUser,
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
    const key = user.name.trim().toLowerCase();
    const exists = [...this.users.values()].some(
      (candidate) => candidate.name.trim().toLowerCase() === key,
    );
    if (exists) {
      throw new Error('name is already in use');
    }
    const record: UserRecord = {
      id: randomUUID(),
      name: user.name.trim(),
      email: user.email.trim().toLowerCase(),
      role: user.role,
      passwordHash: user.passwordHash,
      disabled: false,
      loginFailures: 0,
      lockedUntil: null,
      createdAt: this.now(),
    };
    this.users.set(record.id, record);
    return cloneUser(record);
  }

  async setDisabled(id: string, disabled: boolean): Promise<UserRecord | null> {
    const user = this.users.get(id);
    if (!user) {
      return null;
    }
    user.disabled = disabled;
    return cloneUser(user);
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    const user = this.users.get(id);
    if (!user) {
      return;
    }
    user.passwordHash = passwordHash;
    user.loginFailures = 0;
    user.lockedUntil = null;
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

  async incrementAttempts(id: string): Promise<number> {
    const otp = this.otps.find((candidate) => candidate.id === id);
    if (!otp) {
      return 0;
    }
    otp.attempts += 1;
    return otp.attempts;
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
