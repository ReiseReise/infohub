import { observeNewItem, observeJev } from '../jev/queue.js';
import { eq, and, lte, or, sql } from 'drizzle-orm';
import { config } from '../config/index.js';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { classifyCollectorFetchResult } from '../lib/fetch-result-policy.js';
import { RssCollector } from '../collectors/rss.js';
import { RsshubCollector } from '../collectors/rsshub.js';
import { ChangedetectionCollector } from '../collectors/changedetection.js';
import { YoutubeCollector } from '../collectors/youtube.js';
import { CustomCollector } from '../collectors/custom.js';
import { WebpageCollector } from '../collectors/webpage.js';
import { WebpageIndexCollector } from '../collectors/webpage-index.js';
import type { Collector, SourceConfig, RawItem } from '../collectors/base.js';
import { fetchQueue, processQueue, type FetchJobData } from './queue.js';
import type { Job } from 'bullmq';
import { isFetchJobInFlight, shouldRemoveExistingFetchJob } from './fetch-dedupe.js';
import { buildSnippet, detectLikelyLanguage } from '../lib/content-extractor.js';
import { classifyCollectedContentStatus, classifyCollectedReadabilityState, contentStatusMessage } from '../lib/content-status.js';
import { maybeAutoTranscribeItem, type AutoTranscribeCandidate } from '../services/auto-transcribe.js';
import { buildEventClusterKey } from '../lib/event-clustering.js';
import { applyFilterRules } from '../processors/filter.js';
import { resolveFetchJobTimeoutMs } from '../lib/fetch-trigger-policy.js';
import {
  buildDuplicateContentUpgradeResetPatch,
  buildAutomaticItemAiJobId,
  mergeContentProcessingCandidateIds,
  shouldQueueAutomaticContentProcessing,
  shouldReplaceDuplicateContent,
  shouldUpgradeDuplicateProvenance,
} from '../lib/duplicate-content-upgrade.js';
import { shouldAutoUpgradeReadableContent } from '../lib/content-upgrade-policy.js';
import { ensureItemContent } from '../lib/item-enrichment.js';
import { getUserFetchSettings } from '../lib/fetch-settings.js';
import {
  mergeExternalRadarMetadata,
  radarComparableUrl,
} from '../lib/external-radar-dedupe.js';
import { rankDueSources } from '../lib/source-scheduling-policy.js';
import { resolveAudioRuntimePolicy } from '../lib/runtime-security-policy.js';

const collectors: Record<string, Collector> = {
  rss: new RssCollector(),
  rsshub: new RsshubCollector(),
  changedetection: new ChangedetectionCollector(),
  youtube: new YoutubeCollector(),
  custom: new CustomCollector(),
  webpage: new WebpageCollector(),
  webpage_index: new WebpageIndexCollector(),
};

