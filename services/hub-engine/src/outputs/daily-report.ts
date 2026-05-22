import { eq, and, or, gte, lt, desc, count, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logAiUsage } from '../lib/ai-usage.js';
import { logger } from '../lib/logger.js';
import { getEffectiveAiConfig, type ResolvedAiConfig } from '../lib/ai-configs.js';
import { callLLM } from '../processors/ai-scorer.js';
import { AIHOT_DAILY_BUCKET_LABELS, classifyAihotDailyBucket, type AihotDailyBucket } from '../lib/aihot-governance.js';
import { buildEmptyDailyReportDiagnosis, type EmptyDailyReportDiagnosis } from './daily-report-diagnostics.js';
import { translateItemsDetailed } from '../processors/ai-summarizer.js';
import {
  DEFAULT_DAILY_REPORT_WORKFLOW,
  normalizeDailyReportWorkflowConfig,
  prepareDailyReportCandidates,
  type DailyReportCandidateInput,
  type DailyReportCandidateFunnel,
  type DailyReportCandidatePreparation,
  type DailyReportPreparedCandidate,
  type DailyReportWorkflowConfig,
  type DailyReportSelectionMode,
} from './daily-report-workflow.js';

export type InsightPreset = 'full' | 'decision' | 'research' | 'reading';

export interface DailyReportOptions {
  topN?: number;
  minScore?: number;
  includeHighScore?: boolean;
  includeCategoryTop?: boolean;
  preset?: InsightPreset;
  compareWindowDays?: number;
  workflow?: Partial<DailyReportWorkflowConfig>;
}

export interface TopItem {
  id: string;
  title: string;
  displayTitle?: string;
  url: string;
  aiScore: number | null;
  aiSummary: string | null;
  reportSummary?: string | null;
  aiTranslation?: string | null;
  language?: string | null;
  translationStatus?: string | null;
  translationReason?: string | null;
  selectionReason?: string;
  selectionMode?: Exclude<DailyReportSelectionMode, 'empty'>;
  scopeMatched?: boolean;
  sourceName: string;
  category: string;
  publishedAt?: string | null;
  fetchedAt?: string | null;
  aiTags?: string[];
  sourceType?: string | null;
  sourceTier?: string | null;
  sourceKind?: string | null;
  isFiltered?: boolean | null;
  filterBucket?: string | null;
  filterReason?: string | null;
  qualityDecision?: string | null;
  processingStatus?: string | null;
}

export interface DailyReportModuleMeta {
  sceneType: string;
  resolvedConfigType?: string | null;
  provider?: string | null;
  model?: string | null;
  promptTemplateId?: string | null;
  modelConfigId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number | null;
  status: 'ai' | 'fallback';
  error?: string;
}

export interface DailyReportModule {
  key: 'decision' | 'research' | 'reading';
  title: string;
  markdown: string;
  bullets: string[];
  citations: Array<Pick<TopItem, 'id' | 'title' | 'url' | 'sourceName' | 'category' | 'aiScore'>>;
  meta: DailyReportModuleMeta;
}

export interface DailyCleaningOutput {
  summary: string;
  prioritySignals: string[];
  themeLabels: string[];
  watchlist: string[];
  domainBuckets?: Record<string, string[]>;
}

export interface DailyReportCleaning {
  output: DailyCleaningOutput;
  rawText: string;
  meta: DailyReportModuleMeta;
}

export interface DailyReportFinal {
  markdown: string;
  bullets: string[];
  meta: DailyReportModuleMeta;
}

export interface DailyReportSnapshot {
  date: string;
  totalItems: number;
  newItems: number;
  reportFunnel?: EmptyDailyReportDiagnosis['funnel'];
  workflowConfig?: DailyReportWorkflowConfig;
  candidateFunnel?: DailyReportCandidateFunnel;
  excludedCandidates?: DailyReportCandidatePreparation['excluded'];
  selectionMode?: DailyReportSelectionMode;
  compareWindowDays: number;
  topItems: TopItem[];
  highScoreItems: TopItem[];
  byCategory: Array<{ category: string; count: number; baselineAvg: number; delta: number }>;
  topSources: Array<{ sourceName: string; count: number }>;
  themeClusters: Array<{ label: string; count: number; sampleTitles: string[] }>;
  generatedAt: string;
}

export interface DailyReportPayload {
  snapshot: DailyReportSnapshot;
  emptyDiagnosis?: EmptyDailyReportDiagnosis;
  cleaning?: DailyReportCleaning;
  modules: Partial<Record<'decision' | 'research' | 'reading', DailyReportModule>>;
  final?: DailyReportFinal;
  preset: InsightPreset;
}

export interface DailyReportData {
  date: string;
  totalItems: number;
  newItems: number;
  compareWindowDays: number;
  preset: InsightPreset;
  pipelineVersion: number;
  snapshot: DailyReportSnapshot;
  cleaning?: DailyReportCleaning;
  modules: Partial<Record<'decision' | 'research' | 'reading', DailyReportModule>>;
  final?: DailyReportFinal;
  payload: DailyReportPayload;
  markdown: string;
  options: Required<DailyReportOptions>;
}

const DAILY_PIPELINE_VERSION = 3;
const DAILY_COMPARE_WINDOW_DAYS = 7;

export function selectDailyReportItems(
  visibleItems: TopItem[],
  options: Pick<Required<DailyReportOptions>, 'topN' | 'minScore'>,
): { topItems: TopItem[]; eligibleItems: number; selectionMode: DailyReportSelectionMode } {
  if (visibleItems.length === 0) {
    return { topItems: [], eligibleItems: 0, selectionMode: 'empty' };
  }

  const scoredItems = visibleItems.filter((item) => options.minScore === 0 || (item.aiScore ?? 0) >= options.minScore);
  if (scoredItems.length > 0) {
    return {
      topItems: scoredItems.slice(0, options.topN),
      eligibleItems: visibleItems.length,
      selectionMode: 'scored',
    };
  }

  return {
    topItems: visibleItems.slice(0, options.topN),
    eligibleItems: visibleItems.length,
    selectionMode: 'latest_visible',
  };
}

const DAILY_AGENT_SCENES = {
  cleaning: 'daily_report_cleaning',
  decision: 'daily_report_decision',
  research: 'daily_report_research',
  reading: 'daily_report_reading',
  final: 'daily_report_final',
} as const;
const LEGACY_DAILY_SCENE = 'daily_report';
const DAILY_SCENE_MAX_TOKENS: Record<keyof typeof DAILY_AGENT_SCENES, number> = {
  cleaning: 500,
  decision: 900,
  research: 1200,
  reading: 900,
  final: 1800,
};
const DAILY_SCENE_MIN_LENGTH: Record<keyof typeof DAILY_AGENT_SCENES, number> = {
  cleaning: 80,
  decision: 220,
  research: 320,
  reading: 220,
  final: 520,
};

