import type { NEWS_CATEGORIES } from '@healthcare/shared';

export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

export const CATEGORY_RULES: ReadonlyArray<{
  category: Exclude<NewsCategory, 'Uncategorized'>;
  keywords: readonly string[];
}> = [
  {
    category: 'Outbreaks and public health',
    keywords: ['outbreak', 'epidemic', 'advisory', 'vaccine', 'surveillance'],
  },
  {
    category: 'Drugs and approvals',
    keywords: ['approval', 'recall', 'drug safety', 'pharmacovigilance', 'adverse event'],
  },
  {
    category: 'Clinical trials and research',
    keywords: ['clinical trial', 'phase 3', 'study finds', 'journal'],
  },
  {
    category: 'Digital health and AI',
    keywords: ['AI in healthcare', 'telemedicine', 'EHR', 'wearable', 'remote monitoring'],
  },
  {
    category: 'Policy and regulation',
    keywords: ['guideline', 'regulation', 'health policy', 'insurance scheme'],
  },
  {
    category: 'Hospitals and industry',
    keywords: ['hospital', 'funding', 'acquisition', 'partnership'],
  },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function categorize(headline: string, summary: string): NewsCategory {
  const text = `${headline} ${summary}`;
  let winner: NewsCategory = 'Uncategorized';
  let winningCount = 0;

  for (const rule of CATEGORY_RULES) {
    const hits = rule.keywords.filter((keyword) =>
      new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(keyword)}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(
        text,
      ),
    ).length;
    if (hits > winningCount) {
      winner = rule.category;
      winningCount = hits;
    }
  }
  return winner;
}
