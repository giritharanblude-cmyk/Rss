import type { EmailMessage, EmailSender, EmailStatus } from './types';
import { SmtpEmailSender, type SmtpSettings } from './smtp';

export { smtpSettingsSchema } from '@healthcare/shared';

export type PublicSmtpSettings = Omit<SmtpSettings, 'password'>;

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
