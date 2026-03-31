import { Hono } from 'hono';
import { eq, and, desc, count, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { parseOpml } from '../lib/opml-parser.js';
import { requireAuth } from '../lib/auth.js';
import { computeSourceFreshness } from '../lib/freshness.js';
import { deriveSourceProfile, normalizeGrowthAxes } from '../lib/growth.js';
import { buildSourceFingerprint } from '../lib/source-normalization.js';

const app = new Hono();

type SourceListSort = 'createdAt' | 'latest' | 'unread' | 'health' | 'name';

type SourceOverview = {
  entryCount: number;
  unreadCount: number;
  favoriteCount: number;
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
}>(rows: T[], sortBy: SourceListSort): T[] {
  return [...rows].sort((a, b) => {
    if (sortBy === 'name') {
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
    }
    if (sortBy === 'health') {
      const healthDiff = Number(b.healthScore || 0) - Number(a.healthScore || 0);
      if (healthDiff !== 0) return healthDiff;
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
      entryCount: sql<number>`sum(case when ${schema.items.isFiltered} = false then 1 else 0 end)`,
      unreadCount: sql<number>`sum(case when ${schema.items.isRead} = false and ${schema.items.isFiltered} = false then 1 else 0 end)`,
      favoriteCount: sql<number>`sum(case when ${schema.items.isFavorite} = true and ${schema.items.isFiltered} = false then 1 else 0 end)`,
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
      and is_filtered = false
    order by source_id, coalesce(published_at, fetched_at) desc nulls last, fetched_at desc nulls last
  `) as Array<{
    source_id: number;
    title: string | null;
    url: string | null;
    latest_item_at: string | null;
  }>;

  const statsMap = new Map<number, Pick<SourceOverview, 'entryCount' | 'unreadCount' | 'favoriteCount'>>();
  for (const row of itemStatsRows) {
    statsMap.set(row.sourceId, {
      entryCount: Number(row.entryCount || 0),
      unreadCount: Number(row.unreadCount || 0),
      favoriteCount: Number(row.favoriteCount || 0),
    });
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
      entryCount: sourceStats?.entryCount || 0,
      unreadCount: sourceStats?.unreadCount || 0,
      favoriteCount: sourceStats?.favoriteCount || 0,
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
    const result = await db.insert(schema.sources).values({
      userId: authUser.userId,
      name,
      sourceType,
      collectorType: collectorType || 'rss',
      sourceRole: sourceRole || ((collectorType === 'webpage' || collectorType === 'changedetection') && (category === '监控' || category === 'monitor') ? 'monitor' : 'normal'),
      sourceTier: derivedProfile.sourceTier,
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
  const allowedFields = ['name', 'sourceType', 'collectorType', 'sourceRole', 'config', 'category', 'priority', 'fetchInterval', 'autoFetchEnabled', 'autoTranscribe', 'status', 'tags'];
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
