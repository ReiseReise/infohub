import { Hono } from 'hono';
import { eq, and, desc, count, sql, gte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { parseOpml } from '../lib/opml-parser.js';
import { requireAuth } from '../lib/auth.js';
import { computeSourceFreshness } from '../lib/freshness.js';
import { deriveSourceProfile, normalizeGrowthAxes } from '../lib/growth.js';
import { deriveSourceContentStrategy, withDerivedSourceContentStrategy } from '../lib/source-content-strategy.js';
import { buildSourceFingerprint } from '../lib/source-normalization.js';
import { classifySourceKind, normalizeAuthorityWeight } from '../lib/aihot-governance.js';
import { buildSourceQualityFunnel, type SourceQualityFunnel } from '../lib/content-quality.js';
import { normalizeSourceReadingTier, resolveSourceReadingTier, type SourceReadingTierValue } from '../lib/source-reading-tier.js';
import {
  buildSourceAiBudgetSnapshot,
  loadSourceAiDailyUsage,
  normalizeSourceAiDailyBudget,
  resolveSourceAiDailyBudget,
} from '../lib/source-ai-budget.js';
import {
  buildSourceHealthSnapshot,
  type SourceHealthAiFailure,
  type SourceHealthFetchLog,
  type SourceHealthSnapshot,
  type SourceHealthStats,
} from '../lib/source-health.js';
import {
  classifySourceGovernance,
  normalizeSourceGovernanceRole,
  normalizeSourceTopicGroup,
} from '../lib/source-governance-classification.js';
import { mainReadingSourceCondition } from '../lib/reference-source-visibility.js';

const app = new Hono();

type SourceListSort = 'createdAt' | 'latest' | 'unread' | 'health' | 'name' | 'quality' | 'content' | 'ai' | 'noise' | 'readingTier';

type SourceOverview = {
  itemCount: number;
  entryCount: number;
  filteredCount: number;
  unreadCount: number;
  favoriteCount: number;
  selectedCount: number;
  selectedHitRate: number;
  duplicateContribution: number;
  contentReadyCount: number;
  contentDegradedCount: number;
  contentMissingCount: number;
  qualityPassCount: number;
  qualityReviewCount: number;
  qualityFilterCount: number;
  scoredCount: number;
  summarizedCount: number;
  translationCompletedCount: number;
  summaryFailedCount: number;
  translationFailedCount: number;
  titleOnlyCount: number;
  snippetOnlyCount: number;
  longReadRiskCount: number;
  averageContentLength: number;
  sourceQuality: SourceQualityFunnel;
  sourceHealth: SourceHealthSnapshot;
  latestItemTitle: string | null;
  latestItemUrl: string | null;
  latestItemAt: string | null;
  sourceHost: string | null;
  iconUrl: string | null;
};

function getConfigObject(config: unknown): Record<string, unknown> {
  return (config && typeof config === 'object') ? config as Record<string, unknown> : {};
}

function getSourceHost(config: Record<string, unknown>): string | null {
  const urlCandidates = [
    typeof config.htmlUrl === 'string' ? config.htmlUrl : null,
    typeof config.url === 'string' ? config.url : null,
    typeof config.endpoint === 'string' ? config.endpoint : null,
  ].filter((value): value is string => Boolean(value));

  for (const value of urlCandidates) {
    try {
      return new URL(value).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
  }
  return null;
}

function parseTimestampValue(value?: string | Date | null): number {
  if (!value) return 0;
  const parsed = value instanceof Date ? value : new Date(value);
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortSources<T extends {
  name?: string | null;
  createdAt?: string | Date | null;
  latestItemAt?: string | null;
  unreadCount?: number | null;
  healthScore?: number | null;
  sourceQuality?: SourceQualityFunnel | null;
  readingTier?: SourceReadingTierValue | string | null;
}>(rows: T[], sortBy: SourceListSort): T[] {
  return [...rows].sort((a, b) => {
    if (sortBy === 'name') {
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
    }
    if (sortBy === 'health') {
      const healthDiff = Number(b.healthScore || 0) - Number(a.healthScore || 0);
      if (healthDiff !== 0) return healthDiff;
    }
    if (sortBy === 'quality') {
      const scoreDiff = Number(b.sourceQuality?.qualityScore || 0) - Number(a.sourceQuality?.qualityScore || 0);
      if (scoreDiff !== 0) return scoreDiff;
    }
    if (sortBy === 'content') {
      const contentDiff = Number(b.sourceQuality?.contentReadyRate || 0) - Number(a.sourceQuality?.contentReadyRate || 0);
      if (contentDiff !== 0) return contentDiff;
    }
    if (sortBy === 'ai') {
      const aiDiff = Number(b.sourceQuality?.aiReadyRate || 0) - Number(a.sourceQuality?.aiReadyRate || 0);
      if (aiDiff !== 0) return aiDiff;
    }
    if (sortBy === 'noise') {
      const noiseDiff = Number(a.sourceQuality?.noiseRate || 0) - Number(b.sourceQuality?.noiseRate || 0);
      if (noiseDiff !== 0) return noiseDiff;
    }
    if (sortBy === 'readingTier') {
      const rank: Record<string, number> = { high_value: 4, light_reading: 3, explore: 2, paused: 1 };
      const diff = Number(rank[String(b.readingTier || '')] || 0) - Number(rank[String(a.readingTier || '')] || 0);
      if (diff !== 0) return diff;
    }
    if (sortBy === 'unread') {
      const unreadDiff = Number(b.unreadCount || 0) - Number(a.unreadCount || 0);
      if (unreadDiff !== 0) return unreadDiff;
    }
    if (sortBy === 'latest' || sortBy === 'unread' || sortBy === 'health') {
      const latestDiff = parseTimestampValue(b.latestItemAt) - parseTimestampValue(a.latestItemAt);
      if (latestDiff !== 0) return latestDiff;
    }
    return parseTimestampValue(b.createdAt) - parseTimestampValue(a.createdAt);
  });
}

function mapSourceResponse<T extends { config?: unknown; lastError?: string | null }>(row: T) {
  const config = getConfigObject(row.config);
  const contentStrategy = deriveSourceContentStrategy({
    contentStrategy: config.contentStrategy,
    collectorType: (row as { collectorType?: string | null }).collectorType,
    sourceType: (row as { sourceType?: string | null }).sourceType,
    sourceRole: (row as { sourceRole?: string | null }).sourceRole,
    processingProfile: (row as { processingProfile?: string | null }).processingProfile,
  });
  const freshness = computeSourceFreshness(row as Parameters<typeof computeSourceFreshness>[0]);
  const readingTier = resolveSourceReadingTier({
    ...(row as Record<string, unknown>),
    config,
  });
  const governance = classifySourceGovernance({
    ...(row as Record<string, unknown>),
    config,
  });
  return {
    ...row,
    ...governance,
    contentStrategy,
    growthAxes: normalizeGrowthAxes((row as { growthAxes?: unknown }).growthAxes, []),
    sourceHost: getSourceHost(config),
    iconUrl: typeof config.iconUrl === 'string' ? config.iconUrl : null,
    renderMode: typeof config.renderMode === 'string' ? config.renderMode : null,
    lastFetchEngine: typeof config.lastFetchEngine === 'string' ? config.lastFetchEngine : null,
    blockedReason: typeof config.lastBlockedReason === 'string' ? config.lastBlockedReason : (row.lastError || null),
    lastChangeSummary: typeof config.lastChangeSummary === 'string' ? config.lastChangeSummary : null,
    freshnessState: freshness.freshnessState,
    staleReason: freshness.staleReason,
    readingTier: readingTier.value,
    readingTierLabel: readingTier.label,
    readingTierReason: readingTier.reason,
    aiDailyBudget: resolveSourceAiDailyBudget({
      ...(row as Record<string, unknown>),
      sourceConfig: config,
    }),
  };
}

function emptySourceHealthStats(): SourceHealthStats {
  return {
    itemCount: 0,
    visibleCount: 0,
    filteredCount: 0,
    contentReadyCount: 0,
    contentDegradedCount: 0,
    contentMissingCount: 0,
    titleOnlyCount: 0,
    snippetOnlyCount: 0,
    longReadRiskCount: 0,
    scoredCount: 0,
    summaryReadyCount: 0,
    summaryFailedCount: 0,
    translationReadyCount: 0,
    translationFailedCount: 0,
    reportCandidateCount: 0,
    reportSelectedCount: 0,
    hotNotSelectedCount: 0,
    averageContentLength: 0,
  };
}

function stageFromScene(sceneType: string | null | undefined): SourceHealthAiFailure['stage'] {
  const scene = String(sceneType || '');
  if (scene.includes('summary')) return 'summary';
  if (scene.includes('translation')) return 'translation';
  if (scene.includes('scoring')) return 'score';
  if (scene.includes('quality')) return 'quality';
  return 'other';
}

function normalizeFetchLogRow(row: {
  status?: string | null;
  outcome?: string | null;
  started_at?: string | Date | null;
  finished_at?: string | Date | null;
  duration_ms?: number | null;
  items_found?: number | null;
  items_new?: number | null;
  items_filtered?: number | null;
  items_duplicate?: number | null;
  items_queued_ai?: number | null;
  error?: string | null;
}): SourceHealthFetchLog {
  return {
    status: row.status || null,
    outcome: row.outcome || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    durationMs: Number(row.duration_ms || 0),
    itemsFound: Number(row.items_found || 0),
    itemsNew: Number(row.items_new || 0),
    itemsFiltered: Number(row.items_filtered || 0),
    itemsDuplicate: Number(row.items_duplicate || 0),
    itemsQueuedAi: Number(row.items_queued_ai || 0),
    error: row.error || null,
  };
}

// GET /api/sources — 列表（支持分类/类型筛选）
app.get('/', async (c) => {
  const authUser = requireAuth(c);
  const category = c.req.query('category');
  const sourceType = c.req.query('sourceType');
  const sourceRole = c.req.query('sourceRole');
  const status = c.req.query('status') || 'active';
  const includeReferenceSources = c.req.query('includeReferenceSources') === 'true';
  const readingTier = normalizeSourceReadingTier(c.req.query('readingTier'));
  const sortBy = (c.req.query('sortBy') || 'createdAt') as SourceListSort;

  const conditions = [eq(schema.sources.userId, authUser.userId)];
  if (category) conditions.push(eq(schema.sources.category, category));
  if (sourceType) conditions.push(eq(schema.sources.sourceType, sourceType));
  if (sourceRole) conditions.push(eq(schema.sources.sourceRole, sourceRole));
  if (status !== 'all') conditions.push(eq(schema.sources.status, status));
  if (!includeReferenceSources) conditions.push(mainReadingSourceCondition());

  const rows = await db
    .select()
    .from(schema.sources)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.sources.createdAt));

  const aiBudgetUsage = await loadSourceAiDailyUsage(authUser.userId);

  const itemStatsRows = await db
    .select({
      sourceId: schema.items.sourceId,
      itemCount: sql<number>`count(*)`,
      entryCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false then 1 else 0 end)`,
      filteredCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'filtered' or ${schema.items.isFiltered} = true then 1 else 0 end)`,
      unreadCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isRead} = false and ${schema.items.isFiltered} = false then 1 else 0 end)`,
      favoriteCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFavorite} = true and ${schema.items.isFiltered} = false then 1 else 0 end)`,
      selectedCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and (coalesce(${schema.items.aiScore}, 0) >= 70 or coalesce(${schema.items.priorityScore}, 0) >= 0.7) then 1 else 0 end)`,
      contentReadyCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and ${schema.items.contentStatus} = 'ready' and coalesce(length(trim(${schema.items.content})), 0) >= 180 then 1 else 0 end)`,
      contentDegradedCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and (${schema.items.contentStatus} = 'degraded' or (${schema.items.contentStatus} = 'ready' and coalesce(length(trim(${schema.items.content})), 0) < 180 and coalesce(length(trim(${schema.items.snippet})), 0) >= 24)) then 1 else 0 end)`,
      contentMissingCount: sql<number>`sum(case when ${schema.items.contentStatus} in ('missing', 'failed', 'unavailable') then 1 else 0 end)`,
      titleOnlyCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and coalesce(length(trim(${schema.items.content})), 0) = 0 and coalesce(length(trim(${schema.items.snippet})), 0) = 0 then 1 else 0 end)`,
      snippetOnlyCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and coalesce(length(trim(${schema.items.content})), 0) < 180 and coalesce(length(trim(${schema.items.snippet})), 0) >= 24 then 1 else 0 end)`,
      longReadRiskCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and coalesce(length(trim(${schema.items.content})), 0) >= 1800 and (${schema.items.content} like '%<p>%' or ${schema.items.content} like '%</li>%') then 1 else 0 end)`,
      averageContentLength: sql<number>`coalesce(avg(nullif(length(trim(coalesce(${schema.items.content}, ''))), 0)), 0)::int`,
      qualityPassCount: sql<number>`sum(case when ${schema.items.qualityDecision} = 'pass' then 1 else 0 end)`,
      qualityReviewCount: sql<number>`sum(case when ${schema.items.qualityDecision} = 'review' then 1 else 0 end)`,
      qualityFilterCount: sql<number>`sum(case when ${schema.items.qualityDecision} = 'filter' then 1 else 0 end)`,
      scoredCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and ${schema.items.aiScore} is not null then 1 else 0 end)`,
      summarizedCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and (${schema.items.summaryStatus} = 'ready' or coalesce(length(trim(${schema.items.aiSummary})), 0) > 0) then 1 else 0 end)`,
      summaryFailedCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and (${schema.items.summaryStatus} = 'failed' or ${schema.items.processingStatus} = 'summary_failed') and coalesce(length(trim(${schema.items.aiSummary})), 0) = 0 then 1 else 0 end)`,
      translationCompletedCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and ${schema.items.translationStatus} in ('ready', 'skipped') then 1 else 0 end)`,
      translationFailedCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and ${schema.items.translationStatus} = 'failed' and coalesce(length(trim(${schema.items.aiTranslation})), 0) = 0 then 1 else 0 end)`,
    })
    .from(schema.items)
    .where(eq(schema.items.userId, authUser.userId))
    .groupBy(schema.items.sourceId);

  const latestItemRows = await db.execute(sql`
    select distinct on (source_id)
      source_id,
      title,
      url,
      coalesce(published_at, fetched_at) as latest_item_at
    from hub.items
    where user_id = ${authUser.userId}::uuid
      and filter_bucket = 'main'
      and is_filtered = false
    order by source_id, coalesce(published_at, fetched_at) desc nulls last, fetched_at desc nulls last
  `) as Array<{
    source_id: number;
    title: string | null;
    url: string | null;
    latest_item_at: string | null;
  }>;

  const fetchLogRows = await db
    .select({
      sourceId: schema.fetchLogs.sourceId,
      itemsFound: sql<number>`sum(coalesce(${schema.fetchLogs.itemsFound}, 0))`,
      itemsNew: sql<number>`sum(coalesce(${schema.fetchLogs.itemsNew}, 0))`,
      itemsFiltered: sql<number>`sum(coalesce(${schema.fetchLogs.itemsFiltered}, 0))`,
      itemsDuplicate: sql<number>`sum(coalesce(${schema.fetchLogs.itemsDuplicate}, 0))`,
    })
    .from(schema.fetchLogs)
    .where(gte(schema.fetchLogs.startedAt, new Date(Date.now() - 14 * 24 * 3600 * 1000)))
    .groupBy(schema.fetchLogs.sourceId);

  const recentFetchLogRows = await db.execute(sql`
    select *
    from (
      select
        log.source_id,
        log.status,
        log.outcome,
        log.started_at,
        log.finished_at,
        log.duration_ms,
        log.items_found,
        log.items_new,
        log.items_filtered,
        log.items_duplicate,
        log.items_queued_ai,
        log.error,
        row_number() over (partition by log.source_id order by log.started_at desc) as rn
      from hub.fetch_logs log
      join hub.sources src on src.id = log.source_id
      where log.started_at >= now() - interval '14 days'
        and src.user_id = ${authUser.userId}::uuid
    ) ranked
    where rn <= 5
    order by source_id, started_at desc
  `) as Array<{
    source_id: number | null;
    status: string | null;
    outcome: string | null;
    started_at: string | Date | null;
    finished_at: string | Date | null;
    duration_ms: number | null;
    items_found: number | null;
    items_new: number | null;
    items_filtered: number | null;
    items_duplicate: number | null;
    items_queued_ai: number | null;
    error: string | null;
  }>;

  const aiFailureRows = await db.execute(sql`
    select
      item.source_id,
      log.scene_type,
      coalesce(log.error_message, item.summary_reason, item.translation_reason, item.content_error, 'unknown_error') as reason,
      count(*)::int as count
    from hub.items item
    join hub.ai_usage_logs log
      on log.user_id = item.user_id
     and log.target_id = item.id::text
    where item.user_id = ${authUser.userId}::uuid
      and item.filter_bucket = 'main'
      and item.is_filtered = false
      and log.status = 'error'
      and log.created_at >= now() - interval '14 days'
      and (
        (log.scene_type like '%summary%' and coalesce(length(trim(item.ai_summary)), 0) = 0 and item.summary_status <> 'skipped')
        or (log.scene_type like '%translation%' and coalesce(length(trim(item.ai_translation)), 0) = 0 and item.translation_status not in ('ready', 'skipped'))
        or (log.scene_type like '%scoring%' and item.ai_score is null)
        or (log.scene_type like '%quality%' and item.quality_decision is null)
        or (
          log.scene_type not like '%summary%'
          and log.scene_type not like '%translation%'
          and log.scene_type not like '%scoring%'
          and log.scene_type not like '%quality%'
        )
      )
    group by item.source_id, log.scene_type, coalesce(log.error_message, item.summary_reason, item.translation_reason, item.content_error, 'unknown_error')
  `) as Array<{
    source_id: number | null;
    scene_type: string | null;
    reason: string | null;
    count: number | null;
  }>;

  const fetchLogMap = new Map<number, { itemsFound: number; itemsNew: number; itemsFiltered: number; itemsDuplicate: number }>();
  for (const row of fetchLogRows) {
    if (row.sourceId == null) continue;
    fetchLogMap.set(row.sourceId, {
      itemsFound: Number(row.itemsFound || 0),
      itemsNew: Number(row.itemsNew || 0),
      itemsFiltered: Number(row.itemsFiltered || 0),
      itemsDuplicate: Number(row.itemsDuplicate || 0),
    });
  }

  const statsMap = new Map<number, Pick<SourceOverview,
    'itemCount' | 'entryCount' | 'filteredCount' | 'unreadCount' | 'favoriteCount' | 'selectedCount' | 'selectedHitRate'
    | 'contentReadyCount' | 'contentDegradedCount' | 'contentMissingCount'
    | 'qualityPassCount' | 'qualityReviewCount' | 'qualityFilterCount'
    | 'scoredCount' | 'summarizedCount' | 'translationCompletedCount'
    | 'summaryFailedCount' | 'translationFailedCount' | 'titleOnlyCount' | 'snippetOnlyCount' | 'longReadRiskCount'
    | 'averageContentLength' | 'sourceQuality'
  >>();
  for (const row of itemStatsRows) {
    const entryCount = Number(row.entryCount || 0);
    const selectedCount = Number(row.selectedCount || 0);
    const fetchLog = fetchLogMap.get(row.sourceId) || { itemsFound: 0, itemsNew: 0, itemsFiltered: 0, itemsDuplicate: 0 };
    const sourceQuality = buildSourceQualityFunnel({
      ...fetchLog,
      itemCount: Number(row.itemCount || 0),
      entryCount,
      filteredCount: Number(row.filteredCount || 0),
      contentReadyCount: Number(row.contentReadyCount || 0),
      contentDegradedCount: Number(row.contentDegradedCount || 0),
      contentMissingCount: Number(row.contentMissingCount || 0),
      qualityPassCount: Number(row.qualityPassCount || 0),
      qualityReviewCount: Number(row.qualityReviewCount || 0),
      qualityFilterCount: Number(row.qualityFilterCount || 0),
      scoredCount: Number(row.scoredCount || 0),
      summarizedCount: Number(row.summarizedCount || 0),
      translationCompletedCount: Number(row.translationCompletedCount || 0),
      reportSelectedCount: selectedCount,
    });
    statsMap.set(row.sourceId, {
      itemCount: Number(row.itemCount || 0),
      entryCount,
      filteredCount: Number(row.filteredCount || 0),
      unreadCount: Number(row.unreadCount || 0),
      favoriteCount: Number(row.favoriteCount || 0),
      selectedCount,
      selectedHitRate: entryCount > 0 ? Number((selectedCount / entryCount).toFixed(3)) : 0,
      contentReadyCount: Number(row.contentReadyCount || 0),
      contentDegradedCount: Number(row.contentDegradedCount || 0),
      contentMissingCount: Number(row.contentMissingCount || 0),
      titleOnlyCount: Number(row.titleOnlyCount || 0),
      snippetOnlyCount: Number(row.snippetOnlyCount || 0),
      longReadRiskCount: Number(row.longReadRiskCount || 0),
      averageContentLength: Number(row.averageContentLength || 0),
      qualityPassCount: Number(row.qualityPassCount || 0),
      qualityReviewCount: Number(row.qualityReviewCount || 0),
      qualityFilterCount: Number(row.qualityFilterCount || 0),
      scoredCount: Number(row.scoredCount || 0),
      summarizedCount: Number(row.summarizedCount || 0),
      translationCompletedCount: Number(row.translationCompletedCount || 0),
      summaryFailedCount: Number(row.summaryFailedCount || 0),
      translationFailedCount: Number(row.translationFailedCount || 0),
      sourceQuality,
    });
  }

  const recentFetchLogMap = new Map<number, SourceHealthFetchLog[]>();
  for (const row of recentFetchLogRows) {
    if (row.source_id == null) continue;
    const list = recentFetchLogMap.get(row.source_id) || [];
    list.push(normalizeFetchLogRow(row));
    recentFetchLogMap.set(row.source_id, list);
  }

  const aiFailureMap = new Map<number, SourceHealthAiFailure[]>();
  for (const row of aiFailureRows) {
    if (row.source_id == null) continue;
    const list = aiFailureMap.get(row.source_id) || [];
    list.push({
      stage: stageFromScene(row.scene_type),
      reason: row.reason || 'unknown_error',
      count: Number(row.count || 0),
    });
    aiFailureMap.set(row.source_id, list);
  }

  const duplicateMap = new Map<number, number>();
  for (const row of fetchLogRows) {
    if (row.sourceId == null) continue;
    const found = Number(row.itemsFound || 0);
    const duplicate = Number(row.itemsDuplicate || 0);
    duplicateMap.set(row.sourceId, found > 0 ? Number(Math.min(1, Math.max(0, duplicate / found)).toFixed(3)) : 0);
  }

  const latestMap = new Map<number, Pick<SourceOverview, 'latestItemTitle' | 'latestItemUrl' | 'latestItemAt'>>();
  for (const row of latestItemRows) {
    latestMap.set(Number(row.source_id), {
      latestItemTitle: row.title || null,
      latestItemUrl: row.url || null,
      latestItemAt: row.latest_item_at || null,
    });
  }

  const enriched = rows.map((row) => {
    const base = mapSourceResponse(row);
    const sourceStats = statsMap.get(row.id);
    const latest = latestMap.get(row.id);
    const healthStats = sourceStats
      ? {
        itemCount: sourceStats.itemCount,
        visibleCount: sourceStats.entryCount,
        filteredCount: sourceStats.filteredCount,
        contentReadyCount: sourceStats.contentReadyCount,
        contentDegradedCount: sourceStats.contentDegradedCount,
        contentMissingCount: sourceStats.contentMissingCount,
        titleOnlyCount: sourceStats.titleOnlyCount,
        snippetOnlyCount: sourceStats.snippetOnlyCount,
        longReadRiskCount: sourceStats.longReadRiskCount,
        scoredCount: sourceStats.scoredCount,
        summaryReadyCount: sourceStats.summarizedCount,
        summaryFailedCount: sourceStats.summaryFailedCount,
        translationReadyCount: sourceStats.translationCompletedCount,
        translationFailedCount: sourceStats.translationFailedCount,
        reportCandidateCount: sourceStats.selectedCount,
        reportSelectedCount: sourceStats.selectedCount,
        hotNotSelectedCount: 0,
        averageContentLength: sourceStats.averageContentLength,
      }
      : emptySourceHealthStats();
    const sourceHealth = buildSourceHealthSnapshot({
      source: { ...row, config: getConfigObject(row.config) },
      fetchLogs: recentFetchLogMap.get(row.id) || [],
      stats: healthStats,
      aiFailures: aiFailureMap.get(row.id) || [],
    });
    return {
      ...base,
      ...buildSourceAiBudgetSnapshot({
        ...row,
        sourceConfig: row.config,
      }, aiBudgetUsage, row.id),
      itemCount: sourceStats?.itemCount || 0,
      entryCount: sourceStats?.entryCount || 0,
      filteredCount: sourceStats?.filteredCount || 0,
      unreadCount: sourceStats?.unreadCount || 0,
      favoriteCount: sourceStats?.favoriteCount || 0,
      selectedCount: sourceStats?.selectedCount || 0,
      selectedHitRate: sourceStats?.selectedHitRate || 0,
      contentReadyCount: sourceStats?.contentReadyCount || 0,
      contentDegradedCount: sourceStats?.contentDegradedCount || 0,
      contentMissingCount: sourceStats?.contentMissingCount || 0,
      titleOnlyCount: sourceStats?.titleOnlyCount || 0,
      snippetOnlyCount: sourceStats?.snippetOnlyCount || 0,
      longReadRiskCount: sourceStats?.longReadRiskCount || 0,
      averageContentLength: sourceStats?.averageContentLength || 0,
      qualityPassCount: sourceStats?.qualityPassCount || 0,
      qualityReviewCount: sourceStats?.qualityReviewCount || 0,
      qualityFilterCount: sourceStats?.qualityFilterCount || 0,
      scoredCount: sourceStats?.scoredCount || 0,
      summarizedCount: sourceStats?.summarizedCount || 0,
      translationCompletedCount: sourceStats?.translationCompletedCount || 0,
      summaryFailedCount: sourceStats?.summaryFailedCount || 0,
      translationFailedCount: sourceStats?.translationFailedCount || 0,
      sourceQuality: sourceStats?.sourceQuality || buildSourceQualityFunnel({}),
      sourceHealth,
      healthStatus: sourceHealth.healthStatus,
      healthReasons: sourceHealth.healthReasons,
      stageHealth: sourceHealth.stageHealth,
      recommendedActions: sourceHealth.recommendedActions,
      duplicateContribution: sourceStats?.sourceQuality.duplicateRate ?? duplicateMap.get(row.id) ?? 0,
      latestItemTitle: latest?.latestItemTitle || null,
      latestItemUrl: latest?.latestItemUrl || null,
      latestItemAt: latest?.latestItemAt || null,
    };
  });

  const filtered = readingTier
    ? enriched.filter((source) => source.readingTier === readingTier)
    : enriched;

  return c.json({ data: sortSources(filtered, sortBy), total: filtered.length });
});

// GET /api/sources/:id/health — 单源全链路健康诊断
app.get('/:id/health', async (c) => {
  const authUser = requireAuth(c);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) {
    return c.json({ error: 'Invalid source id' }, 400);
  }

  const sourceRows = await db
    .select()
    .from(schema.sources)
    .where(and(eq(schema.sources.id, id), eq(schema.sources.userId, authUser.userId)))
    .limit(1);

  const source = sourceRows[0];
  if (!source) {
    return c.json({ error: 'Source not found' }, 404);
  }

  const statsRows = await db
    .select({
      itemCount: sql<number>`count(*)`,
      visibleCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false then 1 else 0 end)`,
      filteredCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'filtered' or ${schema.items.isFiltered} = true then 1 else 0 end)`,
      contentReadyCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and ${schema.items.contentStatus} = 'ready' and coalesce(length(trim(${schema.items.content})), 0) >= 180 then 1 else 0 end)`,
      contentDegradedCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and (${schema.items.contentStatus} = 'degraded' or (${schema.items.contentStatus} = 'ready' and coalesce(length(trim(${schema.items.content})), 0) < 180 and coalesce(length(trim(${schema.items.snippet})), 0) >= 24)) then 1 else 0 end)`,
      contentMissingCount: sql<number>`sum(case when ${schema.items.contentStatus} in ('missing', 'failed', 'unavailable') then 1 else 0 end)`,
      titleOnlyCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and coalesce(length(trim(${schema.items.content})), 0) = 0 and coalesce(length(trim(${schema.items.snippet})), 0) = 0 then 1 else 0 end)`,
      snippetOnlyCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and coalesce(length(trim(${schema.items.content})), 0) < 180 and coalesce(length(trim(${schema.items.snippet})), 0) >= 24 then 1 else 0 end)`,
      longReadRiskCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and coalesce(length(trim(${schema.items.content})), 0) >= 1800 and (${schema.items.content} like '%<p>%' or ${schema.items.content} like '%</li>%') then 1 else 0 end)`,
      scoredCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and ${schema.items.aiScore} is not null then 1 else 0 end)`,
      summaryReadyCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and (${schema.items.summaryStatus} = 'ready' or coalesce(length(trim(${schema.items.aiSummary})), 0) > 0) then 1 else 0 end)`,
      summaryFailedCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and (${schema.items.summaryStatus} = 'failed' or ${schema.items.processingStatus} = 'summary_failed') and coalesce(length(trim(${schema.items.aiSummary})), 0) = 0 then 1 else 0 end)`,
      translationReadyCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and ${schema.items.translationStatus} in ('ready', 'skipped') then 1 else 0 end)`,
      translationFailedCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and ${schema.items.translationStatus} = 'failed' and coalesce(length(trim(${schema.items.aiTranslation})), 0) = 0 then 1 else 0 end)`,
      reportCandidateCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and (coalesce(${schema.items.aiScore}, 0) >= 70 or coalesce(${schema.items.priorityScore}, 0) >= 0.7) then 1 else 0 end)`,
      reportSelectedCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and (coalesce(${schema.items.aiScore}, 0) >= 70 or coalesce(${schema.items.priorityScore}, 0) >= 0.7) then 1 else 0 end)`,
      hotNotSelectedCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and ${schema.items.aiScore} is null and (${schema.items.title} ~* '(Claude|Anthropic|OpenAI|Gemini|模型|model release|新模型)' or coalesce(${schema.items.snippet}, '') ~* '(Claude|Anthropic|OpenAI|Gemini|模型|model release|新模型)') then 1 else 0 end)`,
      averageContentLength: sql<number>`coalesce(avg(nullif(length(trim(coalesce(${schema.items.content}, ''))), 0)), 0)::int`,
    })
    .from(schema.items)
    .where(and(eq(schema.items.userId, authUser.userId), eq(schema.items.sourceId, id)));

  const recentLogs = await db
    .select({
      status: schema.fetchLogs.status,
      outcome: schema.fetchLogs.outcome,
      startedAt: schema.fetchLogs.startedAt,
      finishedAt: schema.fetchLogs.finishedAt,
      durationMs: schema.fetchLogs.durationMs,
      itemsFound: schema.fetchLogs.itemsFound,
      itemsNew: schema.fetchLogs.itemsNew,
      itemsFiltered: schema.fetchLogs.itemsFiltered,
      itemsDuplicate: schema.fetchLogs.itemsDuplicate,
      itemsQueuedAi: schema.fetchLogs.itemsQueuedAi,
      error: schema.fetchLogs.error,
    })
    .from(schema.fetchLogs)
    .where(eq(schema.fetchLogs.sourceId, id))
    .orderBy(desc(schema.fetchLogs.startedAt))
    .limit(5);

  const aiFailureRowsForSource = await db.execute(sql`
    select
      log.scene_type,
      coalesce(log.error_message, item.summary_reason, item.translation_reason, item.content_error, 'unknown_error') as reason,
      count(*)::int as count
    from hub.items item
    join hub.ai_usage_logs log
      on log.user_id = item.user_id
     and log.target_id = item.id::text
    where item.user_id = ${authUser.userId}::uuid
      and item.source_id = ${id}
      and item.filter_bucket = 'main'
      and item.is_filtered = false
      and log.status = 'error'
      and log.created_at >= now() - interval '14 days'
      and (
        (log.scene_type like '%summary%' and coalesce(length(trim(item.ai_summary)), 0) = 0 and item.summary_status <> 'skipped')
        or (log.scene_type like '%translation%' and coalesce(length(trim(item.ai_translation)), 0) = 0 and item.translation_status not in ('ready', 'skipped'))
        or (log.scene_type like '%scoring%' and item.ai_score is null)
        or (log.scene_type like '%quality%' and item.quality_decision is null)
        or (
          log.scene_type not like '%summary%'
          and log.scene_type not like '%translation%'
          and log.scene_type not like '%scoring%'
          and log.scene_type not like '%quality%'
        )
      )
    group by log.scene_type, coalesce(log.error_message, item.summary_reason, item.translation_reason, item.content_error, 'unknown_error')
  `) as Array<{ scene_type: string | null; reason: string | null; count: number | null }>;

  const row = statsRows[0];
  const stats: SourceHealthStats = row
    ? {
      itemCount: Number(row.itemCount || 0),
      visibleCount: Number(row.visibleCount || 0),
      filteredCount: Number(row.filteredCount || 0),
      contentReadyCount: Number(row.contentReadyCount || 0),
      contentDegradedCount: Number(row.contentDegradedCount || 0),
      contentMissingCount: Number(row.contentMissingCount || 0),
      titleOnlyCount: Number(row.titleOnlyCount || 0),
      snippetOnlyCount: Number(row.snippetOnlyCount || 0),
      longReadRiskCount: Number(row.longReadRiskCount || 0),
      scoredCount: Number(row.scoredCount || 0),
      summaryReadyCount: Number(row.summaryReadyCount || 0),
      summaryFailedCount: Number(row.summaryFailedCount || 0),
      translationReadyCount: Number(row.translationReadyCount || 0),
      translationFailedCount: Number(row.translationFailedCount || 0),
      reportCandidateCount: Number(row.reportCandidateCount || 0),
      reportSelectedCount: Number(row.reportSelectedCount || 0),
      hotNotSelectedCount: Number(row.hotNotSelectedCount || 0),
      averageContentLength: Number(row.averageContentLength || 0),
    }
    : emptySourceHealthStats();
  const sourceHealth = buildSourceHealthSnapshot({
    source: { ...source, config: getConfigObject(source.config) },
    fetchLogs: recentLogs,
    stats,
    aiFailures: aiFailureRowsForSource.map((failure) => ({
      stage: stageFromScene(failure.scene_type),
      reason: failure.reason || 'unknown_error',
      count: Number(failure.count || 0),
    })),
  });
  const aiBudgetUsage = await loadSourceAiDailyUsage(authUser.userId);

  return c.json({
    data: {
      source: {
        ...mapSourceResponse(source),
        ...buildSourceAiBudgetSnapshot({
          ...source,
          sourceConfig: source.config,
        }, aiBudgetUsage, source.id),
      },
      stats,
      ...sourceHealth,
    },
  });
});

