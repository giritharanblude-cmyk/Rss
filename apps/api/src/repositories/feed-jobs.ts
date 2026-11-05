import type { FeedTestResponse } from '@healthcare/shared';

export type FeedTestJobRepository = {
  enqueueFeedTest(rssUrl: string): Promise<FeedTestResponse>;
  getFeedTest(id: string): Promise<FeedTestResponse | null>;
  claimNextFeedTest(now: Date, lockUntil: Date): Promise<{ id: string; rssUrl: string } | null>;
  completeFeedTest(
    id: string,
    result: { itemCount: number; sampleHeadlines: string[] },
  ): Promise<void>;
  failFeedTest(id: string, message: string): Promise<void>;
};
