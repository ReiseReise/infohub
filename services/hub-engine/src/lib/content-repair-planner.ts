import {
  plainTextLength,
  trimMalformedFeedContinuation,
} from './content-extractor.js';

export type ContentRepairAction =
  | 'downgrade_short_readability'
  | 'trim_malformed_feed_continuation';

export type ContentRepairSeverity = 'high' | 'medium' | 'low';

export type ContentRepairCandidate = {
  id: string;
  title: string;
  sourceName?: string | null;
  sourceType?: string | null;
  sourceKind?: string | null;
  collectorType?: string | null;
  contentStatus?: string | null;
  readabilityStatus?: string | null;
  readabilityReason?: string | null;
  readabilityContent?: string | null;
  content?: string | null;
  snippet?: string | null;
  fetchedAt?: Date | string | null;
};

export type ContentRepairPatch = {
  readabilityStatus?: 'ready' | 'missing';
  readabilityReason?: string | null;
  readabilityContent?: string | null;
  contentStatus?: 'ready' | 'degraded' | 'missing';
  content?: string | null;
  snippet?: string | null;
  summaryStatus?: 'pending';
  summaryBasis?: null;
  summaryReason?: string;
  translationStatus?: 'pending';
  translationReason?: string;
  processingStatus?: 'raw';
};

export const MAX_CONTENT_REPAIR_APPLY_LIMIT = 50;

export type ContentRepairApplyOptions = {
  apply: boolean;
  itemId?: string | null;
  sourceId?: number | null;
  limit: number;
};

export type ContentRepairApplyValidation =
  | { ok: true }
  | { ok: false; reason: 'apply_requires_item_or_source_scope' }
  | { ok: false; reason: 'apply_limit_too_large'; maxLimit: number };

export type ContentRepairPlanItem = {
  itemId: string;
  title: string;
  sourceName: string | null;
  action: ContentRepairAction;
  severity: ContentRepairSeverity;
  reason: string;
  plannedPatch: ContentRepairPatch;
  metrics: {
    contentLength: number;
    snippetLength: number;
    readabilityLength: number;
    cleanedContentLength?: number;
    cleanedSnippetLength?: number;
  };
  fetchedAt?: Date | string | null;
};

export type ContentRepairPlanSummary = {
  total: number;
  byAction: Record<ContentRepairAction, number>;
  bySeverity: Record<ContentRepairSeverity, number>;
};

