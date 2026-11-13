import { randomUUID } from 'node:crypto';
import type { AlertPreviewService } from '../alerts/preview';
import type { EmailSender } from '../email/types';
import type { RecipientRepository, AlertRuleRepository } from '../repositories/recipients';
import type { DeliveryRepository, DeliveryRecord } from './types';
import { buildEmailDigest, buildWhatsAppDigest } from './message';
import type { WhatsAppAdapter } from './whatsapp';

const maxAttempts = 3;
const retryDelaysMs = [30_000, 120_000];

export class DeliveryService {
  private running = false;
  private lastWhatsAppSendAt = 0;

  constructor(
    private readonly deliveries: DeliveryRepository,
    private readonly recipients: RecipientRepository,
    private readonly rules: AlertRuleRepository,
    private readonly previews: AlertPreviewService,
    private readonly email: EmailSender,
    private readonly whatsapp: WhatsAppAdapter,
    private readonly options: {
      now: () => Date;
      publicOrigin: string;
      throttleMs?: () => number;
      log?: (message: string, error: unknown) => void;
    },
  ) {}

  async sendNow(
    newsItemId: string,
    channel: 'email' | 'whatsapp',
    ownerUserId?: string,
  ): Promise<number> {
    const item = await this.deliveries.findNewsItem(newsItemId, ownerUserId);
    if (!item) return 0;
    const eligible = await this.deliveries.listEligibleRecipients(item.category, ownerUserId);
    let queued = 0;
    for (const recipient of eligible) {
      const channelAllowed = recipient.channel === 'both' || recipient.channel === channel;
      const contactPresent =
        channel === 'email' ? Boolean(recipient.email) : Boolean(recipient.whatsappE164);
      if (!channelAllowed || !contactPresent) continue;
      await this.deliveries.enqueue(
        {
          recipientId: recipient.id,
          channel,
          kind: 'manual',
          subjectOrRef: `manual:${randomUUID()}`,
          newsItemIds: [item.id],
        },
        this.options.now(),
      );
      queued += 1;
    }
    return queued;
  }

  async enqueuePreview(
    kind: 'digest' | 'instant',
    ruleId: string,
    idempotencyPrefix: string,
    ownerUserId: string,
  ): Promise<number> {
    const preview = await this.previews.build({ kind, ruleId, limit: 10 }, ownerUserId);
    let queued = 0;
    for (const group of preview.groups) {
      const itemIds = group.itemsByCategory.flatMap((category) =>
        category.items.map((item) => item.id),
      );
      for (const channel of group.channels) {
        await this.deliveries.enqueue(
          {
            recipientId: group.recipientId,
            channel,
            kind,
            subjectOrRef: `${idempotencyPrefix}:${group.recipientId}:${channel}`,
            newsItemIds: itemIds,
          },
          this.options.now(),
        );
        queued += 1;
      }
    }
    return queued;
  }

  async sendInstantForItem(itemId: string): Promise<number> {
    const item = await this.deliveries.findNewsItem(itemId);
    if (!item?.id) return 0;
    const rules = await this.rules.listAlertRules();
    let queued = 0;
    for (const rule of rules) {
      if (rule.kind !== 'instant' || !rule.active) continue;
      const preview = await this.previews.build(
        { kind: 'instant', ruleId: rule.id, limit: 50 },
        rule.ownerUserId,
      );
      for (const group of preview.groups) {
        const matchingIds = group.itemsByCategory
          .flatMap((category) => category.items)
          .filter((entry) => entry.id === item.id)
          .map((entry) => entry.id);
        if (!matchingIds.length) continue;
        for (const channel of group.channels) {
          await this.deliveries.enqueue(
            {
              recipientId: group.recipientId,
              channel,
              kind: 'instant',
              subjectOrRef: `instant:${item.id}:${rule.id}:${group.recipientId}:${channel}`,
              newsItemIds: matchingIds,
            },
            this.options.now(),
          );
          queued += 1;
        }
      }
    }
    return queued;
  }

