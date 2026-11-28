import { randomBytes } from 'node:crypto';
import type { AlertPreviewService } from '../alerts/preview';
import type { EmailSender } from '../email/types';
import type { RecipientRepository, AlertRuleRepository } from '../repositories/recipients';
import type { UserRecord } from '../repositories/types';
import type { DeliveryNewsItem, DeliveryRepository, DeliveryRecord } from './types';
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
      isOwnerEnabled: (ownerUserId: string) => Promise<boolean>;
      throttleMs?: () => number;
      log?: (message: string, error: unknown) => void;
    },
  ) {}

  async queueForNewItems(
    items: Pick<DeliveryNewsItem, 'id' | 'category'>[],
    ownerUserId: string,
  ): Promise<number> {
    if (!(await this.options.isOwnerEnabled(ownerUserId))) return 0;
    const now = this.options.now();
    let queued = 0;
    for (const item of items) {
      if (queued >= 50) break;
      const eligible = await this.deliveries.listEligibleRecipients(item.category, ownerUserId);
      recipients: for (const recipient of eligible) {
        const channels =
          recipient.channel === 'both'
            ? (['email', 'whatsapp'] as const)
            : ([recipient.channel] as const);
        for (const channel of channels) {
          const contactPresent =
            channel === 'email' ? Boolean(recipient.email) : Boolean(recipient.whatsappE164);
          if (!contactPresent) continue;
          if (queued >= 50) break recipients;
          const result = await this.deliveries.enqueueIfNew(
            {
              recipientId: recipient.id,
              channel,
              kind: 'instant',
              subjectOrRef: `saved:${item.id}`,
              newsItemIds: [item.id],
            },
            now,
          );
          if (result.created) queued += 1;
        }
      }
    }
    return queued;
  }

  async sendNow(
    newsItemId: string,
    channel: 'email' | 'whatsapp',
    user: Pick<UserRecord, 'id' | 'name' | 'email' | 'phone' | 'role'>,
  ): Promise<number | null> {
    const item = await this.deliveries.findNewsItem(
      newsItemId,
      user.role === 'master' ? undefined : user.id,
    );
    if (!item) return null;
    const now = this.options.now();
    const recipient = await this.recipients.ensureAccountDeliveryRecipient(
      {
        name: user.name,
        whatsappE164: user.phone?.trim() || null,
        email: user.email.trim() || null,
        topics: [],
        channel: 'both',
      },
      randomBytes(32).toString('hex'),
      user.id,
      now,
    );
    const result = await this.deliveries.enqueueIfNew(
      {
        recipientId: recipient.id,
        channel,
        kind: 'manual',
        subjectOrRef: `manual:${item.id}`,
        newsItemIds: [item.id],
      },
      now,
    );
    return result.created ? 1 : 0;
  }

  async enqueuePreview(
    kind: 'digest' | 'instant',
    ruleId: string,
    idempotencyPrefix: string,
    ownerUserId: string,
  ): Promise<{ queued: number; created: number; itemCount: number }> {
    const preview = await this.previews.build({ kind, ruleId, limit: 10 }, ownerUserId);
    let queued = 0;
    let created = 0;
    for (const group of preview.groups) {
      const itemIds = group.itemsByCategory.flatMap((category) =>
        category.items.map((item) => item.id),
      );
      for (const channel of group.channels) {
        const result = await this.deliveries.enqueueIfNew(
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
        if (result.created) created += 1;
      }
    }
    return { queued, created, itemCount: preview.itemCount };
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
      if (rule.kind !== 'digest' || !rule.active) continue;
      const occurrence = mostRecentDigestOccurrence(rule, now);
      if (!occurrence) continue;
      const result = await this.enqueuePreview(
        'digest',
        rule.id,
        `digest:${rule.id}:${occurrence.dateKey}`,
        rule.ownerUserId,
      );
      queued += result.queued;
      const outcome =
        result.itemCount === 0
          ? 'skipped, no items'
          : result.created === 0
            ? 'skipped, already sent'
            : 'sent';
      this.logDigestCatchup(
        `digest catch-up: ${outcome}, ruleId=${rule.id}, occurrence=${occurrence.dateKey}, itemCount=${result.itemCount}`,
      );
    }
    return queued;
  }

  private logDigestCatchup(message: string): void {
    if (this.options.log) this.options.log(message, undefined);
    else console.info(message);
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

export function mostRecentDigestOccurrence(
  rule: {
    daysOfWeek: number[];
    timeLocal: string;
    timezone: string;
    createdAt: Date;
  },
  now: Date,
): { at: Date; dateKey: string } | null {
  const today = localDateKey(now, rule.timezone);
  let latest: { at: Date; dateKey: string } | null = null;

  for (let daysBack = 0; daysBack <= 7; daysBack += 1) {
    const dateKey = shiftLocalDate(today, -daysBack);
    const weekday = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
    if (!rule.daysOfWeek.includes(weekday)) continue;

    const at = resolveLocalDateTime(dateKey, rule.timeLocal, rule.timezone);
    if (!at || at > now || at < rule.createdAt) continue;
    if (!latest || at > latest.at) latest = { at, dateKey };
  }

  return latest;
}

function shiftLocalDate(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;
}

function resolveLocalDateTime(dateKey: string, timeLocal: string, timezone: string): Date | null {
  const wallClock = new Date(`${dateKey}T${timeLocal}:00.000Z`);
  if (!Number.isFinite(wallClock.getTime())) return null;
  const wallTime = wallClock.getTime();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const toLocalWallTime = (instant: number): number => {
    const values = new Map(
      formatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]),
    );
    return Date.UTC(
      Number(values.get('year')),
      Number(values.get('month')) - 1,
      Number(values.get('day')),
      Number(values.get('hour')),
      Number(values.get('minute')),
    );
  };
  const offsets = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const probe = wallTime + hours * 60 * 60 * 1000;
    offsets.add(toLocalWallTime(probe) - probe);
  }

  const candidates = [...offsets].map((offset) => wallTime - offset);
  const exact = candidates.filter((candidate) => toLocalWallTime(candidate) === wallTime);
  // The earlier exact instant resolves overlaps; the next wall time resolves gaps.
  if (exact.length) return new Date(Math.min(...exact));

  const afterGap = candidates
    .map((candidate) => ({ candidate, localTime: toLocalWallTime(candidate) }))
    .filter(({ localTime }) => localTime > wallTime)
    .sort((a, b) => a.localTime - b.localTime || a.candidate - b.candidate)[0];
  return afterGap ? new Date(afterGap.candidate) : null;
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