// GET /api/sources/categories — 分类列表
app.get('/categories', async (c) => {
  const authUser = requireAuth(c);
  const rows = await db
    .select({ category: schema.sources.category, count: count() })
    .from(schema.sources)
    .where(eq(schema.sources.userId, authUser.userId))
    .groupBy(schema.sources.category)
    .orderBy(schema.sources.category);

  return c.json({ data: rows });
});

// GET /api/sources/stats — 统计
app.get('/stats', async (c) => {
  const authUser = requireAuth(c);
  const total = await db.select({ count: count() }).from(schema.sources).where(eq(schema.sources.userId, authUser.userId));
  const byStatus = await db
    .select({ status: schema.sources.status, count: count() })
    .from(schema.sources)
    .where(eq(schema.sources.userId, authUser.userId))
    .groupBy(schema.sources.status);
  const byType = await db
    .select({ sourceType: schema.sources.sourceType, count: count() })
    .from(schema.sources)
    .where(eq(schema.sources.userId, authUser.userId))
    .groupBy(schema.sources.sourceType);
  const byCategory = await db
    .select({ category: schema.sources.category, count: count() })
    .from(schema.sources)
    .where(eq(schema.sources.userId, authUser.userId))
    .groupBy(schema.sources.category);
  const byTier = await db
    .select({ sourceTier: schema.sources.sourceTier, count: count() })
    .from(schema.sources)
    .where(eq(schema.sources.userId, authUser.userId))
    .groupBy(schema.sources.sourceTier);
  const byProcessingProfile = await db
    .select({ processingProfile: schema.sources.processingProfile, count: count() })
    .from(schema.sources)
    .where(eq(schema.sources.userId, authUser.userId))
    .groupBy(schema.sources.processingProfile);

  return c.json({
    total: total[0]?.count || 0,
    active: byStatus.find((row) => row.status === 'active')?.count || 0,
    paused: byStatus.find((row) => row.status === 'paused')?.count || 0,
    error: byStatus.find((row) => row.status === 'error')?.count || 0,
    byType,
    byCategory,
    byTier,
    byProcessingProfile,
  });
});

