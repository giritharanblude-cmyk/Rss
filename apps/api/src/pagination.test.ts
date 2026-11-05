import { afterEach, describe, expect, it } from 'vitest';
import type { AlertRuleInput, RecipientInput } from '@healthcare/shared';
import { createTestContext, loginAndVerify, type TestContext } from './test/helpers';

let context: TestContext;

afterEach(async () => context.app.close());

const sourceInput = {
  website: 'https://news.example.test',
  rssUrl: 'https://news.example.test/feed.xml',
  mode: 'all',
  topics: [],
  region: null,
  intervalMinutes: 60,
  active: true,
};

const recipientInput: RecipientInput = {
  name: 'Recipient',
  whatsappE164: null,
  email: 'recipient@example.test',
  topics: [],
  channel: 'email',
};

const ruleInput: AlertRuleInput = {
  kind: 'digest',
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  timeLocal: '08:00',
  timezone: 'Asia/Kolkata',
  topics: [],
  channels: ['email'],
  active: true,
};

describe('list endpoint pagination', () => {
  it('returns bounded pages and accurate metadata for every collection endpoint', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const headers = { cookie };

    for (const name of ['Alpha', 'Bravo']) {
      expect(
        (
          await context.app.inject({
            method: 'POST',
            url: '/api/sources',
            headers,
            payload: { ...sourceInput, name },
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await context.app.inject({
            method: 'POST',
            url: '/api/recipients',
            headers,
            payload: { ...recipientInput, name },
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await context.app.inject({
            method: 'POST',
            url: '/api/alert-rules',
            headers,
            payload: ruleInput,
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await context.app.inject({
            method: 'POST',
            url: '/api/members',
            headers,
            payload: {
              name,
              email: `${name.toLowerCase()}@example.test`,
              password: 'member-password-1',
            },
          })
        ).statusCode,
      ).toBe(201);
    }

    const endpoints = [
      { url: '/api/sources', key: 'sources', field: 'name' },
      { url: '/api/recipients', key: 'recipients', field: 'name' },
      { url: '/api/alert-rules', key: 'rules', field: 'id' },
      { url: '/api/members', key: 'members', field: 'name' },
    ] as const;

    for (const endpoint of endpoints) {
      const first = await context.app.inject({
        method: 'GET',
        url: `${endpoint.url}?page=1&pageSize=1`,
        headers,
      });
      const second = await context.app.inject({
        method: 'GET',
        url: `${endpoint.url}?page=2&pageSize=1`,
        headers,
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      const firstData = first.json() as Record<string, unknown> & {
        sources?: { name?: string; id?: string }[];
        recipients?: { name?: string; id?: string }[];
        rules?: { name?: string; id?: string }[];
        members?: { name?: string; id?: string }[];
      };
      const secondData = second.json() as typeof firstData;
      expect(firstData).toMatchObject({ page: 1, pageSize: 1, total: 2 });
      expect(secondData).toMatchObject({ page: 2, pageSize: 1, total: 2 });
      const firstItems = firstData[endpoint.key];
      const secondItems = secondData[endpoint.key];
      expect(firstItems).toHaveLength(1);
      expect(secondItems).toHaveLength(1);
      expect(firstItems?.[0]?.[endpoint.field]).not.toBe(secondItems?.[0]?.[endpoint.field]);
    }
  });

  it('rejects page sizes above the configured limit on every list endpoint', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    for (const url of [
      '/api/sources?pageSize=101',
      '/api/recipients?pageSize=101',
      '/api/alert-rules?pageSize=101',
      '/api/members?pageSize=101',
      '/api/news?page=1&pageSize=51',
      '/api/deliveries?page=1&pageSize=101',
    ]) {
      const response = await context.app.inject({
        method: 'GET',
        url,
        headers: { cookie },
      });
      expect(response.statusCode, url).toBe(400);
    }
  });
});
