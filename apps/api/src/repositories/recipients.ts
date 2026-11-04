import type { AlertRuleInput, RecipientInput } from '@healthcare/shared';
import type { NewsCategory } from '../rss/categories';

export type RecipientRecord = RecipientInput & {
  id: string;
  unsubscribeToken: string;
  consentStatus: 'pending' | 'granted' | 'revoked';
  consentAt: Date | null;
  consentNote: string | null;
  createdAt: Date;
};

export type AlertRuleRecord = AlertRuleInput & {
  id: string;
  createdAt: Date;
};

export type PreviewNewsRecord = {
  id: string;
  headline: string;
  summary: string;
  link: string;
  category: NewsCategory;
  sourceName: string;
  publishedAt: Date | null;
  fetchedAt: Date;
  important: boolean;
};

export type RecipientRepository = {
  listRecipients(query?: string): Promise<RecipientRecord[]>;
  findRecipient(id: string): Promise<RecipientRecord | null>;
  findByUnsubscribeToken(token: string): Promise<RecipientRecord | null>;
  createRecipient(input: RecipientInput, unsubscribeToken: string): Promise<RecipientRecord>;
  updateRecipient(id: string, input: RecipientInput): Promise<RecipientRecord | null>;
  setConsent(
    id: string,
    status: RecipientRecord['consentStatus'],
    at: Date,
    note: string | null,
  ): Promise<RecipientRecord | null>;
  deleteRecipient(id: string): Promise<boolean>;
  updateTopicsByToken(
    token: string,
    topics: RecipientInput['topics'],
  ): Promise<RecipientRecord | null>;
};

export type AlertRuleRepository = {
  listAlertRules(): Promise<AlertRuleRecord[]>;
  createAlertRule(input: AlertRuleInput): Promise<AlertRuleRecord>;
  updateAlertRule(id: string, input: AlertRuleInput): Promise<AlertRuleRecord | null>;
  deleteAlertRule(id: string): Promise<boolean>;
};

export type AlertPreviewRepository = {
  lastDigestAt(recipientId: string): Promise<Date | null>;
  listPreviewNews(options: {
    since: Date | null;
    importantOnly: boolean;
    categories: NewsCategory[];
    limit: number;
  }): Promise<PreviewNewsRecord[]>;
};
