import type { NewsCategory } from '../rss/categories';
import type { NewsRecord } from './feeds';

export type DashboardNewsItem = Pick<
  NewsRecord,
  'id' | 'sourceId' | 'headline' | 'summary' | 'link' | 'category' | 'publishedAt' | 'fetchedAt'
> & {
  sourceName: string;
  important: boolean;
};

export type NewsFeedFilters = {
  category?: NewsCategory;
  sourceId?: string;
  from?: Date;
  toExclusive?: Date;
  query?: string;
  page: number;
  pageSize: number;
};

export type DashboardSummary = {
  itemsToday: number;
  activeSources: number;
  recipients: number;
  deliveriesToday: number;
  failedDeliveries: number;
  latestItems: DashboardNewsItem[];
  lastFetchAt: Date | null;
  connections: { whatsapp: boolean; email: boolean };
};

export type DashboardRepository = {
  getSummary(todayStart: Date, latestLimit: number): Promise<DashboardSummary>;
  listNews(filters: NewsFeedFilters): Promise<{ items: DashboardNewsItem[]; total: number }>;
  setImportant(id: string, important: boolean): Promise<boolean>;
};
