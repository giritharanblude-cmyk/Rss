import { afterEach, describe, expect, it } from 'vitest';
import { AlertPreviewService } from './alerts/preview';
import { buildEmailDigest, buildWhatsAppDigest } from './delivery/message';
import { DeliveryService } from './delivery/service';
import { decryptSettings } from './settings/secrets';
import { createTestContext, loginAndVerify, seedMember, type TestContext } from './test/helpers';

let context: TestContext;
afterEach(async () => context.app.close());

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

  it('encrypts SMTP credentials at rest and never returns the password', async () => {
    context = await createTestContext();
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
    expect(stored).not.toContain(password);
    expect(JSON.parse(decryptSettings(stored!, '9f'.repeat(32)))).toMatchObject({ password });
    expect(context.managedEmail.getPublicSettings()).not.toHaveProperty('password');
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
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/settings/connections/check',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      connections: [
        { service: 'whatsapp', state: 'disconnected' },
        { service: 'email', state: 'working' },
      ],
    });
    expect(await context.connections.list()).toHaveLength(2);
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
    const saveEmail = await context.app.inject({
      method: 'PUT',
      url: '/api/settings/email',
      headers: { cookie },
      payload: {},
    });
    expect(connections.statusCode).toBe(403);
    expect(saveEmail.statusCode).toBe(403);
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
