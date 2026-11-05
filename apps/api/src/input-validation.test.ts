import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, loginAndVerify, type TestContext } from './test/helpers';

let context: TestContext;

afterEach(async () => context.app.close());

describe('API request validation', () => {
  it('rejects invalid request bodies, queries, and path parameters', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const headers = { cookie };
    const validId = '00000000-0000-4000-8000-000000000001';

    const responses = [
      await context.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { name: '', password: '' },
      }),
      await context.app.inject({
        method: 'POST',
        url: '/api/sources',
        headers,
        payload: { name: 'Feed', website: 'file:///etc/passwd' },
      }),
      await context.app.inject({
        method: 'POST',
        url: '/api/members',
        headers,
        payload: { name: 'Member', email: 'invalid', password: 'short' },
      }),
      await context.app.inject({
        method: 'POST',
        url: '/api/recipients',
        headers,
        payload: { name: '', channel: 'fax' },
      }),
      await context.app.inject({
        method: 'POST',
        url: '/api/alert-rules',
        headers,
        payload: { kind: 'weekly', daysOfWeek: [8] },
      }),
      await context.app.inject({
        method: 'GET',
        url: `/api/news?sourceId=invalid`,
        headers,
      }),
      await context.app.inject({
        method: 'GET',
        url: '/api/deliveries?channel=fax',
        headers,
      }),
      await context.app.inject({
        method: 'GET',
        url: '/api/deliveries?from=2026-02-30',
        headers,
      }),
      await context.app.inject({
        method: 'GET',
        url: `/api/recipients?q=${'x'.repeat(121)}`,
        headers,
      }),
      await context.app.inject({
        method: 'PATCH',
        url: '/api/news/not-a-uuid/important',
        headers,
        payload: { important: true },
      }),
      await context.app.inject({
        method: 'PATCH',
        url: `/api/news/${validId}/important`,
        headers,
        payload: { important: 'yes' },
      }),
      await context.app.inject({
        method: 'POST',
        url: '/api/news/not-a-uuid/send',
        headers,
        payload: { channel: 'email' },
      }),
      await context.app.inject({
        method: 'POST',
        url: `/api/news/${validId}/send`,
        headers,
        payload: { channel: 'fax' },
      }),
      await context.app.inject({
        method: 'PATCH',
        url: '/api/members/not-a-uuid',
        headers,
        payload: { disabled: true },
      }),
      await context.app.inject({
        method: 'POST',
        url: '/api/members/not-a-uuid/reset-password',
        headers,
        payload: { password: 'member-password-2' },
      }),
      await context.app.inject({
        method: 'PATCH',
        url: '/api/sources/not-a-uuid',
        headers,
        payload: { active: false },
      }),
      await context.app.inject({
        method: 'DELETE',
        url: '/api/sources/not-a-uuid',
        headers,
      }),
      await context.app.inject({
        method: 'GET',
        url: '/api/sources/test/not-a-uuid',
        headers,
      }),
      await context.app.inject({
        method: 'POST',
        url: '/api/settings/email/test',
        headers,
        payload: { to: 'invalid' },
      }),
      await context.app.inject({
        method: 'PUT',
        url: '/api/settings/email',
        headers,
        payload: { host: '', port: -1 },
      }),
      await context.app.inject({
        method: 'GET',
        url: `/api/public/preferences/${'invalid'}`,
      }),
    ];

    expect(responses.map((response) => response.statusCode)).toEqual([
      400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400,
      400, 400, 404,
    ]);
  });
});