// POST /api/sources — 创建信源
app.post('/', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json();
  const {
    name,
    sourceType,
    collectorType,
    config: sourceConfig,
    category,
    sourceRole,
    priority,
    fetchInterval,
    autoFetchEnabled,
    autoTranscribe,
    sourceTier,
    processingProfile,
    growthAxes,
    trustScore,
    noiseScore,
    upgradeRules,
    sourceKind,
    authorityWeight,
    readingTier,
    aiDailyBudget,
    contentStrategy,
  } = body;

  if (!name || !sourceType) {
    return c.json({ error: 'name and sourceType are required' }, 400);
  }
  const normalizedReadingTier = readingTier === undefined ? null : normalizeSourceReadingTier(readingTier);
  if (readingTier !== undefined && !normalizedReadingTier) {
    return c.json({ error: 'Invalid reading tier' }, 400);
  }
  const normalizedAiDailyBudget = aiDailyBudget === undefined ? null : normalizeSourceAiDailyBudget(aiDailyBudget);
  if (aiDailyBudget !== undefined && normalizedAiDailyBudget === null) {
    return c.json({ error: 'Invalid AI daily budget; expected an integer from 0 to 200' }, 400);
  }
  const normalizedTopicGroup = body.topicGroup === undefined ? null : normalizeSourceTopicGroup(body.topicGroup);
  if (body.topicGroup !== undefined && !normalizedTopicGroup) {
    return c.json({ error: 'Invalid source topic group' }, 400);
  }
  const normalizedGovernanceRole = body.governanceRole === undefined ? null : normalizeSourceGovernanceRole(body.governanceRole);
  if (body.governanceRole !== undefined && !normalizedGovernanceRole) {
    return c.json({ error: 'Invalid source governance role' }, 400);
  }

  try {
    const effectiveSourceRole = sourceRole || ((collectorType === 'webpage' || collectorType === 'webpage_index' || collectorType === 'changedetection') && (category === '监控' || category === 'monitor') ? 'monitor' : 'normal');
    const derivedProfile = deriveSourceProfile({
      sourceTier,
      processingProfile,
      growthAxes,
      trustScore,
      noiseScore,
      upgradeRules,
      sourceRole: effectiveSourceRole,
      collectorType: collectorType || 'rss',
      sourceType,
      category,
    });
    let effectiveConfig = { ...(sourceConfig || {}) } as Record<string, unknown>;
    if (normalizedReadingTier) effectiveConfig.readingTier = normalizedReadingTier;
    if (normalizedAiDailyBudget !== null) effectiveConfig.aiDailyBudget = normalizedAiDailyBudget;
    if (normalizedTopicGroup) effectiveConfig.topicGroup = normalizedTopicGroup;
    if (normalizedGovernanceRole) effectiveConfig.governanceRole = normalizedGovernanceRole;
    if ((collectorType === 'webpage' || collectorType === 'webpage_index' || collectorType === 'changedetection') && !effectiveConfig.renderMode) {
      effectiveConfig.renderMode = 'auto';
    }
    effectiveConfig = withDerivedSourceContentStrategy({
      config: effectiveConfig,
      collectorType: collectorType || 'rss',
      sourceType,
      sourceRole: effectiveSourceRole,
      processingProfile: derivedProfile.processingProfile,
      contentStrategy,
    });
    const effectiveSourceKind = sourceKind || classifySourceKind({
      name,
      sourceType,
      collectorType: collectorType || 'rss',
      category,
      config: effectiveConfig,
    });
    const effectiveAuthorityWeight = normalizeAuthorityWeight(authorityWeight, derivedProfile.sourceTier, effectiveSourceKind);
    const result = await db.insert(schema.sources).values({
      userId: authUser.userId,
      name,
      sourceType,
      collectorType: collectorType || 'rss',
      sourceKind: effectiveSourceKind,
      sourceRole: effectiveSourceRole,
      sourceTier: derivedProfile.sourceTier,
      authorityWeight: effectiveAuthorityWeight,
      processingProfile: derivedProfile.processingProfile,
      trustScore: derivedProfile.trustScore,
      noiseScore: derivedProfile.noiseScore,
      growthAxes: derivedProfile.growthAxes,
      upgradeRules: derivedProfile.upgradeRules,
      config: effectiveConfig,
      category: category || 'uncategorized',
      priority: priority || 3,
      fetchInterval: fetchInterval || 60,
      autoFetchEnabled: autoFetchEnabled ?? true,
      autoTranscribe: autoTranscribe || false,
      nextFetchAt: autoFetchEnabled === false ? null : new Date(),
      lastOutcome: 'scheduled',
    }).returning();

    logger.info({ sourceId: result[0]?.id, name }, 'Source created');
    return c.json({ data: mapSourceResponse(result[0]) }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message }, 'Failed to create source');
    return c.json({ error: message }, 500);
  }
});

