import type { SourceInput } from '@healthcare/shared';
import { categorize, type NewsCategory } from './categories';

export type ParsedFeedItem = {
  headline: string;
  summary: string;
  link: string;
  publishedAt: Date | null;
  category: NewsCategory;
};

const entityMap: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

export function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code.startsWith('#x')) {
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      }
      if (code.startsWith('#')) {
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      }
      return entityMap[code.toLowerCase()] ?? ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function clampSummary(summary: string, maxLength = 200): string {
  const clean = stripHtml(summary);
  if (clean.length <= maxLength) {
    return clean;
  }
  const limit = Math.max(1, maxLength - 1);
  const boundary = clean.lastIndexOf(' ', limit);
  const end = boundary > Math.floor(limit * 0.6) ? boundary : limit;
  return `${clean.slice(0, end).trimEnd()}…`;
}

export function normalizeLink(raw: string): string {
  const url = new URL(raw);
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (
      key.toLowerCase().startsWith('utm_') ||
      [
        'fbclid',
        'gclid',
        'dclid',
        'mc_cid',
        'mc_eid',
        'ref',
        'ref_src',
        'source',
        'campaign',
        'igshid',
        'mkt_tok',
        's_cid',
        'ocid',
      ].includes(key.toLowerCase())
    ) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

const stopWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

export function headlineTokens(headline: string): Set<string> {
  return new Set(
    headline
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 0 && !stopWords.has(token)),
  );
}

export function headlineSimilarity(left: string, right: string): number {
  const leftTokens = headlineTokens(left);
  const rightTokens = headlineTokens(right);
  const union = new Set([...leftTokens, ...rightTokens]);
  if (union.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / union.size;
}

export function matchesSourceTopics(
  source: Pick<SourceInput, 'mode' | 'topics' | 'region'>,
  headline: string,
  summary: string,
): boolean {
  if (source.mode === 'all') {
    return true;
  }
  const text = `${headline} ${summary}`.toLocaleLowerCase();
  const topicsMatch = source.topics.some((topic) => text.includes(topic.toLocaleLowerCase()));
  const regionMatch = !source.region || text.includes(source.region.toLocaleLowerCase());
  return topicsMatch && regionMatch;
}

export function normalizeFeedItem(item: {
  title?: string;
  contentSnippet?: string;
  content?: string;
  summary?: string;
  description?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
}): ParsedFeedItem | null {
  const headline = stripHtml(item.title ?? '');
  const rawLink = item.link?.trim();
  if (!headline || !rawLink) {
    return null;
  }
  let link: string;
  try {
    link = new URL(rawLink).toString();
  } catch {
    return null;
  }
  const summary = clampSummary(
    item.contentSnippet ?? item.summary ?? item.description ?? item.content ?? '',
  );
  const publishedAtValue = item.isoDate ?? item.pubDate;
  const parsedDate = publishedAtValue ? new Date(publishedAtValue) : null;
  const publishedAt = parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate : null;

  return {
    headline,
    summary,
    link,
    publishedAt,
    category: categorize(headline, summary),
  };
}
