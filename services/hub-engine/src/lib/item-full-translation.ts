import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { translateItemsDetailed } from '../processors/ai-summarizer.js';
import {
  ensureItemContent,
  resolveItemText,
  shouldFetchContentBeforeFullTranslation,
} from './item-enrichment.js';
import {
  buildItemTranslationProgress,
  type ItemTranslationProgress,
} from './item-translation-progress.js';

export type FullItemTranslationResult = {
  message: string;
  stage: 'content' | 'translation' | 'done';
  contentFetched: boolean;
  translated: number;
  skipped: number;
  errors: string[];
  errorReason: string | null;
  item: typeof schema.items.$inferSelect | null;
};

export class FullItemTranslationError extends Error {
  statusCode: number;
  result: FullItemTranslationResult;

  constructor(message: string, result: FullItemTranslationResult, statusCode = 422) {
    super(message);
    this.name = 'FullItemTranslationError';
    this.statusCode = statusCode;
    this.result = result;
  }
}

export function humanizeFullTranslationError(error?: string | null): string {
  const message = String(error || '').trim();
  if (!message) return '全文翻译失败，请稍后重试。';
  if (/missing_translation_config|没有命中这条文章/i.test(message)) {
    return '当前没有可用的翻译模型配置，请先在模型设置中启用翻译模型。';
  }
  if (/primary_translation_failed|fallback_translation_failed|\b5\d\d\b|timeout|timed out|abort|fetch failed|econn|network|socket|stalled|lock/i.test(message)) {
    return '翻译模型暂时不可用，系统已尝试备用模型但仍未完成。请稍后重试，或检查翻译模型配置。';
  }
  if (/译文|translation_quality_incomplete|truncated_or_empty/i.test(message)) {
    return '模型返回的译文不完整，系统没有把它当作完整译文保存。请重新翻译或更换模型。';
  }
  return message;
}

export function shouldContinueFullTranslationWithExistingContent(item: {
  title: string;
  content?: string | null;
  snippet?: string | null;
  readabilityContent?: string | null;
  readabilityStatus?: string | null;
  sourceType?: string | null;
  sourceCollectorType?: string | null;
  fetchEngine?: string | null;
  renderMode?: string | null;
}, _warning?: string | null): boolean {
  const sourceType = String(item.sourceType || '').toLowerCase();
  const collectorType = String(item.sourceCollectorType || '').toLowerCase();
  const fetchEngine = String(item.fetchEngine || '').toLowerCase();
  const renderMode = String(item.renderMode || '').toLowerCase();
  const isIndexLike = sourceType === 'curated_index'
    || sourceType === 'webpage_index'
    || collectorType === 'webpage_index'
    || fetchEngine === 'webpage-index'
    || renderMode === 'index';
  if (isIndexLike) return false;

  const resolved = resolveItemText(item);
  const textLength = resolved.text.replace(/\s+/g, ' ').trim().length;
  return resolved.basis === 'content' && textLength >= 500;
}