// PUT /api/sources/:id — 更新信源
app.put('/:id', async (c) => {
  const authUser = requireAuth(c);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) {
    return c.json({ error: 'Invalid source id' }, 400);
  }
  const body = await c.req.json();
  const normalizedReadingTier = body.readingTier === undefined ? null : normalizeSourceReadingTier(body.readingTier);
  if (body.readingTier !== undefined && !normalizedReadingTier) {
    return c.json({ error: 'Invalid reading tier' }, 400);
  }
  const normalizedAiDailyBudget = body.aiDailyBudget === undefined ? null : normalizeSourceAiDailyBudget(body.aiDailyBudget);
  if (body.aiDailyBudget !== undefined && normalizedAiDailyBudget === null) {
    return c.json({ error: 'Invalid AI daily budget; expected an integer from 0 to 200' }, 400);
  }
  const normalizedTopicGroup = body.topicGroup === undefined ? null : normalizeSourceTopicGroup(body.topicGroup);
  if (body.topicGroup !== undefined && !normalizedTopicGroup) {
    return c.json({ error: 'Invalid source topic group' }, 400);
  }
  const normalizedGovernanceRole = body.governanceRole === undefined ? null : normalizeSourceGovernanceRole(body.governanceRole);
  if (body.governanceRole !== undefined && !normalizedGovernanceRole) {
    return c.json({ error: 'Invalid source governance role' }, 400);
  }
  const existing = await db.select()
    .from(schema.sources)
    .where(and(eq(schema.sources.id, id), eq(schema.sources.userId, authUser.userId)))
    .limit(1);
  if (existing.length === 0) {
    return c.json({ error: 'Source not found' }, 404);
  }
  const current = existing[0];

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  const allowedFields = ['name', 'sourceType', 'collectorType', 'sourceKind', 'sourceRole', 'authorityWeight', 'config', 'category', 'priority', 'fetchInterval', 'autoFetchEnabled', 'autoTranscribe', 'status', 'tags'];
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      // Map camelCase to schema field
      const schemaField = field as keyof typeof schema.sources.$inferInsert;
      updateData[schemaField] = body[field];
    }
  }
  const nextAutoFetchEnabled = body.autoFetchEnabled;
  const nextStatus = body.status;
  const nextFetchInterval = body.fetchInterval;
  if (nextAutoFetchEnabled !== undefined || nextStatus !== undefined || nextFetchInterval !== undefined) {
    const autoFetchEnabled = nextAutoFetchEnabled ?? current.autoFetchEnabled ?? true;
    const status = nextStatus ?? current.status ?? 'active';
    updateData.nextFetchAt = autoFetchEnabled === false || status !== 'active' ? null : new Date();
    updateData.lastOutcome = autoFetchEnabled === false ? 'paused' : status !== 'active' ? 'inactive' : 'scheduled';
  }
  const nextCollectorType = String(body.collectorType ?? current.collectorType ?? '').trim();
  const nextConfig = {
    ...((current.config as Record<string, unknown> | undefined) || {}),
    ...((updateData.config as Record<string, unknown> | undefined) || {}),
  };
  const nextSourceRole = String(body.sourceRole ?? current.sourceRole ?? '').trim();
  const nextSourceType = String(body.sourceType ?? current.sourceType ?? '').trim();
  const nextCategory = String(body.category ?? current.category ?? '').trim();
  let normalizedConfig = { ...nextConfig };
  if (normalizedReadingTier) normalizedConfig.readingTier = normalizedReadingTier;
  if (normalizedAiDailyBudget !== null) normalizedConfig.aiDailyBudget = normalizedAiDailyBudget;
  if (normalizedTopicGroup) normalizedConfig.topicGroup = normalizedTopicGroup;
  if (normalizedGovernanceRole) normalizedConfig.governanceRole = normalizedGovernanceRole;
  if ((nextCollectorType === 'webpage' || nextCollectorType === 'webpage_index' || nextCollectorType === 'changedetection') && !normalizedConfig.renderMode) {
    normalizedConfig = { ...normalizedConfig, renderMode: 'auto' };
  }
  const derivedProfile = deriveSourceProfile({
    sourceTier: body.sourceTier ?? current.sourceTier,
    processingProfile: body.processingProfile ?? current.processingProfile,
    growthAxes: body.growthAxes ?? current.growthAxes,
    trustScore: body.trustScore ?? current.trustScore,
    noiseScore: body.noiseScore ?? current.noiseScore,
    upgradeRules: body.upgradeRules ?? current.upgradeRules,
    sourceRole: nextSourceRole,
    collectorType: nextCollectorType,
    sourceType: nextSourceType,
    category: nextCategory,
  });
  normalizedConfig = withDerivedSourceContentStrategy({
    config: normalizedConfig,
    collectorType: nextCollectorType,
    sourceType: nextSourceType,
    sourceRole: nextSourceRole,
    processingProfile: derivedProfile.processingProfile,
    contentStrategy: body.contentStrategy ?? normalizedConfig.contentStrategy,
  });
  updateData.config = normalizedConfig;
  updateData.sourceTier = derivedProfile.sourceTier;
  const nextSourceKind = String(body.sourceKind ?? current.sourceKind ?? '').trim() || classifySourceKind({
    name: body.name ?? current.name,
    sourceType: nextSourceType,
    collectorType: nextCollectorType,
    category: nextCategory,
    config: normalizedConfig,
  });
  updateData.sourceKind = nextSourceKind;
  updateData.authorityWeight = normalizeAuthorityWeight(body.authorityWeight ?? current.authorityWeight, derivedProfile.sourceTier, nextSourceKind);
  updateData.processingProfile = derivedProfile.processingProfile;
  updateData.trustScore = derivedProfile.trustScore;
  updateData.noiseScore = derivedProfile.noiseScore;
  updateData.growthAxes = derivedProfile.growthAxes;
  updateData.upgradeRules = derivedProfile.upgradeRules;

  const result = await db.update(schema.sources)
    .set(updateData)
    .where(and(eq(schema.sources.id, id), eq(schema.sources.userId, authUser.userId)))
    .returning();

  if (result.length === 0) {
    return c.json({ error: 'Source not found' }, 404);
  }

  return c.json({ data: mapSourceResponse(result[0]) });
});

