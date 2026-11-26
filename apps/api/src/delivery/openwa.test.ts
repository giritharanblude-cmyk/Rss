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
});

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
