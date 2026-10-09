import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getActiveAiConfig } from '../processors/ai-scorer.js';
import { buildItemTranslationProgress } from '../lib/item-translation-progress.js';
import { buildSourceReadingTierCondition } from '../lib/source-reading-tier-sql.js';
import { itemTranslationQueue, type ItemTranslationJobData } from './queue.js';
import {
  buildItemTranslationRevision,
  buildItemTranslationJobId,
  buildItemTranslationJobOptions,
  evaluateTranslationProviderReadiness,
  ITEM_TRANSLATION_PRIORITIES,
  TRANSLATION_RUNTIME_VERIFICATION_TTL_MS,
  type TranslationProviderReadiness,
} from './item-translation-policy.js';

const AUTOMATIC_TERMINAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export async function resolveTranslationProviderReadiness(userId: string): Promise<TranslationProviderReadiness> {
  const config = await getActiveAiConfig(userId, 'translation');
  if (!config?.modelConfigId) {
    return evaluateTranslationProviderReadiness({ hasBinding: false });
  }
  const rows = await db.select({
    modelType: schema.modelConfigs.modelType,
    isActive: schema.modelConfigs.isActive,
    hasApiKey: sql<boolean>`coalesce(length("model_configs"."api_key_encrypted"), 0) > 0`,
    testStatus: schema.modelConfigs.testStatus,
    testedAt: schema.modelConfigs.testedAt,
  })
    .from(schema.modelConfigs)
    .where(eq(schema.modelConfigs.id, config.modelConfigId))
    .limit(1);
  const row = rows[0];
  const successRows = row ? await db.select({
    createdAt: schema.aiUsageLogs.createdAt,
  })
    .from(schema.aiUsageLogs)
    .where(and(
      eq(schema.aiUsageLogs.modelConfigId, config.modelConfigId),
      eq(schema.aiUsageLogs.status, 'success'),
      gte(
        schema.aiUsageLogs.createdAt,
        new Date(Date.now() - TRANSLATION_RUNTIME_VERIFICATION_TTL_MS),
      ),
    ))
    .orderBy(desc(schema.aiUsageLogs.createdAt))
    .limit(1) : [];
  return evaluateTranslationProviderReadiness({
    hasBinding: true,
    modelConfig: row ? {
      ...row,
      isActive: Boolean(row.isActive),
      hasApiKey: Boolean(row.hasApiKey),
      recentSuccessAt: successRows[0]?.createdAt || null,
    } : null,
  });
}

async function resolveItemTranslationRevision(userId: string, itemId: string): Promise<string> {
  const [itemRows, config] = await Promise.all([
    db.select({
      title: schema.items.title,
      content: schema.items.content,
      readabilityContent: schema.items.readabilityContent,
      snippet: schema.items.snippet,
    })
      .from(schema.items)
      .where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)))
      .limit(1),
    getActiveAiConfig(userId, 'translation'),
  ]);
  const item = itemRows[0];
  const modelRows = config?.modelConfigId ? await db.select({
    updatedAt: schema.modelConfigs.updatedAt,
  })
    .from(schema.modelConfigs)
    .where(eq(schema.modelConfigs.id, config.modelConfigId))
    .limit(1) : [];
  return buildItemTranslationRevision({
    ...item,
    modelConfigId: config?.modelConfigId || null,
    model: config?.model || null,
    modelConfigUpdatedAt: modelRows[0]?.updatedAt || null,
    promptTemplateId: config?.promptTemplateId || null,
  });
}

export async function markAutomaticTranslationPending(
  userId: string,
  itemId: string,
  reason: string,
): Promise<void> {
  await db.update(schema.items).set({
    processingStatus: 'summarized',
    translationStatus: 'pending',
    translationReason: reason,
  }).where(and(
    eq(schema.items.id, itemId),
    eq(schema.items.userId, userId),
    or(
      isNull(schema.items.translationStatus),
      inArray(schema.items.translationStatus, ['pending', 'failed']),
    ),
  ));
}

export async function enqueueItemTranslationJob(
  input: Omit<ItemTranslationJobData, 'requestedAt' | 'revision'> & {
    requestedAt?: string;
    revision?: string;
  },
) {
  const data: ItemTranslationJobData = {
    ...input,
    requestedAt: input.requestedAt || new Date().toISOString(),
    revision: input.revision || await resolveItemTranslationRevision(input.userId, input.itemId),
  };
  const jobId = buildItemTranslationJobId(data);
  const existing = await itemTranslationQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (['active', 'waiting', 'delayed', 'prioritized'].includes(state)) {
      if (data.mode === 'manual' && existing.data.mode === 'automatic' && state !== 'active') {
        await existing.updateData(data);
        if (state === 'delayed' && typeof existing.promote === 'function') {
          await existing.promote();
        }
        if (typeof existing.changePriority === 'function') {
          await existing.changePriority({ priority: ITEM_TRANSLATION_PRIORITIES.manual });
        }
      }
      return { job: existing, enqueued: false };
    }
    const terminalAt = existing.finishedOn || existing.processedOn || existing.timestamp;
    if (
      data.mode === 'automatic'
      && terminalAt
      && Date.now() - terminalAt < AUTOMATIC_TERMINAL_COOLDOWN_MS
    ) {
      return { job: existing, enqueued: false };
    }
    await existing.remove();
  }
  const job = await itemTranslationQueue.add('translate-item', data, {
    jobId,
    ...buildItemTranslationJobOptions(data.mode),
  });
  await job.updateProgress(buildItemTranslationProgress('queued', {
    detail: { itemId: data.itemId, mode: data.mode, trigger: data.trigger },
  }));
  return { job, enqueued: true };
}

export async function enqueueAutomaticTranslationCandidates(
  userId: string,
  limit = 5,
  trigger: Extract<ItemTranslationJobData['trigger'], 'cron' | 'debt'> = 'cron',
) {
  const readiness = await resolveTranslationProviderReadiness(userId);
  if (!readiness.ready) {
    return {
      selected: 0,
      enqueued: 0,
      itemIds: [] as string[],
      blockedReason: readiness.reason,
    };
  }
  const rows = await db.select({ id: schema.items.id })
    .from(schema.items)
    .innerJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
    .where(and(
      eq(schema.items.userId, userId),
      eq(schema.items.isFiltered, false),
      inArray(schema.items.processingStatus, ['summarized', 'translation_failed']),
      or(isNull(schema.items.translationStatus), ne(schema.items.translationStatus, 'ready')),
      buildSourceReadingTierCondition('high_value'),
    ))
    .orderBy(desc(schema.items.fetchedAt))
    .limit(Math.max(0, limit));

  let enqueued = 0;
  for (const row of rows) {
    const result = await enqueueItemTranslationJob({
      userId,
      itemId: row.id,
      mode: 'automatic',
      trigger,
    });
    if (result.enqueued) enqueued++;
  }
  return { selected: rows.length, enqueued, itemIds: rows.map((row) => row.id), blockedReason: null };
}
