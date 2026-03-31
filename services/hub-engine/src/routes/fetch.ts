import { Hono } from 'hono';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { enqueueDueFetches, enqueueFetchAll, enqueueSourceFetch, fetchSourceNow } from '../scheduler/pipeline.js';
import { fetchQueue } from '../scheduler/queue.js';
import { requireAuth } from '../lib/auth.js';
import { getEffectiveAiSceneAvailability } from '../lib/ai-configs.js';
import { getUserFetchSettings } from '../lib/fetch-settings.js';
import { ensureItemContent } from '../lib/item-enrichment.js';
import { computeSourceFreshness, summarizeFreshness } from '../lib/freshness.js';
import { scoreItemsDetailed } from '../processors/ai-scorer.js';
import { summarizeItemsDetailed, translateItemsDetailed } from '../processors/ai-summarizer.js';

const app = new Hono();

async function getContentStats(userId: string, itemIds: string[]) {
  if (itemIds.length === 0) {
    return { withContent: 0, withoutContent: 0 };
  }

  const rows = await db
    .select({
      withContent: sql<number>`sum(case when coalesce(length(trim(${schema.items.content})), 0) > 0 or coalesce(length(trim(${schema.items.snippet})), 0) > 0 then 1 else 0 end)`,
      withoutContent: sql<number>`sum(case when coalesce(length(trim(${schema.items.content})), 0) = 0 and coalesce(length(trim(${schema.items.snippet})), 0) = 0 then 1 else 0 end)`,
    })
    .from(schema.items)
    .where(and(eq(schema.items.userId, userId), inArray(schema.items.id, itemIds)));

  return {
    withContent: Number(rows[0]?.withContent || 0),
    withoutContent: Number(rows[0]?.withoutContent || 0),
  };
}

// POST /api/fetch/trigger — 手动触发全量采集
app.post('/trigger', async (c) => {
  const authUser = requireAuth(c);
  const count = await enqueueFetchAll(authUser.userId, {
    reason: 'manual',
    priority: 1,
    dedupe: true,
    respectAutoFetch: false,
  });
  return c.json({
    message: 'Fetch triggered',
    enqueued: count,
    mode: 'manual-priority',
  });
});

// POST /api/fetch/due — 手动补抓到期来源
app.post('/due', async (c) => {
  const authUser = requireAuth(c);
  const result = await enqueueDueFetches(50, authUser.userId);
  return c.json({
    message: 'Due sources enqueued',
    mode: 'due-only',
    ...result,
  });
});

// POST /api/fetch/source/:id — 手动触发单源采集
app.post('/source/:id', async (c) => {
  const authUser = requireAuth(c);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) {
    return c.json({ error: 'Invalid source id' }, 400);
  }
  const rows = await db.select()
    .from(schema.sources)
    .where(and(eq(schema.sources.id, id), eq(schema.sources.userId, authUser.userId)))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Source not found' }, 404);
  }

  const source = rows[0];
  const mode = (c.req.query('mode') || 'sync').toLowerCase();

  if (mode === 'sync') {
    try {
      const summary = await fetchSourceNow({
        sourceId: source.id,
        sourceName: source.name,
        sourceType: source.sourceType,
        collectorType: source.collectorType,
        config: source.config as Record<string, unknown>,
      });
      let aiProcessed = { scored: 0, summarized: 0, translated: 0 };
      const aiErrors: Record<string, string[]> = {};
      const itemIds = (summary?.newItemIds || []).slice(0, Math.min(summary?.itemsNew || 0, 10));
      if (itemIds.length > 0) {
        await Promise.all(itemIds.map((itemId) => ensureItemContent(authUser.userId, itemId)));
      }
      const contentStats = await getContentStats(authUser.userId, summary?.newItemIds || []);
      if (summary?.itemsNew && summary.itemsNew > 0) {
        const scenes = await getEffectiveAiSceneAvailability(authUser.userId);
        const limit = Math.min(summary.itemsNew, 10);
        const itemIds = (summary.newItemIds || []).slice(0, limit);
        if (scenes.has('scoring')) {
          const scoring = await scoreItemsDetailed(authUser.userId, limit, { itemIds });
          aiProcessed.scored = scoring.processed;
          if (scoring.errors.length > 0) aiErrors.scoring = scoring.errors;
        }
        if (scenes.has('summary')) {
          const summarization = await summarizeItemsDetailed(authUser.userId, limit, { itemIds });
          aiProcessed.summarized = summarization.processed;
          if (summarization.errors.length > 0) aiErrors.summary = summarization.errors;
        }
        if (scenes.has('translation')) {
          const translation = await translateItemsDetailed(authUser.userId, Math.min(limit, 5), { itemIds });
          aiProcessed.translated = translation.processed;
          if (translation.errors.length > 0) aiErrors.translation = translation.errors;
        }
      }
      logger.info({ sourceId: source.id, name: source.name, mode: 'sync', summary, aiProcessed, aiErrors, contentStats }, 'Manual fetch finished');
      return c.json({
        message: 'Fetch finished',
        sourceId: source.id,
        mode: 'sync',
        ...summary,
        aiProcessed,
        aiErrors,
        contentStats,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      logger.error({ sourceId: source.id, name: source.name, mode: 'sync', error: detail }, 'Manual fetch failed');
      return c.json({
        error: detail,
        sourceId: source.id,
        mode: 'sync',
      }, 502);
    }
  }

  const queued = await enqueueSourceFetch({
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.sourceType,
    collectorType: source.collectorType,
    config: source.config as Record<string, unknown>,
  }, {
    reason: 'manual',
    priority: 1,
    dedupeKey: authUser.userId,
  });

  logger.info({
    sourceId: source.id,
    name: source.name,
    jobId: queued.jobId,
    enqueued: queued.enqueued,
    state: queued.state,
  }, 'Manual fetch enqueued');

  return c.json({
    message: queued.enqueued ? 'Fetch enqueued' : 'Fetch already queued',
    sourceId: source.id,
    jobId: queued.jobId,
    enqueued: queued.enqueued,
    state: queued.state || null,
  });
});

