export type SourceQualityInput = {
  itemsFound?: number | null;
  itemsNew?: number | null;
  itemsDuplicate?: number | null;
  itemCount?: number | null;
  entryCount?: number | null;
  filteredCount?: number | null;
  contentReadyCount?: number | null;
  contentDegradedCount?: number | null;
  contentMissingCount?: number | null;
  qualityPassCount?: number | null;
  qualityReviewCount?: number | null;
  qualityFilterCount?: number | null;
  scoredCount?: number | null;
  summarizedCount?: number | null;
  translationCompletedCount?: number | null;
  reportSelectedCount?: number | null;
};

export type SourceQualityFunnel = {
  fetched: number;
  unique: number;
  duplicate: number;
  visible: number;
  filtered: number;
  contentReady: number;
  contentDegraded: number;
  contentMissing: number;
  qualityPass: number;
  qualityReview: number;
  qualityFilter: number;
  scored: number;
  summarized: number;
  translated: number;
  reportSelected: number;
  duplicateRate: number;
  contentReadyRate: number;
  aiReadyRate: number;
  noiseRate: number;
  reportSelectedRate: number;
  qualityScore: number;
  grade: SourceQualityGrade;
};

export type SourceQualityGrade = 'excellent' | 'good' | 'fair' | 'poor' | 'empty';

function asCount(value?: number | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed);
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number(Math.max(0, Math.min(1, numerator / denominator)).toFixed(3));
}

function computeNoiseRate(input: {
  itemCount: number;
  entryCount: number;
  filteredCount: number;
  qualityReview: number;
  qualityFilter: number;
}): number {
  if (input.itemCount === 0) return 0;
  if (input.entryCount > 0 && input.entryCount >= input.itemCount / 2) {
    return rate(input.filteredCount, input.entryCount);
  }
  return rate(input.qualityReview + input.qualityFilter, input.itemCount);
}

export function classifySourceQualityGrade(funnel: Pick<SourceQualityFunnel, 'qualityScore' | 'fetched'>): SourceQualityGrade {
  if (funnel.fetched === 0) return 'empty';
  if (funnel.qualityScore >= 85) return 'excellent';
  if (funnel.qualityScore >= 68) return 'good';
  if (funnel.qualityScore >= 40) return 'fair';
  return 'poor';
}

export function buildSourceQualityFunnel(input: SourceQualityInput): SourceQualityFunnel {
  const rawFetched = asCount(input.itemsFound);
  const unique = asCount(input.itemsNew) || asCount(input.itemCount);
  const fetched = Math.max(rawFetched, unique);
  const duplicate = Math.min(asCount(input.itemsDuplicate), Math.max(fetched - unique, 0));
  const itemCount = asCount(input.itemCount) || unique;
  const visible = asCount(input.entryCount);
  const filtered = asCount(input.filteredCount);
  const contentReady = asCount(input.contentReadyCount);
  const contentDegraded = asCount(input.contentDegradedCount);
  const contentMissing = asCount(input.contentMissingCount);
  const qualityPass = asCount(input.qualityPassCount);
  const qualityReview = asCount(input.qualityReviewCount);
  const qualityFilter = asCount(input.qualityFilterCount);
  const scored = asCount(input.scoredCount);
  const summarized = asCount(input.summarizedCount);
  const translated = asCount(input.translationCompletedCount);
  const reportSelected = asCount(input.reportSelectedCount);
  const denominator = Math.max(visible, 1);
  const contentReadyRate = rate(contentReady, denominator);
  const aiReadyRate = rate(scored + summarized + translated, denominator * 3);
  const noiseRate = computeNoiseRate({ itemCount, entryCount: visible, filteredCount: filtered, qualityReview, qualityFilter });
  const reportSelectedRate = rate(reportSelected, denominator);
  const duplicateRate = rate(duplicate, fetched);
  let qualityScore = Math.floor(
    contentReadyRate * 30
    + aiReadyRate * 30
    + (1 - noiseRate) * 30
    + reportSelectedRate * 10,
  );
  if (noiseRate >= 0.75) {
    qualityScore = Math.floor(qualityScore * 0.5);
  }
  if (fetched === 0 && itemCount === 0) qualityScore = 0;
  if (contentReadyRate === 1 && aiReadyRate === 1 && noiseRate === 0 && reportSelectedRate > 0) qualityScore = 100;

  const funnel: SourceQualityFunnel = {
    fetched,
    unique,
    duplicate,
    visible,
    filtered,
    contentReady,
    contentDegraded,
    contentMissing,
    qualityPass,
    qualityReview,
    qualityFilter,
    scored,
    summarized,
    translated,
    reportSelected,
    duplicateRate,
    contentReadyRate,
    aiReadyRate,
    noiseRate,
    reportSelectedRate,
    qualityScore: Math.max(0, Math.min(100, qualityScore)),
    grade: 'empty',
  };
  return {
    ...funnel,
    grade: classifySourceQualityGrade(funnel),
  };
}
