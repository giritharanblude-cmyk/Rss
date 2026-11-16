import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import type { Pool } from 'pg';
import type { SourceInput } from '@healthcare/shared';
import { createDatabase, createPool, type Database } from './db/client';
import { runMigrations } from './db/migrate';
import { deliveries, newsItems, recipients, users } from './db/schema';
import { PostgresFeedRepository } from './repositories/postgres-feeds';
import { PostgresUserRepository } from './repositories/postgres';
import { encryptRecipientContact, hashUserContactLookup } from './settings/secrets';
import { createTestContext, loginAndVerify, seedMember, type TestContext } from './test/helpers';

const databaseUrl = process.env.SOURCE_DELETION_TEST_DATABASE_URL;
const settingsEncryptionKey = '9f'.repeat(32);
const sourceInput: SourceInput = {
  name: 'PostgreSQL deletion test',
  website: 'https://news.example.test',
  rssUrl: 'https://news.example.test/feed.xml',
  mode: 'all',
  topics: [],
  region: null,
  intervalMinutes: 60,
  active: true,
};

if (databaseUrl) {
  const parsedUrl = new URL(databaseUrl);
  if (
    parsedUrl.hostname !== '127.0.0.1' ||
    parsedUrl.port !== '55432' ||
    parsedUrl.pathname !== '/source_deletion_test'
  ) {
    throw new Error(
      'SOURCE_DELETION_TEST_DATABASE_URL must point to the isolated local source_deletion_test database on port 55432.',
    );
  }
}

