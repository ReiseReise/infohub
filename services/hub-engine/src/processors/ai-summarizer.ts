import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { logAiUsage } from '../lib/ai-usage.js';
import { getActiveAiConfig, callLLM, buildAiStageResult, type AiStageResult } from './ai-scorer.js';
import { detectLikelyLanguage } from '../lib/content-extractor.js';
import { ensureItemContent, resolveItemText } from '../lib/item-enrichment.js';
import { AI_TOKEN_BUDGETS } from '../lib/ai-token-budgets.js';

type ProcessOptions = {
  itemId?: string;
  itemIds?: string[];
  includeAnyStatus?: boolean;
};

type LlmAggregate = {
  text: string;
  provider?: string;
  model?: string;
  endpointId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number | null;
  providerRequestId?: string | null;
  latencyMs?: number | null;
  apiKind?: string | null;
};

function unwrapJsonBlock(input: string): string {
  const trimmed = input.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() || trimmed;
}

function normalizeSummaryText(input: string): string {
  return unwrapJsonBlock(input)
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^摘要[:：]\s*/i, '')
    .replace(/^summary[:：]\s*/i, '')
    .trim();
}

function countMatches(input: string, pattern: RegExp): number {
  return (input.match(pattern) || []).length;
}

export function isMostlyChineseSummary(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  const hanCount = countMatches(text, /[\u4e00-\u9fff]/g);
  const latinCount = countMatches(text, /[A-Za-z]/g);
  if (hanCount >= 24) return true;
  if (hanCount >= 10 && hanCount >= latinCount / 2) return true;
  return hanCount > 0 && latinCount <= 12;
}