// DELETE /api/sources/:id — 删除信源
app.delete('/:id', async (c) => {
  const authUser = requireAuth(c);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) {
    return c.json({ error: 'Invalid source id' }, 400);
  }
  const result = await db.delete(schema.sources)
    .where(and(eq(schema.sources.id, id), eq(schema.sources.userId, authUser.userId)))
    .returning();

  if (result.length === 0) {
    return c.json({ error: 'Source not found' }, 404);
  }

  logger.info({ sourceId: id }, 'Source deleted');
  return c.json({ message: 'Deleted', id });
});

// POST /api/sources/import-opml — OPML 导入
app.post('/import-opml', async (c) => {
  const authUser = requireAuth(c);
  const contentType = c.req.header('content-type') || '';

  let xmlContent: string;

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No OPML file provided' }, 400);
    }
    xmlContent = await file.text();
  } else {
    const body = await c.req.json().catch(() => ({}));
    xmlContent = String(body.content || body.opml || '');
  }

  if (!xmlContent) {
    return c.json({ error: 'Empty OPML content' }, 400);
  }

  try {
    const feeds = parseOpml(xmlContent);
    if (feeds.length === 0) {
      return c.json({ error: 'No feeds found in OPML' }, 400);
    }

    const existingSources = await db
      .select({
        collectorType: schema.sources.collectorType,
        config: schema.sources.config,
      })
      .from(schema.sources)
      .where(eq(schema.sources.userId, authUser.userId));

    const existingFingerprints = new Set(
      existingSources
        .map((source) => buildSourceFingerprint(source.collectorType, source.config))
        .filter((value): value is string => Boolean(value)),
    );

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const feed of feeds) {
      try {
        let sourceType = feed.xmlUrl.includes('youtube.com') ? 'rsshub' : 'rss';
        let collectorType = feed.xmlUrl.includes('youtube.com') ? 'youtube' : 'rss';
        let configPayload: Record<string, unknown> = { url: feed.xmlUrl, htmlUrl: feed.htmlUrl };
        if (feed.dailyReportEnabled === true) configPayload.dailyReportEnabled = true;

        try {
          const parsed = new URL(feed.xmlUrl);
          if (/rsshub/i.test(parsed.hostname)) {
            sourceType = 'rsshub';
            collectorType = 'rsshub';
            configPayload = { route: parsed.pathname + parsed.search, htmlUrl: feed.htmlUrl };
          }
        } catch {
          // keep rss defaults
        }

        const fingerprint = buildSourceFingerprint(collectorType, configPayload);
        if (fingerprint && existingFingerprints.has(fingerprint)) {
          skipped++;
          continue;
        }

        const inserted = await db.insert(schema.sources).values({
          userId: authUser.userId,
          name: feed.title,
          sourceType,
          collectorType,
          sourceTier: collectorType === 'youtube' ? 'A' : 'B',
          processingProfile: collectorType === 'youtube' ? 'smart' : 'brief',
          trustScore: collectorType === 'youtube' ? 78 : 62,
          noiseScore: collectorType === 'youtube' ? 24 : 42,
          growthAxes: ['认知升级'],
          upgradeRules: {},
          config: configPayload,
          category: feed.category || 'uncategorized',
          priority: 3,
          fetchInterval: 60,
        }).onConflictDoNothing().returning({ id: schema.sources.id });

        if (inserted.length > 0) {
          imported++;
          if (fingerprint) existingFingerprints.add(fingerprint);
        } else {
          skipped++;
        }
      } catch (err) {
        skipped++;
      }
    }

    logger.info({ imported, skipped, total: feeds.length }, 'OPML import complete');
    return c.json({
      message: 'OPML imported',
      total: feeds.length,
      imported,
      skipped,
      categories: [...new Set(feeds.map(f => f.category))],
    });
  } catch (err) {
    return c.json({ error: `OPML parse error: ${(err as Error).message}` }, 400);
  }
});

// POST /api/sources/categories/rename — 分类重命名
app.post('/categories/rename', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json();
  const { from, to } = body;
  if (!from || !to) return c.json({ error: 'from and to required' }, 400);

  await db.update(schema.sources)
    .set({ category: to })
    .where(and(eq(schema.sources.category, from), eq(schema.sources.userId, authUser.userId)));
  return c.json({ message: 'Renamed', from, to });
});

export default app;
