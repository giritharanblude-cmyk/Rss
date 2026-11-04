import type { PoolClient } from 'pg';
import { loadConfig } from '../src/config';
import { createPool, waitForDatabase } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { encryptRecipientContact } from '../src/settings/secrets';

const demoSourceIds = [
  '00000000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000602',
];
const demoNewsIds = [
  '00000000-0000-4000-8000-000000000611',
  '00000000-0000-4000-8000-000000000612',
];
const demoRecipientIds = [
  '00000000-0000-4000-8000-000000000621',
  '00000000-0000-4000-8000-000000000622',
];

type DemoSource = {
  id: string;
  name: string;
  website: string;
  rssUrl: string;
  topics: string[];
  region: string;
};

const demoSources: DemoSource[] = [
  {
    id: demoSourceIds[0]!,
    name: '[DEMO] WHO Health Emergencies',
    website: 'https://www.who.int',
    rssUrl: 'https://example.test/demo/who.rss',
    topics: ['Outbreaks and public health', 'Vaccines'],
    region: 'Global',
  },
  {
    id: demoSourceIds[1]!,
    name: '[DEMO] CDC Newsroom',
    website: 'https://www.cdc.gov',
    rssUrl: 'https://example.test/demo/cdc.rss',
    topics: ['Clinical guidance', 'Vaccines'],
    region: 'United States',
  },
];