export async function runFullItemTranslation(
  userId: string,
  itemId: string,
  options: {
    onProgress?: (progress: ItemTranslationProgress) => void | Promise<void>;
  } = {},
): Promise<FullItemTranslationResult> {
  const onProgress = options.onProgress || (() => undefined);
  await onProgress(buildItemTranslationProgress('fetching_content', {
    detail: { itemId },
  }));

  const rows = await db
    .select({
      id: schema.items.id,
      language: schema.items.language,
      title: schema.items.title,
      url: schema.items.url,
      content: schema.items.content,
      snippet: schema.items.snippet,
      readabilityContent: schema.items.readabilityContent,
      readabilityStatus: schema.items.readabilityStatus,
      originalUrl: schema.items.originalUrl,
      sourceType: schema.items.sourceType,
      sourceCollectorType: schema.sources.collectorType,
      sourceRole: schema.sources.sourceRole,
      sourceProcessingProfile: schema.sources.processingProfile,
      sourceConfig: schema.sources.config,
      contentStatus: schema.items.contentStatus,
      fetchEngine: schema.items.fetchEngine,
      renderMode: schema.items.renderMode,
    })
    .from(schema.items)
    .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
    .where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)))
    .limit(1);

  const item = rows[0];
  if (!item) {
    const result = await buildCurrentResult(userId, itemId, {
      message: 'Item not found',
      stage: 'content',
      contentFetched: false,
      translated: 0,
      skipped: 0,
      errors: ['Item not found'],
      errorReason: 'Item not found',
    });
    throw new FullItemTranslationError('Item not found', result, 404);
  }

  let stage: 'content' | 'translation' | 'done' = 'translation';
  let contentFetched = false;
  const sourceConfig = (item.sourceConfig && typeof item.sourceConfig === 'object')
    ? item.sourceConfig as Record<string, unknown>
    : {};
  if (shouldFetchContentBeforeFullTranslation({
    ...item,
    sourceContentStrategy: sourceConfig.contentStrategy as string | null | undefined,
    sourceProcessingProfile: item.sourceProcessingProfile,
  })) {
    stage = 'content';
    const contentResult = await ensureItemContent(userId, itemId, { force: true });
    contentFetched = contentResult.contentFetched;
    if (!contentFetched) {
      const errorReason = contentResult.warning || '原文补抓失败，无法生成完整译文。';
      const fallbackItem = contentResult.item || item;
      if (shouldContinueFullTranslationWithExistingContent(fallbackItem, errorReason)) {
        await onProgress(buildItemTranslationProgress('preparing_translation', {
          message: '原站补抓未命中，已改用当前缓存正文继续生成完整译文。',
          detail: { itemId, fallbackReason: errorReason },
        }));
        stage = 'translation';
      } else {
        const result = await buildCurrentResult(userId, itemId, {
          message: errorReason,
          stage,
          contentFetched,
          translated: 0,
          skipped: 0,
          errors: [errorReason],
          errorReason,
        });
        throw new FullItemTranslationError(errorReason, result, 422);
      }
    }
    stage = 'translation';
  }

  await onProgress(buildItemTranslationProgress('preparing_translation', {
    detail: { itemId, contentFetched },
  }));

  await db.update(schema.items).set({
    translationStatus: 'pending',
    translationReason: null,
    processingStatus: 'summarized',
  }).where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)));

  await onProgress(buildItemTranslationProgress('translating', {
    detail: { itemId },
  }));

  const result = await translateItemsDetailed(userId, 1, {
    itemId,
    includeAnyStatus: true,
    force: true,
  });

  if (result.processed === 0 && result.errors.length > 0) {
    const errorReason = humanizeFullTranslationError(result.errors[0]);
    const failedResult = await buildCurrentResult(userId, itemId, {
      message: errorReason,
      stage: 'translation',
      contentFetched,
      translated: 0,
      skipped: result.skipped || 0,
      errors: result.errors,
      errorReason,
    });
    throw new FullItemTranslationError(errorReason, failedResult, 502);
  }

  if (result.processed === 0 && result.skipped === 0) {
    const errorReason = humanizeFullTranslationError('missing_translation_config');
    const failedResult = await buildCurrentResult(userId, itemId, {
      message: errorReason,
      stage: 'translation',
      contentFetched,
      translated: 0,
      skipped: 0,
      errors: ['missing_translation_config'],
      errorReason,
    });
    throw new FullItemTranslationError(errorReason, failedResult, 422);
  }

  await onProgress(buildItemTranslationProgress('saving', {
    detail: { itemId, translated: result.processed, skipped: result.skipped || 0 },
  }));

  const refreshed = await selectCurrentItem(userId, itemId);
  return {
    message: result.processed > 0
      ? '全文翻译完成，译文已刷新。'
      : result.skipped > 0
        ? '全文翻译被跳过：通常是原文已识别为中文，或当前内容缺少可翻译正文。'
        : '全文翻译没有执行：可能缺少翻译模型配置，或后端没有命中这条文章。',
    stage: result.processed > 0 ? 'done' : stage,
    contentFetched,
    translated: result.processed,
    skipped: result.skipped || 0,
    errors: result.errors,
    errorReason: result.errors[0] || null,
    item: refreshed,
  };
}

async function selectCurrentItem(userId: string, itemId: string) {
  const refreshed = await db.select()
    .from(schema.items)
    .where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)))
    .limit(1);
  return refreshed[0] || null;
}

async function buildCurrentResult(
  userId: string,
  itemId: string,
  partial: Omit<FullItemTranslationResult, 'item'>,
): Promise<FullItemTranslationResult> {
  return {
    ...partial,
    item: await selectCurrentItem(userId, itemId),
  };
}
