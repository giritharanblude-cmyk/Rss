import type { AlertPreviewInput, AlertRuleInput } from '@healthcare/shared';
import { NEWS_CATEGORIES } from '@healthcare/shared';
import type {
  AlertPreviewRepository,
  AlertRuleRepository,
  RecipientRepository,
} from '../repositories/recipients';
import { HttpError } from '../errors';

const defaultDigestRule: AlertRuleInput = {
  kind: 'digest',
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  timeLocal: '08:00',
  timezone: 'Asia/Kolkata',
  topics: [],
  channels: ['email'],
  active: true,
};

function recipientChannels(channel: 'whatsapp' | 'email' | 'both'): ('whatsapp' | 'email')[] {
  if (channel === 'both') return ['whatsapp', 'email'];
  return [channel];
}

export class AlertPreviewService {
  constructor(
    private readonly recipients: RecipientRepository,
    private readonly rules: AlertRuleRepository,
    private readonly preview: AlertPreviewRepository,
    private readonly now: () => Date,
  ) {}

  async build(input: AlertPreviewInput, ownerUserId: string) {
    const rules = await this.rules.listAlertRules(ownerUserId);
    const selected = input.ruleId ? rules.find((rule) => rule.id === input.ruleId) : undefined;
    if (input.ruleId && !selected) throw new HttpError(404, 'That alert rule was not found.');
    const rule =
      selected ?? input.rule ?? rules.find((value) => value.kind === input.kind && value.active);
    const effectiveRule =
      rule ??
      (input.kind === 'digest'
        ? defaultDigestRule
        : { ...defaultDigestRule, kind: 'instant' as const, active: false });
    if (effectiveRule.kind !== input.kind)
      throw new HttpError(400, 'The alert rule type does not match.');
    if (!effectiveRule.active) {
      return {
        kind: input.kind,
        rule: effectiveRule,
        generatedAt: this.now().toISOString(),
        groups: [],
        recipientCount: 0,
        itemCount: 0,
      };
    }

    const categories = effectiveRule.topics.length ? effectiveRule.topics : [...NEWS_CATEGORIES];
    const recipients = await this.recipients.listRecipients(undefined, ownerUserId);
    const groups = [];
    for (const recipient of recipients) {
      if (recipient.consentStatus !== 'granted') continue;
      const channels = recipientChannels(recipient.channel).filter((channel) =>
        effectiveRule.channels.includes(channel),
      );
      if (!channels.length) continue;
      const recipientCategories = recipient.topics.filter((category) =>
        categories.includes(category),
      );
      if (!recipientCategories.length) continue;
      const since = input.kind === 'digest' ? await this.preview.lastDigestAt(recipient.id) : null;
      const items = await this.preview.listPreviewNews({
        ownerUserId,
        since,
        importantOnly: input.kind === 'instant',
        categories: recipientCategories,
        limit: input.limit,
      });
      if (!items.length) continue;
      const categoryGroups = recipientCategories
        .map((category) => ({
          category,
          items: items
            .filter((item) => item.category === category)
            .map((item) => ({
              id: item.id,
              headline: item.headline,
              summary: item.summary,
              link: item.link,
              sourceName: item.sourceName,
              category: item.category,
              publishedAt: item.publishedAt?.toISOString() ?? null,
              fetchedAt: item.fetchedAt.toISOString(),
            })),
        }))
        .filter((group) => group.items.length > 0);
      groups.push({
        recipientId: recipient.id,
        recipientName: recipient.name,
        channels,
        since: since?.toISOString() ?? null,
        itemsByCategory: categoryGroups,
        itemCount: categoryGroups.reduce((total, group) => total + group.items.length, 0),
      });
    }
    return {
      kind: input.kind,
      rule: effectiveRule,
      generatedAt: this.now().toISOString(),
      groups,
      recipientCount: groups.length,
      itemCount: groups.reduce((total, group) => total + group.itemCount, 0),
    };
  }
}
