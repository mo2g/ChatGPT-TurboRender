import type {
  SlidingWindowPair,
  SlidingWindowPairIndex,
  SlidingWindowSearchEntry,
  SlidingWindowSearchMatch,
} from './types';

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function summarize(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function getPairs(source: SlidingWindowPairIndex | SlidingWindowPair[]): SlidingWindowPair[] {
  return Array.isArray(source) ? source : source.pairs;
}

export function buildSlidingWindowSearchIndex(
  source: SlidingWindowPairIndex | SlidingWindowPair[],
): SlidingWindowSearchEntry[] {
  return getPairs(source).map((pair) => ({
    pairIndex: pair.pairIndex,
    searchText: pair.searchText,
    userPreview: pair.userPreview,
    assistantPreview: pair.assistantPreview,
  }));
}

export function searchSlidingWindowPairs(
  index: SlidingWindowSearchEntry[],
  query: string,
  limit = 20,
): SlidingWindowSearchMatch[] {
  const normalizedQuery = normalizeQuery(query);
  if (normalizedQuery.length === 0) {
    return [];
  }

  const maxResults = Math.max(1, Math.floor(limit));
  return index
    .filter((entry) => normalizeQuery(entry.searchText).includes(normalizedQuery))
    .slice(0, maxResults)
    .map((entry) => ({
      pairIndex: entry.pairIndex,
      userPreview: entry.userPreview,
      assistantPreview: entry.assistantPreview,
      excerpt: summarize(entry.searchText),
    }));
}
