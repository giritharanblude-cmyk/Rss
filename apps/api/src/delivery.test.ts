import { afterEach, describe, expect, it, vi } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { AlertPreviewService } from './alerts/preview';
import { buildEmailDigest, buildWhatsAppDigest } from './delivery/message';
import { DeliveryService } from './delivery/service';
import type { Database } from './db/client';
import { PostgresSettingsRepository } from './repositories/postgres-settings';
import { decryptSettings } from './settings/secrets';
import { createTestContext, loginAndVerify, seedMember, type TestContext } from './test/helpers';

let context: TestContext;
afterEach(async () => context.app.close());

function workbookText(buffer: Buffer): string {
  const contents: string[] = [];
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    contents.push((method === 8 ? inflateRawSync(data) : data).toString('utf8'));
    offset = dataStart + compressedSize;
  }
  return contents.join('\n');
}

async function setupEmailDelivery() {
  context = await createTestContext();
  const { cookie } = await loginAndVerify(context.app, context.email, 'Admin', 'master-password-1');
  const recipient = await context.recipients.createRecipient(
    {
      name: 'Asha',
      whatsappE164: null,
      email: 'asha@example.test',
      topics: ['Outbreaks and public health'],
      channel: 'email',
    },
    'a'.repeat(64),
  );
  await context.recipients.setConsent(
    recipient.id,
    'granted',
    context.clock.now(),
    'Agreed on call',
  );
  const source = await context.feeds.createSource({
    name: 'Health News',
    website: 'https://news.example.test',
    rssUrl: 'https://news.example.test/feed.xml',
    mode: 'all',
    topics: [],
    region: null,
    intervalMinutes: 60,
    active: true,
  });
  const item = {
    id: '00000000-0000-4000-8000-000000000123',
    sourceId: source.id,
    headline: 'Vaccine advisory',
    summary: 'Guidance',
    link: 'https://news.example.test/advisory',
    category: 'Outbreaks and public health' as const,
    publishedAt: context.clock.now(),
    fetchedAt: context.clock.now(),
    important: false,
    duplicateOf: null,
  };
  await context.feeds.addNewsForTest(item, context.clock.now());
  return { cookie, recipient, item };
}

