import { afterEach, describe, expect, it } from 'vitest';
import { createMasterIfNone } from './auth/seed';
import { DuplicateMasterError } from './errors';
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
    const member = (created.json() as { member: { id: string; role: string } }).member;
    expect(member.role).toBe('member');

    const list = await context.app.inject({
      method: 'GET',
      url: '/api/members',
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ members: [{ name: 'Ravi', disabled: false }] });

    const disabled = await context.app.inject({
      method: 'PATCH',
      url: `/api/members/${member.id}`,
      headers: { cookie },
      payload: { disabled: true },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toMatchObject({ member: { disabled: true } });
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

  it('blocks a member from master-only routes', async () => {
    context = await createTestContext();
    await seedMember(context.users, {
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
