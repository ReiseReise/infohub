import type { FeedItemRecord } from './api';

interface FeedInfinitePage {
  data?: FeedItemRecord[];
  [key: string]: unknown;
}

interface FeedInfiniteCache {
  pages?: FeedInfinitePage[];
  [key: string]: unknown;
}

export function patchFeedItemInInfiniteCache(
  current: unknown,
  itemId: string,
  patch: Partial<FeedItemRecord>,
): unknown {
  if (!current || typeof current !== 'object') return current;

  const cache = current as FeedInfiniteCache;
  if (!Array.isArray(cache.pages)) return current;

  return {
    ...cache,
    pages: cache.pages.map((page) => ({
      ...page,
      data: Array.isArray(page.data)
        ? page.data.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
        : page.data,
    })),
  };
}