function trimField(value?: string | null): string | null | undefined {
  if (value == null) return undefined;
  if (!/\n?```#{1,6}/m.test(value)) return undefined;
  const cleaned = trimMalformedFeedContinuation(value);
  if (!cleaned || cleaned === value.trim()) return undefined;
  return cleaned;
}

function buildMalformedContinuationPlan(row: ContentRepairCandidate): ContentRepairPlanItem | null {
  const cleanedContent = trimField(row.content);
  const cleanedSnippet = trimField(row.snippet);
  const cleanedReadability = trimField(row.readabilityContent);
  if (cleanedContent === undefined && cleanedSnippet === undefined && cleanedReadability === undefined) {
    return null;
  }

  const plannedPatch: ContentRepairPatch = {};
  if (cleanedContent !== undefined) plannedPatch.content = cleanedContent;
  if (cleanedSnippet !== undefined) plannedPatch.snippet = cleanedSnippet;
  if (cleanedReadability !== undefined) plannedPatch.readabilityContent = cleanedReadability;

  return {
    itemId: row.id,
    title: row.title,
    sourceName: row.sourceName || null,
    action: 'trim_malformed_feed_continuation',
    severity: 'medium',
    reason: '检测到 RSS 短讯串台标记，建议截断后续错误拼接内容。',
    plannedPatch,
    metrics: {
      contentLength: plainTextLength(row.content || ''),
      snippetLength: plainTextLength(row.snippet || ''),
      readabilityLength: plainTextLength(row.readabilityContent || ''),
      cleanedContentLength: plannedPatch.content != null ? plainTextLength(plannedPatch.content) : undefined,
      cleanedSnippetLength: plannedPatch.snippet != null ? plainTextLength(plannedPatch.snippet) : undefined,
    },
    fetchedAt: row.fetchedAt,
  };
}

function contentStatusFromLength(length: number): 'ready' | 'degraded' | 'missing' {
  if (length >= 180) return 'ready';
  if (length > 0) return 'degraded';
  return 'missing';
}

function buildShortReadabilityPlan(row: ContentRepairCandidate): ContentRepairPlanItem | null {
  const readabilityLength = plainTextLength(row.readabilityContent || '');
  if (row.readabilityStatus !== 'ready' || readabilityLength >= 180) return null;

  return {
    itemId: row.id,
    title: row.title,
    sourceName: row.sourceName || null,
    action: 'downgrade_short_readability',
    severity: 'high',
    reason: 'readability_status 标记为 ready，但可读正文低于 180 字，容易造成假全文和坏翻译。',
    plannedPatch: {
      readabilityStatus: 'missing',
      readabilityReason: 'readability_too_short',
    },
    metrics: {
      contentLength: plainTextLength(row.content || ''),
      snippetLength: plainTextLength(row.snippet || ''),
      readabilityLength,
    },
    fetchedAt: row.fetchedAt,
  };
}

export function buildContentRepairPlan(rows: ContentRepairCandidate[]): ContentRepairPlanItem[] {
  const plan: ContentRepairPlanItem[] = [];
  for (const row of rows) {
    const shortReadability = buildShortReadabilityPlan(row);
    if (shortReadability) plan.push(shortReadability);

    const malformedContinuation = buildMalformedContinuationPlan(row);
    if (malformedContinuation) plan.push(malformedContinuation);
  }
  return plan;
}

export function summarizeContentRepairPlan(plan: ContentRepairPlanItem[]): ContentRepairPlanSummary {
  const byAction = {
    downgrade_short_readability: 0,
    trim_malformed_feed_continuation: 0,
  };
  const bySeverity = {
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const item of plan) {
    byAction[item.action] += 1;
    bySeverity[item.severity] += 1;
  }

  return {
    total: plan.length,
    byAction,
    bySeverity,
  };
}

export function validateContentRepairApplyOptions(options: ContentRepairApplyOptions): ContentRepairApplyValidation {
  if (!options.apply) return { ok: true };
  if (!options.itemId && !options.sourceId) {
    return { ok: false, reason: 'apply_requires_item_or_source_scope' };
  }
  if (!options.itemId && options.limit > MAX_CONTENT_REPAIR_APPLY_LIMIT) {
    return {
      ok: false,
      reason: 'apply_limit_too_large',
      maxLimit: MAX_CONTENT_REPAIR_APPLY_LIMIT,
    };
  }
  return { ok: true };
}

export function buildContentRepairApplyPatch(planItem: ContentRepairPlanItem): ContentRepairPatch {
  const patch: ContentRepairPatch = { ...planItem.plannedPatch };
  const changesContent = Object.prototype.hasOwnProperty.call(patch, 'content')
    || Object.prototype.hasOwnProperty.call(patch, 'snippet')
    || Object.prototype.hasOwnProperty.call(patch, 'readabilityContent')
    || Object.prototype.hasOwnProperty.call(patch, 'readabilityStatus');

  if (Object.prototype.hasOwnProperty.call(patch, 'content')) {
    patch.contentStatus = contentStatusFromLength(plainTextLength(patch.content || ''));
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'readabilityContent')) {
    const readabilityLength = plainTextLength(patch.readabilityContent || '');
    patch.readabilityStatus = readabilityLength >= 180 ? 'ready' : 'missing';
    patch.readabilityReason = readabilityLength >= 180 ? null : 'readability_too_short';
  }

  if (changesContent) {
    patch.summaryStatus = 'pending';
    patch.summaryBasis = null;
    patch.summaryReason = 'content_repaired';
    patch.translationStatus = 'pending';
    patch.translationReason = 'content_repaired';
    patch.processingStatus = 'raw';
  }

  return patch;
}