const MAX_AUTO_CONTENT_UPGRADES_PER_FETCH = 3;

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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label}_timeout_${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
      if (isFetchJobInFlight(state)) {
        return { jobId, enqueued: false, state };
      }
      if (shouldRemoveExistingFetchJob(state)) {
        await existing.remove();
        logger.debug({ jobId, state, sourceId: params.sourceId }, 'Removed terminal fetch job before re-enqueue');
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
  itemsUpdated?: number;
  updatedItemIds?: string[];
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
  const dueSources = await db
    .select({
      id: schema.sources.id,
      userId: schema.sources.userId,
      name: schema.sources.name,
      sourceType: schema.sources.sourceType,
      collectorType: schema.sources.collectorType,
      config: schema.sources.config,
      priority: schema.sources.priority,
      sourceTier: schema.sources.sourceTier,
      processingProfile: schema.sources.processingProfile,
      fetchInterval: schema.sources.fetchInterval,
      lastFetchedAt: schema.sources.lastFetchedAt,
      nextFetchAt: schema.sources.nextFetchAt,
      healthScore: schema.sources.healthScore,
      errorCount: schema.sources.errorCount,
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
    ));

  const rankedSources = rankDueSources(dueSources, now);
  const selectedSources = rankedSources.slice(0, Math.max(limit, 1));

  let enqueued = 0;
  let skipped = 0;
  for (const [index, source] of selectedSources.entries()) {
    const result = await enqueueSourceFetch({
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.sourceType,
      collectorType: source.collectorType,
      config: source.config as Record<string, unknown>,
    }, {
      reason: 'cron',
      // BullMQ uses smaller numbers for higher priority. Rank 0 stays below manual priority 1.
      priority: Math.min(index + 2, 100),
      dedupeKey: 'due',
    });
    if (result.enqueued) enqueued++;
    else skipped++;
  }

  logger.info({
    enqueued,
    skipped,
    total: selectedSources.length,
    evaluated: dueSources.length,
    mode: 'hybrid-quality-ranked',
    userId: userId || 'all',
    selection: selectedSources.slice(0, 10).map((source) => ({
      sourceId: source.id,
      score: source.score,
      overdueRatio: source.overdueRatio,
      priorityScore: source.priorityScore,
      starvationScore: source.starvationScore,
      fetchCost: source.fetchCost,
      reason: source.reason,
    })),
  }, 'Enqueued due fetch jobs');
  return { enqueued, skipped, total: selectedSources.length, evaluated: dueSources.length };
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
    const result = await withTimeout(collector.fetch({
      id: sourceId,
      name: source.name,
      sourceType: source.sourceType,
      collectorType: effectiveCollectorType,
      sourceTier: source.sourceTier || 'B',
      processingProfile: source.processingProfile || 'brief',
      sourceRole: source.sourceRole || 'normal',
      config: (source.config as Record<string, unknown>) || sourceConfig,
      category: source.category || '',
      priority: source.priority ?? 3,
      fetchInterval: source.fetchInterval ?? 60,
      status: source.status || 'active',
    }), resolveFetchJobTimeoutMs(effectiveCollectorType, {
      processingProfile: source.processingProfile,
      sourceTier: source.sourceTier,
      config: (source.config as Record<string, unknown>) || sourceConfig,
    }), `collector_${effectiveCollectorType}`);

    const collectorResultStatus = classifyCollectorFetchResult(result);
    if (collectorResultStatus === 'error') {
      throw new Error(result.error || 'collector_returned_no_items');
    }
    if (collectorResultStatus === 'degraded_success') {
      logger.warn({ sourceId, error: result.error, items: result.items.length }, 'Collector returned usable items with a degraded result');
    }

    const userId = source.userId;
    if (!userId) {
      logger.error({ sourceId }, 'Source not found or no userId');
      return;
    }

    let newCount = 0;
    const newItemIds: string[] = [];
    let updatedCount = 0;
    const updatedItemIds: string[] = [];
    let filteredCount = 0;
    let duplicateCount = 0;
    let aiQueuedCount = 0;
    let autoContentUpgradeAttempts = 0;
    const autoCandidates: AutoTranscribeCandidate[] = [];
    const autoAiCandidateIds: string[] = [];
    const contentUpgradeItemIds: string[] = [];
    const contentUpgradeBodies = new Map<string, string>();
    for (const rawItem of result.items) {
      if (!rawItem.url) continue;

      try {
        if (String(rawItem.curationSource || '').trim().toLowerCase() === 'ai hot') {
          const comparable = radarComparableUrl(rawItem.originalUrl || rawItem.url);
          if (comparable) {
            const radarMatch = comparable.queryless
              ? sql`(
                  ${schema.items.url} in (${rawItem.url}, ${comparable.normalized})
                  or ${schema.items.originalUrl} in (${rawItem.url}, ${comparable.normalized})
                  or rtrim(split_part(split_part(coalesce(${schema.items.originalUrl}, ${schema.items.url}), '#', 1), '?', 1), '/') = ${comparable.queryless}
                )`
              : or(
                  eq(schema.items.url, rawItem.url),
                  eq(schema.items.url, comparable.normalized),
                  eq(schema.items.originalUrl, rawItem.url),
                  eq(schema.items.originalUrl, comparable.normalized),
                );
            const existingRadarRows = await db
              .select({
                id: schema.items.id,
                curationUrl: schema.items.curationUrl,
                curationSource: schema.items.curationSource,
                curationMeta: schema.items.curationMeta,
              })
              .from(schema.items)
              .where(and(eq(schema.items.userId, userId), radarMatch))
              .limit(1);
            const existingRadarItem = existingRadarRows[0];
            if (existingRadarItem) {
              await db.update(schema.items).set({
                curationUrl: existingRadarItem.curationUrl || rawItem.curationUrl || null,
                curationSource: existingRadarItem.curationSource || rawItem.curationSource || null,
                curationMeta: mergeExternalRadarMetadata({
                  existing: existingRadarItem.curationMeta,
                  incoming: rawItem.curationMeta,
                  provider: 'aihot',
                }),
              }).where(and(eq(schema.items.id, existingRadarItem.id), eq(schema.items.userId, userId)));
              updatedCount += 1;
              updatedItemIds.push(existingRadarItem.id);
              duplicateCount += 1;
              continue;
            }
          }
        }

        const snippet = buildSnippet(rawItem.content, 220);
        const inferredLanguage = detectLikelyLanguage(`${rawItem.title}\n${rawItem.content || snippet || ''}`);
        const contentStatus = classifyCollectedContentStatus({
          content: rawItem.content,
          snippet,
        });
        const readabilityState = classifyCollectedReadabilityState({
          readabilityContent: rawItem.readabilityContent,
          contentStatus,
        });
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
          clusterId: buildEventClusterKey(rawItem.title, rawItem.content || snippet),
          guid: rawItem.guid || rawItem.url,
          title: rawItem.title,
          url: rawItem.url,
          originalUrl: rawItem.originalUrl ?? null,
          curationUrl: rawItem.curationUrl ?? null,
          curationSource: rawItem.curationSource ?? null,
          curationMeta: rawItem.curationMeta ?? {},
          author: rawItem.author,
          content: rawItem.content,
          readabilityContent: rawItem.readabilityContent ?? null,
          readabilityStatus: readabilityState.readabilityStatus,
          readabilityReason: readabilityState.readabilityReason,
          snippet,
          language: inferredLanguage,
          publishedAt: rawItem.publishedAt,
          mediaUrl: rawItem.mediaUrl,
          mediaType: rawItem.mediaType,
          audioDuration: rawItem.audioDuration,
          isFiltered: !filterResult.passed,
          filterReason: filterResult.reason ?? null,
          qualityDecision: !filterResult.passed ? 'filter' : null,
          qualitySummary: !filterResult.passed ? (snippet || rawItem.title) : null,
          qualityReason: !filterResult.passed ? (filterResult.reason ?? '命中硬规则过滤') : null,
          qualityTags: !filterResult.passed ? ['硬规则过滤'] : [],
          qualityRiskFlags: [],
          qualityScore: null,
          qualityConfidence: !filterResult.passed ? 1 : null,
          qualityCheckedAt: !filterResult.passed ? new Date() : null,
          filterBucket: !filterResult.passed ? 'filtered' : 'main',
          restoredFromFilter: false,
          contentStatus,
          contentError: contentStatusMessage(contentStatus),
          summaryStatus: 'pending',
          summaryBasis: null,
          summaryReason: null,
          translationStatus: 'pending',
          translationReason: null,
          processingStatus: 'raw',
          fetchEngine: rawItem.fetchEngine ?? null,
          renderMode: rawItem.renderMode ?? null,
          blockedReason: rawItem.blockedReason ?? null,
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
          observeNewItem(inserted[0].id);
          if (effectiveCollectorType === "changedetection") observeJev("monitor", inserted[0].id);
          if (
            autoContentUpgradeAttempts < MAX_AUTO_CONTENT_UPGRADES_PER_FETCH
            && shouldAutoUpgradeReadableContent({
              url: rawItem.url,
              sourceType: source.sourceType,
              collectorType: effectiveCollectorType,
              sourceKind: source.sourceKind,
              sourceTier: source.sourceTier,
              sourceRole: source.sourceRole,
              processingProfile: source.processingProfile || 'brief',
              contentStrategy: (((source.config as Record<string, unknown>) || sourceConfig || {}) as Record<string, unknown>).contentStrategy as string | null | undefined,
              originalUrl: rawItem.originalUrl ?? null,
              fetchEngine: rawItem.fetchEngine ?? null,
              renderMode: rawItem.renderMode ?? null,
            })
          ) {
            autoContentUpgradeAttempts += 1;
            try {
              await ensureItemContent(userId, inserted[0].id, { force: true });
            } catch (error) {
              logger.warn({
                sourceId,
                itemId: inserted[0].id,
                url: rawItem.originalUrl || rawItem.url,
                error: error instanceof Error ? error.message : String(error),
              }, 'Auto content upgrade failed for index item');
            }
          }
          if (!filterResult.passed) filteredCount++;
          if (filterResult.passed) autoAiCandidateIds.push(inserted[0].id);
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
          const guid = rawItem.guid || rawItem.url;
          const existingRows = await db
            .select({
              id: schema.items.id,
              content: schema.items.content,
              originalUrl: schema.items.originalUrl,
              curationUrl: schema.items.curationUrl,
              curationSource: schema.items.curationSource,
              curationMeta: schema.items.curationMeta,
            })
            .from(schema.items)
            .where(and(
              eq(schema.items.userId, userId),
              or(
                and(eq(schema.items.sourceId, sourceId), eq(schema.items.guid, guid)),
                eq(schema.items.url, rawItem.url),
              ),
            ))
            .limit(1);
          const existing = existingRows[0];
          const upgrade = existing
            ? shouldReplaceDuplicateContent({
              existingContent: existing.content,
              incomingContent: rawItem.content,
            })
            : null;
          const provenanceUpgrade = existing
            ? shouldUpgradeDuplicateProvenance({
              existingOriginalUrl: existing.originalUrl,
              incomingOriginalUrl: rawItem.originalUrl,
              existingCurationUrl: existing.curationUrl,
              incomingCurationUrl: rawItem.curationUrl,
            })
            : null;
          if (existing && upgrade?.replace) {
            await db.update(schema.items).set({
              title: rawItem.title,
              originalUrl: rawItem.originalUrl ?? null,
              curationUrl: rawItem.curationUrl ?? null,
              curationSource: rawItem.curationSource ?? null,
              curationMeta: rawItem.curationMeta ?? {},
              author: rawItem.author,
              content: rawItem.content,
              readabilityContent: rawItem.readabilityContent ?? null,
              readabilityStatus: readabilityState.readabilityStatus,
              readabilityReason: readabilityState.readabilityReason,
              snippet,
              language: inferredLanguage,
              publishedAt: rawItem.publishedAt,
              mediaUrl: rawItem.mediaUrl,
              mediaType: rawItem.mediaType,
              audioDuration: rawItem.audioDuration,
              clusterId: buildEventClusterKey(rawItem.title, rawItem.content || snippet),
              contentStatus,
              contentError: contentStatusMessage(contentStatus),
              ...buildDuplicateContentUpgradeResetPatch(upgrade.reason),
              fetchEngine: rawItem.fetchEngine ?? null,
              renderMode: rawItem.renderMode ?? null,
              blockedReason: rawItem.blockedReason ?? null,
            }).where(and(eq(schema.items.id, existing.id), eq(schema.items.userId, userId)));
            updatedCount++;
            updatedItemIds.push(existing.id);
            contentUpgradeItemIds.push(existing.id);
            contentUpgradeBodies.set(existing.id, String(rawItem.content || ''));
          } else if (existing && provenanceUpgrade?.upgrade) {
            const incomingCurationMeta = rawItem.curationMeta && Object.keys(rawItem.curationMeta).length > 0
              ? rawItem.curationMeta
              : (existing.curationMeta as Record<string, unknown> | null | undefined) || {};
            await db.update(schema.items).set({
              originalUrl: rawItem.originalUrl || existing.originalUrl || null,
              curationUrl: rawItem.curationUrl || existing.curationUrl || null,
              curationSource: rawItem.curationSource || existing.curationSource || null,
              curationMeta: incomingCurationMeta,
              fetchEngine: rawItem.fetchEngine ?? null,
              renderMode: rawItem.renderMode ?? null,
              blockedReason: rawItem.blockedReason ?? null,
            }).where(and(eq(schema.items.id, existing.id), eq(schema.items.userId, userId)));
            updatedCount++;
            updatedItemIds.push(existing.id);
          }
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
        error: result.error || null,
        durationMs,
      }).where(eq(schema.fetchLogs.id, logId));
    }

    const audioRuntimePolicy = resolveAudioRuntimePolicy({
      mode: 'automatic',
      globalEnabled: config.ai.enabled,
      sourceEnabled: source.autoTranscribe,
    });
    if (audioRuntimePolicy.run && autoCandidates.length > 0) {
      for (const candidate of autoCandidates) {
        const autoResult = await maybeAutoTranscribeItem(candidate);
        if (autoResult.triggered) aiQueuedCount++;
      }
    }

    const processingCandidateIds = mergeContentProcessingCandidateIds(autoAiCandidateIds, contentUpgradeItemIds);
    if (config.ai.enabled && processingCandidateIds.length > 0) {
      const aiSettings = await getUserFetchSettings(userId);
      if (shouldQueueAutomaticContentProcessing(aiSettings)) {
        for (const itemId of processingCandidateIds) {
          try {
            const contentUpgradeBody = contentUpgradeBodies.get(itemId);
            const processJobId = buildAutomaticItemAiJobId({
              itemId,
              reason: contentUpgradeBody === undefined ? 'new_item' : 'content_upgrade',
              content: contentUpgradeBody,
            });
            if (!processJobId) continue;
            await processQueue.add('ai-pipeline', {
              userId,
              itemId,
              stage: 'ai_pipeline',
              autoSummaryEnabled: aiSettings.autoSummaryEnabled,
              autoTranslationEnabled: aiSettings.autoTranslationEnabled,
            }, {
              jobId: processJobId,
            });
            aiQueuedCount++;
          } catch (error) {
            logger.warn({
              sourceId,
              itemId,
              error: error instanceof Error ? error.message : String(error),
            }, 'Automatic item AI processing enqueue failed');
          }
        }
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
      itemsUpdated: updatedCount,
      updatedItemIds,
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
