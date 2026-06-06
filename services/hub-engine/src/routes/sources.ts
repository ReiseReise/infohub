import { Hono } from 'hono';
import { eq, and, desc, count, sql, gte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { parseOpml } from '../lib/opml-parser.js';
import { requireAuth } from '../lib/auth.js';
import { computeSourceFreshness } from '../lib/freshness.js';
import { deriveSourceProfile, normalizeGrowthAxes } from '../lib/growth.js';
import { buildSourceFingerprint } from '../lib/source-normalization.js';
import { classifySourceKind, normalizeAuthorityWeight } from '../lib/aihot-governance.js';
import { buildSourceQualityFunnel, type SourceQualityFunnel } from '../lib/content-quality.js';

const app = new Hono();

type SourceListSort = 'createdAt' | 'latest' | 'unread' | 'health' | 'name' | 'quality' | 'content' | 'ai' | 'noise';

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
  sourceQuality: SourceQualityFunnel;
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
  const freshness = computeSourceFreshness(row as Parameters<typeof computeSourceFreshness>[0]);
  return {
    ...row,
    growthAxes: normalizeGrowthAxes((row as { growthAxes?: unknown }).growthAxes, []),
    sourceHost: getSourceHost(config),
    iconUrl: typeof config.iconUrl === 'string' ? config.iconUrl : null,
    renderMode: typeof config.renderMode === 'string' ? config.renderMode : null,
    lastFetchEngine: typeof config.lastFetchEngine === 'string' ? config.lastFetchEngine : null,
    blockedReason: typeof config.lastBlockedReason === 'string' ? config.lastBlockedReason : (row.lastError || null),
    lastChangeSummary: typeof config.lastChangeSummary === 'string' ? config.lastChangeSummary : null,
    freshnessState: freshness.freshnessState,
    staleReason: freshness.staleReason,
  };
}

// GET /api/sources — 列表（支持分类/类型筛选）
app.get('/', async (c) => {
  const authUser = requireAuth(c);
  const category = c.req.query('category');
  const sourceType = c.req.query('sourceType');
  const sourceRole = c.req.query('sourceRole');
  const status = c.req.query('status');
  const sortBy = (c.req.query('sortBy') || 'createdAt') as SourceListSort;

  const conditions = [eq(schema.sources.userId, authUser.userId)];
  if (category) conditions.push(eq(schema.sources.category, category));
  if (sourceType) conditions.push(eq(schema.sources.sourceType, sourceType));
  if (sourceRole) conditions.push(eq(schema.sources.sourceRole, sourceRole));
  if (status) conditions.push(eq(schema.sources.status, status));

  const rows = await db
    .select()
    .from(schema.sources)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.sources.createdAt));

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
      qualityPassCount: sql<number>`sum(case when ${schema.items.qualityDecision} = 'pass' then 1 else 0 end)`,
      qualityReviewCount: sql<number>`sum(case when ${schema.items.qualityDecision} = 'review' then 1 else 0 end)`,
      qualityFilterCount: sql<number>`sum(case when ${schema.items.qualityDecision} = 'filter' then 1 else 0 end)`,
      scoredCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and ${schema.items.aiScore} is not null then 1 else 0 end)`,
      summarizedCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and (${schema.items.summaryStatus} = 'ready' or coalesce(length(trim(${schema.items.aiSummary})), 0) > 0) then 1 else 0 end)`,
      translationCompletedCount: sql<number>`sum(case when ${schema.items.filterBucket} = 'main' and ${schema.items.isFiltered} = false and ${schema.items.translationStatus} in ('ready', 'skipped') then 1 else 0 end)`,
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
    | 'scoredCount' | 'summarizedCount' | 'translationCompletedCount' | 'sourceQuality'
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
      qualityPassCount: Number(row.qualityPassCount || 0),
      qualityReviewCount: Number(row.qualityReviewCount || 0),
      qualityFilterCount: Number(row.qualityFilterCount || 0),
      scoredCount: Number(row.scoredCount || 0),
      summarizedCount: Number(row.summarizedCount || 0),
      translationCompletedCount: Number(row.translationCompletedCount || 0),
      sourceQuality,
    });
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
    return {
      ...base,
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
      qualityPassCount: sourceStats?.qualityPassCount || 0,
      qualityReviewCount: sourceStats?.qualityReviewCount || 0,
      qualityFilterCount: sourceStats?.qualityFilterCount || 0,
      scoredCount: sourceStats?.scoredCount || 0,
      summarizedCount: sourceStats?.summarizedCount || 0,
      translationCompletedCount: sourceStats?.translationCompletedCount || 0,
      sourceQuality: sourceStats?.sourceQuality || buildSourceQualityFunnel({}),
      duplicateContribution: sourceStats?.sourceQuality.duplicateRate ?? duplicateMap.get(row.id) ?? 0,
      latestItemTitle: latest?.latestItemTitle || null,
      latestItemUrl: latest?.latestItemUrl || null,
      latestItemAt: latest?.latestItemAt || null,
    };
  });

  return c.json({ data: sortSources(enriched, sortBy), total: enriched.length });
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
  } = body;

  if (!name || !sourceType) {
    return c.json({ error: 'name and sourceType are required' }, 400);
  }

  try {
    const effectiveConfig = { ...(sourceConfig || {}) } as Record<string, unknown>;
    if ((collectorType === 'webpage' || collectorType === 'changedetection') && !effectiveConfig.renderMode) {
      effectiveConfig.renderMode = 'auto';
    }
    const derivedProfile = deriveSourceProfile({
      sourceTier,
      processingProfile,
      growthAxes,
      trustScore,
      noiseScore,
      upgradeRules,
      sourceRole,
      collectorType: collectorType || 'rss',
      sourceType,
      category,
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
      sourceRole: sourceRole || ((collectorType === 'webpage' || collectorType === 'changedetection') && (category === '监控' || category === 'monitor') ? 'monitor' : 'normal'),
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
  const nextConfig = (updateData.config as Record<string, unknown> | undefined)
    || (current.config as Record<string, unknown> | undefined)
    || {};
  const nextSourceRole = String(body.sourceRole ?? current.sourceRole ?? '').trim();
  const nextSourceType = String(body.sourceType ?? current.sourceType ?? '').trim();
  const nextCategory = String(body.category ?? current.category ?? '').trim();
  if ((nextCollectorType === 'webpage' || nextCollectorType === 'changedetection') && !nextConfig.renderMode) {
    updateData.config = { ...nextConfig, renderMode: 'auto' };
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
  updateData.sourceTier = derivedProfile.sourceTier;
  const nextSourceKind = String(body.sourceKind ?? current.sourceKind ?? '').trim() || classifySourceKind({
    name: body.name ?? current.name,
    sourceType: nextSourceType,
    collectorType: nextCollectorType,
    category: nextCategory,
    config: updateData.config ?? current.config,
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
