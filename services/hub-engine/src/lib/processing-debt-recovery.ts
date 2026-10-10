import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from './logger.js';
import { mainReadingSourceCondition, isReferenceSourceVisibleInMainReading } from './reference-source-visibility.js';
import { resolveSourceAiDailyBudget, type SourceAiBudgetInput } from './source-ai-budget.js';
import { qualityFilterItemsDetailed } from '../processors/quality-filter.js';
import { scoreItemsDetailed } from '../processors/ai-scorer.js';
import { summarizeItemsDetailed } from '../processors/ai-summarizer.js';
import { getEffectiveAiConfig } from './ai-configs.js';

const PROCESSING_DEBT_STATUSES = [
  'raw',
  'scored',
  'score_failed',
  'summary_failed',
  'translation_failed',
] as const;

export type ProcessingDebtCandidate = SourceAiBudgetInput & {
  id: string;
  sourceId: number;
  processingStatus: string | null;
  fetchedAt: Date | string | null;
  sourceRole?: string | null;
};

export type ProcessingDebtRecoveryOptions = {
  now?: Date;
  minAgeMs?: number;
  lookbackMs?: number;
  limit?: number;
  maxPerSource?: number;
  scoringEnabled?: boolean;
  summaryEnabled?: boolean;
  translationEnabled?: boolean;
};

export type ProcessingDebtRecoveryResult = {
  selected: number;
  itemIds: string[];
  quality: number;
  scored: number;
  summarized: number;
  translated: number;
  errors: Record<string, string[]>;
};

