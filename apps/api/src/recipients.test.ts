import { afterEach, describe, expect, it } from 'vitest';
import type { AlertRuleInput, RecipientInput } from '@healthcare/shared';
import { createTestContext, loginAndVerify, seedMember, type TestContext } from './test/helpers';

let context: TestContext;

afterEach(async () => context.app.close());

const recipientInput: RecipientInput = {
  name: 'Asha',
  whatsappE164: '+919876543210',
  email: 'asha@example.test',
  topics: ['Outbreaks and public health'],
  channel: 'both',
};

const digestRule: AlertRuleInput = {
  kind: 'digest',
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  timeLocal: '08:00',
  timezone: 'Asia/Kolkata',
  topics: ['Outbreaks and public health'],
  channels: ['email'],
  active: true,
};

async function masterCookie() {
  return (await loginAndVerify(context.app, context.email, 'Admin', 'master-password-1')).cookie;
}

describe('recipient management and public preferences', () => {
  it('validates contact details, keeps new recipients pending, and requires a consent note', async () => {
    context = await createTestContext();
    const cookie = await masterCookie();
    const invalid = await context.app.inject({
      method: 'POST',
      url: '/api/recipients',
      headers: { cookie },
      payload: {
        ...recipientInput,
        whatsappE164: '9876',
        email: 'not-an-email',
      },
    });
    expect(invalid.statusCode).toBe(400);

    const created = await context.app.inject({
      method: 'POST',
      url: '/api/recipients',
      headers: { cookie },
      payload: recipientInput,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      recipient: {
        name: 'Asha',
        consentStatus: 'pending',
        whatsappE164: recipientInput.whatsappE164,
      },
    });
    expect(created.body).not.toContain('unsubscribeToken');
    const id = (created.json() as { recipient: { id: string } }).recipient.id;

    const missingNote = await context.app.inject({
      method: 'PATCH',
      url: `/api/recipients/${id}/consent`,
      headers: { cookie },
      payload: { status: 'granted' },
    });
    expect(missingNote.statusCode).toBe(400);

    const confirmed = await context.app.inject({
      method: 'PATCH',
      url: `/api/recipients/${id}/consent`,
      headers: { cookie },
      payload: { status: 'granted', note: 'Agreed on call, 4 Nov' },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({
      recipient: {
        consentStatus: 'granted',
        consentNote: 'Agreed on call, 4 Nov',
        consentAt: context.clock.now().toISOString(),
      },
    });
  });

  it('supports public topic management and immediately revokes on unsubscribe', async () => {
    context = await createTestContext();
    const cookie = await masterCookie();
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/recipients',
      headers: { cookie },
      payload: recipientInput,
    });
    const recipient = (created.json() as { recipient: { id: string } }).recipient;
    await context.recipients.setConsent(
      recipient.id,
      'granted',
      context.clock.now(),
      'Consent noted',
    );
    const token = (await context.recipients.findRecipient(recipient.id))?.unsubscribeToken;
    if (!token) throw new Error('Expected generated recipient token.');

    const preferences = await context.app.inject({
      method: 'GET',
      url: `/api/public/preferences/${token}`,
    });
    expect(preferences.statusCode).toBe(200);
    const updatedTopics = await context.app.inject({
      method: 'PATCH',
      url: `/api/public/preferences/${token}`,
      payload: { topics: ['Drugs and approvals'] },
    });
    expect(updatedTopics.json()).toMatchObject({ topics: ['Drugs and approvals'] });

    const unsubscribed = await context.app.inject({
      method: 'POST',
      url: `/api/public/unsubscribe/${token}`,
    });
    expect(unsubscribed.statusCode).toBe(200);
    expect((await context.recipients.findRecipient(recipient.id))?.consentStatus).toBe('revoked');
    expect(
      (
        await context.app.inject({
          method: 'POST',
          url: `/api/public/unsubscribe/${'0'.repeat(64)}`,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('allows members to view recipients but denies writes and alert configuration', async () => {
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
    const list = await context.app.inject({
      method: 'GET',
      url: '/api/recipients',
      headers: { cookie },
    });
    const create = await context.app.inject({
      method: 'POST',
      url: '/api/recipients',
      headers: { cookie },
      payload: recipientInput,
    });
    const update = await context.app.inject({
      method: 'PATCH',
      url: '/api/recipients/00000000-0000-4000-8000-000000000001',
      headers: { cookie },
      payload: recipientInput,
    });
    const consent = await context.app.inject({
      method: 'PATCH',
      url: '/api/recipients/00000000-0000-4000-8000-000000000001/consent',
      headers: { cookie },
      payload: { status: 'revoked' },
    });
    const remove = await context.app.inject({
      method: 'DELETE',
      url: '/api/recipients/00000000-0000-4000-8000-000000000001',
      headers: { cookie },
    });
    const rules = await context.app.inject({
      method: 'GET',
      url: '/api/alert-rules',
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(create.statusCode).toBe(403);
    expect(update.statusCode).toBe(403);
    expect(consent.statusCode).toBe(403);
    expect(remove.statusCode).toBe(403);
    expect(rules.statusCode).toBe(403);
  });
});

describe('alerts and schedule', () => {
  it('previews only consented, topic-matched recipients with unseen grouped content and a cap', async () => {
    context = await createTestContext();
    const cookie = await masterCookie();
    const recipientIds: string[] = [];
    for (const [name, status, topics] of [
      ['Asha', 'granted', ['Outbreaks and public health']],
      ['Pending', 'pending', ['Outbreaks and public health']],
      ['Revoked', 'revoked', ['Outbreaks and public health']],
      ['Other topic', 'granted', ['Hospitals and industry']],
    ] as const) {
      const input = {
        ...recipientInput,
        name,
        topics: [...topics],
        channel: 'email' as const,
        whatsappE164: null,
      };
      const created = await context.recipients.createRecipient(
        input,
        `${name.toLowerCase()}-token`,
      );
      recipientIds.push(created.id);
      await context.recipients.setConsent(
        created.id,
        status,
        context.clock.now(),
        status === 'granted' ? 'Consent recorded' : null,
      );
    }

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
    const now = context.clock.now();
    await context.feeds.addNewsForTest(
      {
        sourceId: source.id,
        headline: 'Vaccine advisory',
        summary: 'Latest public health update',
        category: 'Outbreaks and public health',
        publishedAt: now,
        important: true,
      },
      now,
    );
    await context.feeds.addNewsForTest(
      {
        sourceId: source.id,
        headline: 'Older vaccine advisory',
        summary: 'Already delivered',
        category: 'Outbreaks and public health',
        publishedAt: new Date(now.getTime() - 60 * 60_000),
      },
      new Date(now.getTime() - 60 * 60_000),
    );
    context.recipients.setLastDigestForTest(
      recipientIds[0]!,
      new Date(now.getTime() - 30 * 60_000),
    );
    const rule = await context.recipients.createAlertRule(digestRule);

    const preview = await context.app.inject({
      method: 'POST',
      url: '/api/alert-rules/preview',
      headers: { cookie },
      payload: { kind: 'digest', ruleId: rule.id, limit: 1 },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      recipientCount: 1,
      itemCount: 1,
      groups: [
        {
          recipientName: 'Asha',
          channels: ['email'],
          itemsByCategory: [
            {
              category: 'Outbreaks and public health',
              items: [{ headline: 'Vaccine advisory' }],
            },
          ],
        },
      ],
    });

    const instantRule = {
      ...digestRule,
      kind: 'instant' as const,
      topics: [],
    };
    const instant = await context.app.inject({
      method: 'POST',
      url: '/api/alert-rules/preview',
      headers: { cookie },
      payload: { kind: 'instant', rule: instantRule, limit: 10 },
    });
    expect(instant.json()).toMatchObject({
      recipientCount: 1,
      itemCount: 1,
      groups: [
        { recipientName: 'Asha', itemsByCategory: [{ items: [{ headline: 'Vaccine advisory' }] }] },
      ],
    });
    const disabled = await context.app.inject({
      method: 'POST',
      url: '/api/alert-rules/preview',
      headers: { cookie },
      payload: { kind: 'instant', rule: { ...instantRule, active: false }, limit: 10 },
    });
    expect(disabled.json()).toMatchObject({ recipientCount: 0, itemCount: 0, groups: [] });
  });

  it('validates timezone and supports saving an active instant alert', async () => {
    context = await createTestContext();
    const cookie = await masterCookie();
    const invalid = await context.app.inject({
      method: 'POST',
      url: '/api/alert-rules',
      headers: { cookie },
      payload: { ...digestRule, timezone: 'Mars/Olympus' },
    });
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/alert-rules',
      headers: { cookie },
      payload: { ...digestRule, kind: 'instant', timeLocal: '00:00' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      rule: { kind: 'instant', timeLocal: '00:00', active: true },
    });
  });
});
