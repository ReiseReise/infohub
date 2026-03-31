import { Hono } from 'hono';
import { eq, and, desc, count } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { parseOpml } from '../lib/opml-parser.js';
import { requireAuth } from '../lib/auth.js';
import { computeSourceFreshness } from '../lib/freshness.js';
import { deriveSourceProfile, normalizeGrowthAxes } from '../lib/growth.js';

const app = new Hono();

function mapSourceResponse<T extends { config?: unknown; lastError?: string | null }>(row: T) {
  const config = (row.config && typeof row.config === 'object') ? row.config as Record<string, unknown> : {};
  const freshness = computeSourceFreshness(row as Parameters<typeof computeSourceFreshness>[0]);
  return {
    ...row,
    growthAxes: normalizeGrowthAxes((row as { growthAxes?: unknown }).growthAxes, []),
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

  return c.json({ data: rows.map((row) => mapSourceResponse(row)), total: rows.length });
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

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const feed of feeds) {
      try {
        const sourceType = feed.xmlUrl.includes('youtube.com') ? 'rsshub' :
                           feed.xmlUrl.includes('rsshub.app') ? 'rsshub' : 'rss';
        const collectorType = feed.xmlUrl.includes('youtube.com') ? 'youtube' :
                              feed.xmlUrl.includes('rsshub.app') ? 'rsshub' : 'rss';

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
          config: { url: feed.xmlUrl, htmlUrl: feed.htmlUrl },
          category: feed.category || 'uncategorized',
          priority: 3,
          fetchInterval: 60,
        }).onConflictDoNothing().returning({ id: schema.sources.id });

        if (inserted.length > 0) {
          imported++;
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
