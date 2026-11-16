import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceInput } from '@healthcare/shared';
import { createTestContext, loginAndVerify, seedMember, type TestContext } from './test/helpers';

let context: TestContext;

afterEach(async () => {
  vi.restoreAllMocks();
  await context.app.close();
});

const validSource: SourceInput = {
  name: 'Health News',
  website: 'https://1.1.1.1',
  rssUrl: 'https://1.1.1.1/feed.xml',
  mode: 'all',
  topics: [],
  region: null,
  intervalMinutes: 60,
  active: true,
};

describe('source management routes', () => {
  it('lets the master create, list, update, pause, and delete a source', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );

    const created = await context.app.inject({
      method: 'POST',
      url: '/api/sources',
      headers: { cookie },
      payload: validSource,
    });
    expect(created.statusCode).toBe(201);
    const source = (created.json() as { source: { id: string } }).source;

    const list = await context.app.inject({
      method: 'GET',
      url: '/api/sources',
      headers: { cookie },
    });
    expect(list.json()).toMatchObject({ sources: [{ name: 'Health News', intervalMinutes: 60 }] });

    const updated = await context.app.inject({
      method: 'PATCH',
      url: `/api/sources/${source.id}`,
      headers: { cookie },
      payload: { active: false, intervalMinutes: 360 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ source: { active: false, intervalMinutes: 360 } });

    const deleted = await context.app.inject({
      method: 'DELETE',
      url: `/api/sources/${source.id}`,
      headers: { cookie, 'content-type': 'application/json' },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it('rejects unauthenticated, invalid, missing, and foreign-owned deletions safely', async () => {
    context = await createTestContext();
    const master = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const source = await context.feeds.createSource(validSource, context.master.id);
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
    const headers = { cookie, 'content-type': 'application/json' };

    const unauthenticated = await context.app.inject({
      method: 'DELETE',
      url: `/api/sources/${source.id}`,
      headers: { 'content-type': 'application/json' },
    });
    const invalidId = await context.app.inject({
      method: 'DELETE',
      url: '/api/sources/not-a-uuid',
      headers: { cookie: master.cookie, 'content-type': 'application/json' },
    });
    const missing = await context.app.inject({
      method: 'DELETE',
      url: '/api/sources/00000000-0000-4000-8000-000000000099',
      headers: { cookie: master.cookie, 'content-type': 'application/json' },
    });
    const foreignOwned = await context.app.inject({
      method: 'DELETE',
      url: `/api/sources/${source.id}`,
      headers,
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(invalidId.statusCode).toBe(400);
    expect(missing.statusCode).toBe(404);
    expect(foreignOwned.statusCode).toBe(404);
    expect(await context.feeds.findSource(source.id)).not.toBeNull();
  });

  it('returns a safe conflict when a database constraint prevents deletion', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const source = await context.feeds.createSource(validSource, context.master.id);
    vi.spyOn(context.feeds, 'deleteSource').mockRejectedValue({ code: '23503' });

    const response = await context.app.inject({
      method: 'DELETE',
      url: `/api/sources/${source.id}`,
      headers: { cookie, 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: 'This source cannot be deleted while related records exist.',
    });
    expect(await context.feeds.findSource(source.id)).not.toBeNull();
  });

  it('preserves delivery history and unrelated news when a source is deleted', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const source = await context.feeds.createSource(validSource, context.master.id);
    const otherSource = await context.feeds.createSource(
      { ...validSource, name: 'Other News' },
      context.master.id,
    );
    const deletedNewsId = '00000000-0000-4000-8000-000000000101';
    const retainedNewsId = '00000000-0000-4000-8000-000000000102';
    await context.feeds.addNewsForTest(
      { id: deletedNewsId, sourceId: source.id, headline: 'Deleted news' },
      context.clock.now(),
    );
    await context.feeds.addNewsForTest(
      {
        id: retainedNewsId,
        sourceId: otherSource.id,
        headline: 'Retained news',
        duplicateOf: deletedNewsId,
      },
      context.clock.now(),
    );
    const recipient = await context.recipients.createRecipient(
      {
        name: 'Asha',
        whatsappE164: null,
        email: 'asha@example.test',
        topics: ['Outbreaks and public health'],
        channel: 'email',
      },
      'a'.repeat(64),
      context.master.id,
    );
    await context.deliveries.enqueue(
      {
        recipientId: recipient.id,
        channel: 'email',
        kind: 'manual',
        subjectOrRef: 'source-deletion-history',
        newsItemIds: [deletedNewsId],
      },
      context.clock.now(),
    );

    const response = await context.app.inject({
      method: 'DELETE',
      url: `/api/sources/${source.id}`,
      headers: { cookie, 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(204);
    expect(await context.feeds.findSource(source.id)).toBeNull();
    expect(await context.feeds.listNewsForTest()).toEqual([
      expect.objectContaining({ id: retainedNewsId, duplicateOf: null }),
    ]);
    expect(await context.deliveries.list({ page: 1, pageSize: 10 })).toMatchObject({
      total: 1,
      items: [{ newsItemIds: [deletedNewsId] }],
    });
  });

  it('validates feed URLs and only allows configured intervals', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );

    const badUrl = await context.app.inject({
      method: 'POST',
      url: '/api/sources',
      headers: { cookie },
      payload: { ...validSource, rssUrl: 'file:///etc/passwd' },
    });
    const badInterval = await context.app.inject({
      method: 'POST',
      url: '/api/sources',
      headers: { cookie },
      payload: { ...validSource, intervalMinutes: 15 },
    });

    expect(badUrl.statusCode).toBe(400);
    expect(badInterval.statusCode).toBe(400);
    expect(await context.feeds.listSources()).toHaveLength(0);
  });

  it.each(['website', 'rssUrl'] as const)(
    'rejects loopback URLs for %s on create and update without storing them',
    async (field) => {
      context = await createTestContext();
      const { cookie } = await loginAndVerify(
        context.app,
        context.email,
        'Admin',
        'master-password-1',
      );
      const headers = { cookie };
      const blockedUrl = 'http://127.0.0.1/feed';

      const rejectedCreate = await context.app.inject({
        method: 'POST',
        url: '/api/sources',
        headers,
        payload: { ...validSource, [field]: blockedUrl },
      });
      expect(rejectedCreate.statusCode).toBe(400);
      expect(rejectedCreate.json()).toEqual({ error: 'This feed address is not allowed.' });
      expect(await context.feeds.listSources()).toHaveLength(0);

      const created = await context.app.inject({
        method: 'POST',
        url: '/api/sources',
        headers,
        payload: validSource,
      });
      expect(created.statusCode).toBe(201);
      const sourceId = (created.json() as { source: { id: string } }).source.id;
      const rejectedUpdate = await context.app.inject({
        method: 'PATCH',
        url: `/api/sources/${sourceId}`,
        headers,
        payload: { [field]: blockedUrl },
      });

      expect(rejectedUpdate.statusCode).toBe(400);
      expect(rejectedUpdate.json()).toEqual({ error: 'This feed address is not allowed.' });
      expect(await context.feeds.findSource(sourceId)).toMatchObject({
        website: validSource.website,
        rssUrl: validSource.rssUrl,
      });
    },
  );

  it('rejects cloud metadata URLs, non-HTTP schemes, and non-standard ports', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const headers = { cookie };
    const invalidUrls = [
      'http://localhost/feed',
      'http://169.254.169.254/latest/meta-data/',
      'file:///etc/passwd',
      'https://1.1.1.1:8080/feed',
    ];

    for (const rssUrl of invalidUrls) {
      const response = await context.app.inject({
        method: 'POST',
        url: '/api/sources',
        headers,
        payload: { ...validSource, rssUrl },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty('error');
    }

    expect(await context.feeds.listSources()).toHaveLength(0);
  });

  it('queues feed tests and exposes their status only to the master', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );

    const queued = await context.app.inject({
      method: 'POST',
      url: '/api/sources/test',
      headers: { cookie },
      payload: { rssUrl: validSource.rssUrl },
    });
    expect(queued.statusCode).toBe(202);
    const job = queued.json() as { id: string; status: string };
    expect(job.status).toBe('queued');

    const status = await context.app.inject({
      method: 'GET',
      url: `/api/sources/test/${job.id}`,
      headers: { cookie },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ id: job.id, status: 'queued' });

    const member = await seedMember(context.users, {
      name: 'Mina',
      email: 'mina@example.test',
      password: 'member-password-1',
    });
    const { cookie: memberCookie } = await loginAndVerify(
      context.app,
      context.email,
      member.name,
      'member-password-1',
    );
    const forbidden = await context.app.inject({
      method: 'GET',
      url: `/api/sources/test/${job.id}`,
      headers: { cookie: memberCookie },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('lets members manage only their own sources', async () => {
    context = await createTestContext();
    const masterCookie = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const masterSource = await context.feeds.createSource(validSource, context.master.id);
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

    const empty = await context.app.inject({
      method: 'GET',
      url: '/api/sources',
      headers: { cookie },
    });
    const create = await context.app.inject({
      method: 'POST',
      url: '/api/sources',
      headers: { cookie },
      payload: { ...validSource, name: 'Member News' },
    });
    const memberSource = (create.json() as { source: { id: string } }).source;
    const storedMemberSource = await context.feeds.findSource(memberSource.id);
    const list = await context.app.inject({
      method: 'GET',
      url: '/api/sources',
      headers: { cookie },
    });
    const updateOtherOwner = await context.app.inject({
      method: 'PATCH',
      url: `/api/sources/${masterSource.id}`,
      headers: { cookie },
      payload: { active: false },
    });
    const updateOwn = await context.app.inject({
      method: 'PATCH',
      url: `/api/sources/${memberSource.id}`,
      headers: { cookie },
      payload: { active: false },
    });
    expect(empty.json()).toMatchObject({ sources: [], total: 0 });
    expect(list.statusCode).toBe(200);
    expect(create.statusCode).toBe(201);
    expect(storedMemberSource).toMatchObject({ ownerUserId: member.id });
    expect(list.json()).toMatchObject({ sources: [{ name: 'Member News' }], total: 1 });
    expect(updateOtherOwner.statusCode).toBe(404);
    expect(updateOwn.statusCode).toBe(200);
    const masterList = await context.app.inject({
      method: 'GET',
      url: '/api/sources',
      headers: { cookie: masterCookie.cookie },
    });
    const masterUpdate = await context.app.inject({
      method: 'PATCH',
      url: `/api/sources/${memberSource.id}`,
      headers: { cookie: masterCookie.cookie },
      payload: { intervalMinutes: 360 },
    });
    expect(masterList.json()).toMatchObject({
      sources: [{ name: 'Health News' }, { name: 'Member News' }],
      total: 2,
    });
    expect(masterUpdate.statusCode).toBe(200);
    const remove = await context.app.inject({
      method: 'DELETE',
      url: `/api/sources/${memberSource.id}`,
      headers: { cookie, 'content-type': 'application/json' },
    });
    expect(remove.statusCode).toBe(204);
    const removeOtherOwner = await context.app.inject({
      method: 'DELETE',
      url: `/api/sources/${masterSource.id}`,
      headers: { cookie, 'content-type': 'application/json' },
    });
    expect(removeOtherOwner.statusCode).toBe(404);
    expect(await context.feeds.findSource(masterSource.id)).not.toBeNull();
  });
});
