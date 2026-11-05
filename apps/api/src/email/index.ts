import type { AppConfig } from '../config';
import { EmailUnavailableError } from '../errors';
import type { EmailMessage, EmailSender, EmailStatus } from './types';
import { SmtpEmailSender } from './smtp';

export type { EmailMessage, EmailSender, EmailStatus } from './types';
export { MockEmailSender } from './mock';
export { SmtpEmailSender } from './smtp';

class UnconfiguredEmailSender implements EmailSender {
  async send(_message: EmailMessage): Promise<void> {
    throw new EmailUnavailableError(
      'Email is not set up yet. Add the Hostinger email connection in Settings.',
    );
  }

  async verify(): Promise<EmailStatus> {
    return { ok: false, detail: 'Hostinger email is not configured' };
  }
}

export function createEmailSender(config: AppConfig): EmailSender {
  if (
    config.SMTP_HOST &&
    config.SMTP_USER &&
    config.SMTP_PASSWORD &&
    config.MAIL_FROM_EMAIL
  ) {
    return new SmtpEmailSender({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      user: config.SMTP_USER,
      password: config.SMTP_PASSWORD,
      fromName: config.MAIL_FROM_NAME,
      fromEmail: config.MAIL_FROM_EMAIL,
    });
  }
  return new UnconfiguredEmailSender();
}
