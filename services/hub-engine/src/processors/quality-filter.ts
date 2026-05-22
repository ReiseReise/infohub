import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { getEffectiveAiConfig, type ResolvedAiConfig } from '../lib/ai-configs.js';
import { buildSnippet } from '../lib/content-extractor.js';
import { ensureItemContent, resolveItemText } from '../lib/item-enrichment.js';
import { logAiUsage } from '../lib/ai-usage.js';
import { extractJsonPayload } from '../lib/scoring-skills.js';
import { getEffectiveQualityPolicyForSource } from '../lib/quality-policies.js';
import {
  normalizeConfidence,
  normalizeQualityDecision,
  resolveQualityOutcome,
  type QualityDecision,
} from '../lib/quality-filtering.js';
import { callLLM, type AiStageResult } from './ai-scorer.js';

type QualityFilterOptions = {
  itemId?: string;
  itemIds?: string[];
};

type ParsedQualityResponse = {
  decision: QualityDecision;
  summary: string | null;
  reason: string | null;
  tags: string[];
  riskFlags: string[];
  confidence: number;
  score: number | null;
  rawResponse: string;
  dimensionScores: Record<string, number>;
};

function buildStageResult(processed: number, attempted: number, errors: string[]): AiStageResult {
  return {
    processed,
    attempted,
    failed: Math.max(attempted - processed, 0),
    errors: [...new Set(errors)].slice(0, 3),
  };
}

function defaultQualityPrompt() {
  return [
    '你是信息中枢的内容质量质检代理。',
    '请根据标题和正文判断这条内容应保留、待复核还是进入过滤池。',
    '重点检查：信息密度、独立洞察、实操性、客观性/动机纯净度、目标相关性、认知增量。',
    '高风险信号：低信息密度、疑似导流、半对半错、情绪煽动、热点搬运、目标弱相关。',
    '只输出 JSON：',
    '{"decision":"pass|review|filter","summary":"一句话概要","reason":"一句话原因","tags":["..."],"riskFlags":["..."],"confidence":0-1,"score":0-100,"dimensionScores":{"density":0-100,"insight":0-100,"practicality":0-100,"objectivity":0-100,"goalFit":0-100,"novelty":0-100}}',
  ].join('\n');
}

function buildLocalQualitySummary(item: { title: string; content?: string | null; snippet?: string | null }) {
  const source = resolveItemText(item);
  return buildSnippet(source.text, 150) || item.snippet || item.title;
}

function renderQualityPrompt(template: string, input: {
  title: string;
  content: string;
  sourceTier: string;
  policyMode: string;
  policyAction: string;
}) {
  return (template || defaultQualityPrompt())
    .replace('{title}', input.title)
    .replace('{content}', input.content)
    .replace('{sourceTier}', input.sourceTier)
    .replace('{policyMode}', input.policyMode)
    .replace('{policyAction}', input.policyAction);
}

function clampScore(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, Number(parsed.toFixed(2))));
}

function normalizeTextArray(value: unknown, limit = 8) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeDimensionScores(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const normalized: Record<string, number> = {};
  for (const [key, entry] of Object.entries(raw)) {
    const score = clampScore(entry);
    if (score != null) normalized[key] = score;
  }
  return normalized;
}

function averageDimensionScores(scores: Record<string, number>) {
  const values = Object.values(scores).filter((value) => Number.isFinite(value));
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

export function parseQualityResponse(text: string): ParsedQualityResponse {
  const raw = extractJsonPayload(text);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const dimensionScores = normalizeDimensionScores(parsed.dimensionScores);
    const derivedScore = clampScore(parsed.score) ?? averageDimensionScores(dimensionScores);
    return {
      decision: normalizeQualityDecision(parsed.decision),
      summary: String(parsed.summary || '').trim() || null,
      reason: String(parsed.reason || '').trim() || null,
      tags: normalizeTextArray(parsed.tags),
      riskFlags: normalizeTextArray(parsed.riskFlags),
      confidence: normalizeConfidence(parsed.confidence),
      score: derivedScore,
      rawResponse: raw,
      dimensionScores,
    };
  } catch {
    return {
      decision: raw.match(/filter/i) ? 'filter' : raw.match(/pass/i) ? 'pass' : 'review',
      summary: null,
      reason: raw.slice(0, 180) || null,
      tags: [],
      riskFlags: [],
      confidence: 0.45,
      score: clampScore(raw.match(/\d{1,3}(?:\.\d+)?/)?.[0]),
      rawResponse: raw,
      dimensionScores: {},
    };
  }
}