  async runPending(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const now = this.options.now();
        const job = await this.deliveries.claimNext(now, new Date(now.getTime() + 120_000));
        if (!job) break;
        await this.deliver(job.jobId, job.deliveryId);
      }
    } finally {
      this.running = false;
    }
  }

  async handleIncoming(message: { from: string; body: string }): Promise<void> {
    if (message.body.trim().toLocaleUpperCase() !== 'STOP') return;
    const number = normalizeWhatsAppNumber(message.from);
    if (!number) return;
    const recipient = await this.recipients.findByWhatsappE164(number);
    if (!recipient || recipient.consentStatus === 'revoked') return;
    const updated = await this.recipients.setConsent(
      recipient.id,
      'revoked',
      this.options.now(),
      'Recipient replied STOP on WhatsApp',
    );
    if (!updated) return;
    await this.deliveries.enqueue(
      {
        recipientId: recipient.id,
        channel: 'whatsapp',
        kind: 'unsubscribe_confirmation',
        subjectOrRef: `unsubscribe:${recipient.id}:${this.options.now().getTime()}`,
        newsItemIds: [],
      },
      this.options.now(),
    );
  }

  async scheduleDigests(): Promise<number> {
    const now = this.options.now();
    const rules = await this.rules.listAlertRules();
    let queued = 0;
    for (const rule of rules) {
      if (rule.kind !== 'digest' || !rule.active || !isRuleDue(rule, now)) continue;
      const dateKey = localDateKey(now, rule.timezone);
      queued += await this.enqueuePreview(
        'digest',
        rule.id,
        `digest:${rule.id}:${dateKey}`,
        rule.ownerUserId,
      );
    }
    return queued;
  }

  private async deliver(jobId: string, deliveryId: string): Promise<void> {
    const context = await this.deliveries.getContext(deliveryId);
    if (!context) {
      await this.deliveries.fail(jobId, deliveryId, 'Delivery details are unavailable.');
      return;
    }
    if (
      context.recipient.consentStatus !== 'granted' &&
      context.delivery.kind !== 'unsubscribe_confirmation'
    ) {
      await this.deliveries.fail(
        jobId,
        deliveryId,
        'Consent is no longer active; message not sent.',
      );
      return;
    }
    const to =
      context.delivery.channel === 'email'
        ? context.recipient.email
        : context.recipient.whatsappE164;
    if (!to) {
      await this.deliveries.fail(jobId, deliveryId, 'Recipient contact details are unavailable.');
      return;
    }
    const token = encodeURIComponent(context.recipient.unsubscribeToken);
    const content = {
      recipientName: context.recipient.name,
      unsubscribeUrl: `${this.options.publicOrigin}/unsubscribe/${token}`,
      preferencesUrl: `${this.options.publicOrigin}/preferences/${token}`,
      items: context.items,
      now: this.options.now(),
    };
    try {
      if (context.delivery.kind === 'unsubscribe_confirmation') {
        await this.throttleWhatsApp();
        await this.whatsapp.sendText(
          to,
          'You have been unsubscribed from healthcare news updates.',
        );
      } else if (context.delivery.channel === 'whatsapp') {
        await this.throttleWhatsApp();
        await this.whatsapp.sendText(to, buildWhatsAppDigest(content));
      } else {
        await this.email.send(buildEmailDigest(content, to));
      }
      await this.deliveries.complete(jobId, deliveryId, this.options.now());
    } catch (error) {
      const attempt = context.delivery.attempts + 1;
      const detail = 'Delivery failed; check the configured connection.';
      if (attempt < maxAttempts) {
        const delay = retryDelaysMs[attempt - 1] ?? retryDelaysMs[retryDelaysMs.length - 1]!;
        await this.deliveries.retry(
          jobId,
          deliveryId,
          detail,
          new Date(this.options.now().getTime() + delay),
        );
      } else {
        await this.deliveries.fail(jobId, deliveryId, detail);
      }
      this.options.log?.('A delivery attempt failed.', error);
    }
  }

  private async throttleWhatsApp(): Promise<void> {
    const delay = Math.max(
      0,
      this.lastWhatsAppSendAt +
        (this.options.throttleMs?.() ?? 3_000 + Math.random() * 2_000) -
        Date.now(),
    );
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    this.lastWhatsAppSendAt = Date.now();
  }
}

function normalizeWhatsAppNumber(value: string): string | null {
  const phone = value.split('@')[0]?.replace(/\D/g, '');
  if (!phone || phone.length < 8 || phone.length > 15) return null;
  return `+${phone}`;
}

function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = new Map(parts.map(({ type, value }) => [type, value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

function isRuleDue(
  rule: { daysOfWeek: number[]; timeLocal: string; timezone: string },
  now: Date,
): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: rule.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = new Map(parts.map(({ type, value }) => [type, value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    values.get('weekday') ?? '',
  );
  return (
    rule.daysOfWeek.includes(weekday) &&
    `${values.get('hour')}:${values.get('minute')}` === rule.timeLocal
  );
}

export type DeliveryPublicRecord = Pick<
  DeliveryRecord,
  | 'id'
  | 'recipientId'
  | 'recipientName'
  | 'recipientContact'
  | 'channel'
  | 'kind'
  | 'status'
  | 'attempts'
  | 'lastError'
  | 'queuedAt'
  | 'sentAt'
  | 'newsItemIds'
>;
