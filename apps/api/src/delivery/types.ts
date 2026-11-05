import type { NewsCategory } from '../rss/categories';

export type DeliveryChannel = 'email' | 'whatsapp';
export type DeliveryKind = 'digest' | 'instant' | 'manual' | 'unsubscribe_confirmation';
export type DeliveryState = 'pending' | 'delivered' | 'retrying' | 'failed';

export type DeliveryInput = {
  recipientId: string;
  channel: DeliveryChannel;
  kind: DeliveryKind;
  subjectOrRef: string;
  newsItemIds: string[];
};

export type DeliveryRecord = DeliveryInput & {
  id: string;
  status: DeliveryState;
  attempts: number;
  lastError: string | null;
  queuedAt: Date;
  sentAt: Date | null;
  recipientName: string;
  recipientContact: string | null;
};

export type DeliveryNewsItem = {
  id: string;
  headline: string;
  link: string;
  sourceName: string;
  category: NewsCategory;
  publishedAt: Date | null;
  fetchedAt: Date;
};

export type DeliveryContext = {
  delivery: DeliveryRecord;
  recipient: {
    id: string;
    name: string;
    email: string | null;
    whatsappE164: string | null;
    unsubscribeToken: string;
    consentStatus: 'pending' | 'granted' | 'revoked';
  };
  items: DeliveryNewsItem[];
};

export type DeliveryFilters = {
  from?: Date;
  toExclusive?: Date;
  channel?: DeliveryChannel;
  recipientId?: string;
  status?: DeliveryState;
  page: number;
  pageSize: number;
};

export type DeliveryRepository = {
  enqueue(input: DeliveryInput, now: Date): Promise<DeliveryRecord>;
  list(filters: DeliveryFilters): Promise<{ items: DeliveryRecord[]; total: number }>;
  getContext(id: string): Promise<DeliveryContext | null>;
  claimNext(now: Date, lockUntil: Date): Promise<{ jobId: string; deliveryId: string } | null>;
  complete(jobId: string, id: string, at: Date): Promise<void>;
  retry(jobId: string, id: string, error: string, runAt: Date): Promise<void>;
  fail(jobId: string, id: string, error: string): Promise<void>;
  retryFailed(id: string, now: Date): Promise<boolean>;
  findNewsItem(id: string): Promise<DeliveryNewsItem | null>;
  listEligibleRecipients(category: NewsCategory): Promise<
    {
      id: string;
      channel: 'email' | 'whatsapp' | 'both';
      email: string | null;
      whatsappE164: string | null;
      topics: NewsCategory[];
      unsubscribeToken: string;
    }[]
  >;
};
