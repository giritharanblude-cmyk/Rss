import { afterEach, describe, expect, it } from 'vitest';
import type { SourceInput } from '@healthcare/shared';
import { createTestContext, loginAndVerify, seedMember, type TestContext } from './test/helpers';

let context: TestContext;

afterEach(async () => context.app.close());

const validSource: SourceInput = {
  name: 'Health News',
  website: 'https://news.example.test',
  rssUrl: 'https://news.example.test/feed.xml',
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
      headers: { cookie },
    });
    expect(deleted.statusCode).toBe(204);
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
    const remove = await context.app.inject({
      method: 'DELETE',
      url: `/api/sources/${memberSource.id}`,
      headers: { cookie },
    });

    expect(empty.json()).toMatchObject({ sources: [], total: 0 });
    expect(list.statusCode).toBe(200);
    expect(create.statusCode).toBe(201);
    expect(storedMemberSource).toMatchObject({ ownerUserId: member.id });
    expect(list.json()).toMatchObject({ sources: [{ name: 'Member News' }], total: 1 });
    expect(updateOtherOwner.statusCode).toBe(404);
    expect(updateOwn.statusCode).toBe(200);
    expect(remove.statusCode).toBe(204);
    const masterList = await context.app.inject({
      method: 'GET',
      url: '/api/sources',
      headers: { cookie: masterCookie.cookie },
    });
    expect(masterList.json()).toMatchObject({ sources: [{ name: 'Health News' }], total: 1 });
  });
});
