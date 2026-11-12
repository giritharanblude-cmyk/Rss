import { randomUUID } from 'node:crypto';
import type { NewsCategory } from '../rss/categories';
import type { RecipientRepository } from './recipients';
import type { DashboardRepository } from './dashboard';
import type {
  DeliveryContext,
  DeliveryFilters,
  DeliveryInput,
  DeliveryNewsItem,
  DeliveryRecord,
  DeliveryRepository,
} from '../delivery/types';

type MemoryJob = {
  id: string;
  deliveryId: string;
  runAt: Date;
  status: 'pending' | 'running' | 'done' | 'failed';
  lockedUntil: Date | null;
};

export class MemoryDeliveryRepository implements DeliveryRepository {
  private readonly records = new Map<string, DeliveryRecord>();
  private readonly jobs: MemoryJob[] = [];

  constructor(
    private readonly recipients: RecipientRepository,
    private readonly dashboard: DashboardRepository,
  ) {}

  async enqueue(input: DeliveryInput, now: Date): Promise<DeliveryRecord> {
    const duplicate = [...this.records.values()].find(
      (record) =>
        record.recipientId === input.recipientId &&
        record.channel === input.channel &&
        record.kind === input.kind &&
        record.subjectOrRef === input.subjectOrRef,
    );
    if (duplicate) return cloneDelivery(duplicate);
    const recipient = await this.recipients.findRecipient(input.recipientId);
    if (!recipient) throw new Error('Recipient does not exist');
    const record: DeliveryRecord = {
      ...input,
      id: randomUUID(),
      ownerUserId: recipient.ownerUserId,
      status: 'pending',
      attempts: 0,
      lastError: null,
      queuedAt: new Date(now),
      sentAt: null,
      recipientName: recipient.name,
      recipientContact: input.channel === 'email' ? recipient.email : recipient.whatsappE164,
    };
    this.records.set(record.id, record);
    this.jobs.push({
      id: randomUUID(),
      deliveryId: record.id,
      runAt: new Date(now),
      status: 'pending',
      lockedUntil: null,
    });
    return cloneDelivery(record);
  }

  async list(filters: DeliveryFilters): Promise<{ items: DeliveryRecord[]; total: number }> {
    const matching = [...this.records.values()]
      .filter(
        (record) =>
          (!filters.from || record.queuedAt >= filters.from) &&
          (!filters.toExclusive || record.queuedAt < filters.toExclusive) &&
          (!filters.channel || record.channel === filters.channel) &&
          (!filters.recipientId || record.recipientId === filters.recipientId) &&
          (!filters.ownerUserId || record.ownerUserId === filters.ownerUserId) &&
          (!filters.status || record.status === filters.status),
      )
      .sort((a, b) => b.queuedAt.getTime() - a.queuedAt.getTime());
    const start = (filters.page - 1) * filters.pageSize;
    return {
      items: matching.slice(start, start + filters.pageSize).map(cloneDelivery),
      total: matching.length,
    };
  }

  async getContext(id: string): Promise<DeliveryContext | null> {
    const delivery = this.records.get(id);
    if (!delivery) return null;
    const recipient = await this.recipients.findRecipient(delivery.recipientId);
    if (!recipient) return null;
    const allItems = await this.dashboard.listNews({ page: 1, pageSize: 50 });
    const items = allItems.items
      .filter((item) => delivery.newsItemIds.includes(item.id))
      .map((item) => ({
        id: item.id,
        headline: item.headline,
        link: item.link,
        sourceName: item.sourceName,
        category: item.category,
        publishedAt: item.publishedAt,
        fetchedAt: item.fetchedAt,
      }));
    return {
      delivery: cloneDelivery(delivery),
      recipient: {
        id: recipient.id,
        name: recipient.name,
        email: recipient.email,
        whatsappE164: recipient.whatsappE164,
        unsubscribeToken: recipient.unsubscribeToken,
        consentStatus: recipient.consentStatus,
      },
      items,
    };
  }

