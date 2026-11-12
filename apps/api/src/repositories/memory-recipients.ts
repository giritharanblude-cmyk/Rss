import { randomUUID } from 'node:crypto';
import type { AlertRuleInput, RecipientInput } from '@healthcare/shared';
import type { NewsCategory } from '../rss/categories';
import type { DashboardRepository } from './dashboard';
import type {
  AlertPreviewRepository,
  AlertRuleRecord,
  AlertRuleRepository,
  PreviewNewsRecord,
  RecipientRecord,
  RecipientRepository,
} from './recipients';

export class MemoryRecipientRepository
  implements RecipientRepository, AlertRuleRepository, AlertPreviewRepository
{
  private readonly recipients = new Map<string, RecipientRecord>();
  private readonly rules = new Map<string, AlertRuleRecord>();
  private readonly digestDates = new Map<string, Date>();

  constructor(
    private readonly dashboard: DashboardRepository,
    private readonly defaultOwnerUserId = 'test-owner',
  ) {}

  async listRecipients(query?: string, ownerUserId?: string): Promise<RecipientRecord[]> {
    const key = query?.trim().toLocaleLowerCase();
    return [...this.recipients.values()]
      .filter(
        (recipient) =>
          (!ownerUserId || recipient.ownerUserId === ownerUserId) &&
          (!key ||
            recipient.name.toLocaleLowerCase().includes(key) ||
            recipient.email?.toLocaleLowerCase().includes(key)),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(cloneRecipient);
  }

  async findRecipient(id: string, ownerUserId?: string): Promise<RecipientRecord | null> {
    const value = this.recipients.get(id);
    return value && (!ownerUserId || value.ownerUserId === ownerUserId)
      ? cloneRecipient(value)
      : null;
  }

  async findByUnsubscribeToken(token: string): Promise<RecipientRecord | null> {
    const recipient = [...this.recipients.values()].find(
      (value) => value.unsubscribeToken === token,
    );
    return recipient ? cloneRecipient(recipient) : null;
  }

  async findByWhatsappE164(phone: string): Promise<RecipientRecord | null> {
    const recipient = [...this.recipients.values()].find((value) => value.whatsappE164 === phone);
    return recipient ? cloneRecipient(recipient) : null;
  }

  async createRecipient(
    input: RecipientInput,
    unsubscribeToken: string,
    ownerUserId = this.defaultOwnerUserId,
  ): Promise<RecipientRecord> {
    const record: RecipientRecord = {
      ...input,
      topics: [...input.topics],
      id: randomUUID(),
      ownerUserId,
      unsubscribeToken,
      consentStatus: 'pending',
      consentAt: null,
      consentNote: null,
      createdAt: new Date(),
    };
    this.recipients.set(record.id, record);
    return cloneRecipient(record);
  }

  async updateRecipient(
    id: string,
    input: RecipientInput,
    ownerUserId?: string,
  ): Promise<RecipientRecord | null> {
    const current = this.recipients.get(id);
    if (!current || (ownerUserId && current.ownerUserId !== ownerUserId)) return null;
    const updated = { ...current, ...input, topics: [...input.topics] };
    this.recipients.set(id, updated);
    return cloneRecipient(updated);
  }

  async setConsent(
    id: string,
    status: RecipientRecord['consentStatus'],
    at: Date,
    note: string | null,
    ownerUserId?: string,
  ): Promise<RecipientRecord | null> {
    const current = this.recipients.get(id);
    if (!current || (ownerUserId && current.ownerUserId !== ownerUserId)) return null;
    const updated = {
      ...current,
      consentStatus: status,
      consentAt: status === 'pending' ? null : new Date(at),
      consentNote: status === 'pending' ? null : note,
    };
    this.recipients.set(id, updated);
    return cloneRecipient(updated);
  }

  async deleteRecipient(id: string, ownerUserId?: string): Promise<boolean> {
    const recipient = this.recipients.get(id);
    if (!recipient || (ownerUserId && recipient.ownerUserId !== ownerUserId)) return false;
    return this.recipients.delete(id);
  }

  async updateTopicsByToken(
    token: string,
    topics: RecipientInput['topics'],
  ): Promise<RecipientRecord | null> {
    const recipient = [...this.recipients.values()].find(
      (value) => value.unsubscribeToken === token,
    );
    if (!recipient) return null;
    recipient.topics = [...topics];
    return cloneRecipient(recipient);
  }

  async listAlertRules(ownerUserId?: string): Promise<AlertRuleRecord[]> {
    return [...this.rules.values()]
      .filter((rule) => !ownerUserId || rule.ownerUserId === ownerUserId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async createAlertRule(
    input: AlertRuleInput,
    ownerUserId = this.defaultOwnerUserId,
  ): Promise<AlertRuleRecord> {
    const record: AlertRuleRecord = {
      ...input,
      id: randomUUID(),
      ownerUserId,
      createdAt: new Date(),
    };
    this.rules.set(record.id, record);
    return record;
  }

  async updateAlertRule(
    id: string,
    input: AlertRuleInput,
    ownerUserId?: string,
  ): Promise<AlertRuleRecord | null> {
    const current = this.rules.get(id);
    if (!current || (ownerUserId && current.ownerUserId !== ownerUserId)) return null;
    const updated = { ...input, id, ownerUserId: current.ownerUserId, createdAt: current.createdAt };
    this.rules.set(id, updated);
    return updated;
  }

  async deleteAlertRule(id: string, ownerUserId?: string): Promise<boolean> {
    const rule = this.rules.get(id);
    if (!rule || (ownerUserId && rule.ownerUserId !== ownerUserId)) return false;
    return this.rules.delete(id);
  }

  async lastDigestAt(recipientId: string): Promise<Date | null> {
    const date = this.digestDates.get(recipientId);
    return date ? new Date(date) : null;
  }

  async listPreviewNews(options: {
    ownerUserId: string;
    since: Date | null;
    importantOnly: boolean;
    categories: NewsCategory[];
    limit: number;
  }): Promise<PreviewNewsRecord[]> {
    const pages = await Promise.all(
      options.categories.map((category) =>
        this.dashboard.listNews({
          category,
          ownerUserId: options.ownerUserId,
          page: 1,
          pageSize: Math.min(Math.max(options.limit, 20), 50),
        }),
      ),
    );
    return pages
      .flatMap((page) => page.items)
      .filter((item) => !options.importantOnly || item.important)
      .filter(
        (item) =>
          !options.since ||
          new Date(item.publishedAt ?? item.fetchedAt).getTime() >= options.since.getTime(),
      )
      .sort(
        (a, b) =>
          new Date(b.publishedAt ?? b.fetchedAt).getTime() -
          new Date(a.publishedAt ?? a.fetchedAt).getTime(),
      )
      .slice(0, options.limit)
      .map((item) => ({
        id: item.id,
        headline: item.headline,
        summary: item.summary,
        link: item.link,
        category: item.category,
        sourceName: item.sourceName,
        publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
        fetchedAt: new Date(item.fetchedAt),
        important: item.important,
      }));
  }

  setLastDigestForTest(recipientId: string, at: Date): void {
    this.digestDates.set(recipientId, new Date(at));
  }
}

function cloneRecipient(recipient: RecipientRecord): RecipientRecord {
  return {
    ...recipient,
    topics: [...recipient.topics],
    consentAt: recipient.consentAt ? new Date(recipient.consentAt) : null,
    createdAt: new Date(recipient.createdAt),
  };
}
