import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, loginAndVerify, seedMember, type TestContext } from './test/helpers';

let context: TestContext;

afterEach(async () => context.app.close());

const topicSetInput = {
  name: 'My oncology reading',
  categoryKeys: ['Drugs and approvals'],
};

async function login(name: string, password: string) {
  return (await loginAndVerify(context.app, context.email, name, password)).cookie;
}

describe('owner-scoped topic presets', () => {
  it('creates, lists, updates, and deletes only the signed-in owner’s presets', async () => {
    context = await createTestContext();
    const masterCookie = await login('Admin', 'master-password-1');
    const member = await seedMember(context.users, {
      name: 'Mina',
      email: 'mina@example.test',
      password: 'member-password-1',
    });
    const memberCookie = await login(member.name, 'member-password-1');

    const masterCreated = await context.app.inject({
      method: 'POST',
      url: '/api/topic-sets',
      headers: { cookie: masterCookie },
      payload: topicSetInput,
    });
    const memberCreated = await context.app.inject({
      method: 'POST',
      url: '/api/topic-sets',
      headers: { cookie: memberCookie },
      payload: { name: 'My hospital updates', categoryKeys: ['Hospitals and industry'] },
    });
    expect(masterCreated.statusCode).toBe(201);
    expect(memberCreated.statusCode).toBe(201);

    const masterSet = masterCreated.json().topicSet as { id: string; name: string };
    const memberSet = memberCreated.json().topicSet as { id: string; name: string };
    expect(masterSet.name).toBe(topicSetInput.name);

    const masterList = await context.app.inject({
      method: 'GET',
      url: '/api/topic-sets',
      headers: { cookie: masterCookie },
    });
    const memberList = await context.app.inject({
      method: 'GET',
      url: '/api/topic-sets',
      headers: { cookie: memberCookie },
    });
    expect(masterList.json().topicSets.map((set: { id: string }) => set.id)).toEqual([
      masterSet.id,
    ]);
    expect(memberList.json().topicSets.map((set: { id: string }) => set.id)).toEqual([
      memberSet.id,
    ]);

    const masterCannotUpdateMember = await context.app.inject({
      method: 'PATCH',
      url: `/api/topic-sets/${memberSet.id}`,
      headers: { cookie: masterCookie },
      payload: topicSetInput,
    });
    const masterCannotDeleteMember = await context.app.inject({
      method: 'DELETE',
      url: `/api/topic-sets/${memberSet.id}`,
      headers: { cookie: masterCookie },
    });
    const memberCannotUpdateMaster = await context.app.inject({
      method: 'PATCH',
      url: `/api/topic-sets/${masterSet.id}`,
      headers: { cookie: memberCookie },
      payload: topicSetInput,
    });
    const memberCannotDeleteMaster = await context.app.inject({
      method: 'DELETE',
      url: `/api/topic-sets/${masterSet.id}`,
      headers: { cookie: memberCookie },
    });
    expect(masterCannotUpdateMember.statusCode).toBe(404);
    expect(masterCannotDeleteMember.statusCode).toBe(404);
    expect(memberCannotUpdateMaster.statusCode).toBe(404);
    expect(memberCannotDeleteMaster.statusCode).toBe(404);

    const updated = await context.app.inject({
      method: 'PATCH',
      url: `/api/topic-sets/${memberSet.id}`,
      headers: { cookie: memberCookie },
      payload: { name: 'Renamed', categoryKeys: ['Clinical trials and research'] },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().topicSet).toMatchObject({
      id: memberSet.id,
      name: 'Renamed',
      categoryKeys: ['Clinical trials and research'],
    });

    const deleted = await context.app.inject({
      method: 'DELETE',
      url: `/api/topic-sets/${memberSet.id}`,
      headers: { cookie: memberCookie },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it('rejects category values outside the fixed category list', async () => {
    context = await createTestContext();
    const cookie = await login('Admin', 'master-password-1');

    const invalid = await context.app.inject({
      method: 'POST',
      url: '/api/topic-sets',
      headers: { cookie },
      payload: { name: 'Custom topic', categoryKeys: ['Custom topic'] },
    });
    const duplicate = await context.app.inject({
      method: 'POST',
      url: '/api/topic-sets',
      headers: { cookie },
      payload: {
        name: 'Repeated category',
        categoryKeys: ['Drugs and approvals', 'Drugs and approvals'],
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(duplicate.statusCode).toBe(400);
  });
});
