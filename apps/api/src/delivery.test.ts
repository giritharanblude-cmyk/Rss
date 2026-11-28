import { afterEach, describe, expect, it, vi } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { AlertPreviewService } from './alerts/preview';
import { buildEmailDigest, buildWhatsAppDigest } from './delivery/message';
import { DeliveryService, mostRecentDigestOccurrence } from './delivery/service';
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

async function createNewsForOwner(ownerUserId: string, id: string) {
  const source = await context.feeds.createSource(
    {
      name: 'Owner News',
      website: 'https://owner-news.example.test',
      rssUrl: 'https://owner-news.example.test/feed.xml',
      mode: 'all',
      topics: [],
      region: null,
      intervalMinutes: 60,
      active: true,
    },
    ownerUserId,
  );
  const item = {
    id,
    sourceId: source.id,
    headline: 'Unmatched topic advisory',
    summary: 'Guidance',
    link: 'https://owner-news.example.test/advisory',
    category: 'Drugs and approvals' as const,
    publishedAt: context.clock.now(),
    fetchedAt: context.clock.now(),
    important: false,
    duplicateOf: null,
  };
  await context.feeds.addNewsForTest(item, context.clock.now());
  return item;
}

async function createDailyDigestRule(ownerUserId: string, active = true) {
  return context.recipients.createAlertRule(
    {
      kind: 'digest',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      timeLocal: '00:00',
      timezone: 'UTC',
      topics: [],
      channels: ['email'],
      active,
    },
    ownerUserId,
  );
}

