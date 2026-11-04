import { schedule } from 'node-cron';
import type { EmailSender } from '../email/types';
import type { WhatsAppAdapter } from './whatsapp';

export type ConnectionRecord = {
  service: 'whatsapp' | 'email';
  state: string;
  checkedAt: Date;
  detail: string | null;
};

export type ConnectionRepository = {
  list(): Promise<ConnectionRecord[]>;
  save(record: ConnectionRecord): Promise<void>;
};

export class ConnectionMonitor {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly email: EmailSender,
    private readonly whatsapp: WhatsAppAdapter,
    private readonly now: () => Date,
  ) {}

  async check(): Promise<ConnectionRecord[]> {
    const [email, whatsapp] = await Promise.all([this.checkEmail(), this.checkWhatsApp()]);
    await Promise.all([this.repository.save(email), this.repository.save(whatsapp)]);
    return [whatsapp, email];
  }

  private async checkEmail(): Promise<ConnectionRecord> {
    try {
      const status = await this.email.verify();
      return {
        service: 'email',
        state: status.ok ? 'working' : 'disconnected',
        checkedAt: this.now(),
        detail: status.detail ?? null,
      };
    } catch {
      return {
        service: 'email',
        state: 'disconnected',
        checkedAt: this.now(),
        detail: 'Email connection check failed.',
      };
    }
  }

  private async checkWhatsApp(): Promise<ConnectionRecord> {
    try {
      const status = await this.whatsapp.getStatus();
      return {
        service: 'whatsapp',
        state: status.connected ? 'connected' : 'disconnected',
        checkedAt: this.now(),
        detail: status.detail ?? null,
      };
    } catch {
      return {
        service: 'whatsapp',
        state: 'disconnected',
        checkedAt: this.now(),
        detail: 'WhatsApp connection check failed.',
      };
    }
  }
}

export function startConnectionMonitor(
  monitor: ConnectionMonitor,
  log: (message: string, error: unknown) => void = (message, error) =>
    console.error(message, error),
): () => void {
  const run = (): void => {
    void monitor.check().catch((error: unknown) => {
      log('Could not update service connection status.', error);
    });
  };
  run();
  const task = schedule('* * * * *', run);
  return () => task.stop();
}
