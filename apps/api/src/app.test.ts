import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthResponseSchema } from '@healthcare/shared';
import { SocketClient } from '@open-wa/wa-automate-socket-client';
import { OpenWaSocketAdapter } from './delivery/openwa';
import { createTestContext, type TestContext } from './test/helpers';

let context: TestContext;

afterEach(async () => {
  await context.app.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('GET /api/health', () => {
  it('returns a valid health payload', async () => {
    context = await createTestContext();
    const response = await context.app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(() => healthResponseSchema.parse(response.json())).not.toThrow();
    expect(response.json()).toMatchObject({ databaseSizeBytes: 0 });
  });

  it('reports the database size provided by the database adapter', async () => {
    context = await createTestContext({ databaseSizeBytes: async () => 734_003_200 });
    const response = await context.app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ databaseSizeBytes: 734_003_200 });
  });

  it('reports OpenWA as healthy when the socket is connected', async () => {
    context = await createTestContext();
    vi.spyOn(context.whatsapp, 'getStatus').mockResolvedValue({
      connected: true,
      detail: 'Do not include arbitrary adapter details.',
    });

    const response = await context.app.inject({ method: 'GET', url: '/api/health' });

    expect(response.json()).toMatchObject({
      components: { openwa: { status: 'ok', detail: 'WhatsApp socket connected' } },
    });
  });

  it('reports the adapter reason when OpenWA is disconnected', async () => {
    context = await createTestContext();
    vi.spyOn(context.whatsapp, 'getStatus').mockResolvedValue({
      connected: false,
      detail: 'Socket handshake was rejected.',
    });

    const response = await context.app.inject({ method: 'GET', url: '/api/health' });

    expect(response.json()).toMatchObject({
      components: { openwa: { status: 'unknown', detail: 'Socket handshake was rejected.' } },
    });
  });

  it('does not expose the OpenWA API key in health output', async () => {
    const apiKey = 'health-test-api-key';
    const socketUrl = 'http://openwa.test:2785';
    const sessionId = 'health-test-session';
    const whatsapp = new OpenWaSocketAdapter({ socketUrl, apiKey, sessionId });
    vi.spyOn(SocketClient, 'connect').mockRejectedValue(
      new Error(`Socket connection failed for ${apiKey} at ${socketUrl}`),
    );
    await expect(whatsapp.connect()).rejects.toThrow();

    context = await createTestContext();
    vi.spyOn(context.whatsapp, 'getStatus').mockResolvedValue(await whatsapp.getStatus());

    const response = await context.app.inject({ method: 'GET', url: '/api/health' });

    expect(response.body).not.toContain(apiKey);
    expect(response.body).not.toContain(socketUrl);
    expect(response.body).not.toContain(sessionId);
    expect(response.json()).toMatchObject({
      components: {
        openwa: { status: 'unknown', detail: 'Socket connection failed for [redacted] at [redacted]' },
      },
    });
  });

  it('reports SMTP as healthy when all required environment variables are set', async () => {
    vi.stubEnv('SMTP_HOST', 'smtp.example.test');
    vi.stubEnv('SMTP_USER', 'smtp-user-secret');
    vi.stubEnv('SMTP_PASSWORD', 'smtp-password-secret');
    vi.stubEnv('MAIL_FROM_EMAIL', 'sender@example.test');
    context = await createTestContext();
    const response = await context.app.inject({ method: 'GET', url: '/api/health' });
    const body = response.body;

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      components: { smtp: { status: 'ok', detail: 'SMTP configuration is present.' } },
    });
    expect(body).not.toContain('smtp.example.test');
    expect(body).not.toContain('smtp-user-secret');
    expect(body).not.toContain('smtp-password-secret');
    expect(body).not.toContain('sender@example.test');
  });

  it('reports which SMTP environment variable is missing', async () => {
    vi.stubEnv('SMTP_HOST', '');
    vi.stubEnv('SMTP_USER', 'smtp-user-secret');
    vi.stubEnv('SMTP_PASSWORD', 'smtp-password-secret');
    vi.stubEnv('MAIL_FROM_EMAIL', 'sender@example.test');
    context = await createTestContext();
    const response = await context.app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      components: {
        smtp: {
          status: 'unknown',
          detail: 'Missing required SMTP configuration: SMTP_HOST.',
        },
      },
    });
    expect(response.body).not.toContain('smtp-user-secret');
    expect(response.body).not.toContain('smtp-password-secret');
    expect(response.body).not.toContain('sender@example.test');
  });
});
