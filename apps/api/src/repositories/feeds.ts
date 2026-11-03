import type { NewsCategory } from '../rss/categories';
import type { SourceInput } from '@healthcare/shared';

export type SourceRecord = SourceInput & {
  id: string;
  lastFetchedAt: Date | null;
  lastStatus: string | null;
  etag: string | null;
  lastModified: string | null;
  createdAt: Date;
};

export type NewsRecord = {
  id: string;
  sourceId: string;
  headline: string;
  summary: string;
  link: string;
  linkNormalized: string;
  headlineSignature: string;
  category: NewsCategory;
  publishedAt: Date | null;
  fetchedAt: Date;
  duplicateOf: string | null;
};

export type NewNews = Omit<NewsRecord, 'id' | 'fetchedAt' | 'duplicateOf'> & {
  duplicateOf?: string | null;
};

export type SourceRepository = {
  listSources(): Promise<SourceRecord[]>;
  findSource(id: string): Promise<SourceRecord | null>;
  createSource(source: SourceInput): Promise<SourceRecord>;
  updateSource(id: string, updates: Partial<SourceInput>): Promise<SourceRecord | null>;
  deleteSource(id: string): Promise<boolean>;
  updateFetchState(
    id: string,
    values: { fetchedAt: Date; status: string; etag?: string | null; lastModified?: string | null },
  ): Promise<void>;
  listDueSources(now: Date): Promise<SourceRecord[]>;
};

export type NewsRepository = {
  findDedupeCandidates(linkNormalized: string, since: Date): Promise<NewsRecord[]>;
  createNewsItem(news: NewNews): Promise<NewsRecord>;
  setDuplicateOf(ids: string[], canonicalId: string): Promise<void>;
  clearDuplicateOf(ids: string[]): Promise<void>;
};

export type RetentionRepository = {
  deleteNewsBefore(cutoff: Date): Promise<number>;
  deleteDeliveriesBefore(cutoff: Date): Promise<number>;
};
