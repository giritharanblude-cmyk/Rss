import { randomInt } from 'node:crypto';
import type { EmailSender } from '../email';
import { EmailUnavailableError, OtpCooldownError, OtpError } from '../errors';
import type { OtpPurpose, OtpRepository } from '../repositories/types';
import { hashPassword, verifyPassword } from './passwords';

export type OtpServiceOptions = {
  otps: OtpRepository;
  email: EmailSender;
  now?: () => Date;
  ttlSeconds?: number;
  cooldownSeconds?: number;
  maxAttempts?: number;
  adminEmail: string;
};

export type OtpTarget = {
  userId: string;
  name: string;
};

export class OtpService {
  private readonly now: () => Date;
  private readonly ttlSeconds: number;
  private readonly cooldownSeconds: number;
  private readonly maxAttempts: number;

  constructor(private readonly options: OtpServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.ttlSeconds = options.ttlSeconds ?? 600;
    this.cooldownSeconds = options.cooldownSeconds ?? 60;
    this.maxAttempts = options.maxAttempts ?? 5;
  }

  async request(target: OtpTarget, purpose: OtpPurpose): Promise<void> {
    const now = this.now();
    const latest = await this.options.otps.findLatest(target.userId, purpose);

    if (latest) {
      const elapsedSeconds = (now.getTime() - latest.createdAt.getTime()) / 1000;
      if (elapsedSeconds < this.cooldownSeconds) {
        throw new OtpCooldownError();
      }
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = await hashPassword(code);
    const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);

    await this.options.otps.invalidateActive(target.userId, purpose, now);
    const otp = await this.options.otps.create({
      userId: target.userId,
      purpose,
      codeHash,
      expiresAt,
    });

    try {
      await this.options.email.send({
        to: this.options.adminEmail,
        subject: 'Your Healthcare News verification code',
        text: [
          `Hello ${target.name},`,
          '',
          `Your verification code is ${code}.`,
          `It expires in ${Math.round(this.ttlSeconds / 60)} minutes.`,
          '',
          'If you did not try to sign in, you can ignore this email.',
        ].join('\n'),
      });
    } catch (error) {
      await this.options.otps.markUsed(otp.id, now);
      if (error instanceof EmailUnavailableError) {
        throw error;
      }
      throw new EmailUnavailableError();
    }
  }

  async verify(target: OtpTarget, purpose: OtpPurpose, code: string): Promise<void> {
    const now = this.now();
    const latest = await this.options.otps.findLatest(target.userId, purpose);

    if (!latest || latest.usedAt) {
      throw new OtpError('That code is not valid. Request a new one.');
    }
    if (latest.expiresAt.getTime() <= now.getTime()) {
      throw new OtpError('That code has expired. Request a new one.');
    }
    if (latest.attempts >= this.maxAttempts) {
      throw new OtpError('Too many incorrect tries. Request a new code.');
    }

    const matches = await verifyPassword(latest.codeHash, code);
    if (!matches) {
      const attempts = await this.options.otps.incrementAttempts(latest.id);
      if (attempts >= this.maxAttempts) {
        await this.options.otps.markUsed(latest.id, now);
      }
      throw new OtpError('That code is incorrect.');
    }

    await this.options.otps.markUsed(latest.id, now);
  }
}
