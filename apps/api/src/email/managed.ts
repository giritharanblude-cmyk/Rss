import type { EmailMessage, EmailSender, EmailStatus } from './types';
import { SmtpEmailSender, type SmtpSettings } from './smtp';
import { z } from 'zod';

export type PublicSmtpSettings = Omit<SmtpSettings, 'password'>;
export const smtpSettingsSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(500),
  fromName: z.string().trim().min(1).max(120),
  fromEmail: z.string().trim().email(),
});

export class ManagedEmailSender implements EmailSender {
  private sender: EmailSender;
  private settings: SmtpSettings | null = null;

  constructor(fallback: EmailSender) {
    this.sender = fallback;
  }

  configure(settings: SmtpSettings): void {
    this.settings = { ...settings };
    this.sender = new SmtpEmailSender(settings);
  }

  getPublicSettings(): PublicSmtpSettings | null {
    if (!this.settings) return null;
    const { password: _password, ...settings } = this.settings;
    return settings;
  }

  hasPassword(): boolean {
    return Boolean(this.settings?.password);
  }

  async send(message: EmailMessage): Promise<void> {
    return this.sender.send(message);
  }

  async verify(): Promise<EmailStatus> {
    return this.sender.verify();
  }
}
