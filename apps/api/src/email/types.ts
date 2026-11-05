export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailStatus = {
  ok: boolean;
  detail?: string;
};

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
  verify(): Promise<EmailStatus>;
}
