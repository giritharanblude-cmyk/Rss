import { and, eq, lte, lt, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { jobs } from '../db/schema';
import type { FeedTestResponse } from '@healthcare/shared';
import type { FeedTestJobRepository } from './feed-jobs';

type JobPayload = {
  rssUrl?: unknown;
  message?: unknown;
  itemCount?: unknown;
  sampleHeadlines?: unknown;
};

function responseFromRow(row: typeof jobs.$inferSelect): FeedTestResponse {
  const payload = row.payload as JobPayload;
  if (row.status === 'done') {
    return {
      id: row.id,
      status: 'done',
      ...(typeof payload.itemCount === 'number' ? { itemCount: payload.itemCount } : {}),
      ...(Array.isArray(payload.sampleHeadlines)
        ? {
            sampleHeadlines: payload.sampleHeadlines.filter(
              (value): value is string => typeof value === 'string',
            ),
          }
        : {}),
    };
  }
  if (row.status === 'failed') {
    return {
      id: row.id,
      status: 'failed',
      ...(typeof payload.message === 'string' ? { message: payload.message } : {}),
    };
  }
  return { id: row.id, status: row.status === 'running' ? 'running' : 'queued' };
}

export class PostgresFeedTestJobRepository implements FeedTestJobRepository {
  constructor(private readonly db: Database) {}

  async enqueueFeedTest(rssUrl: string): Promise<FeedTestResponse> {
    const rows = await this.db
      .insert(jobs)
      .values({ type: 'feed_test', payload: { rssUrl } })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Feed test job was not queued');
    return responseFromRow(row);
  }

  async getFeedTest(id: string): Promise<FeedTestResponse | null> {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.type, 'feed_test')))
      .limit(1);
    return rows[0] ? responseFromRow(rows[0]) : null;
  }

  async claimNextFeedTest(
    now: Date,
    lockUntil: Date,
  ): Promise<{ id: string; rssUrl: string } | null> {
    const candidates = await this.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.type, 'feed_test'),
          lte(jobs.runAt, now),
          or(
            eq(jobs.status, 'pending'),
            and(eq(jobs.status, 'running'), lt(jobs.lockedUntil, now)),
          ),
        ),
      )
      .orderBy(jobs.runAt)
      .limit(1);
    const candidate = candidates[0];
    if (!candidate) return null;

    const claimed = await this.db
      .update(jobs)
      .set({
        status: 'running',
        lockedUntil: lockUntil,
        attempts: sql`${jobs.attempts} + 1`,
      })
      .where(
        and(
          eq(jobs.id, candidate.id),
          or(
            eq(jobs.status, 'pending'),
            and(eq(jobs.status, 'running'), lt(jobs.lockedUntil, now)),
          ),
        ),
      )
      .returning();
    const row = claimed[0];
    const payload = row?.payload as JobPayload | undefined;
    if (!row || typeof payload?.rssUrl !== 'string') return null;
    return { id: row.id, rssUrl: payload.rssUrl };
  }

  async completeFeedTest(
    id: string,
    result: { itemCount: number; sampleHeadlines: string[] },
  ): Promise<void> {
    await this.db
      .update(jobs)
      .set({ status: 'done', lockedUntil: null, payload: result })
      .where(and(eq(jobs.id, id), eq(jobs.type, 'feed_test')));
  }

  async failFeedTest(id: string, message: string): Promise<void> {
    await this.db
      .update(jobs)
      .set({ status: 'failed', lockedUntil: null, payload: { message } })
      .where(and(eq(jobs.id, id), eq(jobs.type, 'feed_test')));
  }
}
