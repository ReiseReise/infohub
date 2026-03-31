import { eq, and, desc, asc, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { RssCollector } from '../collectors/rss.js';
import { RsshubCollector } from '../collectors/rsshub.js';
import { ChangedetectionCollector } from '../collectors/changedetection.js';
import { YoutubeCollector } from '../collectors/youtube.js';
import { CustomCollector } from '../collectors/custom.js';
import { WebpageCollector } from '../collectors/webpage.js';
import type { Collector, SourceConfig, RawItem } from '../collectors/base.js';
import { fetchQueue, type FetchJobData } from './queue.js';
import type { Job } from 'bullmq';
import { buildSnippet, detectLikelyLanguage } from '../lib/content-extractor.js';
import { maybeAutoTranscribeItem, type AutoTranscribeCandidate } from '../services/auto-transcribe.js';
import { applyFilterRules } from '../processors/filter.js';

const collectors: Record<string, Collector> = {
  rss: new RssCollector(),
  rsshub: new RsshubCollector(),
  changedetection: new ChangedetectionCollector(),
  youtube: new YoutubeCollector(),
  custom: new CustomCollector(),
  webpage: new WebpageCollector(),
};

type EnqueueReason = 'manual' | 'cron' | 'system';

type EnqueueSourceOptions = {
  reason?: EnqueueReason;
  priority?: number;
  dedupeKey?: string;
};

type EnqueueSourceParams = {
  sourceId: number;
  sourceName: string;
  sourceType: string;
  collectorType: string;
  config: Record<string, unknown>;
};

function buildFetchJobId(sourceId: number, options: EnqueueSourceOptions): string {
  const reason = options.reason || 'system';
  if (options.dedupeKey) {
    return `fetch_${sourceId}_${reason}_${options.dedupeKey}`;
  }
  return `fetch_${sourceId}_${Date.now()}`;
}

export async function enqueueSourceFetch(
  params: EnqueueSourceParams,
  options: EnqueueSourceOptions = {},
): Promise<{ jobId: string; enqueued: boolean; state?: string }> {
  const jobId = buildFetchJobId(params.sourceId, options);

  if (options.dedupeKey) {
    const existing = await fetchQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (['waiting', 'active', 'delayed', 'prioritized'].includes(state)) {
        return { jobId, enqueued: false, state };
      }
    }
  }

  await fetchQueue.add(
    `fetch:${params.sourceId}`,
    {
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      sourceType: params.sourceType,
      collectorType: params.collectorType,
      config: params.config,
    },
    {
      jobId,
      priority: options.priority ?? 5,
    },
  );

  return { jobId, enqueued: true };
}

type EnqueueFetchAllOptions = {
  reason?: EnqueueReason;
  priority?: number;
  dedupe?: boolean;
  respectAutoFetch?: boolean;
};

type FetchOutcome = 'no_items' | 'no_change' | 'all_duplicate' | 'all_filtered' | 'ai_queued' | 'new_items' | 'error';

export type FetchExecutionSummary = {
  sourceId: number;
  sourceName: string;
  itemsFound: number;
  itemsNew: number;
  newItemIds?: string[];
  itemsFiltered: number;
  itemsDuplicate: number;
  itemsQueuedAi: number;
  outcome: FetchOutcome;
  durationMs: number;
  error?: string;
};

function jitterMs(baseMs: number): number {
  const spread = Math.round(baseMs * 0.1);
  if (spread <= 0) return 0;
  return Math.round((Math.random() * 2 - 1) * spread);
}

function computeNextFetchAt(baseIntervalMinutes: number, outcome: FetchOutcome, errorCount = 0): Date {
  const safeInterval = Math.max(baseIntervalMinutes || 60, 5);
  let minutes = safeInterval;
  if (outcome === 'no_items' || outcome === 'no_change' || outcome === 'all_duplicate') minutes = Math.round(safeInterval * 1.5);
  if (outcome === 'error') minutes = Math.min(safeInterval * Math.max(2 ** Math.max(errorCount - 1, 0), 1), 360);
  const next = new Date(Date.now() + minutes * 60_000 + jitterMs(minutes * 60_000));
  return next;
}