// GET /api/fetch/status — 采集状态
app.get('/status', async (c) => {
  const authUser = requireAuth(c);
  const waiting = await fetchQueue.getWaitingCount();
  const active = await fetchQueue.getActiveCount();
  const completed = await fetchQueue.getCompletedCount();
  const failed = await fetchQueue.getFailedCount();
  const fetchSettings = await getUserFetchSettings(authUser.userId);

  const userSources = await db
    .select({
      id: schema.sources.id,
      name: schema.sources.name,
      status: schema.sources.status,
      autoFetchEnabled: schema.sources.autoFetchEnabled,
      fetchInterval: schema.sources.fetchInterval,
      lastFetchedAt: schema.sources.lastFetchedAt,
      nextFetchAt: schema.sources.nextFetchAt,
      lastSuccessAt: schema.sources.lastSuccessAt,
      lastOutcome: schema.sources.lastOutcome,
      lastError: schema.sources.lastError,
      errorCount: schema.sources.errorCount,
      updatedAt: schema.sources.updatedAt,
    })
    .from(schema.sources)
    .where(eq(schema.sources.userId, authUser.userId))
    .orderBy(desc(schema.sources.updatedAt))
    .limit(100);
  const sourcesWithFreshness = userSources.map((source) => ({
    ...source,
    ...computeSourceFreshness(source),
  }));
  const freshness = summarizeFreshness(userSources);

  const recentFetches = await db
    .select({
      id: schema.fetchLogs.id,
      sourceId: schema.fetchLogs.sourceId,
      sourceName: schema.sources.name,
      status: schema.fetchLogs.status,
      startedAt: schema.fetchLogs.startedAt,
      finishedAt: schema.fetchLogs.finishedAt,
      itemsFound: schema.fetchLogs.itemsFound,
      itemsNew: schema.fetchLogs.itemsNew,
      itemsFiltered: schema.fetchLogs.itemsFiltered,
      itemsDuplicate: schema.fetchLogs.itemsDuplicate,
      itemsQueuedAi: schema.fetchLogs.itemsQueuedAi,
      outcome: schema.fetchLogs.outcome,
      error: schema.fetchLogs.error,
      durationMs: schema.fetchLogs.durationMs,
    })
    .from(schema.fetchLogs)
    .leftJoin(schema.sources, eq(schema.fetchLogs.sourceId, schema.sources.id))
    .where(eq(schema.sources.userId, authUser.userId))
    .orderBy(desc(schema.fetchLogs.startedAt))
    .limit(20);

  const activeSources = userSources.filter((s) => s.status === 'active').length;
  const autoFetchSourceCount = userSources.filter((s) => s.status === 'active' && s.autoFetchEnabled !== false).length;
  const staleSources = freshness.staleSources;
  const unhealthySources = userSources.filter((s) => (s.errorCount || 0) > 0 || Boolean(s.lastError)).length;
  const dueSources = userSources.filter((s) => s.status === 'active' && (s.autoFetchEnabled ?? true) && (!s.nextFetchAt || new Date(s.nextFetchAt) <= new Date())).length;

  return c.json({
    runtimeOnline: true,
    schedulerMode: 'manual-startup + hybrid',
    lastSuccessfulFetchAt: freshness.lastSuccessfulFetchAt,
    freshnessStatus: freshness.freshnessStatus,
    staleReason: freshness.staleReason,
    staleSources: freshness.staleSources,
    oldestDueMinutes: freshness.oldestDueMinutes,
    queue: {
      name: 'fetch',
      waiting,
      active,
      completed,
      failed,
    },
    user: {
      sourceCount: userSources.length,
      userAutoFetchEnabled: fetchSettings.autoFetchEnabled,
      activeSources,
      autoFetchSourceCount,
      cronSkippedByUserSetting: !fetchSettings.autoFetchEnabled,
      staleSources,
      unhealthySources,
      dueSources,
      scheduleMode: 'hybrid',
      recentFetches,
      freshnessStatus: freshness.freshnessStatus,
      staleReason: freshness.staleReason,
      lastSuccessfulFetchAt: freshness.lastSuccessfulFetchAt,
      oldestDueMinutes: freshness.oldestDueMinutes,
      sources: sourcesWithFreshness,
      staleDetails: freshness.staleDetails,
    },
  });
});

export default app;
