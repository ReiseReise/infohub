import { eq, and, gte, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { resolveRuleRoutingState } from '../lib/item-routing.js';
import { applyFilterRules } from './filter.js';

export async function calculatePriority(
  item: {
    aiScore?: number | null;
    publishedAt?: Date | null;
    sourceId: number;
  },
  ruleScoreAdjust = 0
): Promise<number> {
  const source = await db
    .select({
      priority: schema.sources.priority,
      sourceTier: schema.sources.sourceTier,
      sourceKind: schema.sources.sourceKind,
      authorityWeight: schema.sources.authorityWeight,
      trustScore: schema.sources.trustScore,
      noiseScore: schema.sources.noiseScore,
    })
    .from(schema.sources)
    .where(eq(schema.sources.id, item.sourceId))
    .limit(1);

  const sourcePriority = source[0]?.priority ?? 3;
  const trustScore = Math.max(0, Math.min(100, source[0]?.trustScore ?? 60));
  const noiseScore = Math.max(0, Math.min(100, source[0]?.noiseScore ?? 40));
  const tierBoost = (() => {
    switch (source[0]?.sourceTier) {
      case 'S':
      case 'T1':
        return 1.18;
      case 'A':
      case 'T1.5':
        return 1.08;
      case 'T2':
        return 0.98;
      case 'C':
        return 0.84;
      case 'D':
        return 0.7;
      default:
        return 1;
    }
  })();

  const relevance = Math.min(1, ((item.aiScore ?? 50) + ruleScoreAdjust) / 100);
  const authorityWeight = Math.max(0.35, Math.min(2, source[0]?.authorityWeight ?? 1));
  const credibility = Math.min(1, (((sourcePriority / 5) * 0.4) + ((trustScore / 100) * 0.6)) * tierBoost * authorityWeight);
  const noisePenalty = Math.max(0.45, 1 - (noiseScore / 140));

  const hoursAgo = item.publishedAt
    ? (Date.now() - new Date(item.publishedAt).getTime()) / 3600000
    : 24;
  const urgency = Math.exp(-0.05 * hoursAgo);

  const novelty = 0.7;

  const priority = ((relevance * 0.38) + (credibility * 0.24) + (novelty * 0.22) + (urgency * 0.16)) * noisePenalty;

  return Math.round(priority * 1000) / 1000;
}

export async function applyRulesAndPriority(
  itemId: string,
  userId: string,
): Promise<{ filtered: boolean; priorityScore: number | null; reason?: string }> {
  const rows = await db
    .select({
      id: schema.items.id,
      title: schema.items.title,
      content: schema.items.content,
      snippet: schema.items.snippet,
      contentStatus: schema.items.contentStatus,
      author: schema.items.author,
      language: schema.items.language,
      sourceId: schema.items.sourceId,
      aiScore: schema.items.aiScore,
      publishedAt: schema.items.publishedAt,
    })
    .from(schema.items)
    .where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)))
    .limit(1);

  if (rows.length === 0) {
    return { filtered: false, priorityScore: null, reason: 'item not found' };
  }

  const item = rows[0];
  const ruleResult = await applyFilterRules(item, userId, { includeAiScoreRules: true });
  const routing = resolveRuleRoutingState({
    passed: ruleResult.passed,
    reason: ruleResult.reason,
    contentStatus: item.contentStatus,
    aiScore: item.aiScore,
  });

  if (routing.priorityScoreMode === 'provisional') {
    const provisionalScore = await calculatePriority(item, 0);
    await db.update(schema.items).set({
      isFiltered: routing.isFiltered,
      filterBucket: routing.filterBucket,
      qualityDecision: routing.qualityDecision,
      filterReason: routing.filterReason,
      priorityScore: provisionalScore,
    }).where(eq(schema.items.id, itemId));
    return {
      filtered: routing.isFiltered,
      priorityScore: provisionalScore,
      reason: routing.filterReason ?? undefined,
    };
  }

  if (routing.priorityScoreMode === 'clear') {
    await db.update(schema.items).set({
      isFiltered: routing.isFiltered,
      filterBucket: routing.filterBucket,
      qualityDecision: routing.qualityDecision,
      filterReason: routing.filterReason,
      priorityScore: null,
    }).where(eq(schema.items.id, itemId));
    return {
      filtered: routing.isFiltered,
      priorityScore: null,
      reason: routing.filterReason ?? undefined,
    };
  }

  const score = await calculatePriority(item, ruleResult.scoreAdjust);
  await db.update(schema.items).set({
    isFiltered: routing.isFiltered,
    filterBucket: routing.filterBucket,
    qualityDecision: routing.qualityDecision,
    filterReason: routing.filterReason,
    priorityScore: score,
  }).where(eq(schema.items.id, itemId));
  return { filtered: false, priorityScore: score };
}

export async function batchUpdatePriority(userId: string, limit = 50): Promise<number> {
  const items = await db
    .select({
      id: schema.items.id,
    })
    .from(schema.items)
    .where(and(
      eq(schema.items.userId, userId),
      gte(schema.items.fetchedAt, new Date(Date.now() - 14 * 24 * 3600 * 1000))
    ))
    .limit(limit);

  let updated = 0;
  for (const item of items) {
    await applyRulesAndPriority(item.id, userId);
    updated++;
  }

  logger.info({ userId, updated }, 'Batch priority update complete');
  return updated;
}