async function updateSourceSchedule(
  sourceId: number,
  baseIntervalMinutes: number,
  outcome: FetchOutcome,
  patch?: Partial<typeof schema.sources.$inferInsert>,
) {
  const nextFetchAt = computeNextFetchAt(baseIntervalMinutes, outcome, Number(patch?.errorCount || 0));
  await db.update(schema.sources).set({
    nextFetchAt,
    lastOutcome: outcome,
    ...(patch || {}),
  }).where(eq(schema.sources.id, sourceId));
}

export async function enqueueFetchAll(userId?: string, options: EnqueueFetchAllOptions = {}) {
  const conditions = [eq(schema.sources.status, 'active')];
  if (userId) conditions.push(eq(schema.sources.userId, userId));
  if (options.respectAutoFetch !== false) {
    conditions.push(eq(schema.sources.autoFetchEnabled, true));
    conditions.push(sql`coalesce(${schema.userSettings.autoFetchEnabled}, true)`);
  }

  const activeSources = await db
    .select({
      id: schema.sources.id,
      userId: schema.sources.userId,
      name: schema.sources.name,
      sourceType: schema.sources.sourceType,
      collectorType: schema.sources.collectorType,
      config: schema.sources.config,
      userAutoFetchEnabled: schema.userSettings.autoFetchEnabled,
    })
    .from(schema.sources)
    .leftJoin(schema.userSettings, eq(schema.userSettings.userId, schema.sources.userId))
    .where(and(...conditions));

  let enqueued = 0;
  let skipped = 0;
  const reason = options.reason || 'system';
  for (const source of activeSources) {
    const dedupeKey = options.dedupe ? `${userId || 'all'}` : undefined;
    const result = await enqueueSourceFetch({
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.sourceType,
      collectorType: source.collectorType,
      config: source.config as Record<string, unknown>,
    }, {
      reason,
      priority: options.priority,
      dedupeKey,
    });
    if (result.enqueued) enqueued++;
    else skipped++;
  }

  logger.info({
    enqueued,
    skipped,
    total: activeSources.length,
    reason,
    priority: options.priority ?? 5,
    dedupe: Boolean(options.dedupe),
    userId: userId || 'all',
  }, 'Enqueued fetch jobs for active sources');
  return enqueued;
}

export async function enqueueDueFetches(limit = 50, userId?: string) {
  const now = new Date();
  const overdueRatio = sql<number>`
    extract(epoch from (${now.toISOString()}::timestamptz - coalesce(${schema.sources.nextFetchAt}, now())))
    / greatest(coalesce(${schema.sources.fetchInterval}, 60) * 60, 300)
  `;

  const dueSources = await db
    .select({
      id: schema.sources.id,
      userId: schema.sources.userId,
      name: schema.sources.name,
      sourceType: schema.sources.sourceType,
      collectorType: schema.sources.collectorType,
      config: schema.sources.config,
      priority: schema.sources.priority,
    })
    .from(schema.sources)
    .leftJoin(schema.userSettings, eq(schema.userSettings.userId, schema.sources.userId))
    .where(and(
      eq(schema.sources.status, 'active'),
      ...(userId ? [eq(schema.sources.userId, userId)] : []),
      eq(schema.sources.autoFetchEnabled, true),
      sql`coalesce(${schema.userSettings.autoFetchEnabled}, true)`,
      or(
        sql`${schema.sources.nextFetchAt} is null`,
        lte(schema.sources.nextFetchAt, now),
      ),
    ))
    .orderBy(
      desc(overdueRatio),
      desc(schema.sources.priority),
      desc(schema.sources.healthScore),
      asc(schema.sources.errorCount),
      asc(schema.sources.nextFetchAt),
    )
    .limit(Math.max(limit, 1));

  let enqueued = 0;
  let skipped = 0;
  for (const source of dueSources) {
    const result = await enqueueSourceFetch({
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.sourceType,
      collectorType: source.collectorType,
      config: source.config as Record<string, unknown>,
    }, {
      reason: 'cron',
      priority: source.priority ?? 5,
      dedupeKey: 'due',
    });
    if (result.enqueued) enqueued++;
    else skipped++;
  }

  logger.info({ enqueued, skipped, total: dueSources.length, mode: 'hybrid', userId: userId || 'all' }, 'Enqueued due fetch jobs');
  return { enqueued, skipped, total: dueSources.length };
}