function nextUtcMidnightAfter(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

function advanceClockTo(date: Date): void {
  const milliseconds = date.getTime() - context.clock.now().getTime();
  if (milliseconds > 0) context.clock.advance(milliseconds);
}

describe('delivery pipeline', () => {
  it('queues a matching recipient without an alert rule', async () => {
    const { recipient, item } = await setupEmailDelivery();

    const queued = await context.deliveryService.queueForNewItems([item], recipient.ownerUserId);
    const deliveries = await context.deliveries.list({ page: 1, pageSize: 10 });

    expect(queued).toBe(1);
    expect(deliveries.items).toMatchObject([
      {
        recipientId: recipient.id,
        channel: 'email',
        kind: 'instant',
        subjectOrRef: `saved:${item.id}`,
        newsItemIds: [item.id],
      },
    ]);
  });

  it('does not queue non-matching or unconsented recipients', async () => {
    const { recipient, item } = await setupEmailDelivery();
    await context.recipients.setConsent(
      recipient.id,
      'revoked',
      context.clock.now(),
      'Consent withdrawn',
    );
    const otherTopic = await context.recipients.createRecipient(
      {
        name: 'Other topic',
        whatsappE164: null,
        email: 'other-topic@example.test',
        topics: ['Drugs and approvals'],
        channel: 'email',
      },
      'b'.repeat(64),
      recipient.ownerUserId,
    );
    await context.recipients.setConsent(otherTopic.id, 'granted', context.clock.now(), 'Agreed');
    await context.recipients.createRecipient(
      {
        name: 'Pending consent',
        whatsappE164: null,
        email: 'pending@example.test',
        topics: ['Outbreaks and public health'],
        channel: 'email',
      },
      'c'.repeat(64),
      recipient.ownerUserId,
    );

    expect(await context.deliveryService.queueForNewItems([item], recipient.ownerUserId)).toBe(0);
    expect((await context.deliveries.list({ page: 1, pageSize: 10 })).items).toHaveLength(0);
  });

  it('does not queue the same item again for a recipient and channel', async () => {
    const { recipient, item } = await setupEmailDelivery();

    expect(await context.deliveryService.queueForNewItems([item], recipient.ownerUserId)).toBe(1);
    expect(await context.deliveryService.queueForNewItems([item], recipient.ownerUserId)).toBe(0);
    expect((await context.deliveries.list({ page: 1, pageSize: 10 })).items).toHaveLength(1);
  });

  it('caps automatic queueing at 50 deliveries per feed run', async () => {
    const { recipient, item } = await setupEmailDelivery();
    const secondItem = { ...item, id: '00000000-0000-4000-8000-000000000124' };
    for (let index = 0; index < 50; index += 1) {
      const additional = await context.recipients.createRecipient(
        {
          name: `Recipient ${index}`,
          whatsappE164: null,
          email: `recipient-${index}@example.test`,
          topics: ['Outbreaks and public health'],
          channel: 'email',
        },
        `${String(index + 1).padStart(64, '0')}`,
        recipient.ownerUserId,
      );
      await context.recipients.setConsent(additional.id, 'granted', context.clock.now(), 'Agreed');
    }

    expect(
      await context.deliveryService.queueForNewItems([item, secondItem], recipient.ownerUserId),
    ).toBe(50);
    const queued = await context.deliveries.list({ page: 1, pageSize: 100 });
    expect(queued.items).toHaveLength(50);
    expect(queued.items.every((delivery) => delivery.newsItemIds.includes(item.id))).toBe(true);
  });

  it('skips recipients owned by disabled accounts', async () => {
    const { recipient, item } = await setupEmailDelivery();
    await context.users.setDisabled(recipient.ownerUserId, true);

    expect(await context.deliveryService.queueForNewItems([item], recipient.ownerUserId)).toBe(0);
    expect((await context.deliveries.list({ page: 1, pageSize: 10 })).items).toHaveLength(0);
  });

  it('manually queues an item with no topic match to the signed-in user email', async () => {
    const { cookie, recipient, item } = await setupEmailDelivery();
    const accountEmail = 'admin-account@example.test';
    await context.users.updateContacts(context.master.id, accountEmail, null);
    await context.recipients.updateRecipient(
      recipient.id,
      { ...recipient, topics: ['Drugs and approvals'] },
      context.master.id,
    );

    const response = await context.app.inject({
      method: 'POST',
      url: `/api/news/${item.id}/send`,
      headers: { cookie },
      payload: { channel: 'email' },
    });
    expect(response.json()).toEqual({ queued: 1 });
    const queued = await context.deliveries.list({ page: 1, pageSize: 10 });
    expect(queued.items).toMatchObject([
      {
        recipientId: context.master.id,
        channel: 'email',
        kind: 'manual',
        recipientContact: accountEmail,
      },
    ]);
    expect(await context.recipients.listRecipients(undefined, context.master.id)).toHaveLength(1);
    const accountRecipient = await context.recipients.findRecipient(
      context.master.id,
      context.master.id,
    );
    expect(accountRecipient).not.toBeNull();
    await context.recipients.updateTopicsByToken(
      accountRecipient!.unsubscribeToken,
      [item.category],
    );
    expect(await context.deliveryService.queueForNewItems([item], context.master.id)).toBe(0);

    await context.deliveryService.runPending();
    expect(context.email.sent.at(-1)?.to).toBe(accountEmail);
  });

  it('manually queues WhatsApp to the signed-in user number', async () => {
    const { cookie, item } = await setupEmailDelivery();
    const accountPhone = '+14155550123';
    await context.users.updateContacts(context.master.id, context.master.email, accountPhone);

    const response = await context.app.inject({
      method: 'POST',
      url: `/api/news/${item.id}/send`,
      headers: { cookie },
      payload: { channel: 'whatsapp' },
    });
    expect(response.json()).toEqual({ queued: 1 });
    const queued = await context.deliveries.list({ page: 1, pageSize: 10 });
    expect(queued.items).toMatchObject([
      {
        recipientId: context.master.id,
        channel: 'whatsapp',
        kind: 'manual',
        recipientContact: accountPhone,
      },
    ]);
  });

  it("lets a master manually send a member-owned item to the master's contact", async () => {
    const { cookie } = await setupEmailDelivery();
    const member = await seedMember(context.users, {
      name: 'Mina',
      email: 'mina@example.test',
      password: 'member-password-1',
    });
    const item = await createNewsForOwner(member.id, '00000000-0000-4000-8000-000000000126');

    const response = await context.app.inject({
      method: 'POST',
      url: `/api/news/${item.id}/send`,
      headers: { cookie },
      payload: { channel: 'email' },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ queued: 1 });
    const sentBeforeDelivery = context.email.sent.length;
    await context.deliveryService.runPending();

    const queued = await context.deliveries.list({
      ownerUserId: context.master.id,
      page: 1,
      pageSize: 10,
    });
    expect(queued.items).toMatchObject([
      {
        recipientId: context.master.id,
        kind: 'manual',
        newsItemIds: [item.id],
        recipientContact: context.master.email,
      },
    ]);
    expect(context.email.sent.slice(sentBeforeDelivery).map((message) => message.to)).toEqual([
      context.master.email,
    ]);
  });

  it('lets a member manually send a visible item only to the member contact', async () => {
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
    const masterRecipient = await context.recipients.createRecipient(
      {
        name: 'Master contact',
        whatsappE164: null,
        email: context.master.email,
        topics: ['Drugs and approvals'],
        channel: 'email',
      },
      'd'.repeat(64),
      context.master.id,
    );
    await context.recipients.setConsent(
      masterRecipient.id,
      'granted',
      context.clock.now(),
      'Agreed',
      context.master.id,
    );
    const item = await createNewsForOwner(
      member.id,
      '00000000-0000-4000-8000-000000000125',
    );

    const response = await context.app.inject({
      method: 'POST',
      url: `/api/news/${item.id}/send`,
      headers: { cookie },
      payload: { channel: 'email' },
    });
    expect(response.json()).toEqual({ queued: 1 });
    await context.deliveryService.runPending();

    const queued = await context.deliveries.list({ ownerUserId: member.id, page: 1, pageSize: 10 });
    expect(queued.items).toMatchObject([
      { recipientId: member.id, recipientContact: member.email },
    ]);
    expect(queued.items[0]?.recipientId).not.toBe(masterRecipient.id);
    expect(context.email.sent.at(-1)?.to).toBe(member.email);
    expect(context.email.sent.at(-1)?.to).not.toBe(context.master.email);
  });

  it('returns 404 when a member manually sends an item outside their News Feed', async () => {
    const { item } = await setupEmailDelivery();
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

    const response = await context.app.inject({
      method: 'POST',
      url: `/api/news/${item.id}/send`,
      headers: { cookie },
      payload: { channel: 'email' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('This news item is not available to send.');
    expect(
      await context.deliveries.list({ ownerUserId: member.id, page: 1, pageSize: 10 }),
    ).toMatchObject({ items: [], total: 0 });
  });

  it('does not duplicate repeated manual sends and reports missing contacts', async () => {
    const { cookie, item } = await setupEmailDelivery();
    const first = await context.app.inject({
      method: 'POST',
      url: `/api/news/${item.id}/send`,
      headers: { cookie },
      payload: { channel: 'email' },
    });
    const second = await context.app.inject({
      method: 'POST',
      url: `/api/news/${item.id}/send`,
      headers: { cookie },
      payload: { channel: 'email' },
    });
    expect(first.json()).toEqual({ queued: 1 });
    expect(second.json()).toEqual({ queued: 0 });
    expect((await context.deliveries.list({ page: 1, pageSize: 10 })).items).toHaveLength(1);

    await context.users.updateContacts(context.master.id, ' ', null);
    const missingEmail = await context.app.inject({
      method: 'POST',
      url: `/api/news/${item.id}/send`,
      headers: { cookie },
      payload: { channel: 'email' },
    });
    const missingPhone = await context.app.inject({
      method: 'POST',
      url: `/api/news/${item.id}/send`,
      headers: { cookie },
      payload: { channel: 'whatsapp' },
    });
    expect(missingEmail.statusCode).toBe(400);
    expect(missingEmail.json().error).toContain('email address');
    expect(missingPhone.statusCode).toBe(400);
    expect(missingPhone.json().error).toContain('WhatsApp number');
  });

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
      to: 'admin@example.com',
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
      {
        now: context.clock.now,
        publicOrigin: 'https://news.example.test',
        isOwnerEnabled: async (ownerUserId) => {
          const owner = await context.users.findById(ownerUserId);
          return Boolean(owner && !owner.disabled);
        },
      },
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

  it('catches up a missed digest idempotently and records successful delivery', async () => {
    const { recipient } = await setupEmailDelivery();
    const rule = await createDailyDigestRule(context.master.id);
    const baseTime = new Date(
      Math.max(context.clock.now().getTime(), rule.createdAt.getTime()),
    );
    const occurrence = nextUtcMidnightAfter(baseTime);
    advanceClockTo(new Date(occurrence.getTime() + 60_000));

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
    expect(await context.deliveryService.scheduleDigests()).toBe(1);
    expect((await context.deliveries.list({ page: 1, pageSize: 10 })).items).toHaveLength(1);
  });

  it('catches up only the most recent occurrence after a long outage', async () => {
    const { recipient } = await setupEmailDelivery();
    const rule = await createDailyDigestRule(context.master.id);
    const baseTime = new Date(
      Math.max(context.clock.now().getTime(), rule.createdAt.getTime()),
    );
    const firstOccurrence = nextUtcMidnightAfter(baseTime);
    const now = new Date(firstOccurrence.getTime() + 5 * 24 * 60 * 60 * 1000 + 60_000);
    advanceClockTo(now);

    await context.deliveryService.scheduleDigests();
    await context.deliveryService.scheduleDigests();

    const deliveries = (await context.deliveries.list({ page: 1, pageSize: 10 })).items;
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.subjectOrRef).toBe(
      `digest:${rule.id}:${now.toISOString().slice(0, 10)}:${recipient.id}:email`,
    );
    const sentBeforeDelivery = context.email.sent.length;
    await context.deliveryService.runPending();
    expect(context.email.sent).toHaveLength(sentBeforeDelivery + 1);
  });

  it('does not catch up a digest while its rule is disabled', async () => {
    await setupEmailDelivery();
    const rule = await createDailyDigestRule(context.master.id, false);
    const baseTime = new Date(
      Math.max(context.clock.now().getTime(), rule.createdAt.getTime()),
    );
    const occurrence = nextUtcMidnightAfter(baseTime);
    advanceClockTo(new Date(occurrence.getTime() + 60_000));

    expect(await context.deliveryService.scheduleDigests()).toBe(0);
    expect((await context.deliveries.list({ page: 1, pageSize: 10 })).items).toHaveLength(0);
  });

  it("catches up each owner's rule only for that owner's recipients", async () => {
    const { recipient: masterRecipient } = await setupEmailDelivery();
    const member = await seedMember(context.users, {
      name: 'Mina',
      email: 'mina@example.test',
      password: 'member-password-1',
    });
    const memberRecipient = await context.recipients.createRecipient(
      {
        name: 'Member recipient',
        whatsappE164: null,
        email: 'member-recipient@example.test',
        topics: ['Drugs and approvals'],
        channel: 'email',
      },
      'e'.repeat(64),
      member.id,
    );
    await context.recipients.setConsent(
      memberRecipient.id,
      'granted',
      context.clock.now(),
      'Agreed',
      member.id,
    );
    await createNewsForOwner(member.id, '00000000-0000-4000-8000-000000000127');
    const masterRule = await createDailyDigestRule(context.master.id);
    const memberRule = await createDailyDigestRule(member.id);
    const baseTime = new Date(
      Math.max(
        context.clock.now().getTime(),
        masterRule.createdAt.getTime(),
        memberRule.createdAt.getTime(),
      ),
    );
    const occurrence = nextUtcMidnightAfter(baseTime);
    advanceClockTo(new Date(occurrence.getTime() + 60_000));

    expect(await context.deliveryService.scheduleDigests()).toBe(2);
    const deliveries = (await context.deliveries.list({ page: 1, pageSize: 10 })).items;
    expect(deliveries).toHaveLength(2);
    expect(deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ownerUserId: context.master.id,
          recipientId: masterRecipient.id,
          subjectOrRef: expect.stringContaining(`digest:${masterRule.id}:`),
        }),
        expect.objectContaining({
          ownerUserId: member.id,
          recipientId: memberRecipient.id,
          subjectOrRef: expect.stringContaining(`digest:${memberRule.id}:`),
        }),
      ]),
    );
  });

  it('does not schedule an occurrence before rule creation or before its local time', () => {
    const rule = {
      daysOfWeek: [0],
      timeLocal: '00:00',
      timezone: 'UTC',
      createdAt: new Date('2026-11-01T00:01:00.000Z'),
    };

    expect(
      mostRecentDigestOccurrence(rule, new Date('2026-11-01T23:59:00.000Z')),
    ).toBeNull();
  });

  it('resolves nonexistent and repeated local times using the agreed DST policy', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const springGap = mostRecentDigestOccurrence(
      {
        daysOfWeek: [0],
        timeLocal: '02:30',
        timezone: 'America/New_York',
        createdAt,
      },
      new Date('2026-03-08T07:31:00.000Z'),
    );
    const fallOverlap = mostRecentDigestOccurrence(
      {
        daysOfWeek: [0],
        timeLocal: '01:30',
        timezone: 'America/New_York',
        createdAt,
      },
      new Date('2026-11-01T07:00:00.000Z'),
    );

    expect(springGap).toEqual({
      at: new Date('2026-03-08T07:30:00.000Z'),
      dateKey: '2026-03-08',
    });
    expect(fallOverlap).toEqual({
      at: new Date('2026-11-01T05:30:00.000Z'),
      dateKey: '2026-11-01',
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

  it('sends an email test only to the signed-in user and returns the completed result', async () => {
    context = await createTestContext();
    const member = await seedMember(context.users, {
      name: 'Mina',
      email: 'mina@example.test',
      password: 'member-password-1',
    });
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/settings/email/test',
      headers: { cookie },
      payload: { to: member.email },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'sent',
      message: 'Test email sent successfully.',
    });
    expect(context.email.sent.at(-1)?.to).toBe(context.master.email);
    expect(response.body).not.toContain(context.master.email);
    expect(response.body).not.toContain(member.email);
  });

  it('sends a WhatsApp test only to the signed-in user and returns the completed result', async () => {
    context = await createTestContext();
    const member = await seedMember(context.users, {
      name: 'Mina',
      email: 'mina@example.test',
      password: 'member-password-1',
    });
    const ownPhone = '+14155550123';
    const otherPhone = '+14155550124';
    await context.users.updateContacts(context.master.id, context.master.email, ownPhone);
    await context.users.updateContacts(member.id, member.email, otherPhone);
    context.whatsapp.connected = true;
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/settings/whatsapp/test',
      headers: { cookie },
      payload: { number: otherPhone },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'sent',
      message: 'Test WhatsApp message sent successfully.',
    });
    expect(context.whatsapp.sent).toHaveLength(1);
    expect(context.whatsapp.sent[0]?.number).toBe(ownPhone);
    expect(response.body).not.toContain(ownPhone);
    expect(response.body).not.toContain(otherPhone);
  });

  it('allows members to send channel tests only to their own contacts', async () => {
    context = await createTestContext();
    const member = await seedMember(context.users, {
      name: 'Mina',
      email: 'mina@example.test',
      password: 'member-password-1',
    });
    const ownPhone = '+14155550123';
    await context.users.updateContacts(member.id, member.email, ownPhone);
    context.whatsapp.connected = true;
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      member.name,
      'member-password-1',
    );

    const emailTest = await context.app.inject({
      method: 'POST',
      url: '/api/settings/email/test',
      headers: { cookie },
    });
    const whatsappTest = await context.app.inject({
      method: 'POST',
      url: '/api/settings/whatsapp/test',
      headers: { cookie },
    });

    expect(emailTest.statusCode).toBe(200);
    expect(context.email.sent.at(-1)?.to).toBe(member.email);
    expect(whatsappTest.statusCode).toBe(200);
    expect(context.whatsapp.sent).toMatchObject([{ number: ownPhone }]);
    expect(emailTest.body).not.toContain(member.email);
    expect(whatsappTest.body).not.toContain(ownPhone);
  });

  it('returns a timeout response when a WhatsApp test send never resolves', async () => {
    context = await createTestContext();
    await context.users.updateContacts(context.master.id, context.master.email, '+14155550123');
    context.whatsapp.connected = true;
    let sendStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      sendStarted = resolve;
    });
    vi.spyOn(context.whatsapp, 'sendText').mockImplementation(() => {
      sendStarted();
      return new Promise<void>(() => {});
    });
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const responsePromise = context.app.inject({
        method: 'POST',
        url: '/api/settings/whatsapp/test',
        headers: { cookie },
      });
      await started;
      await vi.advanceTimersByTimeAsync(20_000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(504);
      expect(response.json().error).toBe(
        'WhatsApp did not confirm the send within 20 seconds. Check the OpenWA session.',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns a safe reason when a WhatsApp test send fails', async () => {
    context = await createTestContext();
    const ownPhone = '+14155550123';
    await context.users.updateContacts(context.master.id, context.master.email, ownPhone);
    context.whatsapp.connected = true;
    vi.spyOn(context.whatsapp, 'sendText').mockRejectedValue(
      new Error(`OpenWA session failed for ${ownPhone}: apiKey=secret-value`),
    );
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/settings/whatsapp/test',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe(
      'Test WhatsApp message could not be sent: OpenWA session failed for [REDACTED-PHONE]: [REDACTED-CREDENTIAL]',
    );
    expect(response.body).not.toContain(ownPhone);
    expect(response.body).not.toContain('secret-value');
  });

  it('returns clear reasons when a test channel is disconnected or its contact is missing', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    context.email.verifyStatus = { ok: false, detail: 'SMTP failed for admin@example.com' };
    const emailDisconnected = await context.app.inject({
      method: 'POST',
      url: '/api/settings/email/test',
      headers: { cookie },
    });
    const phoneMissing = await context.app.inject({
      method: 'POST',
      url: '/api/settings/whatsapp/test',
      headers: { cookie },
    });
    await context.users.updateContacts(context.master.id, context.master.email, '+14155550123');
    const whatsappDisconnected = await context.app.inject({
      method: 'POST',
      url: '/api/settings/whatsapp/test',
      headers: { cookie },
    });

    expect(emailDisconnected.statusCode).toBe(503);
    expect(emailDisconnected.json().error).toBe(
      'Email is not connected. Check SMTP settings and try again.',
    );
    expect(emailDisconnected.body).not.toContain('admin@example.com');
    expect(emailDisconnected.body).not.toContain('SMTP failed');
    expect(phoneMissing.statusCode).toBe(400);
    expect(phoneMissing.json().error).toBe('No WhatsApp number is saved for your account.');
    expect(whatsappDisconnected.statusCode).toBe(503);
    expect(whatsappDisconnected.json().error).toBe(
      'WhatsApp is not connected. Connect OpenWA and try again.',
    );
    expect(whatsappDisconnected.body).not.toContain('+14155550123');
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
    expect(resend.statusCode).toBe(409);
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