describe('delivery pipeline', () => {
  it('queues eligible Send now deliveries, retries three attempts, and supports resend', async () => {
    const { cookie, item } = await setupEmailDelivery();
    const queued = await context.app.inject({
      method: 'POST',
      url: `/api/news/${item.id}/send`,
      headers: { cookie },
      payload: { channel: 'email' },
    });
    expect(queued.json()).toEqual({ queued: 1 });
    context.email.failSend = true;

    await context.deliveryService.runPending();
    context.clock.advance(30_000);
    await context.deliveryService.runPending();
    context.clock.advance(120_000);
    await context.deliveryService.runPending();

    const failed = await context.deliveries.list({ page: 1, pageSize: 10 });
    expect(failed.items[0]).toMatchObject({ status: 'failed', attempts: 3 });
    const resend = await context.app.inject({
      method: 'POST',
      url: `/api/deliveries/${failed.items[0]!.id}/resend`,
      headers: { cookie },
    });
    expect(resend.statusCode).toBe(202);
    context.email.failSend = false;
    await context.deliveryService.runPending();
    const delivered = await context.deliveries.list({ page: 1, pageSize: 10 });
    expect(delivered.items[0]).toMatchObject({ status: 'delivered', attempts: 1 });
    expect(context.email.sent.at(-1)).toMatchObject({
      to: 'asha@example.test',
      subject: 'Healthcare News Digest – 3 Nov 2026',
    });
  });

  it('resumes a persisted pending job in a new worker instance', async () => {
    const { recipient, item } = await setupEmailDelivery();
    await context.deliveries.enqueue(
      {
        recipientId: recipient.id,
        channel: 'email',
        kind: 'manual',
        subjectOrRef: 'restart-test',
        newsItemIds: [item.id],
      },
      context.clock.now(),
    );
    const restartedWorker = new DeliveryService(
      context.deliveries,
      context.recipients,
      context.recipients,
      new AlertPreviewService(
        context.recipients,
        context.recipients,
        context.recipients,
        context.clock.now,
      ),
      context.email,
      context.whatsapp,
      { now: context.clock.now, publicOrigin: 'https://news.example.test' },
    );

    await restartedWorker.runPending();

    const result = await context.deliveries.list({ page: 1, pageSize: 10 });
    expect(result.items[0]?.status).toBe('delivered');
  });

  it('rechecks consent immediately before sending a queued message', async () => {
    const { recipient, item } = await setupEmailDelivery();
    const sentBeforeQueue = context.email.sent.length;
    await context.deliveries.enqueue(
      {
        recipientId: recipient.id,
        channel: 'email',
        kind: 'manual',
        subjectOrRef: 'consent-recheck',
        newsItemIds: [item.id],
      },
      context.clock.now(),
    );
    await context.recipients.setConsent(
      recipient.id,
      'revoked',
      context.clock.now(),
      'Recipient withdrew consent',
    );

    await context.deliveryService.runPending();

    const result = await context.deliveries.list({ page: 1, pageSize: 10 });
    expect(context.email.sent).toHaveLength(sentBeforeQueue);
    expect(result.items[0]).toMatchObject({
      status: 'failed',
      lastError: 'Consent is no longer active; message not sent.',
    });
  });

  it('schedules due digests idempotently and records successful delivery', async () => {
    const { recipient } = await setupEmailDelivery();
    await context.recipients.createAlertRule({
      kind: 'digest',
      daysOfWeek: [2],
      timeLocal: '13:30',
      timezone: 'Asia/Kolkata',
      topics: ['Outbreaks and public health'],
      channels: ['email'],
      active: true,
    });

    expect(await context.deliveryService.scheduleDigests()).toBe(1);
    expect(await context.deliveryService.scheduleDigests()).toBe(1);
    expect((await context.deliveries.list({ page: 1, pageSize: 10 })).items).toHaveLength(1);
    await context.deliveryService.runPending();

    const result = await context.deliveries.list({ page: 1, pageSize: 10 });
    expect(result.items[0]).toMatchObject({
      recipientId: recipient.id,
      kind: 'digest',
      status: 'delivered',
    });
  });

  it('revokes consent for STOP and queues a single confirmation', async () => {
    context = await createTestContext();
    const recipient = await context.recipients.createRecipient(
      {
        name: 'Asha',
        whatsappE164: '+919876543210',
        email: null,
        topics: ['Outbreaks and public health'],
        channel: 'whatsapp',
      },
      'b'.repeat(64),
    );
    await context.recipients.setConsent(
      recipient.id,
      'granted',
      context.clock.now(),
      'Agreed on call',
    );
    await context.whatsapp.connect();

    await context.deliveryService.handleIncoming({
      from: '919876543210@c.us',
      body: '  stop ',
    });
    await context.deliveryService.runPending();
    await context.deliveryService.handleIncoming({
      from: '919876543210@c.us',
      body: 'STOP',
    });

    expect((await context.recipients.findRecipient(recipient.id))?.consentStatus).toBe('revoked');
    expect(context.whatsapp.sent).toHaveLength(1);
    expect(context.whatsapp.sent[0]?.text).toContain('unsubscribed');
  });

  it('exports filtered delivery rows as escaped CSV', async () => {
    const { cookie, recipient, item } = await setupEmailDelivery();
    await context.recipients.updateRecipient(recipient.id, {
      name: '=HYPERLINK("https://attacker.example","open")',
      whatsappE164: null,
      email: recipient.email,
      topics: recipient.topics,
      channel: recipient.channel,
    });
    await context.deliveries.enqueue(
      {
        recipientId: recipient.id,
        channel: 'email',
        kind: 'manual',
        subjectOrRef: 'csv-test',
        newsItemIds: [item.id],
      },
      context.clock.now(),
    );
    const response = await context.app.inject({
      method: 'GET',
      url: '/api/deliveries/export.csv',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.body).toContain(`"'=HYPERLINK(""https://attacker.example"",""open"")"`);
    expect(response.body).toContain('"email"');
  });

  it('stores the SMTP password encrypted through the PostgreSQL settings repository', async () => {
    let storedValue: string | null = null;
    const database = {
      insert: () => ({
        values: (value: { encryptedValue: string }) => ({
          onConflictDoUpdate: async () => {
            storedValue = value.encryptedValue;
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => (storedValue ? [{ value: storedValue }] : []),
          }),
        }),
      }),
    };
    const settings = new PostgresSettingsRepository(database as unknown as Database);
    context = await createTestContext({ settings });
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const password = 'private-mailbox-password';
    const response = await context.app.inject({
      method: 'PUT',
      url: '/api/settings/email',
      headers: { cookie },
      payload: {
        host: 'smtp.example.test',
        port: 465,
        secure: true,
        user: 'admin@example.test',
        password,
        fromName: 'Healthcare News Desk',
        fromEmail: 'admin@example.test',
      },
    });
    const stored = await context.settings.get('smtp_transport');
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(password);
    expect(response.body).not.toContain('admin@example.test');
    expect(stored).not.toContain(password);
    expect(stored).toMatch(/^v1\./);
    expect(JSON.parse(decryptSettings(stored!, '9f'.repeat(32)))).toMatchObject({ password });
    expect(context.managedEmail.getPublicSettings()).not.toHaveProperty('password');
    const sensitiveRecipient = await context.recipients.createRecipient(
      {
        name: 'Private Contact',
        whatsappE164: '+919876543210',
        email: 'private-contact@example.test',
        topics: ['Outbreaks and public health'],
        channel: 'both',
      },
      'b'.repeat(64),
    );

    const publicSettings = await context.app.inject({
      method: 'GET',
      url: '/api/settings/email',
      headers: { cookie },
    });
    expect(publicSettings.statusCode).toBe(200);
    expect(publicSettings.body).not.toContain(password);
    expect(publicSettings.body).not.toContain('admin@example.test');
    expect(publicSettings.json()).toMatchObject({ passwordConfigured: true });
    expect(publicSettings.json().settings).not.toHaveProperty('password');
    expect(publicSettings.json().settings).toMatchObject({
      user: 'ad***@example.test',
      fromEmail: 'ad***@example.test',
    });

    const settingsResponses = [
      response,
      publicSettings,
      await context.app.inject({
        method: 'POST',
        url: '/api/settings/email/test',
        headers: { cookie },
        payload: { to: 'probe@example.test' },
      }),
      await context.app.inject({
        method: 'GET',
        url: '/api/settings/connections',
        headers: { cookie },
      }),
      await context.app.inject({
        method: 'POST',
        url: '/api/settings/connections/check',
        headers: { cookie },
      }),
      await context.app.inject({
        method: 'POST',
        url: '/api/settings/whatsapp/connect',
        headers: { cookie },
      }),
      await context.app.inject({
        method: 'POST',
        url: '/api/settings/whatsapp/logout',
        headers: { cookie },
      }),
    ];
    for (const settingsResponse of settingsResponses) {
      expect(settingsResponse.body).not.toContain(password);
      expect(settingsResponse.body).not.toContain(sensitiveRecipient.email!);
      expect(settingsResponse.body).not.toContain(sensitiveRecipient.whatsappE164!);
      expect(settingsResponse.body).not.toContain(sensitiveRecipient.unsubscribeToken);
    }
  });

  it('redacts recipient contacts from delivery list and export responses', async () => {
    const { cookie, recipient, item } = await setupEmailDelivery();
    const password = 'private-mailbox-password';
    const queued = await context.app.inject({
      method: 'POST',
      url: `/api/news/${item.id}/send`,
      headers: { cookie },
      payload: { channel: 'email' },
    });
    expect(queued.statusCode).toBe(202);

    const listed = await context.app.inject({
      method: 'GET',
      url: '/api/deliveries',
      headers: { cookie },
    });
    const csv = await context.app.inject({
      method: 'GET',
      url: '/api/deliveries/export.csv',
      headers: { cookie },
    });
    const xlsx = await context.app.inject({
      method: 'GET',
      url: '/api/deliveries/export.xlsx',
      headers: { cookie },
    });
    const responseBodies = [listed.body, csv.body, workbookText(xlsx.rawPayload)];

    expect(listed.statusCode).toBe(200);
    expect(csv.statusCode).toBe(200);
    expect(xlsx.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ items: [{ recipientContact: null }] });
    expect(csv.body).toContain('[redacted]');
    expect(workbookText(xlsx.rawPayload)).toContain('[redacted]');
    for (const body of responseBodies) {
      expect(body).not.toContain(password);
      expect(body).not.toContain(recipient.email!);
      if (recipient.whatsappE164) expect(body).not.toContain(recipient.whatsappE164);
      expect(body).not.toContain(recipient.unsubscribeToken);
    }
  });

  it('exports XLSX as an OpenXML zip workbook', async () => {
    const { cookie, recipient, item } = await setupEmailDelivery();
    await context.deliveries.enqueue(
      {
        recipientId: recipient.id,
        channel: 'email',
        kind: 'manual',
        subjectOrRef: 'xlsx-test',
        newsItemIds: [item.id],
      },
      context.clock.now(),
    );
    const response = await context.app.inject({
      method: 'GET',
      url: '/api/deliveries/export.xlsx',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });

  it('checks and persists service connection status', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const verify = vi.spyOn(context.email, 'verify');
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/settings/connections/check',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      connections: [
        {
          service: 'whatsapp',
          state: 'disconnected',
          checkedAt: context.clock.now().toISOString(),
        },
        { service: 'email', state: 'working', checkedAt: context.clock.now().toISOString() },
      ],
    });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(await context.connections.list()).toHaveLength(2);
  });

  it('probes connections on read and returns actual failures instead of stored status', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    await context.connections.save({
      service: 'email',
      state: 'working',
      checkedAt: new Date('2026-11-02T00:00:00.000Z'),
      detail: null,
    });
    context.email.verifyStatus = { ok: false, detail: '535 Authentication failed' };
    vi.spyOn(context.whatsapp, 'getStatus').mockRejectedValue(new Error('OpenWA socket timed out'));

    const response = await context.app.inject({
      method: 'GET',
      url: '/api/settings/connections',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      connections: [
        {
          service: 'whatsapp',
          state: 'disconnected',
          detail: 'OpenWA socket timed out',
          checkedAt: context.clock.now().toISOString(),
        },
        {
          service: 'email',
          state: 'disconnected',
          detail: '535 Authentication failed',
          checkedAt: context.clock.now().toISOString(),
        },
      ],
    });
    expect(await context.connections.list()).toMatchObject([
      { service: 'email', state: 'disconnected', detail: '535 Authentication failed' },
      { service: 'whatsapp', state: 'disconnected', detail: 'OpenWA socket timed out' },
    ]);
  });

  it('rejects delivery resend and service settings writes for members', async () => {
    context = await createTestContext();
    const member = await seedMember(context.users, {
      name: 'Mina',
      email: 'mina@example.test',
      password: 'member-password-1',
    });
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      member.name,
      'member-password-1',
    );
    const connections = await context.app.inject({
      method: 'GET',
      url: '/api/settings/connections',
      headers: { cookie },
    });
    const deliveries = await context.app.inject({
      method: 'GET',
      url: '/api/deliveries',
      headers: { cookie },
    });
    const resend = await context.app.inject({
      method: 'POST',
      url: '/api/deliveries/00000000-0000-4000-8000-000000000001/resend',
      headers: { cookie },
    });
    const saveEmail = await context.app.inject({
      method: 'PUT',
      url: '/api/settings/email',
      headers: { cookie },
      payload: {},
    });
    const checkConnections = await context.app.inject({
      method: 'POST',
      url: '/api/settings/connections/check',
      headers: { cookie },
    });
    const resetMember = await context.app.inject({
      method: 'PATCH',
      url: `/api/members/${member.id}`,
      headers: { cookie },
      payload: { disabled: true },
    });
    expect(connections.statusCode).toBe(200);
    expect(connections.json().connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ service: 'email', detail: null }),
        expect.objectContaining({ service: 'whatsapp', detail: null }),
      ]),
    );
    expect(saveEmail.statusCode).toBe(403);
    expect(checkConnections.statusCode).toBe(403);
    expect(deliveries.statusCode).toBe(200);
    expect(resend.statusCode).toBe(403);
    expect(resetMember.statusCode).toBe(403);
  });
});

