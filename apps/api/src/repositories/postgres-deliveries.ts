import { randomUUID } from 'node:crypto';
import {
  and,
  arrayContains,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { Database } from '../db/client';
import { deliveries, jobs, newsItems, recipients, sources } from '../db/schema';
import { decryptRecipientContact, validateSettingsEncryptionKey } from '../settings/secrets';
import type { NewsCategory } from '../rss/categories';
import type {
  DeliveryContext,
  DeliveryFilters,
  DeliveryInput,
  DeliveryNewsItem,
  DeliveryRecord,
  DeliveryRepository,
} from '../delivery/types';

function toRecord(
  row: typeof deliveries.$inferSelect,
  recipientName: string,
  recipientContact: string | null,
): DeliveryRecord {
  return {
    id: row.id,
    recipientId: row.recipientId,
    recipientName,
    recipientContact,
    channel: row.channel as DeliveryRecord['channel'],
    kind: row.kind as DeliveryRecord['kind'],
    subjectOrRef: row.subjectOrRef ?? '',
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    queuedAt: row.queuedAt,
    sentAt: row.sentAt,
    newsItemIds: row.newsItemIds,
  };
}

function toNewsItem(item: typeof newsItems.$inferSelect, sourceName: string): DeliveryNewsItem {
  return {
    id: item.id,
    headline: item.headline,
    link: item.link,
    sourceName,
    category: item.category as NewsCategory,
    publishedAt: item.publishedAt,
    fetchedAt: item.fetchedAt,
  };
}

function deliveryContact(
  channel: string,
  email: string | null,
  phone: string | null,
  encryptionKey: string,
): string | null {
  const value = channel === 'email' ? email : phone;
  return value ? decryptRecipientContact(value, encryptionKey) : null;
}

export class PostgresDeliveryRepository implements DeliveryRepository {
  constructor(
    private readonly db: Database,
    private readonly encryptionKey: string,
  ) {
    validateSettingsEncryptionKey(encryptionKey);
  }

  async enqueue(input: DeliveryInput, now: Date): Promise<DeliveryRecord> {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(deliveries)
        .where(
          and(
            eq(deliveries.recipientId, input.recipientId),
            eq(deliveries.channel, input.channel),
            eq(deliveries.kind, input.kind),
            eq(deliveries.subjectOrRef, input.subjectOrRef),
          ),
        )
        .limit(1);
      if (existing[0]) {
        const recipientsRows = await tx
          .select({
            name: recipients.name,
            email: recipients.email,
            phone: recipients.whatsappE164,
          })
          .from(recipients)
          .where(eq(recipients.id, existing[0].recipientId))
          .limit(1);
        const recipient = recipientsRows[0];
        return toRecord(
          existing[0],
          recipient?.name ?? 'Unknown recipient',
          deliveryContact(
            input.channel,
            recipient?.email ?? null,
            recipient?.phone ?? null,
            this.encryptionKey,
          ),
        );
      }
      const rows = await tx
        .insert(deliveries)
        .values({
          recipientId: input.recipientId,
          channel: input.channel,
          kind: input.kind,
          subjectOrRef: input.subjectOrRef,
          newsItemIds: [...input.newsItemIds],
          status: 'pending',
          queuedAt: now,
        })
        .onConflictDoNothing({
          target: [
            deliveries.recipientId,
            deliveries.channel,
            deliveries.kind,
            deliveries.subjectOrRef,
          ],
          where: sql`${deliveries.subjectOrRef} is not null`,
        })
        .returning();
      const row = rows[0];
      if (!row) {
        const raced = await tx
          .select()
          .from(deliveries)
          .where(
            and(
              eq(deliveries.recipientId, input.recipientId),
              eq(deliveries.channel, input.channel),
              eq(deliveries.kind, input.kind),
              eq(deliveries.subjectOrRef, input.subjectOrRef),
            ),
          )
          .limit(1);
        if (raced[0]) {
          const recipientRows = await tx
            .select({
              name: recipients.name,
              email: recipients.email,
              phone: recipients.whatsappE164,
            })
            .from(recipients)
            .where(eq(recipients.id, raced[0].recipientId))
            .limit(1);
          const recipient = recipientRows[0];
          return toRecord(
            raced[0],
            recipient?.name ?? 'Unknown recipient',
            deliveryContact(
              input.channel,
              recipient?.email ?? null,
              recipient?.phone ?? null,
              this.encryptionKey,
            ),
          );
        }
        throw new Error('Delivery was not created');
      }
      await tx.insert(jobs).values({
        type: 'delivery_send',
        payload: { deliveryId: row.id },
        runAt: now,
        status: 'pending',
      });
      const recipientRows = await tx
        .select({ name: recipients.name, email: recipients.email, phone: recipients.whatsappE164 })
        .from(recipients)
        .where(eq(recipients.id, row.recipientId))
        .limit(1);
      const recipient = recipientRows[0];
      return toRecord(
        row,
        recipient?.name ?? 'Unknown recipient',
        deliveryContact(
          input.channel,
          recipient?.email ?? null,
          recipient?.phone ?? null,
          this.encryptionKey,
        ),
      );
    });
  }

  async list(filters: DeliveryFilters): Promise<{ items: DeliveryRecord[]; total: number }> {
    const conditions = [
      ...(filters.from ? [gte(deliveries.queuedAt, filters.from)] : []),
      ...(filters.toExclusive ? [lt(deliveries.queuedAt, filters.toExclusive)] : []),
      ...(filters.channel ? [eq(deliveries.channel, filters.channel)] : []),
      ...(filters.recipientId ? [eq(deliveries.recipientId, filters.recipientId)] : []),
      ...(filters.status ? [eq(deliveries.status, filters.status)] : []),
    ];
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, countRows] = await Promise.all([
      this.db
        .select({
          delivery: deliveries,
          recipientName: recipients.name,
          email: recipients.email,
          phone: recipients.whatsappE164,
        })
        .from(deliveries)
        .innerJoin(recipients, eq(deliveries.recipientId, recipients.id))
        .where(where)
        .orderBy(desc(deliveries.queuedAt), desc(deliveries.id))
        .limit(filters.pageSize)
        .offset((filters.page - 1) * filters.pageSize),
      this.db
        .select({ value: sql<number>`count(*)::int` })
        .from(deliveries)
        .where(where),
    ]);
    return {
      items: rows.map(({ delivery, recipientName, email, phone }) =>
        toRecord(
          delivery,
          recipientName,
          deliveryContact(delivery.channel, email, phone, this.encryptionKey),
        ),
      ),
      total: countRows[0]?.value ?? 0,
    };
  }

  async getContext(id: string): Promise<DeliveryContext | null> {
    const rows = await this.db
      .select({ delivery: deliveries, recipient: recipients })
      .from(deliveries)
      .innerJoin(recipients, eq(deliveries.recipientId, recipients.id))
      .where(eq(deliveries.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const itemRows = row.delivery.newsItemIds.length
      ? await this.db
          .select({ item: newsItems, sourceName: sources.name })
          .from(newsItems)
          .innerJoin(sources, eq(newsItems.sourceId, sources.id))
          .where(inArray(newsItems.id, row.delivery.newsItemIds))
      : [];
    return {
      delivery: toRecord(
        row.delivery,
        row.recipient.name,
        deliveryContact(
          row.delivery.channel,
          row.recipient.email,
          row.recipient.whatsappE164,
          this.encryptionKey,
        ),
      ),
      recipient: {
        id: row.recipient.id,
        name: row.recipient.name,
        email: row.recipient.email
          ? decryptRecipientContact(row.recipient.email, this.encryptionKey)
          : null,
        whatsappE164: row.recipient.whatsappE164
          ? decryptRecipientContact(row.recipient.whatsappE164, this.encryptionKey)
          : null,
        unsubscribeToken: row.recipient.unsubscribeToken,
        consentStatus: row.recipient.consentStatus,
      },
      items: itemRows.map(({ item, sourceName }) => toNewsItem(item, sourceName)),
    };
  }

  async claimNext(
    now: Date,
    lockUntil: Date,
  ): Promise<{ jobId: string; deliveryId: string } | null> {
    return this.db.transaction(async (tx) => {
      const candidates = await tx
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.type, 'delivery_send'),
            lte(jobs.runAt, now),
            or(
              eq(jobs.status, 'pending'),
              and(
                eq(jobs.status, 'running'),
                or(isNull(jobs.lockedUntil), lt(jobs.lockedUntil, now)),
              ),
            ),
          ),
        )
        .orderBy(jobs.runAt, jobs.id)
        .limit(1)
        .for('update', { skipLocked: true });
      const candidate = candidates[0];
      if (!candidate) return null;
      const payload = candidate.payload as { deliveryId?: unknown };
      if (typeof payload.deliveryId !== 'string') {
        await tx
          .update(jobs)
          .set({ status: 'failed', lockedUntil: null })
          .where(eq(jobs.id, candidate.id));
        return null;
      }
      await tx
        .update(jobs)
        .set({
          status: 'running',
          lockedUntil: lockUntil,
          attempts: sql`${jobs.attempts} + 1`,
        })
        .where(eq(jobs.id, candidate.id));
      return { jobId: candidate.id, deliveryId: payload.deliveryId };
    });
  }

  async complete(jobId: string, id: string, at: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(deliveries)
        .set({
          status: 'delivered',
          attempts: sql`${deliveries.attempts} + 1`,
          lastError: null,
          sentAt: at,
        })
        .where(eq(deliveries.id, id));
      await tx.update(jobs).set({ status: 'done', lockedUntil: null }).where(eq(jobs.id, jobId));
    });
  }

  async retry(jobId: string, id: string, error: string, runAt: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(deliveries)
        .set({
          status: 'retrying',
          attempts: sql`${deliveries.attempts} + 1`,
          lastError: error,
        })
        .where(eq(deliveries.id, id));
      await tx.update(jobs).set({ status: 'done', lockedUntil: null }).where(eq(jobs.id, jobId));
      await tx.insert(jobs).values({
        type: 'delivery_send',
        payload: { deliveryId: id },
        runAt,
        status: 'pending',
      });
    });
  }

  async fail(jobId: string, id: string, error: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(deliveries)
        .set({
          status: 'failed',
          attempts: sql`${deliveries.attempts} + 1`,
          lastError: error,
        })
        .where(eq(deliveries.id, id));
      await tx.update(jobs).set({ status: 'done', lockedUntil: null }).where(eq(jobs.id, jobId));
    });
  }

  async retryFailed(id: string, now: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(deliveries)
        .set({ status: 'pending', attempts: 0, lastError: null, sentAt: null, queuedAt: now })
        .where(and(eq(deliveries.id, id), eq(deliveries.status, 'failed')))
        .returning({ id: deliveries.id });
      if (!rows[0]) return false;
      await tx.insert(jobs).values({
        type: 'delivery_send',
        payload: { deliveryId: id },
        runAt: now,
        status: 'pending',
      });
      return true;
    });
  }

  async findNewsItem(id: string): Promise<DeliveryNewsItem | null> {
    const rows = await this.db
      .select({ item: newsItems, sourceName: sources.name })
      .from(newsItems)
      .innerJoin(sources, eq(newsItems.sourceId, sources.id))
      .where(and(eq(newsItems.id, id), isNull(newsItems.duplicateOf)))
      .limit(1);
    return rows[0] ? toNewsItem(rows[0].item, rows[0].sourceName) : null;
  }

  async listEligibleRecipients(category: NewsCategory) {
    const rows = await this.db
      .select()
      .from(recipients)
      .where(
        and(
          eq(recipients.consentStatus, 'granted'),
          arrayContains(recipients.topics, [category]),
        ),
      );
    return rows.map((recipient) => ({
      id: recipient.id,
      channel: recipient.channel,
      email: recipient.email ? decryptRecipientContact(recipient.email, this.encryptionKey) : null,
      whatsappE164: recipient.whatsappE164
        ? decryptRecipientContact(recipient.whatsappE164, this.encryptionKey)
        : null,
      topics: recipient.topics as NewsCategory[],
      unsubscribeToken: recipient.unsubscribeToken,
    }));
  }
}

export function newDeliveryKey(): string {
  return randomUUID();
}
