import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const userRole = pgEnum('user_role', ['master', 'member']);
export const otpPurpose = pgEnum('otp_purpose', ['login', 'password_change', 'contact_change']);
export const sourceMode = pgEnum('source_mode', ['all', 'topics']);
export const recipientChannel = pgEnum('recipient_channel', ['whatsapp', 'email', 'both']);
export const consentStatus = pgEnum('consent_status', ['granted', 'revoked', 'pending']);
export const alertKind = pgEnum('alert_kind', ['digest', 'instant']);
export const deliveryStatus = pgEnum('delivery_status', [
  'pending',
  'delivered',
  'retrying',
  'failed',
]);
export const jobStatus = pgEnum('job_status', ['pending', 'running', 'done', 'failed']);
export const connectionService = pgEnum('connection_service', ['whatsapp', 'email']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('member'),
    email: text('email').notNull(),
    phone: text('phone'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sessionVersion: integer('session_version').notNull().default(0),
    disabled: boolean('disabled').notNull().default(false),
    loginFailures: integer('login_failures').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('users_name_key_unique').on(table.nameKey),
    uniqueIndex('users_single_master_unique')
      .on(table.role)
      .where(sql`${table.role} = 'master'`),
  ],
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('user_sessions_user_id_idx').on(table.userId)],
);

export const otpCodes = pgTable(
  'otp_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: otpPurpose('purpose').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('otp_codes_user_purpose_idx').on(table.userId, table.purpose)],
);

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  website: text('website').notNull(),
  rssUrl: text('rss_url').notNull(),
  mode: sourceMode('mode').notNull().default('all'),
  topics: text('topics').array().notNull().default([]),
  region: text('region'),
  intervalMinutes: integer('interval_minutes').notNull().default(60),
  active: boolean('active').notNull().default(true),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
  lastStatus: text('last_status'),
  etag: text('etag'),
  lastModified: text('last_modified'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const newsItems = pgTable(
  'news_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    headline: text('headline').notNull(),
    summary: text('summary').notNull(),
    link: text('link').notNull(),
    linkNormalized: text('link_normalized').notNull(),
    headlineSignature: text('headline_signature').notNull(),
    category: text('category').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    important: boolean('important').notNull().default(false),
    duplicateOf: uuid('duplicate_of').references((): AnyPgColumn => newsItems.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('news_items_link_normalized_idx').on(table.linkNormalized),
    index('news_items_headline_signature_idx').on(table.headlineSignature),
    index('news_items_published_at_idx').on(table.publishedAt),
    index('news_items_category_idx').on(table.category),
  ],
);

export const recipients = pgTable(
  'recipients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    whatsappE164: text('whatsapp_e164'),
    email: text('email'),
    topics: text('topics').array().notNull().default([]),
    channel: recipientChannel('channel').notNull().default('email'),
    consentStatus: consentStatus('consent_status').notNull().default('pending'),
    consentAt: timestamp('consent_at', { withTimezone: true }),
    consentNote: text('consent_note'),
    unsubscribeToken: text('unsubscribe_token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('recipients_unsubscribe_token_unique').on(table.unsubscribeToken)],
);

export const alertRules = pgTable('alert_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: alertKind('kind').notNull().default('digest'),
  daysOfWeek: integer('days_of_week').array().notNull().default([]),
  timeLocal: text('time_local').notNull().default('08:00'),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  topics: text('topics').array().notNull().default([]),
  channels: recipientChannel('channels').array().notNull().default([]),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => recipients.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    kind: text('kind').notNull(),
    subjectOrRef: text('subject_or_ref'),
    status: deliveryStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    newsItemIds: uuid('news_item_ids').array().notNull().default([]),
  },
  (table) => [
    index('deliveries_status_idx').on(table.status),
    index('deliveries_queued_at_idx').on(table.queuedAt),
    uniqueIndex('deliveries_idempotency_unique')
      .on(table.recipientId, table.channel, table.kind, table.subjectOrRef)
      .where(sql`${table.subjectOrRef} is not null`),
  ],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    status: jobStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (table) => [index('jobs_status_run_at_idx').on(table.status, table.runAt)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  encryptedValue: text('encrypted_value').notNull(),
});

export const connectionStatus = pgTable(
  'connection_status',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    service: connectionService('service').notNull(),
    state: text('state').notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    detail: text('detail'),
  },
  (table) => [uniqueIndex('connection_status_service_unique').on(table.service)],
);