describe('delivery message templates', () => {
  const content = {
    recipientName: '<Asha>',
    unsubscribeUrl: 'https://news.example.test/unsubscribe/token',
    preferencesUrl: 'https://news.example.test/preferences/token',
    items: [
      {
        id: 'item-1',
        headline: 'Vaccine <advisory>',
        link: 'https://news.example.test/story',
        sourceName: 'Health News',
        category: 'Outbreaks and public health' as const,
        publishedAt: new Date('2026-11-03T08:00:00.000Z'),
        fetchedAt: new Date('2026-11-03T08:00:00.000Z'),
      },
    ],
    now: new Date('2026-11-03T08:00:00.000Z'),
  };

  it('includes required WhatsApp title, source/category, links, and STOP instruction', () => {
    const text = buildWhatsAppDigest(content);
    expect(text).toContain('Healthcare News – Daily Digest');
    expect(text).toContain('Health News │ Outbreaks and public health');
    expect(text).toContain('https://news.example.test/story');
    expect(text).toContain('Reply STOP');
  });

  it('escapes email HTML and provides preference links in both formats', () => {
    const message = buildEmailDigest(content, 'asha@example.test');
    expect(message.to).toBe('asha@example.test');
    expect(message.subject).toBe('Healthcare News Digest – 3 Nov 2026');
    expect(message.text).toContain('Manage topics: https://news.example.test/preferences/token');
    expect(message.html).toContain('&lt;Asha&gt;');
    expect(message.html).not.toContain('<Asha>');
    expect(message.html).toContain('Unsubscribe');
  });
});
