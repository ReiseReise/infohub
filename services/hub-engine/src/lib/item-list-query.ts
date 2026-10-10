import { normalizeSourceReadingTier, type SourceReadingTierValue } from './source-reading-tier.js';

export type ItemListSortBy = 'publishedAt' | 'priority' | 'score';

export type ItemListQueryInput = {
  minScore?: string | number | null;
  maxScore?: string | number | null;
  sourceTier?: string | null;
  readingTier?: string | null;
  growthAxis?: string | null;
  sortBy?: string | null;
  sourceId?: string | number | null;
  sourceType?: string | null;
  collectorType?: string | null;
  search?: string | null;
  category?: string | null;
  monitorOnly?: boolean | null;
  collapseEvents?: string | boolean | null;
};

export type NormalizedItemListQuery = {
  minScore: number | null;
  maxScore: number | null;
  sourceTier: string | null;
  readingTier: SourceReadingTierValue | null;
  growthAxis: string | null;
  sortBy: ItemListSortBy;
  collapseEvents: boolean;
};

export type FeedRecommendationRankInput = {
  title?: string | null;
  sourceName?: string | null;
  sourceType?: string | null;
  sourceCollectorType?: string | null;
  contentReadinessKind?: string | null;
  priorityScore?: number | null;
  fetchedAt?: string | Date | null;
};

function normalizeScore(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  return Math.round(score * 100) / 100;
}

export function normalizeItemListQuery(input: ItemListQueryInput = {}): NormalizedItemListQuery {
  const firstScore = normalizeScore(input.minScore);
  const secondScore = normalizeScore(input.maxScore);
  const minScore = firstScore != null && secondScore != null
    ? Math.min(firstScore, secondScore)
    : firstScore;
  const maxScore = firstScore != null && secondScore != null
    ? Math.max(firstScore, secondScore)
    : secondScore;
  const sortBy = input.sortBy === 'priority' || input.sortBy === 'score'
    ? input.sortBy
    : 'publishedAt';
  const sourceTier = String(input.sourceTier || '').trim().toUpperCase() || null;
  const readingTier = normalizeSourceReadingTier(input.readingTier);
  const growthAxis = String(input.growthAxis || '').trim() || null;
  const collapseEvents = input.collapseEvents === true || input.collapseEvents === 'true';

  return {
    minScore,
    maxScore,
    sourceTier,
    readingTier,
    growthAxis,
    sortBy,
    collapseEvents,
  };
}

export function isWebpageSnapshotLikeItem(item: Pick<
  FeedRecommendationRankInput,
  'title' | 'sourceName' | 'sourceType' | 'sourceCollectorType' | 'contentReadinessKind'
>): boolean {
  const sourceType = String(item.sourceType || '').toLowerCase();
  const collectorType = String(item.sourceCollectorType || '').toLowerCase();
  if (item.contentReadinessKind === 'snapshot') return true;
  if (sourceType === 'webpage') return true;
  const text = [
    item.title || '',
    item.sourceName || '',
  ].join('\n');
  if (/newsroom\s*\\\s*anthropic|newsroom\s*\|\s*anthropic/i.test(text)) return true;
  return collectorType === 'webpage' && /newsroom|press|support|download press kit/i.test(text);
}

export function rankFeedRecommendationItem(item: FeedRecommendationRankInput): number {
  const base = Number.isFinite(Number(item.priorityScore)) ? Number(item.priorityScore) : 0;
  const snapshotPenalty = isWebpageSnapshotLikeItem(item) ? 100 : 0;
  return base - snapshotPenalty;
}

export function shouldExcludeSnapshotLikeItemsFromDefaultFeed(input: Pick<
  ItemListQueryInput,
  'sourceId' | 'sourceType' | 'collectorType' | 'search' | 'category' | 'monitorOnly'
>): boolean {
  const sourceId = String(input.sourceId || '').trim();
  const sourceType = String(input.sourceType || '').trim();
  const collectorType = String(input.collectorType || '').trim();
  const search = String(input.search || '').trim();
  const category = String(input.category || '').trim().toLowerCase();
  const isMonitorCategory = category === '监控' || category === 'monitor';

  if (input.monitorOnly) return false;
  if (sourceId) return false;
  if (sourceType) return false;
  if (collectorType) return false;
  if (search) return false;
  if (isMonitorCategory) return false;
  return true;
}
