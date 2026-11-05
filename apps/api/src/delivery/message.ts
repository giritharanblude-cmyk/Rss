import type { EmailMessage } from '../email/types';
import type { DeliveryNewsItem } from './types';

export type DigestContent = {
  recipientName: string;
  unsubscribeUrl: string;
  preferencesUrl: string;
  items: DeliveryNewsItem[];
  now: Date;
};

function localDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-IN', { ...options, timeZone: 'Asia/Kolkata' }).format(date);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function itemDate(item: DeliveryNewsItem): string {
  return localDate(item.publishedAt ?? item.fetchedAt, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function buildWhatsAppDigest(content: DigestContent): string {
  const date = localDate(content.now, { dateStyle: 'medium', timeStyle: 'short' });
  const items = content.items
    .map(
      (item, index) =>
        `${index + 1}. ${item.headline}\n${item.sourceName} │ ${item.category}\n${item.link}`,
    )
    .join('\n\n');
  return `Healthcare News – Daily Digest\n${date}\n\n${items}\n\nReply STOP to stop these updates.`;
}

export function buildEmailDigest(content: DigestContent, to: string): EmailMessage {
  const subject = `Healthcare News Digest – ${localDate(content.now, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
  const groups = new Map<string, DeliveryNewsItem[]>();
  for (const item of content.items) {
    const items = groups.get(item.category) ?? [];
    items.push(item);
    groups.set(item.category, items);
  }
  const textGroups = [...groups].map(
    ([category, items]) =>
      `${category}\n${items
        .map((item) => `- ${item.headline} – ${item.sourceName}, ${itemDate(item)}\n  ${item.link}`)
        .join('\n')}`,
  );
  const htmlGroups = [...groups]
    .map(
      ([category, items]) =>
        `<h2>${escapeHtml(category)}</h2><ul>${items
          .map(
            (item) =>
              `<li><a href="${escapeHtml(item.link)}">${escapeHtml(item.headline)}</a> – ${escapeHtml(item.sourceName)}, ${escapeHtml(itemDate(item))}</li>`,
          )
          .join('')}</ul>`,
    )
    .join('');
  const linksText = `Unsubscribe: ${content.unsubscribeUrl}\nManage topics: ${content.preferencesUrl}`;
  const linksHtml = `<p><a href="${escapeHtml(content.unsubscribeUrl)}">Unsubscribe</a> · <a href="${escapeHtml(content.preferencesUrl)}">Manage topics</a></p>`;
  return {
    to,
    subject,
    text: `Hello ${content.recipientName},\n\n${textGroups.join('\n\n')}\n\n${linksText}`,
    html: `<main><p>Hello ${escapeHtml(content.recipientName)},</p>${htmlGroups}${linksHtml}</main>`,
  };
}