describe.skipIf(!databaseUrl)('source deletion with PostgreSQL', () => {
  let pool: Pool;
  let db: Database;
  let feeds: PostgresFeedRepository;
  let databaseMasterId: string;
  let context: TestContext | undefined;

  beforeAll(async () => {
    pool = createPool(databaseUrl!);
    db = createDatabase(pool);
    await migrate(db, {
      migrationsFolder: path.resolve(process.cwd(), 'drizzle'),
    });

    const databaseUsers = new PostgresUserRepository(db, settingsEncryptionKey);
    const databaseMaster = await databaseUsers.create({
      name: 'PostgreSQL Test Master',
      email: 'postgres-test-master@example.test',
      passwordHash: 'test-only-password-hash',
      role: 'master',
    });
    databaseMasterId = databaseMaster.id;
    await runMigrations(pool, settingsEncryptionKey);

    feeds = new PostgresFeedRepository(db);
    await pool.query('DROP TABLE IF EXISTS source_deletion_test_restrict');
    await pool.query(`
      CREATE TABLE source_deletion_test_restrict (
        source_id uuid PRIMARY KEY REFERENCES sources(id) ON DELETE RESTRICT
      )
    `);
  });

  afterEach(async () => {
    if (context) await context.app.close();
    context = undefined;
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DROP TABLE IF EXISTS source_deletion_test_restrict');
      await pool.end();
    }
  });

  async function authenticatedDeleteApp(): Promise<string> {
    context = await createTestContext();
    context.feeds.deleteSource = feeds.deleteSource.bind(feeds);
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    return cookie;
  }

  it('deletes the source and cascades only its news while preserving delivery history', async () => {
    const cookie = await authenticatedDeleteApp();
    const source = await feeds.createSource(sourceInput, databaseMasterId);
    const otherSource = await feeds.createSource(
      { ...sourceInput, name: 'Unrelated PostgreSQL source' },
      databaseMasterId,
    );
    const news = await feeds.createNewsItem({
      sourceId: source.id,
      headline: 'Source-owned news',
      summary: 'Test summary',
      link: 'https://news.example.test/source-owned',
      linkNormalized: 'https://news.example.test/source-owned',
      headlineSignature: 'source-owned',
      category: 'Uncategorized',
      publishedAt: null,
    });
    const unrelatedNews = await feeds.createNewsItem({
      sourceId: otherSource.id,
      headline: 'Unrelated news',
      summary: 'Test summary',
      link: 'https://news.example.test/unrelated',
      linkNormalized: 'https://news.example.test/unrelated',
      headlineSignature: 'unrelated',
      category: 'Uncategorized',
      publishedAt: null,
      duplicateOf: news.id,
    });
    const [recipient] = await db
      .insert(recipients)
      .values({
        ownerUserId: databaseMasterId,
        name: 'PostgreSQL test recipient',
        email: null,
        whatsappE164: null,
        topics: [],
        channel: 'email',
        unsubscribeToken: 'postgres-source-delete-test-token',
      })
      .returning({ id: recipients.id });
    if (!recipient) throw new Error('PostgreSQL test recipient was not created.');
    const [delivery] = await db
      .insert(deliveries)
      .values({
        ownerUserId: databaseMasterId,
        recipientId: recipient.id,
        channel: 'email',
        kind: 'manual',
        subjectOrRef: 'source-deletion-integration-test',
        status: 'delivered',
        attempts: 1,
        newsItemIds: [news.id],
      })
      .returning({ id: deliveries.id });
    if (!delivery) throw new Error('PostgreSQL test delivery was not created.');

    const response = await context!.app.inject({
      method: 'DELETE',
      url: `/api/sources/${source.id}`,
      headers: { cookie, 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(204);
    expect(await feeds.findSource(source.id)).toBeNull();
    const remainingNews = await db.select().from(newsItems);
    expect(remainingNews.map(({ id }) => id)).toEqual([unrelatedNews.id]);
    expect(remainingNews[0]?.duplicateOf).toBeNull();
    const remainingDeliveries = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, delivery.id));
    expect(remainingDeliveries).toMatchObject([
      { id: delivery.id, status: 'delivered', newsItemIds: [news.id] },
    ]);
  });

  it('enforces member ownership against PostgreSQL source rows', async () => {
    context = await createTestContext();
    const member = await seedMember(context.users, {
      name: 'PostgreSQL Member',
      email: 'postgres-test-member@example.test',
      password: 'member-password-1',
    });
    await db.insert(users).values({
      id: member.id,
      name: member.name,
      nameKey: member.name.trim().toLowerCase(),
      email: encryptRecipientContact(member.email, settingsEncryptionKey),
      emailLookupHash: hashUserContactLookup('email', member.email, settingsEncryptionKey),
      phone: null,
      phoneLookupHash: null,
      passwordHash: member.passwordHash,
      role: 'member',
    });
    const masterSource = await feeds.createSource(sourceInput, databaseMasterId);
    const memberSource = await feeds.createSource(
      { ...sourceInput, name: 'PostgreSQL Member Source' },
      member.id,
    );
    context.feeds.deleteSource = feeds.deleteSource.bind(feeds);
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      member.name,
      'member-password-1',
    );

    const foreignDelete = await context.app.inject({
      method: 'DELETE',
      url: `/api/sources/${masterSource.id}`,
      headers: { cookie, 'content-type': 'application/json' },
    });
    const ownDelete = await context.app.inject({
      method: 'DELETE',
      url: `/api/sources/${memberSource.id}`,
      headers: { cookie, 'content-type': 'application/json' },
    });

    expect(foreignDelete.statusCode).toBe(404);
    expect(await feeds.findSource(masterSource.id)).not.toBeNull();
    expect(ownDelete.statusCode).toBe(204);
    expect(await feeds.findSource(memberSource.id)).toBeNull();
  });

  it('maps an actual PostgreSQL constraint violation safely and leaves the delete atomic', async () => {
    const cookie = await authenticatedDeleteApp();
    const source = await feeds.createSource(sourceInput, databaseMasterId);
    const news = await feeds.createNewsItem({
      sourceId: source.id,
      headline: 'News protected by failed source delete',
      summary: 'Test summary',
      link: 'https://news.example.test/protected',
      linkNormalized: 'https://news.example.test/protected',
      headlineSignature: 'protected',
      category: 'Uncategorized',
      publishedAt: null,
    });
    await pool.query('INSERT INTO source_deletion_test_restrict (source_id) VALUES ($1)', [
      source.id,
    ]);

    const response = await context!.app.inject({
      method: 'DELETE',
      url: `/api/sources/${source.id}`,
      headers: { cookie, 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: 'This source cannot be deleted while related records exist.',
    });
    expect(await feeds.findSource(source.id)).not.toBeNull();
    const retainedNews = await db.select().from(newsItems).where(eq(newsItems.id, news.id));
    expect(retainedNews).toHaveLength(1);

    await pool.query('DELETE FROM source_deletion_test_restrict WHERE source_id = $1', [source.id]);
    expect(await feeds.deleteSource(source.id)).toBe(true);
  });
});
