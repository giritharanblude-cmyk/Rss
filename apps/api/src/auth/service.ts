import { randomUUID } from 'node:crypto';
import { UnauthorizedError, LockedError } from '../errors';
import type { OtpService } from './otp';
import type { UserRecord, UserRepository } from '../repositories/types';
import { hashPassword, verifyPassword } from './passwords';
import { SESSION_IDLE_TIMEOUT_SECONDS, signSession, type SessionPayload } from './tokens';

export type AuthServiceOptions = {
  users: UserRepository;
  otp: OtpService;
  jwtSecret: string;
  sessionTtlSeconds: number;
  now?: () => Date;
  lockoutThreshold?: number;
  lockoutMinutes?: number;
};

export type LoginResult = {
  user: UserRecord;
  token: string;
};

export class AuthService {
  private readonly now: () => Date;
  private readonly lockoutThreshold: number;
  private readonly lockoutMinutes: number;

  constructor(private readonly options: AuthServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.lockoutThreshold = options.lockoutThreshold ?? 5;
    this.lockoutMinutes = options.lockoutMinutes ?? 15;
  }

  private async findActiveUser(name: string): Promise<UserRecord> {
    const user = await this.options.users.findByName(name);
    if (!user || user.disabled) {
      throw new UnauthorizedError('Name or password is incorrect.');
    }
    return user;
  }

  private async checkLock(user: UserRecord): Promise<void> {
    if (user.lockedUntil && user.lockedUntil.getTime() > this.now().getTime()) {
      throw new LockedError();
    }
  }

  private async registerFailure(user: UserRecord): Promise<never> {
    const failures = await this.options.users.recordLoginFailure(user.id);
    if (failures >= this.lockoutThreshold) {
      const until = new Date(this.now().getTime() + this.lockoutMinutes * 60_000);
      await this.options.users.lockUntil(user.id, until);
      throw new LockedError();
    }
    throw new UnauthorizedError('Name or password is incorrect.');
  }

  async login(name: string, password: string): Promise<void> {
    const user = await this.options.users.findByName(name);
    if (!user || user.disabled) {
      throw new UnauthorizedError('Name or password is incorrect.');
    }

    await this.checkLock(user);

    const matches = await verifyPassword(user.passwordHash, password);
    if (!matches) {
      await this.registerFailure(user);
    }

    await this.options.users.resetLoginFailures(user.id);
    await this.options.otp.request({ userId: user.id, name: user.name }, 'login');
  }

  async resendLoginCode(name: string): Promise<void> {
    const user = await this.options.users.findByName(name);
    if (!user || user.disabled) {
      return;
    }
    await this.checkLock(user);
    await this.options.otp.request({ userId: user.id, name: user.name }, 'login');
  }

  async verifyLogin(name: string, code: string): Promise<LoginResult> {
    const user = await this.findActiveUser(name);
    await this.checkLock(user);
    await this.options.otp.verify({ userId: user.id, name: user.name }, 'login', code);

    const sessionId = randomUUID();
    await this.options.users.createSession({
      id: sessionId,
      userId: user.id,
      lastActiveAt: this.now(),
    });
    const token = signSession(
      user.id,
      this.options.jwtSecret,
      this.options.sessionTtlSeconds,
      user.sessionVersion,
      sessionId,
    );
    return { user, token };
  }

  refreshSession(session: SessionPayload): string {
    return signSession(
      session.userId,
      this.options.jwtSecret,
      this.options.sessionTtlSeconds,
      session.sessionVersion,
      session.sessionId,
    );
  }

  async logout(session: SessionPayload): Promise<void> {
    await this.options.users.deleteSession(session.sessionId);
  }

  async requestPasswordCode(userId: string): Promise<void> {
    const user = await this.options.users.findById(userId);
    if (!user || user.disabled) {
      throw new UnauthorizedError();
    }
    await this.options.otp.request({ userId: user.id, name: user.name }, 'password_change');
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.options.users.findById(userId);
    if (!user || user.disabled) {
      throw new UnauthorizedError();
    }
    await this.checkLock(user);

    const matches = await verifyPassword(user.passwordHash, currentPassword);
    if (!matches) {
      await this.registerFailure(user);
    }

    await this.options.otp.verify({ userId: user.id, name: user.name }, 'password_change', code);

    const passwordHash = await hashPassword(newPassword);
    if (!(await this.options.users.updatePasswordHash(user.id, passwordHash))) {
      throw new UnauthorizedError();
    }
  }

  async authenticate(session: SessionPayload | null): Promise<UserRecord> {
    if (!session) {
      throw new UnauthorizedError();
    }
    const user = await this.options.users.findById(session.userId);
    if (!user || user.disabled || session.sessionVersion !== user.sessionVersion) {
      throw new UnauthorizedError();
    }
    const now = this.now();
    const idleAfter = new Date(now.getTime() - SESSION_IDLE_TIMEOUT_SECONDS * 1000);
    if (!(await this.options.users.touchSession(session.sessionId, user.id, idleAfter, now))) {
      throw new UnauthorizedError();
    }
    return user;
  }
}