async function recordQualityCheck(input: {
  userId: string;
  itemId: string;
  sourceId: number;
  config: ResolvedAiConfig;
  prompt: string;
  responseText: string;
  decision: string;
  summary: string | null;
  reason: string | null;
  tags: string[];
  riskFlags: string[];
  score: number | null;
  confidence: number | null;
  policySnapshot: Record<string, unknown>;
}) {
  await db.insert(schema.itemQualityChecks).values({
    itemId: input.itemId,
    userId: input.userId,
    sourceId: input.sourceId,
    sceneType: 'quality_filter',
    decision: input.decision,
    summary: input.summary,
    reason: input.reason,
    tags: input.tags,
    riskFlags: input.riskFlags,
    score: input.score,
    confidence: input.confidence,
    policySnapshot: input.policySnapshot,
    rawResponse: input.responseText,
    promptPreview: input.prompt,
    responsePreview: input.responseText,
    modelConfigId: input.config.modelConfigId || null,
    promptTemplateId: input.config.promptTemplateId || null,
  });
}

export async function qualityFilterItems(userId: string, limit = 10, options: QualityFilterOptions = {}) {
  const result = await qualityFilterItemsDetailed(userId, limit, options);
  return result.processed;
}

export async function qualityFilterItemsDetailed(userId: string, limit = 10, options: QualityFilterOptions = {}): Promise<AiStageResult> {
  const config = await getEffectiveAiConfig(userId, 'quality_filter');
  if (!config) {
    logger.debug({ userId }, 'No active quality filter config, skipping');
    return buildStageResult(0, 0, []);
  }

  const conditions = [
    eq(schema.items.userId, userId),
    eq(schema.items.processingStatus, 'raw'),
    isNull(schema.items.qualityCheckedAt),
  ];
  if (options.itemId) {
    conditions.push(eq(schema.items.id, options.itemId));
  } else if (options.itemIds && options.itemIds.length > 0) {
    conditions.push(inArray(schema.items.id, options.itemIds));
  }

  const rows = await db
    .select({
      id: schema.items.id,
      sourceId: schema.items.sourceId,
      sourceTier: schema.items.sourceTier,
      title: schema.items.title,
      content: schema.items.content,
      snippet: schema.items.snippet,
      contentStatus: schema.items.contentStatus,
      isFiltered: schema.items.isFiltered,
      filterReason: schema.items.filterReason,
    })
    .from(schema.items)
    .where(and(...conditions))
    .orderBy(desc(schema.items.fetchedAt))
    .limit(options.itemId ? 1 : limit);

  if (rows.length === 0) return buildStageResult(0, 0, []);

  let processed = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const sourceTier = (row.sourceTier || 'B') as 'S' | 'A' | 'B' | 'C' | 'D';
    const localSummary = buildLocalQualitySummary(row);

    if (row.isFiltered) {
      await db.update(schema.items).set({
        qualityDecision: 'filter',
        qualitySummary: localSummary,
        qualityReason: row.filterReason ?? '命中硬规则过滤',
        qualityTags: ['硬规则过滤'],
        qualityRiskFlags: [],
        qualityScore: null,
        qualityConfidence: 1,
        qualityCheckedAt: new Date(),
        filterBucket: 'filtered',
      }).where(eq(schema.items.id, row.id));
      processed++;
      continue;
    }

    try {
      let effectiveRow = row;
      if (row.contentStatus !== 'ready') {
        const enriched = await ensureItemContent(userId, row.id);
        if (enriched.item) {
          effectiveRow = {
            ...effectiveRow,
            content: enriched.item.content,
            snippet: enriched.item.snippet,
            contentStatus: enriched.item.contentStatus,
          };
        }
      }

      const policy = await getEffectiveQualityPolicyForSource(userId, row.sourceId, sourceTier);
      if (policy.mode === 'skip') {
        await db.update(schema.items).set({
          qualityDecision: 'pass',
          qualitySummary: localSummary,
          qualityReason: null,
          qualityTags: [],
          qualityRiskFlags: [],
          qualityScore: null,
          qualityConfidence: null,
          qualityCheckedAt: new Date(),
          filterBucket: 'main',
          isFiltered: false,
          filterReason: null,
        }).where(eq(schema.items.id, row.id));
        processed++;
        continue;
      }

      const source = resolveItemText({
        title: effectiveRow.title,
        content: effectiveRow.content,
        snippet: effectiveRow.snippet,
      });
      const prompt = renderQualityPrompt(config.promptTemplate, {
        title: effectiveRow.title,
        content: source.text.slice(0, 6000),
        sourceTier,
        policyMode: policy.mode,
        policyAction: policy.onFilter,
      });
      const result = await callLLM(config, prompt, { maxTokens: 420 });
      const parsed = parseQualityResponse(result.text);
      const outcome = resolveQualityOutcome({
        itemId: row.id,
        sourceTier,
        summary: parsed.summary || localSummary,
        reason: parsed.reason || '命中质量质检过滤',
        tags: parsed.tags,
        riskFlags: parsed.riskFlags,
        decision: parsed.decision,
        confidence: parsed.confidence,
        score: parsed.score,
        policy,
      });

      await db.update(schema.items).set({
        isFiltered: outcome.isFiltered,
        filterReason: outcome.filterReason,
        qualityDecision: outcome.qualityDecision,
        qualitySummary: outcome.summary,
        qualityReason: outcome.qualityReason,
        qualityTags: outcome.qualityTags,
        qualityRiskFlags: outcome.qualityRiskFlags,
        qualityScore: outcome.qualityScore,
        qualityConfidence: outcome.qualityConfidence,
        qualityCheckedAt: new Date(),
        filterBucket: outcome.filterBucket,
      }).where(eq(schema.items.id, row.id));

      await recordQualityCheck({
        userId,
        itemId: row.id,
        sourceId: row.sourceId,
        config,
        prompt,
        responseText: parsed.rawResponse,
        decision: outcome.qualityDecision,
        summary: outcome.summary,
        reason: outcome.qualityReason,
        tags: outcome.qualityTags,
        riskFlags: outcome.qualityRiskFlags,
        score: outcome.qualityScore,
        confidence: outcome.qualityConfidence,
        policySnapshot: {
          sourceTier,
          policy,
          dimensionScores: parsed.dimensionScores,
        },
      });

      await logAiUsage({
        userId,
        sceneType: 'quality_filter',
        status: 'success',
        provider: result.provider || config.provider,
        modelName: result.model || config.model,
        endpointId: result.endpointId || null,
        modelConfigId: config.modelConfigId || null,
        promptTemplateId: config.promptTemplateId || null,
        targetType: 'item',
        targetId: row.id,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
        estimatedCost: result.estimatedCost,
        latencyMs: result.latencyMs,
        providerRequestId: result.providerRequestId,
        apiKind: result.apiKind,
        promptPreview: prompt,
        responsePreview: result.text,
        label: `${effectiveRow.title} / quality_filter`,
      });

      processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      logger.error({ itemId: row.id, error: message }, 'Quality filter failed');
      await db.update(schema.items).set({
        qualityDecision: 'review',
        qualitySummary: localSummary,
        qualityReason: `待复核：AI 质检失败（${message}）`,
        qualityTags: ['质检失败'],
        qualityRiskFlags: ['AI质检失败'],
        qualityCheckedAt: new Date(),
        filterBucket: 'main',
        isFiltered: false,
        filterReason: `待复核：AI 质检失败（${message}）`,
      }).where(eq(schema.items.id, row.id));
      await logAiUsage({
        userId,
        sceneType: 'quality_filter',
        status: 'error',
        provider: config.provider,
        modelName: config.model,
        endpointId: config.provider === 'volcengine_ark' && config.model.startsWith('ep-') ? config.model : null,
        modelConfigId: config.modelConfigId || null,
        promptTemplateId: config.promptTemplateId || null,
        targetType: 'item',
        targetId: row.id,
        label: `${row.title} / quality_filter`,
        errorMessage: message,
      });
      processed++;
    }
  }

  return buildStageResult(processed, rows.length, errors);
}
