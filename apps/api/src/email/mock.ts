import { EmailUnavailableError } from '../errors';
import type { EmailMessage, EmailSender, EmailStatus } from './types';

export class MockEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  failSend = false;
  verifyStatus: EmailStatus = { ok: true };

  async send(message: EmailMessage): Promise<void> {
    if (this.failSend) {
      throw new EmailUnavailableError();
    }
    this.sent.push(message);
  }

  async verify(): Promise<EmailStatus> {
    return this.verifyStatus;
  }
}
