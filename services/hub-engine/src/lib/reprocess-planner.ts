import { resolveDailyReportWindow } from '../outputs/daily-report-window.js';

export type ReprocessStage = 'content' | 'quality' | 'scoring' | 'summary' | 'translation' | 'all';

export type NormalizedReprocessRequest = {
  stage: ReprocessStage;
  itemId: string | null;
  sourceId: number | null;
  limit: number;
  dateStart: Date | null;
  dateEnd: Date | null;
};

export type ReprocessCandidate = {
  id: string;
  sourceId: number;
  fetchedAt: Date | string | null;
  contentStatus?: string | null;
  contentLength?: number | null;
  snippetLength?: number | null;
  aiScore?: number | null;
  summaryBasis?: string | null;
  processingStatus?: string | null;
  summaryStatus?: string | null;
  translationStatus?: string | null;
  isFiltered?: boolean | null;
  filterBucket?: string | null;
  qualityTags?: unknown;
};

function normalizeStage(value: unknown): ReprocessStage {
  const stage = String(value || 'all').trim().toLowerCase();
  if (['content', 'quality', 'scoring', 'summary', 'translation', 'all'].includes(stage)) {
    return stage as ReprocessStage;
  }
  return 'all';
}

function normalizeDate(value: unknown): { start: Date | null; end: Date | null } {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { start: null, end: null };
  try {
    const window = resolveDailyReportWindow(raw);
    return { start: window.dayStart, end: window.dayEnd };
  } catch {
    return { start: null, end: null };
  }
}

export function normalizeReprocessRequest(input: Record<string, unknown> = {}): NormalizedReprocessRequest {
  const sourceId = Number(input.sourceId);
  const limit = Number(input.limit);
  const date = normalizeDate(input.date);
  const itemId = typeof input.itemId === 'string' && input.itemId.trim()
    ? input.itemId.trim()
    : null;
  return {
    stage: normalizeStage(input.stage),
    itemId,
    sourceId: Number.isInteger(sourceId) && sourceId > 0 ? sourceId : null,
    limit: itemId ? 1 : Math.max(1, Math.min(Number.isFinite(limit) ? Math.round(limit) : 20, 100)),
    dateStart: date.start,
    dateEnd: date.end,
  };
}

function parsedTime(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function stageMatches(candidate: ReprocessCandidate, stage: ReprocessStage): boolean {
  if (stage === 'all') {
    return stageMatches(candidate, 'content')
      || stageMatches(candidate, 'quality')
      || stageMatches(candidate, 'scoring')
      || stageMatches(candidate, 'summary')
      || stageMatches(candidate, 'translation');
  }
  if (stage === 'content') {
    if (candidate.contentStatus !== 'ready') return true;
    const contentLength = Number(candidate.contentLength ?? 0);
    const snippetLength = Number(candidate.snippetLength ?? 0);
    return contentLength > 0 && contentLength < 180 && snippetLength >= 24;
  }
  if (stage === 'quality') return candidate.qualityTags == null || candidate.processingStatus === 'raw';
  if (stage === 'scoring') return candidate.processingStatus === 'raw' || candidate.processingStatus === 'score_failed';
  if (stage === 'summary') {
    if (candidate.processingStatus === 'scored' || candidate.processingStatus === 'summary_failed' || candidate.summaryStatus === 'pending' || candidate.summaryStatus === 'failed') return true;
    return candidate.contentStatus === 'ready'
      && candidate.summaryStatus === 'ready'
      && candidate.summaryBasis != null
      && candidate.summaryBasis !== 'content'
      && Number(candidate.aiScore ?? 0) >= 40;
  }
  if (stage === 'translation') return candidate.processingStatus === 'translation_failed' || candidate.translationStatus === 'failed' || candidate.translationStatus === 'pending';
  return true;
}

export function shouldReprocessItem(candidate: ReprocessCandidate, request: NormalizedReprocessRequest): boolean {
  if (request.itemId && candidate.id !== request.itemId) return false;
  if (request.sourceId && candidate.sourceId !== request.sourceId) return false;
  const time = parsedTime(candidate.fetchedAt);
  if (request.dateStart && time < request.dateStart.getTime()) return false;
  if (request.dateEnd && time >= request.dateEnd.getTime()) return false;
  if (request.itemId) return true;
  return stageMatches(candidate, request.stage);
}

export function isHardRuleFiltered(candidate: Pick<ReprocessCandidate, 'qualityTags'>): boolean {
  return Array.isArray(candidate.qualityTags) && candidate.qualityTags.includes('硬规则过滤');
}

export function buildReprocessResetPatch(stage: ReprocessStage, hardRuleFiltered = false): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (stage === 'content' || stage === 'all') {
    patch.contentStatus = 'missing';
    patch.contentError = null;
    patch.blockedReason = null;
  }
  if ((stage === 'quality' || stage === 'all') && !hardRuleFiltered) {
    patch.qualityDecision = null;
    patch.qualitySummary = null;
    patch.qualityReason = null;
    patch.qualityTags = [];
    patch.qualityRiskFlags = [];
    patch.qualityScore = null;
    patch.qualityConfidence = null;
    patch.qualityCheckedAt = null;
    patch.processingStatus = 'raw';
  }
  if (stage === 'scoring' || stage === 'all') {
    patch.aiScore = null;
    patch.processingStatus = 'raw';
  }
  if (stage === 'summary' || stage === 'all') {
    patch.aiSummary = null;
    patch.aiTags = [];
    patch.summaryStatus = 'pending';
    patch.summaryBasis = null;
    patch.summaryReason = null;
    if (stage === 'summary') patch.processingStatus = 'scored';
  }
  if (stage === 'translation' || stage === 'all') {
    patch.aiTranslation = null;
    patch.translationStatus = 'pending';
    patch.translationReason = null;
    if (stage === 'translation') patch.processingStatus = 'summarized';
  }
  if (!hardRuleFiltered && (stage === 'quality' || stage === 'scoring' || stage === 'all')) {
    patch.isFiltered = false;
    patch.filterBucket = 'main';
    patch.filterReason = null;
  }
  return patch;
}