const DEFAULT_SCENE_PROMPTS: Record<keyof typeof DAILY_AGENT_SCENES, string> = {
  cleaning: [
    '你是信息情报清洗代理。请只基于输入素材，输出 JSON。',
    '字段要求：',
    '{"summary":"一句话总结今天信息面","prioritySignals":["..."],"themeLabels":["..."],"watchlist":["..."],"domainBuckets":{"model_releases":["..."],"product_updates":["..."],"industry":["..."],"research":["..."],"tips":["..."]}}',
    '重点识别 AI 基础设施、模型与智能体、头部产品发布、资本市场/公司动作、监管与舆论信号。',
    '不要编造素材之外的事实，不要输出 JSON 以外内容。',
    '',
    '{context}',
  ].join('\n'),
  decision: [
    '你是决策简报代理。请基于以下信息，输出结构化 Markdown。',
    '必须包含：',
    '## 总体判断',
    '## 关键变化',
    '## 风险与机会',
    '## 下一步动作',
    '要求：聚焦 AI 产业、头部舆论新闻、资本与监管信号；结论先行，动作可执行，不要泛泛而谈。',
    '',
    '{context}',
  ].join('\n'),
  research: [
    '你是研究汇总代理。请基于以下信息输出深度研究型 Markdown。',
    '必须包含：',
    '## 主题脉络',
    '## 代表性证据',
    '## 分歧与空白',
    '## 值得追踪的问题',
    '要求：按 AI 基础设施、模型/智能体、产品落地、监管/舆论、公司/资本信号归纳，不要重复罗列同类信息。',
    '',
    '{context}',
  ].join('\n'),
  reading: [
    '你是阅读导航代理。请基于以下信息输出执行导向的 Markdown。',
    '必须包含：',
    '## 必读',
    '## 速览',
    '## 可跳过',
    '每条都给一句原因，优先考虑 AI 赛道信息增量、舆论影响和行动价值。',
    '',
    '{context}',
  ].join('\n'),
  final: [
    '你是最终日报整合代理。请基于清洗结果、决策简报、研究汇总、阅读导航，输出一份最终中文 Markdown 日报。',
    '必须包含：',
    '## 今日结论',
    '## 关键进展',
    '## 头部舆论/新闻焦点',
    '## AI 产业与产品信号',
    '## 阅读建议',
    '## 下一步动作',
    '要求：',
    '- 这是一份最终交付，不要解释代理过程',
    '- 统一语言风格，不要简单拼接子模块原文',
    '- 聚焦 AI 相关与头部舆论新闻，不要跑到医疗专题',
    '',
    '{context}',
  ].join('\n'),
};

function interpolatePrompt(template: string, replacements: Record<string, string>) {
  return Object.entries(replacements).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, value),
    template,
  );
}

function classifyAiNewsBucket(item: TopItem): AihotDailyBucket {
  return classifyAihotDailyBucket(item);
}

