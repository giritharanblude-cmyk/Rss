import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMasterIfNone } from './auth/seed';
import { DuplicateMasterError, EmailUnavailableError } from './errors';
import { MemoryUserRepository } from './repositories/memory';
import { createTestContext, loginAndVerify, seedMember, type TestContext } from './test/helpers';

let context: TestContext;

afterEach(async () => {
  await context.app.close();
});

describe('member management', () => {
  it('lets the master add, list and disable a member', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );

    const created = await context.app.inject({
      method: 'POST',
      url: '/api/members',
      headers: { cookie },
      payload: { name: 'Ravi', email: 'ravi@example.com', password: 'member-password-1' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ member: { email: 'ra***@example.com' } });
    expect(context.email.sent.at(-1)).toMatchObject({
      to: 'ravi@example.com',
      subject: 'Your Healthcare News account details',
      text: expect.stringContaining('Initial password: member-password-1'),
    });
    const member = (created.json() as { member: { id: string; role: string } }).member;
    expect(member.role).toBe('member');
    const { cookie: oldMemberCookie } = await loginAndVerify(
      context.app,
      context.email,
      'Ravi',
      'member-password-1',
    );

    const list = await context.app.inject({
      method: 'GET',
      url: '/api/members',
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      members: [{ name: 'Ravi', email: 'ra***@example.com', disabled: false }],
    });

    const reset = await context.app.inject({
      method: 'POST',
      url: `/api/members/${member.id}/reset-password`,
      headers: { cookie },
      payload: { password: 'member-password-2' },
    });
    expect(reset.statusCode).toBe(204);

    const staleSession = await context.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: oldMemberCookie },
    });
    expect(staleSession.statusCode).toBe(401);

    context.clock.advance(61_000);
    const { cookie: newMemberCookie } = await loginAndVerify(
      context.app,
      context.email,
      'Ravi',
      'member-password-2',
    );
    const activeSession = await context.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: newMemberCookie },
    });
    expect(activeSession.statusCode).toBe(200);

    const disabled = await context.app.inject({
      method: 'PATCH',
      url: `/api/members/${member.id}`,
      headers: { cookie },
      payload: { disabled: true },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toMatchObject({ member: { disabled: true } });
  });

  it('returns the SMTP failure when an invite cannot be sent', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    vi.spyOn(context.managedEmail, 'send').mockRejectedValue(
      new EmailUnavailableError('SMTP rejected the message: 535 Authentication failed'),
    );

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/members',
      headers: { cookie },
      payload: {
        name: 'Ravi',
        email: 'ravi@example.com',
        password: 'member-password-1',
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe(
      'Member account created, but the login details email could not be sent: SMTP rejected the message: 535 Authentication failed',
    );
    expect(await context.users.findByName('Ravi')).not.toBeNull();
  });

  it.each([
    ['short1!', 'Password must be at least 8 characters'],
    ['password1', 'Password must include at least one symbol'],
    ['password!', 'Password must include at least one number'],
    ['1234567!', 'Password must include at least one letter'],
  ])('rejects member passwords that violate the rule', async (password, message) => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/members',
      headers: { cookie },
      payload: { name: 'Ravi', email: 'ravi@example.com', password },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe(message);
    expect(await context.users.findByName('Ravi')).toBeNull();
  });

  it('rejects a duplicate member name', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );

    const first = await context.app.inject({
      method: 'POST',
      url: '/api/members',
      headers: { cookie },
      payload: { name: 'Ravi', email: 'ravi@example.com', password: 'member-password-1' },
    });
    expect(first.statusCode).toBe(201);

    const duplicate = await context.app.inject({
      method: 'POST',
      url: '/api/members',
      headers: { cookie },
      payload: { name: 'ravi', email: 'other@example.com', password: 'member-password-2' },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('rejects an invalid form', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/members',
      headers: { cookie },
      payload: { name: '', email: 'not-an-email', password: 'short' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('lets the master delete a member without deleting shared sources or recipients', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const member = await seedMember(context.users, {
      name: 'Ravi',
      email: 'ravi@example.com',
      password: 'member-password-1',
    });
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

    const response = await context.app.inject({
      method: 'DELETE',
      url: `/api/members/${member.id}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(204);
    expect(await context.users.findById(member.id)).toBeNull();
    expect(await context.users.findById(context.master.id)).not.toBeNull();
    expect((await context.feeds.listSources()).map(({ id }) => id)).toContain(source.id);
    expect((await context.recipients.listRecipients()).map(({ id }) => id)).toContain(recipient.id);
  });

  it('rejects a deleted member’s existing session immediately', async () => {
    context = await createTestContext();
    const member = await seedMember(context.users, {
      name: 'Ravi',
      email: 'ravi@example.com',
      password: 'member-password-1',
    });
    const { cookie: memberCookie } = await loginAndVerify(
      context.app,
      context.email,
      'Ravi',
      'member-password-1',
    );
    const { cookie: masterCookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const deleted = await context.app.inject({
      method: 'DELETE',
      url: `/api/members/${member.id}`,
      headers: { cookie: masterCookie },
    });
    expect(deleted.statusCode).toBe(204);

    const session = await context.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: memberCookie },
    });
    expect(session.statusCode).toBe(401);
  });

  it('rejects sign-in for a deleted member', async () => {
    context = await createTestContext();
    const member = await seedMember(context.users, {
      name: 'Ravi',
      email: 'ravi@example.com',
      password: 'member-password-1',
    });
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    await context.app.inject({
      method: 'DELETE',
      url: `/api/members/${member.id}`,
      headers: { cookie },
    });

    const signIn = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'Ravi', password: 'member-password-1' },
    });
    expect(signIn.statusCode).toBe(401);
  });

  it('allows the same email again only by creating a new member account', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const first = await context.app.inject({
      method: 'POST',
      url: '/api/members',
      headers: { cookie },
      payload: { name: 'Ravi', email: 'ravi@example.com', password: 'member-password-1' },
    });
    const firstId = (first.json() as { member: { id: string } }).member.id;
    await context.app.inject({
      method: 'DELETE',
      url: `/api/members/${firstId}`,
      headers: { cookie },
    });

    const replacement = await context.app.inject({
      method: 'POST',
      url: '/api/members',
      headers: { cookie },
      payload: { name: 'Ravi', email: 'ravi@example.com', password: 'member-password-2' },
    });

    expect(replacement.statusCode).toBe(201);
    const replacementId = (replacement.json() as { member: { id: string } }).member.id;
    expect(replacementId).not.toBe(firstId);
    expect(await context.users.findById(firstId)).toBeNull();
    expect(await context.users.findById(replacementId)).toMatchObject({
      email: 'ravi@example.com',
      role: 'member',
    });
  });

  it('blocks a member from master-only routes', async () => {
    context = await createTestContext();
    const member = await seedMember(context.users, {
      name: 'Mina',
      email: 'mina@example.com',
      password: 'member-password-1',
    });
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Mina',
      'member-password-1',
    );

    const list = await context.app.inject({
      method: 'GET',
      url: '/api/members',
      headers: { cookie },
    });
    expect(list.statusCode).toBe(403);

    const create = await context.app.inject({
      method: 'POST',
      url: '/api/members',
      headers: { cookie },
      payload: { name: 'New', email: 'new@example.com', password: 'member-password-2' },
    });
    expect(create.statusCode).toBe(403);

    const reset = await context.app.inject({
      method: 'POST',
      url: `/api/members/${member.id}/reset-password`,
      headers: { cookie },
      payload: { password: 'member-password-2' },
    });
    expect(reset.statusCode).toBe(403);

    const remove = await context.app.inject({
      method: 'DELETE',
      url: `/api/members/${member.id}`,
      headers: { cookie },
    });
    expect(remove.statusCode).toBe(403);
    expect(await context.users.findById(member.id)).not.toBeNull();
  });
});

describe('single master rule', () => {
  it('refuses to create a second master', async () => {
    context = await createTestContext();
    await expect(
      createMasterIfNone(context.users, {
        name: 'Second',
        email: 'second@example.com',
        password: 'second-password-1',
      }),
    ).rejects.toBeInstanceOf(DuplicateMasterError);
    expect(await context.users.countMasters()).toBe(1);
  });

  it('refuses concurrent attempts to seed a second master', async () => {
    context = await createTestContext();
    const users = new MemoryUserRepository(context.clock.now);
    const results = await Promise.allSettled([
      createMasterIfNone(users, {
        name: 'Second A',
        email: 'second-a@example.com',
        password: 'second-password-1',
      }),
      createMasterIfNone(users, {
        name: 'Second B',
        email: 'second-b@example.com',
        password: 'second-password-2',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await users.countMasters()).toBe(1);
  });
});