async function main(): Promise<void> {
  const action = process.argv[2];
  if (action !== 'seed' && action !== 'clear') {
    throw new Error('Choose exactly one supported action: seed or clear.');
  }

  const config = loadConfig();
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  if (!config.DEMO_DATA_ENABLED) {
    throw new Error('Set DEMO_DATA_ENABLED=true only for a non-production review database.');
  }
  if (config.NODE_ENV === 'production') {
    throw new Error('Demo data is disabled when NODE_ENV=production.');
  }

  const pool = createPool(config.DATABASE_URL);
  try {
    await waitForDatabase(pool);
    await runMigrations(pool, config.SETTINGS_ENCRYPTION_KEY);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (action === 'seed') {
        await seedDemoData(client, config.SETTINGS_ENCRYPTION_KEY);
      } else {
        await clearDemoData(client);
      }
      await client.query('COMMIT');
      process.stdout.write(
        action === 'seed'
          ? 'Demo data is ready: 2 [DEMO] sources, 2 [DEMO] news items, and 2 [DEMO] recipients.\n'
          : 'Demo data removed. Only records with the fixed demo IDs were targeted.\n',
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function seedDemoData(client: PoolClient, encryptionKey: string): Promise<void> {
  for (const source of demoSources) {
    const result = await client.query(
      `INSERT INTO sources
         (id, name, website, rss_url, mode, topics, region, interval_minutes, active, last_status)
       VALUES ($1, $2, $3, $4, 'topics', $5, $6, 60, true, 'Demo sample')
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, website = EXCLUDED.website, rss_url = EXCLUDED.rss_url,
         mode = EXCLUDED.mode, topics = EXCLUDED.topics, region = EXCLUDED.region,
         interval_minutes = EXCLUDED.interval_minutes, active = EXCLUDED.active,
         last_status = EXCLUDED.last_status
       WHERE sources.name LIKE '[DEMO] %'
       RETURNING id`,
      [source.id, source.name, source.website, source.rssUrl, source.topics, source.region],
    );
    assertDemoRecord(result.rowCount, source.id);
  }

  const demoNews = [
    {
      id: demoNewsIds[0]!,
      sourceId: demoSourceIds[0]!,
      headline: '[DEMO] Sample global outbreak update',
      summary: 'Illustrative sample item for previewing the healthcare news feed.',
      category: 'Outbreaks and public health',
      url: 'https://example.test/demo/news/global-outbreak',
      signature: 'demo-global-outbreak-v1',
      publishedAt: '2026-11-03T08:00:00.000Z',
    },
    {
      id: demoNewsIds[1]!,
      sourceId: demoSourceIds[1]!,
      headline: '[DEMO] Sample clinical guidance notice',
      summary: 'Illustrative sample item for previewing topic filters and summaries.',
      category: 'Clinical guidance',
      url: 'https://example.test/demo/news/clinical-guidance',
      signature: 'demo-clinical-guidance-v1',
      publishedAt: '2026-11-02T08:00:00.000Z',
    },
  ];
  for (const item of demoNews) {
    const result = await client.query(
      `INSERT INTO news_items
         (id, source_id, headline, summary, link, link_normalized, headline_signature,
          category, published_at, important)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, false)
       ON CONFLICT (id) DO UPDATE SET
         source_id = EXCLUDED.source_id, headline = EXCLUDED.headline,
         summary = EXCLUDED.summary, link = EXCLUDED.link,
         link_normalized = EXCLUDED.link_normalized,
         headline_signature = EXCLUDED.headline_signature,
         category = EXCLUDED.category, published_at = EXCLUDED.published_at,
         important = EXCLUDED.important
       WHERE news_items.headline LIKE '[DEMO] %'
       RETURNING id`,
      [
        item.id,
        item.sourceId,
        item.headline,
        item.summary,
        item.url,
        item.signature,
        item.category,
        item.publishedAt,
      ],
    );
    assertDemoRecord(result.rowCount, item.id);
  }

  const demoRecipients = [
    {
      id: demoRecipientIds[0]!,
      name: '[DEMO] Sample email recipient',
      phone: null,
      email: 'demo.recipient@example.test',
      channel: 'email',
      topics: ['Clinical guidance'],
      unsubscribeToken: 'demo-email-recipient-v1',
    },
    {
      id: demoRecipientIds[1]!,
      name: '[DEMO] Sample WhatsApp recipient',
      phone: '+15555550101',
      email: 'demo.whatsapp@example.test',
      channel: 'both',
      topics: ['Outbreaks and public health', 'Vaccines'],
      unsubscribeToken: 'demo-whatsapp-recipient-v1',
    },
  ];
  for (const recipient of demoRecipients) {
    const result = await client.query(
      `INSERT INTO recipients
         (id, name, whatsapp_e164, email, topics, channel, consent_status, consent_at,
          consent_note, unsubscribe_token)
       VALUES ($1, $2, $3, $4, $5, $6, 'granted', now(),
               '[DEMO] Sample consent record; not a real person.', $7)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, whatsapp_e164 = EXCLUDED.whatsapp_e164,
         email = EXCLUDED.email, topics = EXCLUDED.topics, channel = EXCLUDED.channel,
         consent_status = EXCLUDED.consent_status, consent_at = EXCLUDED.consent_at,
         consent_note = EXCLUDED.consent_note, unsubscribe_token = EXCLUDED.unsubscribe_token
       WHERE recipients.name LIKE '[DEMO] %'
       RETURNING id`,
      [
        recipient.id,
        recipient.name,
        recipient.phone ? encryptRecipientContact(recipient.phone, encryptionKey) : null,
        recipient.email ? encryptRecipientContact(recipient.email, encryptionKey) : null,
        recipient.topics,
        recipient.channel,
        recipient.unsubscribeToken,
      ],
    );
    assertDemoRecord(result.rowCount, recipient.id);
  }
}

async function clearDemoData(client: PoolClient): Promise<void> {
  await client.query(
    `DELETE FROM news_items
     WHERE (id = ANY($1::uuid[]) AND headline LIKE '[DEMO] %')
        OR source_id IN (
          SELECT id FROM sources
          WHERE id = ANY($2::uuid[]) AND name LIKE '[DEMO] %'
        )`,
    [demoNewsIds, demoSourceIds],
  );
  await client.query(
    `DELETE FROM sources
     WHERE id = ANY($1::uuid[]) AND name LIKE '[DEMO] %'`,
    [demoSourceIds],
  );
  await client.query(
    `DELETE FROM recipients
     WHERE id = ANY($1::uuid[]) AND name LIKE '[DEMO] %'`,
    [demoRecipientIds],
  );
}

function assertDemoRecord(rowCount: number | null, id: string): void {
  if (rowCount !== 1) {
    throw new Error(`Refusing to overwrite a non-demo record using reserved demo ID ${id}.`);
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Demo data operation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
