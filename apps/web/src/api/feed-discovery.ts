import type { FeedDiscoveryResponse } from '@healthcare/shared';
import { ApiError } from './client';

export async function discoverFeeds(siteUrl: string): Promise<FeedDiscoveryResponse> {
  const response = await fetch('/api/sources/discover', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ siteUrl }),
  });
  const data = (await response.json().catch(() => ({}))) as FeedDiscoveryResponse & {
    error?: string;
  };
  if (!response.ok) {
    throw new ApiError(response.status, data.error ?? 'Could not discover feeds.');
  }
  return data;
}

export async function discoverFeedLinks(siteUrl: string): Promise<string[]> {
  const result = await discoverFeeds(siteUrl);
  return result.feedUrls ?? result.feeds.map((feed) => feed.url);
}
