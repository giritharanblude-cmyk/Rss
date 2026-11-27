import { SocketClient } from '@open-wa/wa-automate-socket-client';
import type { IncomingWhatsAppMessage, WhatsAppAdapter, WhatsAppStatus } from './whatsapp';

type OpenWaConfig = {
  socketUrl?: string;
  apiKey?: string;
  sessionId?: string;
};

const SESSION_ID_NOT_SET = 'OpenWA session ID is not set';
const SEND_TEXT_TIMEOUT_MS = 15_000;
const SEND_TEXT_TIMEOUT_REASON = 'OpenWA send request timed out after 15 seconds.';

function messageFrom(value: unknown): IncomingWhatsAppMessage | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.from !== 'string' || typeof record.body !== 'string') return null;
  return { from: record.from, body: record.body };
}

function responseErrorReason(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  const error = record.error;
  const details = typeof record.details === 'string' ? record.details : undefined;
  const status =
    typeof record.status === 'string' ? record.status.toLowerCase() : undefined;
  const indicatesError =
    Boolean(error) ||
    record.success === false ||
    record.ok === false ||
    status === 'error' ||
    status === 'failed';

  if (indicatesError) {
    const message =
      typeof error === 'string'
        ? error
        : typeof error === 'object' &&
            error !== null &&
            'message' in error &&
            typeof error.message === 'string'
          ? error.message
          : typeof record.message === 'string'
            ? record.message
            : undefined;
    return [message, details].filter(Boolean).join(': ') || 'OpenWA reported a send error.';
  }
  return undefined;
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
    const sessionId = this.sessionId;
    const apiKey = this.config.apiKey;
    if (!sessionId) throw new Error(SESSION_ID_NOT_SET);
    if (!this.config.socketUrl || !apiKey) {
      throw new Error('OpenWA socket URL and API key are not configured.');
    }

    let endpoint: URL;
    try {
      endpoint = new URL(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages/send-text`,
        new URL(this.config.socketUrl).origin,
      );
    } catch {
      throw new Error('OpenWA socket URL is invalid.');
    }

    const controller = new AbortController();
    const timeoutSignal = Symbol('openwa-send-timeout');
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let response: Response | undefined;
    let responseText = '';
    let requestFailure: string | undefined;
    try {
      const request = (async () => {
        const result = await fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify({ chatId: jid, text }),
          signal: controller.signal,
        });
        return { response: result, responseText: await result.text() };
      })();
      const result = await Promise.race([
        request,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(timeoutSignal);
          }, SEND_TEXT_TIMEOUT_MS);
        }),
      ]);
      response = result.response;
      responseText = result.responseText;
    } catch (error) {
      requestFailure = timedOut || error === timeoutSignal
        ? SEND_TEXT_TIMEOUT_REASON
        : error instanceof Error && error.message
          ? error.message
          : 'OpenWA send request failed.';
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    if (requestFailure) throw new Error(this.redactApiKey(requestFailure));
    if (!response) throw new Error('OpenWA send request failed.');

    let body: unknown;
    try {
      body = JSON.parse(responseText);
    } catch {
      body = undefined;
    }
    const rawTextReason =
      !body && /^\s*(?:error|failed)\b/i.test(responseText) ? responseText.trim() : undefined;
    const errorReason = responseErrorReason(body) ?? rawTextReason;
    if (!response.ok || errorReason) {
      const plainTextReason =
        !response.ok && responseText.trim() && !responseText.trim().startsWith('<')
          ? responseText.trim()
          : undefined;
      const reason =
        errorReason ??
        plainTextReason ??
        `OpenWA send failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`;
      throw new Error(this.redactApiKey(reason));
    }
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !(('success' in body && body.success === true) ||
        ('messageId' in body && typeof body.messageId === 'string' && body.messageId.length > 0))
    ) {
      throw new Error('OpenWA response did not confirm the send.');
    }
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

  private redactApiKey(value: string): string {
    return this.config.apiKey ? value.split(this.config.apiKey).join('[redacted]') : value;
  }
}
