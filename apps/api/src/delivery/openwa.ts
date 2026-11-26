import { SocketClient } from '@open-wa/wa-automate-socket-client';
import type { IncomingWhatsAppMessage, WhatsAppAdapter, WhatsAppStatus } from './whatsapp';

type OpenWaConfig = {
  socketUrl?: string;
  apiKey?: string;
  sessionId?: string;
};

const SESSION_ID_NOT_SET = 'OpenWA session ID is not set';

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
  private lastError: string | null = null;
  private sessionConnected = false;

  constructor(private readonly config: OpenWaConfig) {}

  private get sessionId(): string | undefined {
    const sessionId = this.config.sessionId?.trim();
    return sessionId || undefined;
  }

  async connect(): Promise<void> {
    if (!this.sessionId) {
      this.lastError = SESSION_ID_NOT_SET;
      throw new Error(SESSION_ID_NOT_SET);
    }

    if (!this.config.socketUrl || !this.config.apiKey) {
      const error = new Error('OpenWA socket URL and API key are not configured.');
      this.lastError = error.message;
      throw error;
    }

    try {
      if (!this.client) {
        this.client = await SocketClient.connect(this.config.socketUrl, this.config.apiKey);
        this.client.socket.on('connect', () => {
          this.sessionConnected = false;
          this.lastError = null;
          this.subscribeToSessionStatus();
        });
        this.client.socket.on('connect_error', (error: Error) => {
          this.sessionConnected = false;
          this.lastError = this.errorDetail(error);
        });
        this.client.socket.on('disconnect', () => {
          this.sessionConnected = false;
        });
        this.client.socket.on('message', (message: unknown) => this.handleSessionStatus(message));
      }
      this.subscribeToSessionStatus();
      void this.startListening().catch((error: unknown) => {
        this.lastError = this.errorDetail(error);
      });
      this.lastError = null;
    } catch (error) {
      const detail = this.errorDetail(error);
      this.lastError = detail;
      throw new Error(detail, { cause: error });
    }
  }

  async getStatus(): Promise<WhatsAppStatus> {
    const connected = Boolean(this.client?.socket.connected && this.sessionConnected);
    return {
      connected,
      detail: connected
        ? 'Connected to the OpenWA session; verify the linked account in OpenWA.'
        : !this.sessionId
          ? SESSION_ID_NOT_SET
          : this.lastError ?? 'OpenWA session is not connected.',
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

  private subscribeToSessionStatus(): void {
    const sessionId = this.sessionId;
    if (!this.client?.socket.connected || !sessionId) return;
    this.client.socket.emit('message', {
      type: 'subscribe',
      sessionId,
      events: ['session.status'],
    });
  }

  private handleSessionStatus(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const frame = message as Record<string, unknown>;
    const payload =
      frame.type === 'event' && frame.payload && typeof frame.payload === 'object'
        ? (frame.payload as Record<string, unknown>)
        : frame;

    if (payload.event !== 'session.status' || payload.sessionId !== this.sessionId) return;
    if (!payload.data || typeof payload.data !== 'object') return;

    const data = payload.data as Record<string, unknown>;
    this.sessionConnected = data.status === 'ready' || data.status === 'connected';
    this.lastError = null;
    console.info(`OpenWA session status received; connected=${this.sessionConnected}`);
  }

  private errorDetail(error: unknown): string {
    const message = error instanceof Error ? error.message : 'OpenWA socket connection failed.';
    return [this.config.apiKey, this.config.socketUrl, this.sessionId]
      .filter((value): value is string => Boolean(value))
      .reduce((detail, sensitive) => detail.split(sensitive).join('[redacted]'), message);
  }
}
