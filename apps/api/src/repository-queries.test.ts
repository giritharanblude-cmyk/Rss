import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from './db/client';
import { PostgresDeliveryRepository } from './repositories/postgres-deliveries';
import { PostgresFeedRepository } from './repositories/postgres-feeds';

const dialect = new PgDialect();

describe('hot repository query filtering', () => {
  it('filters due feed sources in PostgreSQL before loading rows', async () => {
    let queryText = '';
    const database = {
      select: () => ({
        from: () => ({
          where: async (condition: Parameters<typeof dialect.sqlToQuery>[0]) => {
            queryText = dialect.sqlToQuery(condition).sql;
            return [];
          },
        }),
      }),
    };
    const repository = new PostgresFeedRepository(database as unknown as Database);

    await repository.listDueSources(new Date('2026-11-05T08:00:00.000Z'));

    expect(queryText).toContain('"active" = $');
    expect(queryText).toContain('"last_fetched_at" is null');
    expect(queryText).toContain('"interval_minutes" * interval \'1 minute\'');
    expect(queryText).toContain('"last_fetched_at" +');
  });

  it('filters eligible recipients by consent and topic in PostgreSQL', async () => {
    let queryText = '';
    const database = {
      select: () => ({
        from: () => ({
          where: async (condition: Parameters<typeof dialect.sqlToQuery>[0]) => {
            queryText = dialect.sqlToQuery(condition).sql;
            return [];
          },
        }),
      }),
    };
    const repository = new PostgresDeliveryRepository(
      database as unknown as Database,
      '9f'.repeat(32),
    );

    await repository.listEligibleRecipients('Outbreaks and public health');

    expect(queryText).toContain('"consent_status" = $');
    expect(queryText).toContain('"topics" @> ');
  });
});
