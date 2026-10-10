import { feedQuerySortValue, normalizeFeedSortMode } from './feed-layout.ts';

export type FeedFilterMode = 'all' | 'unread' | 'favorites';
export type FeedSortMode = 'latest' | 'priority' | 'score';
export type FeedScoreBand = 'all' | '80' | '70' | '60' | 'below60';

export type FeedUrlState = {
  q: string;
  filter: FeedFilterMode;
  category: string;
  sourceId: string;
  sort: FeedSortMode;
  sourceTier: string;
  readingTier: string;
  growthAxis: string;
  score: FeedScoreBand;
};

export function readFeedUrlState(searchParams: URLSearchParams): FeedUrlState {
  const nextFilter = searchParams.get('filter');
  const nextScore = searchParams.get('score');

  return {
    q: searchParams.get('q') || '',
    filter: nextFilter === 'unread' || nextFilter === 'favorites' ? nextFilter : 'all',
    category: searchParams.get('category') || '',
    sourceId: searchParams.get('sourceId') || '',
    sort: normalizeFeedSortMode(searchParams.get('sort')),
    sourceTier: searchParams.get('sourceTier') || '',
    readingTier: searchParams.get('readingTier') || '',
    growthAxis: searchParams.get('growthAxis') || '',
    score: nextScore === '80' || nextScore === '70' || nextScore === '60' || nextScore === 'below60'
      ? nextScore
      : 'all',
  };
}

export function mergeFeedUrlParams(
  current: URLSearchParams,
  next: {
    q?: string;
    filter?: FeedFilterMode;
    category?: string;
    sourceId?: string;
    sort?: FeedSortMode;
    sourceTier?: string;
    readingTier?: string;
    growthAxis?: string;
    score?: FeedScoreBand;
  },
): URLSearchParams {
  const params = new URLSearchParams(current);

  if (next.q !== undefined) {
    if (next.q) params.set('q', next.q);
    else params.delete('q');
  }
  if (next.filter !== undefined) {
    if (next.filter && next.filter !== 'all') params.set('filter', next.filter);
    else params.delete('filter');
  }
  if (next.category !== undefined) {
    if (next.category) params.set('category', next.category);
    else params.delete('category');
  }
  if (next.sourceId !== undefined) {
    if (next.sourceId) params.set('sourceId', next.sourceId);
    else params.delete('sourceId');
  }
  if (next.sort !== undefined) {
    const queryValue = feedQuerySortValue(next.sort);
    if (queryValue) params.set('sort', queryValue);
    else params.delete('sort');
  }
  if (next.sourceTier !== undefined) {
    if (next.sourceTier) params.set('sourceTier', next.sourceTier);
    else params.delete('sourceTier');
  }
  if (next.readingTier !== undefined) {
    if (next.readingTier) params.set('readingTier', next.readingTier);
    else params.delete('readingTier');
  }
  if (next.growthAxis !== undefined) {
    if (next.growthAxis) params.set('growthAxis', next.growthAxis);
    else params.delete('growthAxis');
  }
  if (next.score !== undefined) {
    if (next.score && next.score !== 'all') params.set('score', next.score);
    else params.delete('score');
  }

  return params;
}
