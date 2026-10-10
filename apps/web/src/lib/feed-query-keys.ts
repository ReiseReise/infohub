import type { FeedFilterMode, FeedScoreBand, FeedSortMode } from './feed-query-state';

export interface FeedListParams {
  filter: FeedFilterMode;
  sortMode: FeedSortMode;
  searchQuery: string;
  category: string;
  sourceId: string;
  sourceTierFilter: string;
  readingTierFilter: string;
  growthAxisFilter: string;
  scoreBand: FeedScoreBand;
}

export const feedKeys = {
  all: (userId: string) => ['feed', userId] as const,
  lists: (userId: string) => [...feedKeys.all(userId), 'list'] as const,
  list: (userId: string, params: FeedListParams) => [...feedKeys.lists(userId), params] as const,
  details: (userId: string) => [...feedKeys.all(userId), 'detail'] as const,
  detail: (userId: string, id: string | null) => [...feedKeys.details(userId), id] as const,
  sourceRail: (userId: string, readingTier: string) => [...feedKeys.all(userId), 'sourceRail', readingTier] as const,
  categories: (userId: string) => [...feedKeys.all(userId), 'categories'] as const,
  stats: (userId: string) => [...feedKeys.all(userId), 'stats'] as const,
  fetchStatus: (userId: string) => [...feedKeys.all(userId), 'fetchStatus'] as const,
  preferenceSummary: (userId: string) => [...feedKeys.all(userId), 'preferenceSummary'] as const,
  scoreBreakdown: (userId: string, id: string | null) => [...feedKeys.all(userId), 'scoreBreakdown', id] as const,
};
