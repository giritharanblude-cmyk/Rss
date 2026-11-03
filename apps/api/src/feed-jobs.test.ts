import { describe, expect, it, vi } from 'vitest';
import { MemoryFeedTestJobRepository } from './repositories/memory-feeds';
import { FeedTestQueue } from './rss/background';

describe('background feed test jobs', () => {
  it('returns immediately and exposes completion through a job id', async () => {
    const testFeed = vi.fn(async () => ({
      itemCount: 2,
      sampleHeadlines: ['First story', 'Second story'],
    }));
    const jobs = new MemoryFeedTestJobRepository();
    const queue = new FeedTestQueue({ testFeed }, jobs);
    const job = await queue.enqueue('https://feed.example.test/rss');

    expect(job.status).toBe('queued');
    expect((await queue.get(job.id))?.status).toBe('queued');
    await queue.runPending();

    expect(testFeed).toHaveBeenCalledWith('https://feed.example.test/rss');
    expect(await queue.get(job.id)).toMatchObject({
      id: job.id,
      status: 'done',
      itemCount: 2,
      sampleHeadlines: ['First story', 'Second story'],
    });
  });

  it('returns a bounded message for a failed test job', async () => {
    const jobs = new MemoryFeedTestJobRepository();
    const queue = new FeedTestQueue(
      {
        testFeed: async () => {
          throw new Error('network details and credentials should not be exposed');
        },
      },
      jobs,
    );
    const job = await queue.enqueue('https://feed.example.test/rss');
    await queue.runPending();

    expect(await queue.get(job.id)).toMatchObject({
      status: 'failed',
      message: 'The feed could not be read. Check the URL and try again.',
    });
  });
});
