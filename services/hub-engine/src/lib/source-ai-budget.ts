import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { resolveDailyReportWindow } from '../outputs/daily-report-window.js';
import {
  resolveSourceReadingTier,
  type SourceReadingTierInput,
  type SourceReadingTierValue,
} from './source-reading-tier.js';

export const SOURCE_AI_DAILY_BUDGETS: Record<SourceReadingTierValue, number> = {
  high_value: 40,
  light_reading: 10,
  explore: 3,
  paused: 0,
};

export type SourceAiBudgetInput = SourceReadingTierInput & {
  sourceName?: string | null;
  sourceStatus?: string | null;
  sourceAutoFetchEnabled?: boolean | null;
  sourceTags?: unknown;
  sourceConfig?: unknown;
};

export type SourceAiBudgetCandidate = SourceAiBudgetInput & {
  id: string;
  sourceId: number;
  budgetExempt?: boolean;
};

export type SourceAiDailyUsageState = {
  windowStart: Date;
  windowEnd: Date;
  processedItemIds: Set<string>;
  processedBySource: Map<number, number>;
};

export type SourceAiBudgetSnapshot = {
  aiDailyBudget: number;
  aiProcessedToday: number;
  aiBudgetRemaining: number;
  aiBudgetWindowStart: string;
  aiBudgetWindowEnd: string;
};

function getConfigObject(config: unknown): Record<string, unknown> {
  return config && typeof config === 'object' && !Array.isArray(config)
    ? config as Record<string, unknown>
    : {};
}

export function normalizeSourceAiDailyBudget(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 200) return null;
  return parsed;
}

function toReadingTierInput(source: SourceAiBudgetInput): SourceReadingTierInput {
  return {
    name: source.sourceName ?? source.name,
    sourceTier: source.sourceTier,
    collectorType: source.collectorType,
    sourceType: source.sourceType,
    sourceKind: source.sourceKind,
    category: source.category,
    status: source.sourceStatus ?? source.status,
    autoFetchEnabled: source.sourceAutoFetchEnabled ?? source.autoFetchEnabled,
    tags: source.sourceTags ?? source.tags,
    config: source.sourceConfig ?? source.config,
  };
}

export function resolveSourceAiDailyBudget(source: SourceAiBudgetInput): number {
  const config = getConfigObject(source.sourceConfig ?? source.config);
  const configured = normalizeSourceAiDailyBudget(config.aiDailyBudget);
  if (configured !== null) return configured;
  const readingTier = resolveSourceReadingTier(toReadingTierInput(source)).value;
  return SOURCE_AI_DAILY_BUDGETS[readingTier];
}

export function selectAutomaticSourceAiCandidates<T extends SourceAiBudgetCandidate>(
  candidates: T[],
  usage: SourceAiDailyUsageState,
  limit: number,
): T[] {
  const selected: T[] = [];
  const selectedIds = new Set<string>();
  const projectedUsage = new Map(usage.processedBySource);

  for (const candidate of candidates) {
    if (selected.length >= Math.max(0, limit)) break;
    if (selectedIds.has(candidate.id)) continue;

    const alreadyProcessed = usage.processedItemIds.has(candidate.id);
    if (candidate.budgetExempt || alreadyProcessed) {
      selected.push(candidate);
      selectedIds.add(candidate.id);
      continue;
    }

    const budget = resolveSourceAiDailyBudget(candidate);
    const used = projectedUsage.get(candidate.sourceId) || 0;
    if (used >= budget) continue;

    selected.push(candidate);
    selectedIds.add(candidate.id);
    projectedUsage.set(candidate.sourceId, used + 1);
  }

  return selected;
}

export async function loadSourceAiDailyUsage(
  userId: string,
  now: Date = new Date(),
): Promise<SourceAiDailyUsageState> {
  const { dayStart, dayEnd } = resolveDailyReportWindow(now);
  const rows = await db.execute(sql`
    select distinct item.source_id, log.target_id
    from hub.ai_usage_logs log
    join hub.items item
      on item.user_id = log.user_id
     and item.id::text = log.target_id
    where log.user_id = ${userId}::uuid
      and log.created_at >= ${dayStart.toISOString()}::timestamptz
      and log.created_at < ${dayEnd.toISOString()}::timestamptz
      and log.scene_type in (
        'quality_filter',
        'feed_scoring',
        'feed_scoring_skill',
        'feed_summary',
        'feed_translation'
      )
  `) as Array<{ source_id: number | null; target_id: string | null }>;

  const processedItemIds = new Set<string>();
  const itemIdsBySource = new Map<number, Set<string>>();
  for (const row of rows) {
    const sourceId = Number(row.source_id);
    const itemId = String(row.target_id || '').trim();
    if (!Number.isInteger(sourceId) || !itemId) continue;
    processedItemIds.add(itemId);
    const ids = itemIdsBySource.get(sourceId) || new Set<string>();
    ids.add(itemId);
    itemIdsBySource.set(sourceId, ids);
  }

  return {
    windowStart: dayStart,
    windowEnd: dayEnd,
    processedItemIds,
    processedBySource: new Map(
      Array.from(itemIdsBySource.entries()).map(([sourceId, ids]) => [sourceId, ids.size]),
    ),
  };
}

export async function applyAutomaticSourceAiBudget<T extends SourceAiBudgetCandidate>(
  userId: string,
  candidates: T[],
  limit: number,
): Promise<T[]> {
  const usage = await loadSourceAiDailyUsage(userId);
  return selectAutomaticSourceAiCandidates(candidates, usage, limit);
}

export function buildSourceAiBudgetSnapshot(
  source: SourceAiBudgetInput,
  usage: SourceAiDailyUsageState,
  sourceId: number,
): SourceAiBudgetSnapshot {
  const aiDailyBudget = resolveSourceAiDailyBudget(source);
  const aiProcessedToday = usage.processedBySource.get(sourceId) || 0;
  return {
    aiDailyBudget,
    aiProcessedToday,
    aiBudgetRemaining: Math.max(0, aiDailyBudget - aiProcessedToday),
    aiBudgetWindowStart: usage.windowStart.toISOString(),
    aiBudgetWindowEnd: usage.windowEnd.toISOString(),
  };
}
