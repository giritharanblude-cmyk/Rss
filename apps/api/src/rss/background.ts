import { schedule } from 'node-cron';
import type { FeedTestResponse } from '@healthcare/shared';
import type { SourceRepository } from '../repositories/feeds';
import type { FeedTestJobRepository } from '../repositories/feed-jobs';
import type { FeedService } from './service';

export class FeedTestQueue {
  private running = false;

  constructor(
    private readonly service: Pick<FeedService, 'testFeed'>,
    private readonly jobs: FeedTestJobRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  enqueue(rssUrl: string): Promise<FeedTestResponse> {
    return this.jobs.enqueueFeedTest(rssUrl);
  }

  get(id: string): Promise<FeedTestResponse | null> {
    return this.jobs.getFeedTest(id);
  }

  async runPending(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const now = this.now();
        const job = await this.jobs.claimNextFeedTest(now, new Date(now.getTime() + 120_000));
        if (!job) break;
        try {
          const result = await this.service.testFeed(job.rssUrl);
          await this.jobs.completeFeedTest(job.id, result);
        } catch (error) {
          const message =
            error instanceof Error && error.message.startsWith('Feed returned HTTP ')
              ? error.message
              : 'The feed could not be read. Check the URL and try again.';
          await this.jobs.failFeedTest(job.id, message);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export function startFeedTestWorker(
  queue: FeedTestQueue,
  log: (message: string, error: unknown) => void = (message, error) =>
    console.error(message, error),
): () => void {
  const run = (): void => {
    void queue.runPending().catch((error: unknown) => {
      log('Could not process queued feed tests', error);
    });
  };
  run();
  const task = schedule('*/5 * * * * *', run);
  return () => task.stop();
}

export async function runDueFeedsOnce(
  sources: SourceRepository,
  service: FeedService,
  now: Date,
  log: (message: string, error: unknown) => void = (message, error) =>
    console.error(message, error),
): Promise<void> {
  const due = await sources.listDueSources(now);
  for (const source of due) {
    try {
      await service.fetchSource(source);
    } catch (error) {
      log(`Skipping failed RSS source ${source.id}; other sources will continue.`, error);
    }
  }
}

export function startFeedScheduler(
  sources: SourceRepository,
  service: FeedService,
  options: { log?: (message: string, error: unknown) => void } = {},
): () => void {
  const log = options.log ?? ((message, error) => console.error(message, error));
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await runDueFeedsOnce(sources, service, new Date(), log);
    } catch (error) {
      log('Could not check for due RSS sources', error);
    } finally {
      running = false;
    }
  };

  void tick();
  const task = schedule('* * * * *', () => void tick());
  return () => task.stop();
}

export async function runRetention(
  repository: {
    deleteNewsBefore(cutoff: Date): Promise<number>;
    deleteDeliveriesBefore(cutoff: Date): Promise<number>;
  },
  options: {
    newsDays: number;
    deliveryDays: number;
    now?: () => Date;
    log?: (message: string) => void;
  },
): Promise<{ newsDeleted: number; deliveriesDeleted: number }> {
  const now = (options.now ?? (() => new Date()))();
  const [newsDeleted, deliveriesDeleted] = await Promise.all([
    repository.deleteNewsBefore(new Date(now.getTime() - options.newsDays * 86_400_000)),
    repository.deleteDeliveriesBefore(new Date(now.getTime() - options.deliveryDays * 86_400_000)),
  ]);
  options.log?.(
    `Retention removed ${newsDeleted} news items and ${deliveriesDeleted} delivery records.`,
  );
  return { newsDeleted, deliveriesDeleted };
}

export function startRetentionJob(
  repository: Parameters<typeof runRetention>[0],
  options: Parameters<typeof runRetention>[1],
): () => void {
  const run = (): void => {
    void runRetention(repository, options).catch((error: unknown) => {
      options.log?.(
        `Retention job failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    });
  };
  run();
  const task = schedule('0 3 * * *', run);
  return () => task.stop();
}