  async claimNext(
    now: Date,
    lockUntil: Date,
  ): Promise<{ jobId: string; deliveryId: string } | null> {
    const job = this.jobs
      .filter(
        (candidate) =>
          candidate.runAt <= now &&
          (candidate.status === 'pending' ||
            (candidate.status === 'running' &&
              (!candidate.lockedUntil || candidate.lockedUntil < now))),
      )
      .sort((a, b) => a.runAt.getTime() - b.runAt.getTime())[0];
    if (!job) return null;
    job.status = 'running';
    job.lockedUntil = new Date(lockUntil);
    return { jobId: job.id, deliveryId: job.deliveryId };
  }

  async complete(jobId: string, id: string, at: Date): Promise<void> {
    const delivery = this.records.get(id);
    if (delivery) {
      delivery.status = 'delivered';
      delivery.attempts += 1;
      delivery.lastError = null;
      delivery.sentAt = new Date(at);
    }
    this.finishJob(jobId);
  }

  async retry(jobId: string, id: string, error: string, runAt: Date): Promise<void> {
    const delivery = this.records.get(id);
    if (delivery) {
      delivery.status = 'retrying';
      delivery.attempts += 1;
      delivery.lastError = error;
    }
    this.finishJob(jobId);
    this.jobs.push({
      id: randomUUID(),
      deliveryId: id,
      runAt: new Date(runAt),
      status: 'pending',
      lockedUntil: null,
    });
  }

  async fail(jobId: string, id: string, error: string): Promise<void> {
    const delivery = this.records.get(id);
    if (delivery) {
      delivery.status = 'failed';
      delivery.attempts += 1;
      delivery.lastError = error;
    }
    this.finishJob(jobId);
  }

  async retryFailed(id: string, now: Date, ownerUserId?: string): Promise<boolean> {
    const delivery = this.records.get(id);
    if (
      !delivery ||
      delivery.status !== 'failed' ||
      (ownerUserId && delivery.ownerUserId !== ownerUserId)
    ) {
      return false;
    }
    delivery.status = 'pending';
    delivery.attempts = 0;
    delivery.lastError = null;
    delivery.sentAt = null;
    delivery.queuedAt = new Date(now);
    this.jobs.push({
      id: randomUUID(),
      deliveryId: id,
      runAt: new Date(now),
      status: 'pending',
      lockedUntil: null,
    });
    return true;
  }

  async findNewsItem(id: string, ownerUserId?: string): Promise<DeliveryNewsItem | null> {
    const page = await this.dashboard.listNews({ page: 1, pageSize: 50, ownerUserId });
    const item = page.items.find((candidate) => candidate.id === id);
    return item
      ? {
          id: item.id,
          headline: item.headline,
          link: item.link,
          sourceName: item.sourceName,
          category: item.category,
          publishedAt: item.publishedAt,
          fetchedAt: item.fetchedAt,
        }
      : null;
  }

  async listEligibleRecipients(category: NewsCategory, ownerUserId?: string) {
    if (category === 'Uncategorized') return [];
    return (await this.recipients.listRecipients(undefined, ownerUserId))
      .filter(
        (recipient) => recipient.consentStatus === 'granted' && recipient.topics.includes(category),
      )
      .map((recipient) => ({
        id: recipient.id,
        channel: recipient.channel,
        email: recipient.email,
        whatsappE164: recipient.whatsappE164,
        topics: [...recipient.topics],
        unsubscribeToken: recipient.unsubscribeToken,
      }));
  }

  private finishJob(id: string): void {
    const job = this.jobs.find((candidate) => candidate.id === id);
    if (job) {
      job.status = 'done';
      job.lockedUntil = null;
    }
  }
}

function cloneDelivery(value: DeliveryRecord): DeliveryRecord {
  return {
    ...value,
    newsItemIds: [...value.newsItemIds],
    queuedAt: new Date(value.queuedAt),
    sentAt: value.sentAt ? new Date(value.sentAt) : null,
  };
}