export function isUsableChineseSummary(input: string): boolean {
  const text = input.trim();
  if (!isMostlyChineseSummary(text)) return false;
  if (/^[{\[]/.test(text)) return false;
  if (/(请提供|未提供|无法进行|不能进行|很抱歉).{0,24}(摘要|改写|内容)/.test(text)) return false;
  return true;
}

export function parseSummaryResponse(input: string): { summary: string; tags: string[] } {
  const normalized = unwrapJsonBlock(input);
  let summary = '';
  let tags: string[] = [];

  try {
    const parsed = JSON.parse(normalized);
    summary = typeof parsed.summary === 'string'
      ? parsed.summary
      : typeof parsed.one_sentence === 'string'
        ? parsed.one_sentence
        : normalized;
    tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
      : [];
  } catch {
    summary = normalized.slice(0, 300);
  }

  return {
    summary: normalizeSummaryText(summary),
    tags,
  };
}

export function buildChineseSummaryRepairPrompt(title: string, sourceText: string): string {
  return [
    '请基于标题和正文写一段 120-220 字的简体中文摘要。',
    '只输出中文自然段，不要 JSON，不要英文整句；Claude、RAG、MCP、API、SDK 等英文专名可以保留。',
    '',
    `标题：${title}`,
    '正文：',
    sourceText.trim().slice(0, 2500),
  ].join('\n');
}

function shouldFetchFullContent(profile?: string | null, score?: number | null): boolean {
  if (profile === 'full') return true;
  if (profile === 'smart') return (score ?? 0) >= 60;
  return false;
}

export function resolveSummarySkipReason(input: {
  processingProfile?: string | null;
  aiScore?: number | null;
}): string | null {
  if (input.processingProfile === 'monitor') return '监控档位默认不做摘要';
  if (typeof input.aiScore === 'number' && input.aiScore < 40) return 'AI 评分过低，跳过摘要';
  return null;
}

function looksTruncatedText(input: string): boolean {
  const text = input.trim();
  if (!text) return true;
  if (/[—\-–:：,，、（(]$/.test(text)) return true;
  if (/(evidenced|including|such as|for example|例如|比如|包括)$/i.test(text)) return true;
  const fenceCount = (text.match(/```/g) || []).length;
  return fenceCount % 2 !== 0;
}

function mergeLlmResults(chunks: LlmAggregate[]): LlmAggregate {
  return chunks.reduce<LlmAggregate>((acc, chunk, index) => ({
    text: index === 0 ? chunk.text : `${acc.text}\n\n${chunk.text}`.trim(),
    inputTokens: (acc.inputTokens || 0) + (chunk.inputTokens || 0),
    outputTokens: (acc.outputTokens || 0) + (chunk.outputTokens || 0),
    totalTokens: (acc.totalTokens || 0) + (chunk.totalTokens || 0),
    estimatedCost: (acc.estimatedCost || 0) + (chunk.estimatedCost || 0),
    latencyMs: (acc.latencyMs || 0) + (chunk.latencyMs || 0),
    provider: chunk.provider || acc.provider,
    model: chunk.model || acc.model,
    endpointId: chunk.endpointId ?? acc.endpointId ?? null,
    providerRequestId: chunk.providerRequestId || acc.providerRequestId || null,
    apiKind: chunk.apiKind || acc.apiKind || null,
  }), {
    text: '',
    estimatedCost: 0,
    latencyMs: 0,
    endpointId: null,
    providerRequestId: null,
    apiKind: null,
  });
}

function splitTranslationSource(input: string, maxChars = 1800): string[] {
  const normalized = input.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buffer = '';

  const flush = () => {
    const trimmed = buffer.trim();
    if (trimmed) chunks.push(trimmed);
    buffer = '';
  };

  for (const paragraph of paragraphs) {
    if ((buffer.length + paragraph.length + 2) <= maxChars) {
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      continue;
    }

    if (buffer) flush();

    if (paragraph.length <= maxChars) {
      buffer = paragraph;
      continue;
    }

    const sentences = paragraph.split(/(?<=[.!?。！？])\s+/).filter(Boolean);
    for (const sentence of sentences) {
      if ((buffer.length + sentence.length + 1) <= maxChars) {
        buffer = buffer ? `${buffer} ${sentence}` : sentence;
      } else {
        if (buffer) flush();
        if (sentence.length <= maxChars) {
          buffer = sentence;
        } else {
          for (let index = 0; index < sentence.length; index += maxChars) {
            chunks.push(sentence.slice(index, index + maxChars).trim());
          }
        }
      }
    }
  }

  if (buffer) flush();
  return chunks.filter(Boolean);
}

async function rewriteSummaryAsChinese(
  config: Awaited<ReturnType<typeof getActiveAiConfig>>,
  title: string,
  summary: string,
): Promise<LlmAggregate> {
  if (!config) throw new Error('missing_summary_config');
  const prompt = [
    '请把下面这段摘要忠实改写成简体中文。',
    '要求：只输出中文；保留原有关键信息；不要扩写；长度控制在 120 到 220 字。',
    '',
    `标题：${title}`,
    '待改写摘要：',
    summary.trim(),
  ].join('\n');
  return callLLM(config, prompt, { maxTokens: AI_TOKEN_BUDGETS.feedSummaryRewrite });
}

async function repairSummaryFromSourceAsChinese(
  config: Awaited<ReturnType<typeof getActiveAiConfig>>,
  title: string,
  sourceText: string,
): Promise<LlmAggregate> {
  if (!config) throw new Error('missing_summary_config');
  return callLLM(config, buildChineseSummaryRepairPrompt(title, sourceText), {
    maxTokens: AI_TOKEN_BUDGETS.feedSummary,
  });
}

async function translateInChunks(
  config: Awaited<ReturnType<typeof getActiveAiConfig>>,
  title: string,
  sourceText: string,
): Promise<LlmAggregate> {
  if (!config) throw new Error('missing_translation_config');
  const chunks = splitTranslationSource(sourceText);
  if (chunks.length === 0) return { text: '' };

  const results: LlmAggregate[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const prompt = config.promptTemplate
      .replace('{title}', `${title}${chunks.length > 1 ? `（第 ${index + 1}/${chunks.length} 段）` : ''}`)
      .replace('{content}', chunks[index]);
    const result = await callLLM(config, prompt, { maxTokens: 1800 });
    results.push(result);
  }
  return mergeLlmResults(results);
}

export async function summarizeItems(userId: string, limit = 10, options: ProcessOptions = {}): Promise<number> {
  const result = await summarizeItemsDetailed(userId, limit, options);
  return result.processed;
}

export async function summarizeItemsDetailed(userId: string, limit = 10, options: ProcessOptions = {}): Promise<AiStageResult> {
  const config = await getActiveAiConfig(userId, 'summary');
  if (!config) {
    logger.debug('No active summary AI config, skipping');
    return buildAiStageResult(0, 0, []);
  }

  const conditions = [
    eq(schema.items.userId, userId),
    inArray(schema.items.processingStatus, ['scored', 'summary_failed']),
    eq(schema.items.isFiltered, false),
  ];
  if (options.itemId) {
    conditions.push(eq(schema.items.id, options.itemId));
  } else if (options.itemIds && options.itemIds.length > 0) {
    conditions.push(inArray(schema.items.id, options.itemIds));
  }

  const items = await db
    .select({
      id: schema.items.id,
      title: schema.items.title,
      snippet: schema.items.snippet,
      content: schema.items.content,
      contentStatus: schema.items.contentStatus,
      aiScore: schema.items.aiScore,
      sourceTier: schema.items.sourceTier,
      processingProfile: schema.items.processingProfile,
    })
    .from(schema.items)
    .where(and(...conditions))
    .orderBy(desc(schema.items.fetchedAt))
    .limit(options.itemId ? 1 : limit);

  if (items.length === 0) return buildAiStageResult(0, 0, []);

  let summarized = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const item of items) {
    const skipReason = resolveSummarySkipReason(item);
    if (skipReason) {
      await db.update(schema.items).set({
        processingStatus: 'done',
        summaryStatus: 'skipped',
        summaryReason: skipReason,
        translationStatus: 'skipped',
        translationReason: `${skipReason}，未进入翻译`,
      }).where(eq(schema.items.id, item.id));
      skipped++;
      continue;
    }

    try {
      let effectiveItem = item;
      let prompt = '';
      if (item.contentStatus !== 'ready' && shouldFetchFullContent(item.processingProfile, item.aiScore)) {
        const enriched = await ensureItemContent(userId, item.id);
        if (enriched.item) {
          effectiveItem = {
            ...effectiveItem,
            content: enriched.item.content,
            snippet: enriched.item.snippet,
            contentStatus: enriched.item.contentStatus,
          };
        }
      }
      const source = resolveItemText(effectiveItem);
      prompt = `${config.promptTemplate}

附加硬要求：最终摘要必须全部使用简体中文，不得保留英文句子、英文标题或英文小节名。`
        .replace('{title}', effectiveItem.title)
        .replace('{content}', source.text.slice(0, 4000));

      let result: LlmAggregate = await callLLM(config, prompt, { maxTokens: AI_TOKEN_BUDGETS.feedSummary });
      let { summary, tags } = parseSummaryResponse(result.text);
      if (!isUsableChineseSummary(summary)) {
        result = await rewriteSummaryAsChinese(config, effectiveItem.title, summary || result.text);
        const rewritten = parseSummaryResponse(result.text);
        summary = rewritten.summary;
        if (tags.length === 0) tags = rewritten.tags;
      }
      if (!isUsableChineseSummary(summary)) {
        result = await repairSummaryFromSourceAsChinese(config, effectiveItem.title, source.text);
        const repaired = parseSummaryResponse(result.text);
        summary = repaired.summary;
        if (tags.length === 0) tags = repaired.tags;
      }
      if (!summary || !isUsableChineseSummary(summary)) {
        throw new Error('summary_must_be_chinese');
      }

      await db.update(schema.items).set({
        aiSummary: summary,
        aiTags: tags,
        processingStatus: 'summarized',
        summaryStatus: 'ready',
        summaryReason: null,
        summaryBasis: source.basis,
      }).where(eq(schema.items.id, item.id));

      await logAiUsage({
        userId,
        sceneType: 'feed_summary',
        status: 'success',
        provider: result.provider || config.provider,
        modelName: result.model || config.model,
        endpointId: result.endpointId || null,
        modelConfigId: config.modelConfigId || null,
        promptTemplateId: config.promptTemplateId || null,
        targetType: 'item',
        targetId: item.id,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
        estimatedCost: result.estimatedCost,
        latencyMs: result.latencyMs,
        providerRequestId: result.providerRequestId,
        apiKind: result.apiKind,
        promptPreview: prompt,
        responsePreview: summary,
        label: effectiveItem.title,
      });

      summarized++;
      logger.debug({ itemId: item.id, summaryLen: summary.length, tagsCount: tags.length }, 'Item summarized');
    } catch (err) {
      const message = (err as Error).message;
      logger.error({ itemId: item.id, error: message }, 'Summarization failed');
      await db.update(schema.items).set({
        processingStatus: 'summary_failed',
        summaryStatus: 'failed',
        summaryReason: message,
      }).where(eq(schema.items.id, item.id));
      await logAiUsage({
        userId,
        sceneType: 'feed_summary',
        status: 'error',
        provider: config.provider,
        modelName: config.model,
        endpointId: config.provider === 'volcengine_ark' && config.model.startsWith('ep-') ? config.model : null,
        modelConfigId: config.modelConfigId || null,
        promptTemplateId: config.promptTemplateId || null,
        targetType: 'item',
        targetId: item.id,
        label: item.title,
        errorMessage: message,
      });
      errors.push(message);
    }
  }

  logger.info({ userId, summarized, skipped, total: items.length }, 'Batch summarization complete');
  return buildAiStageResult(summarized, items.length, errors, skipped);
}

export async function translateItems(userId: string, limit = 5): Promise<number> {
  return translateItemsWithOptions(userId, limit, {});
}

export async function translateItemsWithOptions(userId: string, limit = 5, options: ProcessOptions = {}): Promise<number> {
  const result = await translateItemsDetailed(userId, limit, options);
  return result.processed;
}

export async function translateItemsDetailed(userId: string, limit = 5, options: ProcessOptions = {}): Promise<AiStageResult> {
  const config = await getActiveAiConfig(userId, 'translation');
  if (!config) {
    logger.debug('No active translation AI config, skipping');
    return buildAiStageResult(0, 0, []);
  }

  const conditions = [
    eq(schema.items.userId, userId),
    eq(schema.items.isFiltered, false),
  ];
  if (!options.includeAnyStatus) {
    conditions.push(inArray(schema.items.processingStatus, ['summarized', 'translation_failed']));
  }
  if (options.itemId) {
    conditions.push(eq(schema.items.id, options.itemId));
  } else if (options.itemIds && options.itemIds.length > 0) {
    conditions.push(inArray(schema.items.id, options.itemIds));
  }

  const items = await db
    .select({
      id: schema.items.id,
      title: schema.items.title,
      snippet: schema.items.snippet,
      content: schema.items.content,
      language: schema.items.language,
      contentStatus: schema.items.contentStatus,
      aiScore: schema.items.aiScore,
      sourceTier: schema.items.sourceTier,
      processingProfile: schema.items.processingProfile,
    })
    .from(schema.items)
    .where(and(...conditions))
    .orderBy(desc(schema.items.fetchedAt))
    .limit(options.itemId ? 1 : limit);

  let translated = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const item of items) {
    let effectiveItem = item;
    let prompt = '';
    if (item.processingProfile === 'monitor') {
      await db.update(schema.items).set({
        processingStatus: 'done',
        translationStatus: 'skipped',
        translationReason: '监控档位默认不做翻译',
      }).where(eq(schema.items.id, item.id));
      skipped++;
      continue;
    }
    if (item.contentStatus !== 'ready' && shouldFetchFullContent(item.processingProfile, item.aiScore)) {
      const enriched = await ensureItemContent(userId, item.id);
      if (enriched.item) {
        effectiveItem = {
          ...effectiveItem,
          content: enriched.item.content,
          snippet: enriched.item.snippet,
          language: enriched.item.language,
          contentStatus: enriched.item.contentStatus,
        };
      }
    }

    const source = resolveItemText(effectiveItem);
    const effectiveLanguage = effectiveItem.language || detectLikelyLanguage(`${effectiveItem.title}\n${source.text}`);
    if (!effectiveLanguage || effectiveLanguage === 'zh') {
      await db.update(schema.items).set({
        processingStatus: 'done',
        translationStatus: 'skipped',
        translationReason: effectiveLanguage === 'zh' ? '原文已是中文' : '未能识别为外文',
      }).where(eq(schema.items.id, item.id));
      skipped++;
      continue;
    }

    if (typeof item.aiScore === 'number' && item.aiScore < 50) {
      await db.update(schema.items).set({
        processingStatus: 'done',
        translationStatus: 'skipped',
        translationReason: 'AI 评分过低，跳过翻译',
      }).where(eq(schema.items.id, item.id));
      skipped++;
      continue;
    }
    if (item.processingProfile === 'brief' && typeof item.aiScore === 'number' && item.aiScore < 70) {
      await db.update(schema.items).set({
        processingStatus: 'done',
        translationStatus: 'skipped',
        translationReason: '轻处理档位仅翻译高分内容',
      }).where(eq(schema.items.id, item.id));
      skipped++;
      continue;
    }

    try {
      if (!source.text.trim()) {
        await db.update(schema.items).set({
          translationStatus: 'skipped',
          translationReason: '缺少可翻译正文',
        }).where(eq(schema.items.id, item.id));
        skipped++;
        continue;
      }
      const translationSource = source.text.slice(0, 4000);
      prompt = config.promptTemplate
        .replace('{title}', effectiveItem.title)
        .replace('{content}', translationSource);

      let result: LlmAggregate;
      if (translationSource.length > 1800) {
        result = await translateInChunks(config, effectiveItem.title, translationSource);
      } else {
        result = await callLLM(config, prompt, { maxTokens: 1800 });
        if (
          looksTruncatedText(result.text)
          || (translationSource.length > 1200 && result.text.trim().length < 220)
        ) {
          result = await translateInChunks(config, effectiveItem.title, translationSource);
        }
      }

      if (!result.text.trim() || looksTruncatedText(result.text)) {
        throw new Error('translation_truncated_or_empty');
      }

      await db.update(schema.items).set({
        aiTranslation: result.text,
        processingStatus: 'done',
        translationStatus: 'ready',
        translationReason: null,
      }).where(eq(schema.items.id, item.id));

      await logAiUsage({
        userId,
        sceneType: 'feed_translation',
        status: 'success',
        provider: result.provider || config.provider,
        modelName: result.model || config.model,
        endpointId: result.endpointId || null,
        modelConfigId: config.modelConfigId || null,
        promptTemplateId: config.promptTemplateId || null,
        targetType: 'item',
        targetId: item.id,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
        estimatedCost: result.estimatedCost,
        latencyMs: result.latencyMs,
        providerRequestId: result.providerRequestId,
        apiKind: result.apiKind,
        promptPreview: prompt,
        responsePreview: result.text,
        label: effectiveItem.title,
      });

      translated++;
      logger.debug({ itemId: item.id }, 'Item translated');
    } catch (err) {
      const message = (err as Error).message;
      logger.error({ itemId: item.id, error: message }, 'Translation failed');
      await logAiUsage({
        userId,
        sceneType: 'feed_translation',
        status: 'error',
        provider: config.provider,
        modelName: config.model,
        endpointId: config.provider === 'volcengine_ark' && config.model.startsWith('ep-') ? config.model : null,
        modelConfigId: config.modelConfigId || null,
        promptTemplateId: config.promptTemplateId || null,
        targetType: 'item',
        targetId: item.id,
        promptPreview: prompt,
        label: effectiveItem.title,
        errorMessage: message,
      });
      await db.update(schema.items).set({
        processingStatus: 'translation_failed',
        translationStatus: 'failed',
        translationReason: message,
      }).where(eq(schema.items.id, item.id));
      errors.push(message);
    }
  }

  logger.info({ userId, translated, skipped, total: items.length }, 'Batch translation complete');
  return buildAiStageResult(translated, items.length, errors, skipped);
}
