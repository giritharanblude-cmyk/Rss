export type IncomingWhatsAppMessage = {
  from: string;
  body: string;
};

export type WhatsAppStatus = {
  connected: boolean;
  detail?: string;
  qrDataUrl?: string;
};

export interface WhatsAppAdapter {
  connect(): Promise<void>;
  getStatus(): Promise<WhatsAppStatus>;
  sendText(number: string, text: string): Promise<void>;
  onIncomingMessage(handler: (message: IncomingWhatsAppMessage) => void): () => void;
  logout(): Promise<void>;
}

export class MockWhatsAppAdapter implements WhatsAppAdapter {
  readonly sent: { number: string; text: string }[] = [];
  private readonly handlers = new Set<(message: IncomingWhatsAppMessage) => void>();
  connected = false;
  failSend = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async getStatus(): Promise<WhatsAppStatus> {
    return { connected: this.connected, detail: this.connected ? 'Connected' : 'Disconnected' };
  }

  async sendText(number: string, text: string): Promise<void> {
    if (!this.connected || this.failSend) throw new Error('WhatsApp is unavailable.');
    this.sent.push({ number, text });
  }

  onIncomingMessage(handler: (message: IncomingWhatsAppMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(message: IncomingWhatsAppMessage): void {
    for (const handler of this.handlers) handler(message);
  }

  async logout(): Promise<void> {
    this.connected = false;
  }
}