export async function handleFetchJob(job: Job<FetchJobData>): Promise<FetchExecutionSummary | void> {
  const { sourceId, sourceName, collectorType, config: sourceConfig } = job.data;
  const sourceRows = await db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.id, sourceId))
    .limit(1);

  const source = sourceRows[0];
  if (!source) {
    logger.warn({ sourceId, sourceName }, 'Fetch job skipped because source no longer exists');
    return;
  }

  const effectiveCollectorType = source.collectorType || collectorType;
  const collector = collectors[effectiveCollectorType];
  if (!collector) {
    logger.warn({ sourceId, collectorType: effectiveCollectorType }, 'Unknown collector type, skipping');
    return;
  }

  const logEntry = await db.insert(schema.fetchLogs).values({
    sourceId,
    status: 'running',
  }).returning();
  const logId = logEntry[0]?.id;

  const startTime = Date.now();

  try {
    const result = await collector.fetch({
      id: sourceId,
      name: source.name,
      sourceType: source.sourceType,
      collectorType: effectiveCollectorType,
      config: (source.config as Record<string, unknown>) || sourceConfig,
      category: source.category || '',
      priority: source.priority ?? 3,
      fetchInterval: source.fetchInterval ?? 60,
      status: source.status || 'active',
    });

    if (result.error) {
      await db.update(schema.sources).set({
        errorCount: sql`${schema.sources.errorCount} + 1`,
        lastError: result.error,
        lastFetchedAt: new Date(),
      }).where(eq(schema.sources.id, sourceId));
    }

    const userId = source.userId;
    if (!userId) {
      logger.error({ sourceId }, 'Source not found or no userId');
      return;
    }

    let newCount = 0;
    const newItemIds: string[] = [];
    let filteredCount = 0;
    let duplicateCount = 0;
    let aiQueuedCount = 0;
    const autoCandidates: AutoTranscribeCandidate[] = [];
    for (const rawItem of result.items) {
      if (!rawItem.url) continue;

      try {
        const snippet = buildSnippet(rawItem.content, 220);
        const inferredLanguage = detectLikelyLanguage(`${rawItem.title}\n${rawItem.content || snippet || ''}`);
        const contentStatus = rawItem.content
          ? 'ready'
          : snippet
            ? 'ready'
            : 'missing';
        const filterResult = await applyFilterRules({
          title: rawItem.title,
          content: rawItem.content,
          snippet,
          author: rawItem.author,
          language: inferredLanguage,
          sourceId,
        }, userId);

        const inserted = await db.insert(schema.items).values({
          sourceId,
          userId,
          sourceType: source.sourceType,
          sourceTier: source.sourceTier || 'B',
          processingProfile: source.processingProfile || 'brief',
          growthAxes: Array.isArray(source.growthAxes) ? source.growthAxes : ['认知升级'],
          guid: rawItem.guid || rawItem.url,
          title: rawItem.title,
          url: rawItem.url,
          author: rawItem.author,
          content: rawItem.content,
          snippet,
          language: inferredLanguage,
          publishedAt: rawItem.publishedAt,
          mediaUrl: rawItem.mediaUrl,
          mediaType: rawItem.mediaType,
          audioDuration: rawItem.audioDuration,
          isFiltered: !filterResult.passed,
          filterReason: filterResult.reason ?? null,
          contentStatus,
          contentError: contentStatus === 'missing' ? '采集阶段未获得正文缓存' : null,
          summaryStatus: 'pending',
          summaryBasis: null,
          translationStatus: 'pending',
          translationReason: null,
          processingStatus: 'raw',
          audioStatus: rawItem.mediaType === 'audio' ? 'none' : 'none',
          audioStatusReason: rawItem.mediaType === 'audio' ? '等待音频策略判定' : null,
        }).onConflictDoNothing().returning({
          id: schema.items.id,
          title: schema.items.title,
          url: schema.items.url,
          mediaUrl: schema.items.mediaUrl,
          mediaType: schema.items.mediaType,
          audioDuration: schema.items.audioDuration,
          sourceType: schema.items.sourceType,
        });
        if (inserted.length > 0) {
          newCount++;
          newItemIds.push(inserted[0].id);
          if (!filterResult.passed) filteredCount++;
          autoCandidates.push({
            itemId: inserted[0].id,
            userId,
            sourceId,
            sourceName,
            sourceType: inserted[0].sourceType,
            title: inserted[0].title,
            url: inserted[0].url,
            mediaUrl: inserted[0].mediaUrl,
            mediaType: inserted[0].mediaType,
            audioDuration: inserted[0].audioDuration,
            sourceAutoTranscribe: Boolean(source.autoTranscribe),
          });
        } else {
          duplicateCount++;
        }
      } catch (err) {
        duplicateCount++;
      }
    }

    const durationMs = Date.now() - startTime;
    const mergedConfig = result.sourceConfigPatch
      ? {
        ...((source.config as Record<string, unknown>) || sourceConfig || {}),
        ...result.sourceConfigPatch,
      }
      : undefined;

    const preAiOutcome: FetchOutcome = newCount === 0
      ? (result.outcomeHint === 'no_change' ? 'no_change' : (result.items.length === 0 ? 'no_items' : 'all_duplicate'))
      : filteredCount === newCount
        ? 'all_filtered'
        : 'new_items';

    await updateSourceSchedule(sourceId, source.fetchInterval ?? 60, preAiOutcome, {
      lastFetchedAt: new Date(),
      lastSuccessAt: new Date(),
      lastItemAt: result.items.length > 0 ? (result.items[0].publishedAt || new Date()) : undefined,
      errorCount: 0,
      lastError: result.error || null,
      healthScore: result.error ? Math.max((source.healthScore ?? 100) - 10, 60) : 100,
      config: mergedConfig as Record<string, unknown> | undefined,
    });

    if (logId) {
      await db.update(schema.fetchLogs).set({
        finishedAt: new Date(),
        status: 'success',
        itemsFound: result.items.length,
        itemsNew: newCount,
        itemsFiltered: filteredCount,
        itemsDuplicate: duplicateCount,
        itemsQueuedAi: 0,
        outcome: preAiOutcome,
        durationMs,
      }).where(eq(schema.fetchLogs.id, logId));
    }

    if (Boolean(source.autoTranscribe) && autoCandidates.length > 0) {
      for (const candidate of autoCandidates) {
        const autoResult = await maybeAutoTranscribeItem(candidate);
        if (autoResult.triggered) aiQueuedCount++;
      }
    }

    const outcome: FetchOutcome = aiQueuedCount > 0
      ? 'ai_queued'
      : newCount === 0
        ? (result.outcomeHint === 'no_change' ? 'no_change' : (result.items.length === 0 ? 'no_items' : 'all_duplicate'))
        : filteredCount === newCount
          ? 'all_filtered'
          : 'new_items';

    if (logId) {
      await db.update(schema.fetchLogs).set({
        itemsQueuedAi: aiQueuedCount,
        outcome,
      }).where(eq(schema.fetchLogs.id, logId));
    }

    await updateSourceSchedule(sourceId, source.fetchInterval ?? 60, outcome, {
      lastFetchedAt: new Date(),
      lastSuccessAt: new Date(),
      lastOutcome: outcome,
      errorCount: 0,
      lastError: result.error || null,
      healthScore: result.error ? Math.max((source.healthScore ?? 100) - 10, 60) : 100,
      config: mergedConfig as Record<string, unknown> | undefined,
    });

    logger.info({ sourceId, sourceName, found: result.items.length, new: newCount, durationMs }, 'Fetch complete');
    return {
      sourceId,
      sourceName,
      itemsFound: result.items.length,
      itemsNew: newCount,
      newItemIds,
      itemsFiltered: filteredCount,
      itemsDuplicate: duplicateCount,
      itemsQueuedAi: aiQueuedCount,
      outcome,
      durationMs,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startTime;

    const nextErrorCount = (source.errorCount ?? 0) + 1;
    await updateSourceSchedule(sourceId, source.fetchInterval ?? 60, 'error', {
      errorCount: nextErrorCount,
      lastError: message,
      lastFetchedAt: new Date(),
      healthScore: Math.max((source.healthScore ?? 100) - 20, 20),
    });

    if (logId) {
      await db.update(schema.fetchLogs).set({
        finishedAt: new Date(),
        status: 'error',
        outcome: 'error',
        error: message,
        durationMs,
      }).where(eq(schema.fetchLogs.id, logId));
    }

    throw err;
  }
}

export async function fetchSourceNow(data: FetchJobData) {
  return handleFetchJob({ data } as Job<FetchJobData>);
}
