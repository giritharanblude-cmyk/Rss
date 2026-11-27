import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocketClient } from '@open-wa/wa-automate-socket-client';
import { createTestContext, type TestContext } from '../test/helpers';
import { loggerOptions } from '../logging';
import { OpenWaSocketAdapter } from './openwa';

type OpenWaClient = Awaited<ReturnType<typeof SocketClient.connect>>;
type OpenWaSocket = OpenWaClient['socket'];

const sessionId = 'configured-session';

function mockOpenWaClient() {
  const socket = Object.assign(new EventEmitter(), { connected: true }) as unknown as OpenWaSocket;
  const client = {
    socket,
    sendText: vi.fn(),
    killSession: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
  } as unknown as OpenWaClient;
  vi.spyOn(SocketClient, 'connect').mockResolvedValue(client);
  return { socket, emit: vi.spyOn(socket, 'emit') };
}

function sessionStatus(session: string, status: string) {
  return {
    type: 'event',
    payload: {
      event: 'session.status',
      sessionId: session,
      data: { status },
    },
  };
}

function unwrappedSessionStatus(session: string, status: string) {
  return {
    event: 'session.status',
    sessionId: session,
    data: { status },
  };
}

let context: TestContext | undefined;

afterEach(async () => {
  if (context) {
    await context.app.close();
    context = undefined;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const sendTestApiKey = 'openwa-test-api-key';

async function connectedAdapter() {
  mockOpenWaClient();
  const adapter = new OpenWaSocketAdapter({
    socketUrl: 'https://openwa.test/socket/path',
    apiKey: sendTestApiKey,
    sessionId,
  });
  await adapter.connect();
  return adapter;
}

describe('OpenWA session subscription', () => {
  it('sends a status subscribe frame for the configured session', async () => {
    const { emit } = mockOpenWaClient();
    const adapter = new OpenWaSocketAdapter({
      socketUrl: 'http://openwa.test',
      apiKey: 'test-key',
      sessionId,
    });

    await adapter.connect();

    const calls = emit.mock.calls as unknown as [string, unknown][];
    const subscribed = calls.some(([event, frame]) => {
      if (event !== 'message' || !frame || typeof frame !== 'object') return false;
      const request = frame as Record<string, unknown>;
      return (
        request.type === 'subscribe' &&
        request.sessionId === sessionId &&
        Array.isArray(request.events) &&
        request.events.length === 1 &&
        request.events[0] === 'session.status'
      );
    });
    expect(subscribed).toBe(true);
  });

  it('reports a missing session ID without connecting', async () => {
    const connect = vi.spyOn(SocketClient, 'connect');
    const adapter = new OpenWaSocketAdapter({
      socketUrl: 'http://openwa.test',
      apiKey: 'test-key',
    });

    await expect(adapter.connect()).rejects.toThrow('OpenWA session ID is not set');

    expect(connect).not.toHaveBeenCalled();
    expect((await adapter.getStatus()).detail).toBe('OpenWA session ID is not set');
  });

  it('marks health ok only after the configured session reports ready', async () => {
    const { socket } = mockOpenWaClient();
    const adapter = new OpenWaSocketAdapter({
      socketUrl: 'http://openwa.test',
      apiKey: 'test-key',
      sessionId,
    });
    await adapter.connect();
    socket.emit('message', sessionStatus('another-session', 'ready'));
    expect((await adapter.getStatus()).connected).toBe(false);

    socket.emit('message', sessionStatus(sessionId, 'ready'));
    context = await createTestContext();
    vi.spyOn(context.whatsapp, 'getStatus').mockImplementation(() => adapter.getStatus());

    const response = await context.app.inject({ method: 'GET', url: '/api/health' });

    expect(response.json().components.openwa.status).toBe('ok');
  });

  it('accepts an unwrapped connected status', async () => {
    const { socket } = mockOpenWaClient();
    const adapter = new OpenWaSocketAdapter({
      socketUrl: 'http://openwa.test',
      apiKey: 'test-key',
      sessionId,
    });
    await adapter.connect();

    socket.emit('message', unwrappedSessionStatus(sessionId, 'connected'));

    expect((await adapter.getStatus()).connected).toBe(true);
  });

  it('ignores status for a different session', async () => {
    const { socket } = mockOpenWaClient();
    const adapter = new OpenWaSocketAdapter({
      socketUrl: 'http://openwa.test',
      apiKey: 'test-key',
      sessionId,
    });
    await adapter.connect();
    socket.emit('message', sessionStatus(sessionId, 'ready'));

    socket.emit('message', sessionStatus('another-session', 'failed'));

    expect((await adapter.getStatus()).connected).toBe(true);
  });

  it.each(['disconnected', 'failed'])('marks a %s status as disconnected', async (status) => {
    const { socket } = mockOpenWaClient();
    const adapter = new OpenWaSocketAdapter({
      socketUrl: 'http://openwa.test',
      apiKey: 'test-key',
      sessionId,
    });
    await adapter.connect();
    socket.emit('message', sessionStatus(sessionId, 'ready'));

    socket.emit('message', sessionStatus(sessionId, status));

    expect((await adapter.getStatus()).connected).toBe(false);
  });

  it('logs a matching status without session or key values', async () => {
    const { socket } = mockOpenWaClient();
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const adapter = new OpenWaSocketAdapter({
      socketUrl: 'http://openwa.test',
      apiKey: 'test-key',
      sessionId,
    });
    await adapter.connect();

    socket.emit('message', sessionStatus(sessionId, 'ready'));

    const line = log.mock.calls.flat().join(' ');
    expect(log).toHaveBeenCalledTimes(1);
    expect(line.includes(sessionId)).toBe(false);
    expect(line.includes('test-key')).toBe(false);
  });

  it('keeps the session ID out of health output and logged connection errors', async () => {
    const adapter = new OpenWaSocketAdapter({
      socketUrl: 'http://openwa.test',
      apiKey: 'test-key',
      sessionId,
    });
    vi.spyOn(SocketClient, 'connect').mockRejectedValue(new Error(`Connection failed for ${sessionId}`));

    let thrown: unknown;
    try {
      await adapter.connect();
    } catch (error) {
      thrown = error;
    }

    context = await createTestContext();
    vi.spyOn(context.whatsapp, 'getStatus').mockImplementation(() => adapter.getStatus());
    const response = await context.app.inject({ method: 'GET', url: '/api/health' });
    const loggedError = thrown instanceof Error ? loggerOptions.serializers.err(thrown) : {};

    expect(response.body.includes(sessionId)).toBe(false);
    expect(JSON.stringify(loggedError).includes(sessionId)).toBe(false);
  });
});

describe('OpenWA text sending', () => {
  it('sends a REST request and resolves only after a confirmed response', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ messageId: 'confirmed' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = await connectedAdapter();

    await expect(adapter.sendText('+14155550123', 'Test message')).resolves.toBeUndefined();

    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      'https://openwa.test/api/sessions/configured-session/messages/send-text',
    );
    expect(options?.method).toBe('POST');
    expect(options?.redirect).toBe('error');
    expect(options?.headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': sendTestApiKey,
    });
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
    expect(body).toEqual({ chatId: '14155550123@c.us', text: 'Test message' });
    expect(body).not.toHaveProperty('to');
    expect(body).not.toHaveProperty('content');
    expect(String(url)).not.toContain(sendTestApiKey);
    expect(String(options?.body)).not.toContain(sendTestApiKey);
  });

  it.each([400, 500])('returns the response reason for HTTP %i', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ error: 'OpenWA rejected the send.' }), { status }),
      ),
    );
    const adapter = await connectedAdapter();

    await expect(adapter.sendText('+14155550123', 'Test message')).rejects.toThrow(
      'OpenWA rejected the send.',
    );
  });

  it('treats an error in a successful HTTP response as a failed send', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ error: 'OpenWA did not accept the send.' }), { status: 200 }),
      ),
    );
    const adapter = await connectedAdapter();

    await expect(adapter.sendText('+14155550123', 'Test message')).rejects.toThrow(
      'OpenWA did not accept the send.',
    );
  });

  it('does not report success without an OpenWA confirmation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({}), { status: 200 }),
      ),
    );
    const adapter = await connectedAdapter();

    await expect(adapter.sendText('+14155550123', 'Test message')).rejects.toThrow(
      'OpenWA response did not confirm the send.',
    );
  });

  it('returns a timeout reason after 15 seconds', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, options?: RequestInit) => {
        signal = options?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }),
    );
    const adapter = await connectedAdapter();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    try {
      const request = adapter.sendText('+14155550123', 'Test message');
      const timedOut = expect(request).rejects.toThrow(
        'OpenWA send request timed out after 15 seconds.',
      );
      await vi.advanceTimersByTimeAsync(15_000);
      await timedOut;
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('redacts the API key from send errors and never logs it', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ error: `OpenWA rejected the send with ${sendTestApiKey}` }),
          { status: 500 },
        ),
      ),
    );
    const adapter = await connectedAdapter();
    let reason = '';
    try {
      await adapter.sendText('+14155550123', 'Test message');
    } catch (caught) {
      reason = caught instanceof Error ? caught.message : '';
    }

    expect(reason).toBe('OpenWA rejected the send with [redacted]');
    expect(reason).not.toContain(sendTestApiKey);
    expect(JSON.stringify([info.mock.calls, warn.mock.calls, error.mock.calls])).not.toContain(
      sendTestApiKey,
    );
  });
});
