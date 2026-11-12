import nodemailer, { type Transporter } from 'nodemailer';
import { EmailUnavailableError } from '../errors';
import type { EmailMessage, EmailSender, EmailStatus } from './types';

export type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromEmail: string;
};

export class SmtpEmailSender implements EmailSender {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(private readonly settings: SmtpSettings) {
    this.transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: { user: settings.user, pass: settings.password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    this.from = `"${settings.fromName}" <${settings.fromEmail}>`;
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.message ? error.message : 'Unknown SMTP error.';
      throw new EmailUnavailableError(`Could not send email: ${reason}`);
    }
  }

  async verify(): Promise<EmailStatus> {
    try {
      await this.transporter.verify();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : 'Email check failed',
      };
    }
  }
}
