import { SocketClient } from '@open-wa/wa-automate-socket-client';
import type { IncomingWhatsAppMessage, WhatsAppAdapter, WhatsAppStatus } from './whatsapp';

type OpenWaConfig = {
  socketUrl?: string;
  apiKey?: string;
};

function messageFrom(value: unknown): IncomingWhatsAppMessage | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.from !== 'string' || typeof record.body !== 'string') return null;
  return { from: record.from, body: record.body };
}

export class OpenWaSocketAdapter implements WhatsAppAdapter {
  private client: Awaited<ReturnType<typeof SocketClient.connect>> | null = null;
  private readonly handlers = new Set<(message: IncomingWhatsAppMessage) => void>();
  private listening = false;

  constructor(private readonly config: OpenWaConfig) {}

  async connect(): Promise<void> {
    if (!this.config.socketUrl || !this.config.apiKey) {
      throw new Error('OpenWA socket URL and API key are not configured.');
    }
    if (!this.client) {
      this.client = await SocketClient.connect(this.config.socketUrl, this.config.apiKey);
    }
    await this.startListening();
  }

  async getStatus(): Promise<WhatsAppStatus> {
    const connected = Boolean(this.client?.socket.connected);
    return {
      connected,
      detail: connected
        ? 'Connected to the OpenWA session; verify the linked account in OpenWA.'
        : 'OpenWA session is not connected.',
    };
  }

  async sendText(number: string, text: string): Promise<void> {
    if (!this.client?.socket.connected) throw new Error('OpenWA session is not connected.');
    const jid = `${number.replace(/\D/g, '')}@c.us`;
    await this.client.sendText(jid, text);
  }

  onIncomingMessage(handler: (message: IncomingWhatsAppMessage) => void): () => void {
    this.handlers.add(handler);
    void this.startListening();
    return () => this.handlers.delete(handler);
  }

  async logout(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.listening = false;
    if (client) await client.killSession();
  }

  private async startListening(): Promise<void> {
    if (!this.client || this.listening) return;
    this.listening = true;
    await this.client.listen('onMessage', (value: unknown) => {
      const message = messageFrom(value);
      if (!message) return;
      for (const handler of this.handlers) handler(message);
    });
  }
}
