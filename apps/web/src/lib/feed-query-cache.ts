import type { FeedItemRecord } from './api';

export function selectFeedDetailForRoute<T extends { id: string }>(
  current: T | null,
  routeId: string | null | undefined,
  items: T[],
): T | null {
  if (!routeId) return null;
  // List records omit or downgrade full text, translations and reading assets.
  if (current?.id === routeId) return current;
  return items.find((item) => item.id === routeId) || null;
}

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