function buildAiNewsFocus(snapshot: DailyReportSnapshot) {
  const buckets = new Map<string, TopItem[]>();
  for (const item of snapshot.topItems.slice(0, 12)) {
    const key = classifyAiNewsBucket(item);
    const current = buckets.get(key) || [];
    current.push(item);
    buckets.set(key, current);
  }

  const labels = AIHOT_DAILY_BUCKET_LABELS;

  const lines = ['AI/舆论主线：'];
  for (const [key, label] of Object.entries(labels)) {
    const items = buckets.get(key) || [];
    if (items.length === 0) continue;
    lines.push(`- ${label}：${items.slice(0, 2).map((item) => item.title).join(' / ')}`);
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function bucketBy<T>(items: T[], keyFn: (item: T) => string) {
  const bucket = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const current = bucket.get(key) || [];
    current.push(item);
    bucket.set(key, current);
  }
  return bucket;
}

function deriveThemeClusters(items: TopItem[]) {
  const bucket = new Map<string, { count: number; sampleTitles: string[] }>();
  for (const item of items) {
    const labels = [...normalizeTags(item.aiTags), item.category].filter(Boolean);
    const uniqueLabels = labels.length > 0 ? labels : ['未分类主题'];
    for (const label of uniqueLabels) {
      const current = bucket.get(label) || { count: 0, sampleTitles: [] };
      current.count += 1;
      if (current.sampleTitles.length < 3) current.sampleTitles.push(item.title);
      bucket.set(label, current);
    }
  }
  return [...bucket.entries()]
    .map(([label, value]) => ({ label, count: value.count, sampleTitles: value.sampleTitles }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function buildInsightContext(snapshot: DailyReportSnapshot): string {
  const categoryLines = snapshot.byCategory
    .slice(0, 12)
    .map((entry) => `- ${entry.category}: 今日 ${entry.count}，近${snapshot.compareWindowDays}日均值 ${entry.baselineAvg.toFixed(1)}，变化 ${entry.delta >= 0 ? '+' : ''}${entry.delta.toFixed(1)}`)
    .join('\n');

  const themeLines = snapshot.themeClusters
    .slice(0, 8)
    .map((cluster) => `- ${cluster.label}: ${cluster.count} 条；样例：${cluster.sampleTitles.join(' / ')}`)
    .join('\n');

  const topItemLines = snapshot.topItems
    .slice(0, 16)
    .map((item, index) => {
      const score = item.aiScore != null ? `AI ${item.aiScore}` : 'AI -';
      return `${index + 1}. ${item.displayTitle || item.title}\n来源: ${item.sourceName} / ${item.category}\n评分: ${score}\n入报原因: ${item.selectionReason || '按默认日报规则入选'}\n摘要: ${item.reportSummary || item.aiSummary || '暂无摘要'}\n链接: ${item.url}`;
    })
    .join('\n\n');

  return [
    `日期：${snapshot.date}`,
    `今日新增：${snapshot.newItems}`,
    `库存总量：${snapshot.totalItems}`,
    `对比窗口：近 ${snapshot.compareWindowDays} 天`,
    buildAiNewsFocus(snapshot),
    '',
    '分类变化：',
    categoryLines || '- 无',
    '',
    '主题聚类：',
    themeLines || '- 无',
    '',
    '重点条目：',
    topItemLines || '- 无',
  ].join('\n');
}

function normalizeMarkdownForQuality(input?: string | null) {
  return (input || '').replace(/\r\n/g, '\n').trim();
}

function hasAllSections(markdown: string, sections: string[]) {
  return sections.every((section) => markdown.includes(section));
}

function looksTruncated(markdown: string) {
  const trimmed = normalizeMarkdownForQuality(markdown);
  if (!trimmed) return true;
  if (/[—\-–:：,，、（(]$/.test(trimmed)) return true;
  if (/(需求—产能—|详见下文但未展开|如下：?$)/.test(trimmed)) return true;
  const fenceCount = (trimmed.match(/```/g) || []).length;
  return fenceCount % 2 !== 0;
}

function validateSceneMarkdown(
  sceneKey: keyof typeof DAILY_AGENT_SCENES,
  markdown: string,
): { ok: boolean; reason?: string } {
  const normalized = normalizeMarkdownForQuality(markdown);
  if (normalized.length < DAILY_SCENE_MIN_LENGTH[sceneKey]) {
    return { ok: false, reason: 'too_short' };
  }
  if (looksTruncated(normalized)) {
    return { ok: false, reason: 'truncated' };
  }

  const requiredSections: Partial<Record<keyof typeof DAILY_AGENT_SCENES, string[]>> = {
    decision: ['## 总体判断', '## 关键变化', '## 风险与机会', '## 下一步动作'],
    research: ['## 主题脉络', '## 代表性证据', '## 分歧与空白', '## 值得追踪的问题'],
    reading: ['## 必读', '## 速览', '## 可跳过'],
    final: ['## 今日结论', '## 关键进展', '## 头部舆论/新闻焦点', '## AI 产业与产品信号', '## 阅读建议', '## 下一步动作'],
  };

  const required = requiredSections[sceneKey];
  if (required && !hasAllSections(normalized, required)) {
    return { ok: false, reason: 'missing_sections' };
  }

  return { ok: true };
}

function parseStructuredJson<T>(value: string): T | null {
  const normalized = value.trim();
  const candidates = [
    normalized,
    normalized.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, ''),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      continue;
    }
  }
  return null;
}

function buildCleaningFallback(snapshot: DailyReportSnapshot): DailyCleaningOutput {
  const domainBuckets: Record<string, string[]> = {
    model_releases: [],
    product_updates: [],
    industry: [],
    research: [],
    tips: [],
  };

  for (const item of snapshot.topItems.slice(0, 10)) {
    domainBuckets[classifyAiNewsBucket(item)]?.push(item.displayTitle || item.title);
  }

  const priorityItems = snapshot.highScoreItems.length > 0 ? snapshot.highScoreItems : snapshot.topItems;
  const selectionNote = snapshot.selectionMode === 'latest_visible'
    ? '当前高分条目不足，已启用最新兜底；以下内容不是高分精选，需结合入报原因快速判断价值。'
    : snapshot.selectionMode === 'review'
      ? '当前高分条目不足，已使用低分复核候选；这些内容不应被当作垃圾，但需要人工快速判断价值。'
      : `今日新增 ${snapshot.newItems} 条，重点集中在 ${snapshot.byCategory.slice(0, 3).map((item) => item.category).join(' / ') || '暂无主类目'}，主线围绕 AI 产业、头部舆论和资本/监管变化展开。`;

  return {
    summary: selectionNote,
    prioritySignals: priorityItems.slice(0, 4).map((item) => item.displayTitle || item.title),
    themeLabels: snapshot.themeClusters.slice(0, 5).map((cluster) => cluster.label),
    watchlist: snapshot.topItems.slice(0, 5).map((item) => item.displayTitle || item.title),
    domainBuckets,
  };
}

function buildCleaningContext(snapshot: DailyReportSnapshot, fallback: DailyCleaningOutput) {
  return [
    buildInsightContext(snapshot),
    '',
    '清洗 fallback 参考：',
    JSON.stringify(fallback, null, 2),
  ].join('\n');
}

function buildFinalContext(
  snapshot: DailyReportSnapshot,
  cleaning: DailyCleaningOutput,
  modules: Partial<Record<'decision' | 'research' | 'reading', DailyReportModule>>,
) {
  return [
    buildInsightContext(snapshot),
    '',
    '清洗结果：',
    JSON.stringify(cleaning, null, 2),
    '',
    '决策简报：',
    modules.decision?.markdown || '暂无',
    '',
    '研究汇总：',
    modules.research?.markdown || '暂无',
    '',
    '阅读导航：',
    modules.reading?.markdown || '暂无',
  ].join('\n');
}

function buildModuleContext(
  snapshot: DailyReportSnapshot,
  cleaning: DailyCleaningOutput,
  sceneKey: 'decision' | 'research' | 'reading',
) {
  const focusMap: Record<'decision' | 'research' | 'reading', string> = {
    decision: '请更偏向判断、优先级、风险与行动建议。',
    research: '请更偏向证据脉络、分歧、研究空白与专题拆解。',
    reading: '请更偏向阅读路径、必读/速览/可跳过分层与原因。',
  };
  return [
    buildInsightContext(snapshot),
    '',
    '结构化清洗结果：',
    JSON.stringify(cleaning, null, 2),
    '',
    `当前模块要求：${focusMap[sceneKey]}`,
  ].join('\n');
}

async function resolveDailyConfig(userId: string, sceneType: string): Promise<{ config: ResolvedAiConfig; resolvedConfigType: string } | null> {
  const config = await getEffectiveAiConfig(userId, sceneType);
  if (config) return { config, resolvedConfigType: sceneType };
  const fallback = await getEffectiveAiConfig(userId, LEGACY_DAILY_SCENE);
  if (fallback) return { config: fallback, resolvedConfigType: LEGACY_DAILY_SCENE };
  return null;
}

async function runScene(
  userId: string,
  sceneKey: keyof typeof DAILY_AGENT_SCENES,
  snapshot: DailyReportSnapshot,
  fallbackMarkdown: string,
  fallbackBullets: string[],
  citations: DailyReportModule['citations'],
  contextOverride?: string,
) {
  const sceneType = DAILY_AGENT_SCENES[sceneKey];
  const resolved = await resolveDailyConfig(userId, sceneType);
  if (!resolved) {
    return {
      markdown: fallbackMarkdown,
      meta: { sceneType, status: 'fallback' as const, error: 'missing_ai_config' },
    };
  }

  const template = resolved.resolvedConfigType === sceneType
    ? resolved.config.promptTemplate
    : DEFAULT_SCENE_PROMPTS[sceneKey];

  const prompt = interpolatePrompt(template, {
    date: snapshot.date,
    newItems: String(snapshot.newItems),
    totalItems: String(snapshot.totalItems),
    compareWindowDays: String(snapshot.compareWindowDays),
    context: contextOverride || buildInsightContext(snapshot),
    highlights: snapshot.topItems.map((item, index) => `${index + 1}. ${item.title}`).join('\n'),
    categories: snapshot.byCategory.map((item) => `${item.category}: ${item.count}`).join('\n'),
  });

  try {
    const result = await callLLM(resolved.config, prompt, {
      maxTokens: DAILY_SCENE_MAX_TOKENS[sceneKey],
    });
    const quality = validateSceneMarkdown(sceneKey, result.text);
    if (!quality.ok) {
      throw new Error(`invalid_daily_scene_output:${quality.reason}`);
    }
    await logAiUsage({
      userId,
      sceneType,
      status: 'success',
      provider: result.provider || resolved.config.provider,
      modelName: result.model || resolved.config.model,
      endpointId: result.endpointId || null,
      modelConfigId: resolved.config.modelConfigId || null,
      promptTemplateId: resolved.config.promptTemplateId || null,
      targetType: 'insight_module',
      targetId: `${snapshot.date}:${sceneKey}`,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
      estimatedCost: result.estimatedCost,
      latencyMs: result.latencyMs,
      providerRequestId: result.providerRequestId,
      apiKind: result.apiKind,
      promptPreview: prompt,
      responsePreview: result.text,
      label: `${snapshot.date}:${sceneKey}`,
    });
    return {
      markdown: normalizeMarkdownForQuality(result.text) || fallbackMarkdown,
      meta: {
        sceneType,
        resolvedConfigType: resolved.resolvedConfigType,
        provider: result.provider || resolved.config.provider,
        model: result.model || resolved.config.model,
        promptTemplateId: resolved.config.promptTemplateId || null,
        modelConfigId: resolved.config.modelConfigId || null,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedCost: result.estimatedCost,
        status: 'ai' as const,
      },
    };
  } catch (error) {
    const message = (error as Error).message;
    logger.warn({ sceneType, error: message }, 'Daily report scene fell back to deterministic output');
    await logAiUsage({
      userId,
      sceneType,
      status: 'error',
      provider: resolved.config.provider,
      modelName: resolved.config.model,
      endpointId: resolved.config.provider === 'volcengine_ark' && resolved.config.model.startsWith('ep-') ? resolved.config.model : null,
      modelConfigId: resolved.config.modelConfigId || null,
      promptTemplateId: resolved.config.promptTemplateId || null,
      targetType: 'insight_module',
      targetId: `${snapshot.date}:${sceneKey}`,
      promptPreview: prompt,
      label: `${snapshot.date}:${sceneKey}`,
      errorMessage: message,
    });
    return {
      markdown: fallbackMarkdown,
      meta: {
        sceneType,
        resolvedConfigType: resolved.resolvedConfigType,
        provider: resolved.config.provider,
        model: resolved.config.model,
        promptTemplateId: resolved.config.promptTemplateId || null,
        modelConfigId: resolved.config.modelConfigId || null,
        status: 'fallback' as const,
        error: message,
      },
    };
  }
}

async function runCleaningScene(userId: string, snapshot: DailyReportSnapshot, fallback: DailyCleaningOutput): Promise<DailyReportCleaning> {
  const sceneType = DAILY_AGENT_SCENES.cleaning;
  const resolved = await resolveDailyConfig(userId, sceneType);
  if (!resolved) {
    return {
      output: fallback,
      rawText: JSON.stringify(fallback, null, 2),
      meta: { sceneType, status: 'fallback', error: 'missing_ai_config' },
    };
  }

  const template = resolved.resolvedConfigType === sceneType
    ? resolved.config.promptTemplate
    : DEFAULT_SCENE_PROMPTS.cleaning;
  const prompt = interpolatePrompt(template, {
    context: buildCleaningContext(snapshot, fallback),
  });

  try {
    const result = await callLLM(resolved.config, prompt, {
      maxTokens: DAILY_SCENE_MAX_TOKENS.cleaning,
    });
    const parsed = parseStructuredJson<DailyCleaningOutput>(result.text) || fallback;
    await logAiUsage({
      userId,
      sceneType,
      status: 'success',
      provider: result.provider || resolved.config.provider,
      modelName: result.model || resolved.config.model,
      endpointId: result.endpointId || null,
      modelConfigId: resolved.config.modelConfigId || null,
      promptTemplateId: resolved.config.promptTemplateId || null,
      targetType: 'insight_module',
      targetId: `${snapshot.date}:cleaning`,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
      estimatedCost: result.estimatedCost,
      latencyMs: result.latencyMs,
      providerRequestId: result.providerRequestId,
      apiKind: result.apiKind,
      promptPreview: prompt,
      responsePreview: result.text,
      label: `${snapshot.date}:cleaning`,
    });
    return {
      output: {
        summary: parsed.summary || fallback.summary,
        prioritySignals: parsed.prioritySignals?.filter(Boolean) || fallback.prioritySignals,
        themeLabels: parsed.themeLabels?.filter(Boolean) || fallback.themeLabels,
        watchlist: parsed.watchlist?.filter(Boolean) || fallback.watchlist,
        domainBuckets: parsed.domainBuckets || fallback.domainBuckets,
      },
      rawText: result.text.trim(),
      meta: {
        sceneType,
        resolvedConfigType: resolved.resolvedConfigType,
        provider: result.provider || resolved.config.provider,
        model: result.model || resolved.config.model,
        promptTemplateId: resolved.config.promptTemplateId || null,
        modelConfigId: resolved.config.modelConfigId || null,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedCost: result.estimatedCost,
        status: 'ai',
      },
    };
  } catch (error) {
    const message = (error as Error).message;
    await logAiUsage({
      userId,
      sceneType,
      status: 'error',
      provider: resolved.config.provider,
      modelName: resolved.config.model,
      endpointId: resolved.config.provider === 'volcengine_ark' && resolved.config.model.startsWith('ep-') ? resolved.config.model : null,
      modelConfigId: resolved.config.modelConfigId || null,
      promptTemplateId: resolved.config.promptTemplateId || null,
      targetType: 'insight_module',
      targetId: `${snapshot.date}:cleaning`,
      promptPreview: prompt,
      label: `${snapshot.date}:cleaning`,
      errorMessage: message,
    });
    return {
      output: fallback,
      rawText: JSON.stringify(fallback, null, 2),
      meta: {
        sceneType,
        resolvedConfigType: resolved.resolvedConfigType,
        provider: resolved.config.provider,
        model: resolved.config.model,
        promptTemplateId: resolved.config.promptTemplateId || null,
        modelConfigId: resolved.config.modelConfigId || null,
        status: 'fallback',
        error: message,
      },
    };
  }
}

function buildFinalFallback(
  snapshot: DailyReportSnapshot,
  cleaning: DailyCleaningOutput,
  modules: Partial<Record<'decision' | 'research' | 'reading', DailyReportModule>>,
) {
  const bullets = [
    cleaning.summary,
    cleaning.prioritySignals[0] ? `优先信号：${cleaning.prioritySignals[0]}` : '暂无优先信号',
    cleaning.themeLabels[0] ? `主主题：${cleaning.themeLabels.slice(0, 3).join(' / ')}` : '暂无主主题',
  ].filter(Boolean);
  const aiNewsFocus = buildAiNewsFocus(snapshot);
  const mustRead = snapshot.highScoreItems.slice(0, 3);
  const sourceFocus = snapshot.topSources.slice(0, 5).map((item) => `- ${item.sourceName}：${item.count} 条`);
  const newsFocus = snapshot.topItems.slice(0, 4).map((item) => {
    const modeLabel = item.selectionMode ? ` · ${selectionModeLabel(item.selectionMode)}` : '';
    return `- ${item.displayTitle || item.title} · ${item.sourceName}${modeLabel}`;
  });
  const aiBuckets = Object.entries(cleaning.domainBuckets || {}).flatMap(([key, titles]) => {
    if (!titles?.length) return [];
    return [`- ${AIHOT_DAILY_BUCKET_LABELS[key as AihotDailyBucket] || key}：${titles.slice(0, 2).join(' / ')}`];
  });

  const markdown = [
    '## 今日结论',
    '',
    cleaning.summary,
    '',
    '## 关键进展',
    '',
    ...(cleaning.prioritySignals.length > 0 ? cleaning.prioritySignals.map((item) => `- ${item}`) : ['- 暂无']),
    '',
    '## 头部舆论/新闻焦点',
    '',
    ...(newsFocus.length > 0 ? newsFocus : ['- 暂无']),
    ...(aiNewsFocus ? ['', ...aiNewsFocus.split('\n').map((line) => line.startsWith('- ') ? line : `- ${line}`)] : []),
    '',
    '## AI 产业与产品信号',
    '',
    ...(aiBuckets.length > 0 ? aiBuckets : (cleaning.themeLabels.length > 0 ? cleaning.themeLabels.map((item) => `- ${item}`) : ['- 暂无'])),
    '',
    '## 阅读建议',
    '',
    ...(mustRead.length > 0
      ? mustRead.map((item) => `- [${item.displayTitle || item.title}](${item.url}) · ${item.sourceName} · ${item.category}`)
      : (cleaning.watchlist.length > 0 ? cleaning.watchlist.slice(0, 5).map((item) => `- ${item}`) : ['- 暂无'])),
    '',
    '## 下一步动作',
    '',
    `- 先读 ${snapshot.highScoreItems[0] ? `《${snapshot.highScoreItems[0].displayTitle || snapshot.highScoreItems[0].title}》` : '高分条目'}，再决定是否展开专题复盘。`,
    ...(modules.decision?.markdown ? ['- 如需快速判断，看“决策简报”；如需细查证据，看“研究汇总”。'] : []),
    ...(sourceFocus.length > 0 ? ['', '### 重点来源', '', ...sourceFocus] : []),
  ].join('\n');

  return { markdown, bullets };
}

async function runFinalScene(
  userId: string,
  snapshot: DailyReportSnapshot,
  cleaning: DailyCleaningOutput,
  modules: Partial<Record<'decision' | 'research' | 'reading', DailyReportModule>>,
  fallback: { markdown: string; bullets: string[] },
): Promise<DailyReportFinal> {
  const sceneType = DAILY_AGENT_SCENES.final;
  const resolved = await resolveDailyConfig(userId, sceneType);
  if (!resolved) {
    return {
      markdown: fallback.markdown,
      bullets: fallback.bullets,
      meta: { sceneType, status: 'fallback', error: 'missing_ai_config' },
    };
  }

  const template = resolved.resolvedConfigType === sceneType
    ? resolved.config.promptTemplate
    : DEFAULT_SCENE_PROMPTS.final;
  const prompt = interpolatePrompt(template, {
    context: buildFinalContext(snapshot, cleaning, modules),
  });

  try {
    const result = await callLLM(resolved.config, prompt, {
      maxTokens: DAILY_SCENE_MAX_TOKENS.final,
    });
    const quality = validateSceneMarkdown('final', result.text);
    if (!quality.ok) {
      throw new Error(`invalid_daily_scene_output:${quality.reason}`);
    }
    await logAiUsage({
      userId,
      sceneType,
      status: 'success',
      provider: result.provider || resolved.config.provider,
      modelName: result.model || resolved.config.model,
      endpointId: result.endpointId || null,
      modelConfigId: resolved.config.modelConfigId || null,
      promptTemplateId: resolved.config.promptTemplateId || null,
      targetType: 'insight_module',
      targetId: `${snapshot.date}:final`,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
      estimatedCost: result.estimatedCost,
      latencyMs: result.latencyMs,
      providerRequestId: result.providerRequestId,
      apiKind: result.apiKind,
      promptPreview: prompt,
      responsePreview: result.text,
      label: `${snapshot.date}:final`,
    });
    return {
      markdown: normalizeMarkdownForQuality(result.text) || fallback.markdown,
      bullets: fallback.bullets,
      meta: {
        sceneType,
        resolvedConfigType: resolved.resolvedConfigType,
        provider: result.provider || resolved.config.provider,
        model: result.model || resolved.config.model,
        promptTemplateId: resolved.config.promptTemplateId || null,
        modelConfigId: resolved.config.modelConfigId || null,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedCost: result.estimatedCost,
        status: 'ai',
      },
    };
  } catch (error) {
    const message = (error as Error).message;
    await logAiUsage({
      userId,
      sceneType,
      status: 'error',
      provider: resolved.config.provider,
      modelName: resolved.config.model,
      endpointId: resolved.config.provider === 'volcengine_ark' && resolved.config.model.startsWith('ep-') ? resolved.config.model : null,
      modelConfigId: resolved.config.modelConfigId || null,
      promptTemplateId: resolved.config.promptTemplateId || null,
      targetType: 'insight_module',
      targetId: `${snapshot.date}:final`,
      promptPreview: prompt,
      label: `${snapshot.date}:final`,
      errorMessage: message,
    });
    return {
      markdown: fallback.markdown,
      bullets: fallback.bullets,
      meta: {
        sceneType,
        resolvedConfigType: resolved.resolvedConfigType,
        provider: resolved.config.provider,
        model: resolved.config.model,
        promptTemplateId: resolved.config.promptTemplateId || null,
        modelConfigId: resolved.config.modelConfigId || null,
        status: 'fallback',
        error: message,
      },
    };
  }
}

function buildDecisionFallback(snapshot: DailyReportSnapshot) {
  const topCategories = snapshot.byCategory.slice(0, 3);
  const strongestDelta = [...snapshot.byCategory].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  const mustWatch = (snapshot.highScoreItems.length > 0 ? snapshot.highScoreItems : snapshot.topItems).slice(0, 3);
  const bullets = [
    `今日新增 ${snapshot.newItems} 条，重点信息主要集中在 ${topCategories.map((item) => item.category).join(' / ') || '暂无主类目'}`,
    strongestDelta
      ? `${strongestDelta.category} 相比近 ${snapshot.compareWindowDays} 日均值变化 ${strongestDelta.delta >= 0 ? '+' : ''}${strongestDelta.delta.toFixed(1)}`
      : '暂无显著分类变化',
    '优先判断 AI 赛道里哪条信号已经从概念走向部署、收入或市场预期变化。',
    mustWatch[0]
      ? `优先关注《${mustWatch[0].displayTitle || mustWatch[0].title}》等${snapshot.highScoreItems.length > 0 ? '高分' : '可见'}条目，适合拿来判断今日主信号`
      : '当前可见条目不足，建议先检查过滤口径或账号数据',
  ];
  const markdown = [
    '## 总体判断',
    '',
    bullets[0],
    '',
    '## 关键变化',
    '',
    `- ${bullets[1]}`,
    '',
    '## 风险与机会',
    '',
    `- ${mustWatch.length > 0 ? '机会在高分条目集中出现，适合快速形成判断。' : '风险是高价值信号不够集中，可能会浪费阅读时间。'}`,
    '- 头部舆论新闻容易制造噪音，要区分是短期讨论热度还是会改变 AI 产品/资本预期的真信号。',
    '',
    '## 下一步动作',
    '',
    `- 先读 ${mustWatch.slice(0, 2).map((item) => `《${item.displayTitle || item.title}》`).join('、') || 'TOP 条目'}，再决定是否继续展开。`,
  ].join('\n');
  return { markdown, bullets };
}

function buildResearchFallback(snapshot: DailyReportSnapshot) {
  const bullets = snapshot.themeClusters.slice(0, 4).map((cluster) => `${cluster.label}：${cluster.count} 条`);
  const markdown = [
    '## 主题脉络',
    '',
    ...snapshot.themeClusters.slice(0, 5).map((cluster) => `- **${cluster.label}**：${cluster.sampleTitles.join(' / ')}`),
    ...(buildAiNewsFocus(snapshot) ? ['', '### AI/舆论主线', '', ...buildAiNewsFocus(snapshot).split('\n').map((line) => line.startsWith('- ') ? line : `- ${line}`)] : []),
    '',
    '## 代表性证据',
    '',
    ...snapshot.topItems.slice(0, 5).map((item) => `- [${item.displayTitle || item.title}](${item.url}) · ${item.sourceName} · ${item.category} · ${item.selectionReason || '按日报规则入选'}`),
    '',
    '## 分歧与空白',
    '',
    '- 当前仍以高优先级摘要为主，AI 产业链、产品落地与舆论变化之间的因果链还需要继续补样本。',
    '',
    '## 值得追踪的问题',
    '',
    ...snapshot.themeClusters.slice(0, 3).map((cluster) => `- ${cluster.label} 后续会继续放大，还是只是单日波动？`),
  ].join('\n');
  return { markdown, bullets };
}

function buildReadingFallback(snapshot: DailyReportSnapshot) {
  const mustRead = (snapshot.highScoreItems.length > 0 ? snapshot.highScoreItems : snapshot.topItems).slice(0, 3);
  const skim = snapshot.topItems.filter((item) => !mustRead.some((picked) => picked.id === item.id)).slice(0, 5);
  const skip = snapshot.topItems.filter((item) => (item.aiScore ?? 0) < 50).slice(0, 3);
  const bullets = [
    `必读 ${mustRead.length} 篇`,
    `速览 ${skim.length} 篇`,
    `可跳过 ${skip.length} 篇`,
    '必读优先留给能改变 AI 判断、头部舆论或资本预期的条目',
  ];
  const markdown = [
    '## 必读',
    '',
    ...(mustRead.length > 0
      ? mustRead.map((item) => `- [${item.displayTitle || item.title}](${item.url})：${item.selectionReason || '高分且对 AI 产业、产品或舆论判断有直接增量'}`)
      : ['- 暂无明确必读条目']),
    '',
    '## 速览',
    '',
    ...(skim.length > 0
      ? skim.map((item) => `- [${item.displayTitle || item.title}](${item.url})：${item.selectionMode === 'latest_visible' ? '最新兜底条目，可快速扫读但不视为高分精选' : item.selectionMode === 'review' ? '低分复核条目，先判断是否值得继续追踪' : '可快速扫读把握当日脉络'}`)
      : ['- 暂无']),
    '',
    '## 可跳过',
    '',
    ...(skip.length > 0
      ? skip.map((item) => `- [${item.displayTitle || item.title}](${item.url})：优先级较低，可等后续验证再看`)
      : ['- 暂无明显低优先级条目']),
  ].join('\n');
  return { markdown, bullets };
}

function normalizeComparableMarkdown(input?: string | null): string {
  return (input || '')
    .replace(/\s+/g, ' ')
    .replace(/[>*#`-]/g, '')
    .trim();
}

function ensureReportHeading(markdown: string, date: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return `# 信息中枢日报 — ${date}`;
  if (/^#\s+信息中枢日报\s+—/.test(trimmed)) return trimmed;
  return `# 信息中枢日报 — ${date}\n\n${trimmed}`;
}

function ensureDistinctModules(
  modules: DailyReportData['modules'],
  fallbacks: {
    decision: { markdown: string; bullets: string[] };
    research: { markdown: string; bullets: string[] };
    reading: { markdown: string; bullets: string[] };
  },
) {
  const seen = new Map<string, keyof DailyReportData['modules']>();
  (['decision', 'research', 'reading'] as const).forEach((key) => {
    const module = modules[key];
    if (!module?.markdown?.trim()) {
      if (module) {
        module.markdown = fallbacks[key].markdown;
        module.bullets = fallbacks[key].bullets;
        module.meta = { ...module.meta, status: 'fallback', error: module.meta?.error || 'empty_module_markdown' };
      }
      return;
    }
    const normalized = normalizeComparableMarkdown(module.markdown);
    const existingKey = seen.get(normalized);
    if (existingKey) {
      module.markdown = fallbacks[key].markdown;
      module.bullets = fallbacks[key].bullets;
      module.meta = { ...module.meta, status: 'fallback', error: 'duplicate_module_output' };
      return;
    }
    seen.set(normalized, key);
  });
}

async function translateCandidateForDailyReport(userId: string, candidate: DailyReportCandidateInput) {
  await translateItemsDetailed(userId, 1, { itemId: candidate.id });
  const rows = await db
    .select({
      aiSummary: schema.items.aiSummary,
      aiTranslation: schema.items.aiTranslation,
      language: schema.items.language,
      translationStatus: schema.items.translationStatus,
      translationReason: schema.items.translationReason,
    })
    .from(schema.items)
    .where(and(eq(schema.items.id, candidate.id), eq(schema.items.userId, userId)))
    .limit(1);
  return rows[0] || null;
}

function buildGenerationScopeMarkdown(snapshot: DailyReportSnapshot) {
  const funnel = snapshot.candidateFunnel;
  if (!funnel) return '';
  return [
    '## 生成口径',
    '',
    `- 今日新增：${snapshot.newItems} 条`,
    `- 主流程可见：${funnel.mainVisible} 条`,
    `- 匹配日报范围：${funnel.scopeMatched} 条`,
    `- 高分候选：${funnel.scoredCandidates} 条`,
    `- 低分复核候选：${funnel.reviewCandidates} 条`,
    `- 软过滤恢复候选：${funnel.softFilteredRecovered} 条`,
    `- 评分失败候选：${funnel.scoreFailedCandidates} 条`,
    `- 最新兜底候选：${funnel.latestFallbackCandidates} 条`,
    `- 翻译待处理：${funnel.translationPending} 条`,
    `- 翻译失败/未中文化：${funnel.translationFailed} 条`,
    `- 最终入报：${funnel.finalCandidates} 条`,
    '',
  ].join('\n');
}

function selectionModeLabel(mode?: string | null) {
  if (mode === 'scored') return '高分精选';
  if (mode === 'review') return '低分复核';
  if (mode === 'latest_visible') return '最新兜底';
  return '候选入报';
}

function prependGenerationScope(snapshot: DailyReportSnapshot, markdown: string) {
  const scope = buildGenerationScopeMarkdown(snapshot).trimEnd();
  const body = markdown.trim();
  return scope ? `${scope}\n\n${body}` : body;
}

export async function generateDailyReport(userId: string, date?: Date, opts?: DailyReportOptions): Promise<DailyReportData> {
  const workflowConfig = normalizeDailyReportWorkflowConfig(opts?.workflow || DEFAULT_DAILY_REPORT_WORKFLOW);
  const options: Required<DailyReportOptions> = {
    topN: opts?.topN ?? workflowConfig.topN,
    minScore: opts?.minScore ?? workflowConfig.minScore,
    includeHighScore: opts?.includeHighScore ?? true,
    includeCategoryTop: opts?.includeCategoryTop ?? true,
    preset: opts?.preset ?? 'full',
    compareWindowDays: opts?.compareWindowDays ?? DAILY_COMPARE_WINDOW_DAYS,
    workflow: workflowConfig,
  };

  const targetDate = date || new Date();
  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const compareStart = new Date(dayStart);
  compareStart.setDate(compareStart.getDate() - options.compareWindowDays);

  const dateStr = dayStart.toISOString().split('T')[0];
  const samplingLimit = Math.max(options.topN * 4, 60);

  const [newItemsResult, totalResult, todayAuditRows, todayRows, todayCategoryRows, previousCategoryRows] = await Promise.all([
    db.select({ count: count() }).from(schema.items).where(and(eq(schema.items.userId, userId), gte(schema.items.fetchedAt, dayStart))),
    db.select({ count: count() }).from(schema.items).where(eq(schema.items.userId, userId)),
    db.select({
      id: schema.items.id,
      isFiltered: schema.items.isFiltered,
      filterBucket: schema.items.filterBucket,
      qualityDecision: schema.items.qualityDecision,
      contentStatus: schema.items.contentStatus,
      filterReason: schema.items.filterReason,
    })
    .from(schema.items)
    .where(and(eq(schema.items.userId, userId), gte(schema.items.fetchedAt, dayStart))),
    db.select({
      id: schema.items.id,
      title: schema.items.title,
      url: schema.items.url,
      aiScore: schema.items.aiScore,
      aiSummary: schema.items.aiSummary,
      aiTranslation: schema.items.aiTranslation,
      language: schema.items.language,
      translationStatus: schema.items.translationStatus,
      translationReason: schema.items.translationReason,
      aiTags: schema.items.aiTags,
      publishedAt: schema.items.publishedAt,
      fetchedAt: schema.items.fetchedAt,
      sourceName: schema.sources.name,
      category: schema.sources.category,
      sourceType: schema.items.sourceType,
      sourceTier: schema.items.sourceTier,
      sourceKind: schema.sources.sourceKind,
      isFiltered: schema.items.isFiltered,
      filterBucket: schema.items.filterBucket,
      filterReason: schema.items.filterReason,
      qualityDecision: schema.items.qualityDecision,
      processingStatus: schema.items.processingStatus,
    })
    .from(schema.items)
    .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
    .where(and(
      eq(schema.items.userId, userId),
      gte(schema.items.fetchedAt, dayStart),
      or(
        and(eq(schema.items.filterBucket, 'main'), eq(schema.items.isFiltered, false)),
        and(
          eq(schema.items.filterBucket, 'filtered'),
          eq(schema.items.isFiltered, true),
          sql`coalesce(${schema.items.filterReason}, '') ~* '^ai score too low:\\s*[0-9]+\\s*<\\s*[0-9]+'`,
        ),
        eq(schema.items.processingStatus, 'score_failed'),
      ),
    ))
    .orderBy(desc(schema.items.priorityScore))
    .limit(samplingLimit),
    db.select({ category: schema.sources.category, count: count() })
      .from(schema.items)
      .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
      .where(and(eq(schema.items.userId, userId), gte(schema.items.fetchedAt, dayStart), eq(schema.items.filterBucket, 'main'), eq(schema.items.isFiltered, false)))
      .groupBy(schema.sources.category)
      .orderBy(desc(count())),
    db.select({ category: schema.sources.category, count: count() })
      .from(schema.items)
      .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
      .where(and(
        eq(schema.items.userId, userId),
        gte(schema.items.fetchedAt, compareStart),
        lt(schema.items.fetchedAt, dayStart),
        eq(schema.items.filterBucket, 'main'),
        eq(schema.items.isFiltered, false),
      ))
      .groupBy(schema.sources.category)
      .orderBy(desc(count())),
  ]);

  const newItems = newItemsResult[0]?.count || 0;
  const totalItems = totalResult[0]?.count || 0;

  const toItem = (t: typeof todayRows[number]): TopItem => ({
    id: t.id,
    title: t.title,
    displayTitle: t.title,
    url: t.url,
    aiScore: t.aiScore,
    aiSummary: t.aiSummary,
    reportSummary: t.aiSummary,
    aiTranslation: t.aiTranslation,
    language: t.language,
    translationStatus: t.translationStatus,
    translationReason: t.translationReason,
    sourceName: t.sourceName || 'Unknown',
    category: t.category || 'uncategorized',
    publishedAt: t.publishedAt?.toISOString?.() || null,
    fetchedAt: t.fetchedAt?.toISOString?.() || null,
    aiTags: normalizeTags(t.aiTags),
    sourceType: t.sourceType || 'article',
    sourceTier: t.sourceTier,
    sourceKind: t.sourceKind,
    isFiltered: t.isFiltered,
    filterBucket: t.filterBucket,
    filterReason: t.filterReason,
    qualityDecision: t.qualityDecision,
    processingStatus: t.processingStatus,
  });

  const visibleItems = todayRows.map(toItem);
  const candidatePreparation = await prepareDailyReportCandidates(visibleItems, workflowConfig, {
    translateItem: (candidate) => translateCandidateForDailyReport(userId, candidate),
  });
  const selection = {
    topItems: candidatePreparation.finalCandidates as DailyReportPreparedCandidate[],
    eligibleItems: candidatePreparation.funnel.finalCandidates,
    selectionMode: candidatePreparation.selectionMode,
  };
  const topItems = selection.topItems;
  const highScoreItems = options.includeHighScore
    ? candidatePreparation.scoredCandidates.filter((item) => (item.aiScore ?? 0) >= 70).slice(0, 10)
    : [];

  const previousCategoryMap = new Map(previousCategoryRows.map((row) => [row.category || 'uncategorized', row.count]));
  const byCategoryData = todayCategoryRows.map((row) => {
    const category = row.category || 'uncategorized';
    const previousTotal = previousCategoryMap.get(category) || 0;
    const baselineAvg = previousTotal / Math.max(options.compareWindowDays, 1);
    return {
      category,
      count: row.count,
      baselineAvg,
      delta: row.count - baselineAvg,
    };
  });

  const topSources = [...bucketBy(topItems, (item) => item.sourceName).entries()]
    .map(([sourceName, items]) => ({ sourceName, count: items.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const reportFunnel = {
    newItems,
    eligibleItems: selection.eligibleItems,
    filteredItems: todayAuditRows.filter((item) => item.isFiltered).length,
    filteredBucketItems: todayAuditRows.filter((item) => item.filterBucket === 'filtered').length,
    reviewItems: todayAuditRows.filter((item) => item.qualityDecision === 'review' || (!item.isFiltered && item.filterReason)).length,
    pendingItems: todayAuditRows.filter((item) => item.contentStatus && item.contentStatus !== 'ready').length,
    scopeMatched: candidatePreparation.funnel.scopeMatched,
    scoredCandidates: candidatePreparation.funnel.scoredCandidates,
    reviewCandidates: candidatePreparation.funnel.reviewCandidates,
    softFilteredRecovered: candidatePreparation.funnel.softFilteredRecovered,
    scoreFailedCandidates: candidatePreparation.funnel.scoreFailedCandidates,
    latestFallbackCandidates: candidatePreparation.funnel.latestFallbackCandidates,
    translationPending: candidatePreparation.funnel.translationPending,
    translationFailed: candidatePreparation.funnel.translationFailed,
    finalCandidates: candidatePreparation.funnel.finalCandidates,
  };
  const filterReasonCounts = [...todayAuditRows.reduce((acc, item) => {
    if (!item.isFiltered && item.filterBucket !== 'filtered') return acc;
    const reason = String(item.filterReason || '未记录过滤原因').trim();
    acc.set(reason, (acc.get(reason) || 0) + 1);
    return acc;
  }, new Map<string, number>()).entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);

  const snapshot: DailyReportSnapshot = {
    date: dateStr,
    totalItems,
    newItems,
    reportFunnel,
    workflowConfig,
    candidateFunnel: candidatePreparation.funnel,
    excludedCandidates: candidatePreparation.excluded.slice(0, 20),
    selectionMode: selection.selectionMode,
    compareWindowDays: options.compareWindowDays,
    topItems,
    highScoreItems,
    byCategory: byCategoryData,
    topSources,
    themeClusters: deriveThemeClusters(topItems),
    generatedAt: new Date().toISOString(),
  };

  if (newItems > 0 && topItems.length === 0) {
    const emptyDiagnosis = buildEmptyDailyReportDiagnosis({
      ...reportFunnel,
      topFilterReasons: filterReasonCounts,
    });
    const final: DailyReportFinal = {
      markdown: ensureReportHeading(prependGenerationScope(snapshot, emptyDiagnosis.markdown), dateStr),
      bullets: [
        `今日新增 ${newItems} 条，但可入报内容为 ${reportFunnel.eligibleItems} 条。`,
        `已过滤标记 ${reportFunnel.filteredItems} 条，过滤池 ${reportFunnel.filteredBucketItems} 条。`,
      ],
      meta: {
        sceneType: 'daily_report_final',
        status: 'fallback',
        error: 'empty_daily_report_diagnosis',
      },
    };
    const payload: DailyReportPayload = {
      snapshot,
      emptyDiagnosis,
      modules: {},
      final,
      preset: options.preset,
    };
    const report: DailyReportData = {
      date: dateStr,
      totalItems,
      newItems,
      compareWindowDays: options.compareWindowDays,
      preset: options.preset,
      pipelineVersion: DAILY_PIPELINE_VERSION,
      snapshot,
      modules: {},
      final,
      payload,
      markdown: final.markdown,
      options,
    };

    await db.insert(schema.insights).values({
      userId,
      date: dateStr,
      type: 'daily',
      topics: [],
      payload,
      summary: report.markdown,
      itemCount: newItems,
      pipelineVersion: DAILY_PIPELINE_VERSION,
    }).onConflictDoUpdate({
      target: [schema.insights.userId, schema.insights.date, schema.insights.type],
      set: {
        summary: report.markdown,
        itemCount: newItems,
        topics: [],
        payload,
        pipelineVersion: DAILY_PIPELINE_VERSION,
      },
    });

    logger.info({ date: dateStr, newItems, reportFunnel }, 'Daily report generated as empty diagnosis');
    return report;
  }

  const decisionFallback = buildDecisionFallback(snapshot);
  const researchFallback = buildResearchFallback(snapshot);
  const readingFallback = buildReadingFallback(snapshot);
  const cleaningFallback = buildCleaningFallback(snapshot);

  const modules: DailyReportData['modules'] = {};
  const cleaning: DailyReportCleaning = workflowConfig.enabledModules.cleaning
    ? await runCleaningScene(userId, snapshot, cleaningFallback)
    : {
      output: cleaningFallback,
      rawText: JSON.stringify(cleaningFallback, null, 2),
      meta: {
        sceneType: DAILY_AGENT_SCENES.cleaning,
        status: 'fallback',
        error: 'workflow_module_disabled',
      },
    };
  if (workflowConfig.enabledModules.decision && (options.preset === 'full' || options.preset === 'decision')) {
    const result = await runScene(
      userId,
      'decision',
      snapshot,
      decisionFallback.markdown,
      decisionFallback.bullets,
      snapshot.highScoreItems.slice(0, 5),
      buildModuleContext(snapshot, cleaning.output, 'decision'),
    );
    modules.decision = {
      key: 'decision',
      title: '决策简报',
      markdown: result.markdown,
      bullets: decisionFallback.bullets,
      citations: snapshot.highScoreItems.slice(0, 5).map(({ id, title, url, sourceName, category, aiScore }) => ({ id, title, url, sourceName, category, aiScore })),
      meta: result.meta,
    };
  }
  if (workflowConfig.enabledModules.research && (options.preset === 'full' || options.preset === 'research')) {
    const result = await runScene(
      userId,
      'research',
      snapshot,
      researchFallback.markdown,
      researchFallback.bullets,
      snapshot.topItems.slice(0, 6),
      buildModuleContext(snapshot, cleaning.output, 'research'),
    );
    modules.research = {
      key: 'research',
      title: '研究汇总',
      markdown: result.markdown,
      bullets: researchFallback.bullets,
      citations: snapshot.topItems.slice(0, 6).map(({ id, title, url, sourceName, category, aiScore }) => ({ id, title, url, sourceName, category, aiScore })),
      meta: result.meta,
    };
  }
  if (workflowConfig.enabledModules.reading && (options.preset === 'full' || options.preset === 'reading')) {
    const result = await runScene(
      userId,
      'reading',
      snapshot,
      readingFallback.markdown,
      readingFallback.bullets,
      snapshot.topItems.slice(0, 8),
      buildModuleContext(snapshot, cleaning.output, 'reading'),
    );
    modules.reading = {
      key: 'reading',
      title: '阅读导航',
      markdown: result.markdown,
      bullets: readingFallback.bullets,
      citations: snapshot.topItems.slice(0, 8).map(({ id, title, url, sourceName, category, aiScore }) => ({ id, title, url, sourceName, category, aiScore })),
      meta: result.meta,
    };
  }

  ensureDistinctModules(modules, {
    decision: decisionFallback,
    research: researchFallback,
    reading: readingFallback,
  });

  const finalFallback = buildFinalFallback(snapshot, cleaning.output, modules);
  const final: DailyReportFinal = workflowConfig.enabledModules.final
    ? await runFinalScene(userId, snapshot, cleaning.output, modules, finalFallback)
    : {
      markdown: finalFallback.markdown,
      bullets: finalFallback.bullets,
      meta: {
        sceneType: DAILY_AGENT_SCENES.final,
        status: 'fallback',
        error: 'workflow_module_disabled',
      },
    };
  if (!final.markdown?.trim()) {
    final.markdown = finalFallback.markdown;
    final.bullets = finalFallback.bullets;
    final.meta = { ...final.meta, status: 'fallback', error: final.meta?.error || 'empty_final_markdown' };
  }
  final.markdown = ensureReportHeading(prependGenerationScope(snapshot, final.markdown), dateStr);

  const payload: DailyReportPayload = {
    snapshot,
    cleaning,
    modules,
    final,
    preset: options.preset,
  };

  const report: DailyReportData = {
    date: dateStr,
    totalItems,
    newItems,
    compareWindowDays: options.compareWindowDays,
    preset: options.preset,
    pipelineVersion: DAILY_PIPELINE_VERSION,
    snapshot,
    cleaning,
    modules,
    final,
    payload,
    markdown: '',
    options,
  };
  report.markdown = formatMarkdown(report);

  await db.insert(schema.insights).values({
    userId,
    date: dateStr,
    type: 'daily',
    topics: snapshot.themeClusters,
    payload,
    summary: report.markdown,
    itemCount: newItems,
    pipelineVersion: DAILY_PIPELINE_VERSION,
  }).onConflictDoUpdate({
    target: [schema.insights.userId, schema.insights.date, schema.insights.type],
    set: {
      summary: report.markdown,
      itemCount: newItems,
      topics: snapshot.themeClusters,
      payload,
      pipelineVersion: DAILY_PIPELINE_VERSION,
    },
  });

  logger.info({ date: dateStr, newItems, topCount: topItems.length, highScore: highScoreItems.length, preset: options.preset }, 'Daily report generated');
  return report;
}

export function formatMarkdown(report: DailyReportData): string {
  if (report.final?.markdown?.trim()) {
    return report.final.markdown.trim();
  }

  const lines: string[] = [
    `# 信息中枢日报 — ${report.date}`,
    '',
    `> 今日新增 **${report.newItems}** 条 | 库存总计 **${report.totalItems}** 条`,
    `> 对比窗口 **${report.compareWindowDays}** 天 | 生成模式 **${report.preset}**`,
    '',
  ];

  if (report.modules.decision) {
    lines.push('## 决策简报', '');
    lines.push(report.modules.decision.markdown, '');
  }

  if (report.modules.research) {
    lines.push('## 研究汇总', '');
    lines.push(report.modules.research.markdown, '');
  }

  if (report.modules.reading) {
    lines.push('## 阅读导航', '');
    lines.push(report.modules.reading.markdown, '');
  }

  if (report.snapshot.highScoreItems.length > 0) {
    lines.push('## ⭐ 今日精选（AI 评分 ≥ 70）', '');
    for (let i = 0; i < report.snapshot.highScoreItems.length; i++) {
      const item = report.snapshot.highScoreItems[i];
      lines.push(`### ${i + 1}. [${item.displayTitle || item.title}](${item.url})`);
      lines.push(`> 来源：**${item.sourceName}** · 分类：${item.category} · AI评分：**${item.aiScore ?? '-'}** · 入报方式：${selectionModeLabel(item.selectionMode)}`);
      if (item.selectionReason) {
        lines.push(`> 入报原因：${item.selectionReason}`);
      }
      if (item.reportSummary || item.aiSummary) {
        lines.push('');
        lines.push(item.reportSummary || item.aiSummary || '');
      }
      lines.push('');
    }
  }

  if (report.snapshot.byCategory.length > 0) {
    lines.push('## 📊 今日分类统计', '');
    const total = report.snapshot.byCategory.reduce((sum, c) => sum + c.count, 0);
    for (const cat of report.snapshot.byCategory.slice(0, 15)) {
      const bar = '█'.repeat(Math.round(cat.count / Math.max(total, 1) * 20));
      lines.push(`- **${cat.category}**: ${cat.count} 条 \`${bar}\`（较近${report.compareWindowDays}日均值 ${cat.delta >= 0 ? '+' : ''}${cat.delta.toFixed(1)}）`);
    }
    lines.push('');
  }

  if (report.snapshot.themeClusters.length > 0) {
    lines.push('## 🧩 今日主题聚类', '');
    for (const cluster of report.snapshot.themeClusters.slice(0, 6)) {
      lines.push(`- **${cluster.label}**：${cluster.count} 条 · ${cluster.sampleTitles.join(' / ')}`);
    }
    lines.push('');
  }

  if (report.snapshot.topItems.length > 0) {
    lines.push(`## 📋 今日推荐 TOP ${Math.min(report.options.topN, report.snapshot.topItems.length)}`, '');
    for (let i = 0; i < report.snapshot.topItems.length; i++) {
      const item = report.snapshot.topItems[i];
      const score = item.aiScore != null ? ` · AI ${item.aiScore}分` : '';
      lines.push(`### ${i + 1}. [${item.displayTitle || item.title}](${item.url})`);
      lines.push(`> ${item.sourceName} · ${item.category}${score} · ${selectionModeLabel(item.selectionMode)}`);
      if (item.selectionReason) {
        lines.push(`> 入报原因：${item.selectionReason}`);
      }
      if (item.reportSummary || item.aiSummary) {
        lines.push('');
        lines.push(item.reportSummary || item.aiSummary || '');
      }
      lines.push('');
    }
  }

  lines.push('---');
  lines.push(`*生成时间: ${new Date().toLocaleString('zh-CN')} | topN: ${report.options.topN} | minScore: ${report.options.minScore} | compareWindowDays: ${report.options.compareWindowDays} | pipelineVersion: ${report.pipelineVersion}*`);
  return lines.join('\n');
}

export function formatJson(report: DailyReportData): string {
  return JSON.stringify(report, null, 2);
}
