import { eq, and, gte, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
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
        return 1.18;
      case 'A':
        return 1.08;
      case 'C':
        return 0.84;
      case 'D':
        return 0.7;
      default:
        return 1;
    }
  })();

  const relevance = Math.min(1, ((item.aiScore ?? 50) + ruleScoreAdjust) / 100);
  const credibility = Math.min(1, (((sourcePriority / 5) * 0.45) + ((trustScore / 100) * 0.55)) * tierBoost);
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
  if (!ruleResult.passed) {
    if (item.contentStatus !== 'ready') {
      const provisionalScore = item.aiScore != null ? await calculatePriority(item, 0) : null;
      await db.update(schema.items).set({
        isFiltered: false,
        filterReason: `待复核：${ruleResult.reason ?? '内容未完整，暂不自动过滤'}`,
        priorityScore: provisionalScore,
      }).where(eq(schema.items.id, itemId));
      return {
        filtered: false,
        priorityScore: provisionalScore,
        reason: `待复核：${ruleResult.reason ?? '内容未完整，暂不自动过滤'}`,
      };
    }
    await db.update(schema.items).set({
      isFiltered: true,
      filterReason: ruleResult.reason ?? null,
      priorityScore: null,
    }).where(eq(schema.items.id, itemId));
    return { filtered: true, priorityScore: null, reason: ruleResult.reason };
  }

  const score = await calculatePriority(item, ruleResult.scoreAdjust);
  await db.update(schema.items).set({
    isFiltered: false,
    filterReason: null,
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
