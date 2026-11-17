import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, loginAndVerify, seedMember, type TestContext } from './test/helpers';

let context: TestContext;

afterEach(async () => context.app.close());

const validSource = {
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
    const createForbidden = await context.app.inject({
      method: 'POST',
      url: '/api/sources/test',
      headers: { cookie: memberCookie },
      payload: { rssUrl: validSource.rssUrl },
    });
    const statusForbidden = await context.app.inject({
      method: 'GET',
      url: `/api/sources/test/${job.id}`,
      headers: { cookie: memberCookie },
    });
    expect(createForbidden.statusCode).toBe(403);
    expect(statusForbidden.statusCode).toBe(403);
  });

  it('lets members create, own, update, and delete their sources', async () => {
    context = await createTestContext();
    const { cookie: masterCookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const masterSource = await context.app.inject({
      method: 'POST',
      url: '/api/sources',
      headers: { cookie: masterCookie },
      payload: { ...validSource, name: 'Master Source' },
    });
    expect(masterSource.statusCode).toBe(201);

    const member = await seedMember(context.users, {
      name: 'Mina',
      email: 'mina@example.test',
      password: 'member-password-1',
    });
    const { cookie, userId } = await loginAndVerify(
      context.app,
      context.email,
      member.name,
      'member-password-1',
    );

    const created = await context.app.inject({
      method: 'POST',
      url: '/api/sources',
      headers: { cookie },
      payload: { ...validSource, name: 'Member Source' },
    });
    expect(created.statusCode).toBe(201);
    const source = (created.json() as { source: { id: string } }).source;
    expect((await context.feeds.findSource(source.id))?.ownerUserId).toBe(userId);

    const list = await context.app.inject({
      method: 'GET',
      url: '/api/sources',
      headers: { cookie },
    });
    expect(list.json()).toMatchObject({
      sources: [{ name: 'Member Source' }],
      total: 1,
    });

    const update = await context.app.inject({
      method: 'PATCH',
      url: `/api/sources/${source.id}`,
      headers: { cookie },
      payload: { active: false },
    });
    const remove = await context.app.inject({
      method: 'DELETE',
      url: `/api/sources/${source.id}`,
      headers: { cookie },
    });

    expect(update.statusCode).toBe(200);
    expect(remove.statusCode).toBe(204);
  });

  it("prevents members from editing or deleting another member's source", async () => {
    context = await createTestContext();
    const owner = await seedMember(context.users, {
      name: 'Owner',
      email: 'owner@example.test',
      password: 'owner-password-1',
    });
    const otherMember = await seedMember(context.users, {
      name: 'Other',
      email: 'other@example.test',
      password: 'other-password-1',
    });
    const { cookie: ownerCookie } = await loginAndVerify(
      context.app,
      context.email,
      owner.name,
      'owner-password-1',
    );
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/sources',
      headers: { cookie: ownerCookie },
      payload: validSource,
    });
    const source = (created.json() as { source: { id: string } }).source;
    const { cookie: otherCookie } = await loginAndVerify(
      context.app,
      context.email,
      otherMember.name,
      'other-password-1',
    );

    const update = await context.app.inject({
      method: 'PATCH',
      url: `/api/sources/${source.id}`,
      headers: { cookie: otherCookie },
      payload: { active: false },
    });
    const remove = await context.app.inject({
      method: 'DELETE',
      url: `/api/sources/${source.id}`,
      headers: { cookie: otherCookie },
    });

    expect(update.statusCode).toBe(404);
    expect(remove.statusCode).toBe(404);
    expect((await context.feeds.findSource(source.id))?.active).toBe(true);
  });

  it('lets the master edit and delete any member source', async () => {
    context = await createTestContext();
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
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/sources',
      headers: { cookie: memberCookie },
      payload: validSource,
    });
    const source = (created.json() as { source: { id: string } }).source;
    const { cookie: masterCookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );

    const update = await context.app.inject({
      method: 'PATCH',
      url: `/api/sources/${source.id}`,
      headers: { cookie: masterCookie },
      payload: { active: false },
    });
    const remove = await context.app.inject({
      method: 'DELETE',
      url: `/api/sources/${source.id}`,
      headers: { cookie: masterCookie },
    });

    expect(update.statusCode).toBe(200);
    expect(remove.statusCode).toBe(204);
  });
});