function asDate(value: Date | string | null): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function selectProcessingDebtRecoveryCandidates<T extends ProcessingDebtCandidate>(
  candidates: T[],
  options: Pick<ProcessingDebtRecoveryOptions, 'now' | 'minAgeMs' | 'lookbackMs' | 'limit' | 'maxPerSource'> = {},
): T[] {
  const now = options.now ?? new Date();
  const minAgeMs = Math.max(0, options.minAgeMs ?? 30 * 60 * 1000);
  const lookbackMs = Math.max(minAgeMs, options.lookbackMs ?? 72 * 60 * 60 * 1000);
  const limit = Math.max(0, options.limit ?? 5);
  const maxPerSource = Math.max(1, options.maxPerSource ?? 1);
  const cutoff = now.getTime() - minAgeMs;
  const windowStart = now.getTime() - lookbackMs;
  const perSource = new Map<number, number>();

  return candidates
    .filter((candidate) => {
      const fetchedAt = asDate(candidate.fetchedAt);
      if (!fetchedAt || fetchedAt.getTime() > cutoff || fetchedAt.getTime() < windowStart) return false;
      if (!PROCESSING_DEBT_STATUSES.includes(candidate.processingStatus as typeof PROCESSING_DEBT_STATUSES[number])) {
        return false;
      }
      if (!isReferenceSourceVisibleInMainReading({
        status: candidate.sourceStatus ?? candidate.status,
        sourceRole: candidate.sourceRole,
        config: candidate.sourceConfig ?? candidate.config,
      })) {
        return false;
      }
      return resolveSourceAiDailyBudget(candidate) > 0;
    })
    .sort((left, right) => {
      const leftTime = asDate(left.fetchedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightTime = asDate(right.fetchedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    })
    .filter((candidate) => {
      const used = perSource.get(candidate.sourceId) || 0;
      if (used >= maxPerSource) return false;
      perSource.set(candidate.sourceId, used + 1);
      return true;
    })
    .slice(0, limit);
}

function appendErrors(target: Record<string, string[]>, stage: string, errors: string[]) {
  if (errors.length === 0) return;
  target[stage] = [...new Set([...(target[stage] || []), ...errors])].slice(0, 3);
}

export function shouldBypassQualityGateForDebtRecovery(hasEffectiveQualityConfig: boolean) {
  return !hasEffectiveQualityConfig;
}

export async function recoverFormalProcessingDebt(
  userId: string,
  options: ProcessingDebtRecoveryOptions = {},
): Promise<ProcessingDebtRecoveryResult> {
  const now = options.now ?? new Date();
  const minAgeMs = Math.max(0, options.minAgeMs ?? 30 * 60 * 1000);
  const lookbackMs = Math.max(minAgeMs, options.lookbackMs ?? 72 * 60 * 60 * 1000);
  const limit = Math.max(0, options.limit ?? 5);
  const cutoff = new Date(now.getTime() - minAgeMs);
  const windowStart = new Date(now.getTime() - lookbackMs);

  const rows = await db
    .select({
      id: schema.items.id,
      sourceId: schema.items.sourceId,
      processingStatus: schema.items.processingStatus,
      fetchedAt: schema.items.fetchedAt,
      sourceName: schema.sources.name,
      sourceTier: schema.sources.sourceTier,
      collectorType: schema.sources.collectorType,
      sourceType: schema.sources.sourceType,
      sourceKind: schema.sources.sourceKind,
      category: schema.sources.category,
      sourceStatus: schema.sources.status,
      sourceAutoFetchEnabled: schema.sources.autoFetchEnabled,
      sourceTags: schema.sources.tags,
      sourceConfig: schema.sources.config,
      sourceRole: schema.sources.sourceRole,
    })
    .from(schema.items)
    .innerJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
    .where(and(
      eq(schema.items.userId, userId),
      eq(schema.items.isFiltered, false),
      inArray(schema.items.processingStatus, [...PROCESSING_DEBT_STATUSES]),
      eq(schema.sources.status, 'active'),
      gte(schema.items.fetchedAt, windowStart),
      lte(schema.items.fetchedAt, cutoff),
      mainReadingSourceCondition(),
    ))
    .orderBy(asc(schema.items.fetchedAt))
    .limit(Math.max(limit * 50, 200));

  const selected = selectProcessingDebtRecoveryCandidates(rows, {
    now,
    minAgeMs,
    lookbackMs,
    limit,
    maxPerSource: options.maxPerSource,
  });
  const itemIds = selected.map((item) => item.id);
  const result: ProcessingDebtRecoveryResult = {
    selected: itemIds.length,
    itemIds,
    quality: 0,
    scored: 0,
    summarized: 0,
    translated: 0,
    errors: {},
  };
  if (itemIds.length === 0) return result;

  const qualityConfig = await getEffectiveAiConfig(userId, 'quality_filter');
  if (qualityConfig) {
    const quality = await qualityFilterItemsDetailed(userId, itemIds.length, {
      itemIds,
      automatic: true,
      budgetExempt: true,
    });
    result.quality = quality.processed;
    appendErrors(result.errors, 'quality', quality.errors);
  }

  if (options.scoringEnabled !== false) {
    const scoring = await scoreItemsDetailed(userId, itemIds.length, {
      itemIds,
      automatic: true,
      budgetExempt: true,
      bypassQualityGate: shouldBypassQualityGateForDebtRecovery(Boolean(qualityConfig)),
    });
    result.scored = scoring.processed;
    appendErrors(result.errors, 'scoring', scoring.errors);
  }

  if (options.summaryEnabled !== false) {
    const summary = await summarizeItemsDetailed(userId, itemIds.length, {
      itemIds,
      automatic: true,
      budgetExempt: true,
    });
    result.summarized = summary.processed;
    appendErrors(result.errors, 'summary', summary.errors);
  }

  if (options.translationEnabled !== false) {
    const { enqueueItemTranslationJob } = await import('../scheduler/item-translation-jobs.js');
    for (const itemId of itemIds) {
      const queued = await enqueueItemTranslationJob({
        userId,
        itemId,
        mode: 'automatic',
        trigger: 'debt',
      });
      if (queued.enqueued) result.translated++;
    }
  }

  logger.info({
    userId,
    selected: result.selected,
    quality: result.quality,
    scored: result.scored,
    summarized: result.summarized,
    translated: result.translated,
    errorStages: Object.keys(result.errors),
  }, 'Formal processing debt recovery complete');

  return result;
}
