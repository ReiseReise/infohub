import { eq, and, or, gte, lt, desc, count, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logAiUsage as productionLogAiUsage } from '../lib/ai-usage.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from '../lib/logger.js';
import { getEffectiveAiConfig, type ResolvedAiConfig } from '../lib/ai-configs.js';
import { callLLM as productionCallLLM } from '../processors/ai-scorer.js';
import { AI_TOKEN_BUDGETS } from '../lib/ai-token-budgets.js';
import { AIHOT_DAILY_BUCKET_LABELS, classifyAihotDailyBucket, type AihotDailyBucket } from '../lib/aihot-governance.js';
import { buildDailyGenerationProgress, type DailyGenerationProgress, type DailyGenerationStage } from '../lib/daily-generation-progress.js';
import { buildDailyReportQuality, type DailyReportQualityStatus } from '../lib/daily-report-quality.js';
import { buildEmptyDailyReportDiagnosis, type EmptyDailyReportDiagnosis } from './daily-report-diagnostics.js';
import { resolveDailyReportWindow } from './daily-report-window.js';
import { buildReadingAssetRecords, findArticleAsset } from '../lib/article-assets.js';
import type { ReadingAsset } from '../lib/reading-context.js';
import { resolveSourceReadingTier } from '../lib/source-reading-tier.js';
import {
  buildDailyReportEventMetrics,
  type DailyReportEventMetrics,
} from './daily-report-event-metrics.js';
import {
  DEFAULT_DAILY_REPORT_WORKFLOW,
  normalizeDailyReportWorkflowConfig,
  prepareDailyReportCandidates,
  summarizeDailyReportExcludedCandidates,
  type DailyReportCandidateFunnel,
  type DailyReportCandidatePreparation,
  type DailyReportExcludedCandidateSummary,
  type DailyReportPreparedCandidate,
  type DailyReportWorkflowConfig,
  type DailyReportSelectionMode,
} from './daily-report-workflow.js';
import {
  buildDailyReportCandidateSampleOrder,
  countMainVisibleItemsForReportFunnel,
  normalizeDailyReportCandidateFunnelForSnapshot,
} from './daily-report-candidate-sampling.js';
import {
  repairDailyReportCandidateReadiness,
  translateDailyReportCandidate,
} from './daily-report-candidate-readiness.js';
import {
  buildDailyReportEditorialDigestService,
  buildDailyReportModuleSectionsService,
  buildDailyReportPriorityArticlesService,
  buildDailyReportSupplementalArticlesService,
  buildDailyReportTrendSummaryService,
  describeReportItemValueService,
  isEditorialThemeLabelService,
  isValidReportArticleUrlService,
  type DailyReportEditorialDependencies,
  uniqueDailyReportArticlesService,
  uniqueDailyReportPriorityArticlesService,
} from './daily-report-editorial.js';
import {
  buildDailyReportInsightConflictUpdateService,
  ensureDistinctDailyReportModules,
  runDailyReportModuleTasksService,
  type DailyReportModuleTask,
} from './daily-report-generation.js';
import {
  loadDailyReportRecoveryContext,
  type DailyReportRecoveryContext,
} from './daily-report-recovery-material.js';
import { refreshRecentEventClusters } from '../lib/event-cluster-maintenance.js';
import { containsDailyPlaceholder, dailyProseIssue, hasUnsupportedEditorialNumbers, preserveEditorialProse } from './daily-report-prose.js';

export {
  buildDailyReportCandidateSampleOrder,
  countMainVisibleItemsForReportFunnel,
  isDailyReportHotSignal,
  normalizeDailyReportCandidateFunnelForSnapshot,
  type DailyReportCandidateSampleItem,
} from './daily-report-candidate-sampling.js';

// Evaluation dependencies are scoped to this async execution, never production configuration.
const frozenEvaluation = new AsyncLocalStorage<{ complete: typeof productionCallLLM }>();
const callLLM: typeof productionCallLLM = (...args) =>
  (frozenEvaluation.getStore()?.complete || productionCallLLM)(...args);
const logAiUsage: typeof productionLogAiUsage = (...args) =>
  frozenEvaluation.getStore() ? Promise.resolve(undefined) : productionLogAiUsage(...args);

export async function evaluateFrozenLegacySnapshot(snapshot: DailyReportSnapshot, complete: typeof productionCallLLM) {
  return frozenEvaluation.run({ complete }, async () => {
    const cleaning = await runCleaningScene('frozen-evaluation', snapshot, buildCleaningFallback(snapshot));
    const fallbacks = { decision: buildDecisionFallback(snapshot), research: buildResearchFallback(snapshot), reading: buildReadingFallback(snapshot) };
    const modules: DailyReportData['modules'] = {};
    for (const key of ['decision', 'research', 'reading'] as const) {
      const fallback = fallbacks[key];
      const citations = (key === 'decision' ? snapshot.highScoreItems : snapshot.topItems).slice(0, key === 'decision' ? 5 : key === 'research' ? 6 : 8);
      const result = await runScene('frozen-evaluation', key, snapshot, fallback.markdown, fallback.bullets, citations, buildModuleContext(snapshot, cleaning.output, key));
      modules[key] = { key, title: key, ...result, bullets: fallback.bullets, citations };
    }
    ensureDistinctDailyReportModules(modules, fallbacks);
    const final = await runFinalScene('frozen-evaluation', snapshot, cleaning.output, modules, buildFinalFallback(snapshot, cleaning.output, modules));
    return { cleaning, modules, final, markdown: ensureReportHeading(finalizeDailyReportDelivery(final.markdown, snapshot, final.meta.deliveryMode), snapshot.date) };
  });
}

export type InsightPreset = 'full' | 'decision' | 'research' | 'reading';
export type DailyReportGenerationMode = 'fast' | 'full';

export interface DailyReportOptions {
  topN?: number;
  minScore?: number;
  includeHighScore?: boolean;
  includeCategoryTop?: boolean;
  preset?: InsightPreset;
  compareWindowDays?: number;
  generationMode?: DailyReportGenerationMode;
  workflow?: Partial<DailyReportWorkflowConfig>;
  sourceId?: number | null;
  sourceName?: string | null;
  reportType?: string;
  onProgress?: (progress: DailyGenerationProgress) => void | Promise<void>;
}

type ResolvedDailyReportOptions = Required<Omit<DailyReportOptions, 'onProgress'>>;

export interface TopItem {
  id: string;
  title: string;
  displayTitle?: string;
  translatedTitle?: string | null;
  url: string;
  readerUrl?: string;
  editorialContext?: string | null;
  contentLength?: number | null;
  aiScore: number | null;
  aiSummary: string | null;
  snippet?: string | null;
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
  readingTier?: string | null;
  sourceKind?: string | null;
  clusterId?: string | null;
  isFiltered?: boolean | null;
  filterBucket?: string | null;
  filterReason?: string | null;
  qualityDecision?: string | null;
  processingStatus?: string | null;
  scoreRiskFlags?: string[];
  readingAssets?: ReadingAsset[];
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
  repaired?: boolean;
  repairReason?: string;
  deliveryMode?: 'model' | 'model_composed' | 'deterministic';
  compositionPasses?: number;
  evidenceLinksSupplemented?: boolean;
  factualGroundingApplied?: boolean;
  groundedArticleCount?: number;
  preservedArticleCount?: number;
  droppedUngroundedSections?: number;
  compositionDiagnostics?: {
    initial?: FinalMarkdownStructureDiagnostics;
    expansion?: FinalMarkdownStructureDiagnostics;
    merged?: FinalMarkdownStructureDiagnostics;
    repair?: FinalMarkdownStructureDiagnostics;
  };
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
  modelDraftMarkdown?: string;
  bullets: string[];
  meta: DailyReportModuleMeta;
}

export interface DailyReportSnapshot {
  date: string;
  totalItems: number;
  newItems: number;
  generationMode?: DailyReportGenerationMode;
  reportFunnel?: EmptyDailyReportDiagnosis['funnel'];
  workflowConfig?: DailyReportWorkflowConfig;
  candidateFunnel?: DailyReportCandidateFunnel;
  excludedCandidates?: DailyReportCandidatePreparation['excluded'];
  excludedCandidateSummary?: DailyReportExcludedCandidateSummary;
  selectionMode?: DailyReportSelectionMode;
  compareWindowDays: number;
  topItems: TopItem[];
  highScoreItems: TopItem[];
  byCategory: Array<{ category: string; count: number; baselineAvg: number; delta: number }>;
  topSources: Array<{ sourceName: string; count: number }>;
  themeClusters: Array<{ label: string; count: number; sampleTitles: string[] }>;
  eventMetrics?: DailyReportEventMetrics;
  moduleSections?: DailyReportModuleSection[];
  editorialSupplementArticles?: DailyReportPriorityArticle[];
  generatedAt: string;
}

export interface DailyReportTrendSummary {
  newItems: number;
  totalItems: number;
  compareWindowDays: number;
  categories: Array<{
    category: string;
    count: number;
    baselineAvg: number;
    delta: number;
    direction: 'up' | 'down' | 'flat';
  }>;
  sources: Array<{ sourceName: string; count: number }>;
  themes: Array<{ label: string; count: number; sampleTitles: string[] }>;
  funnel?: DailyReportCandidateFunnel;
  eventMetrics?: DailyReportEventMetrics;
}

export interface DailyReportPriorityArticle {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  category: string;
  reason: string;
  summary: string;
  contentLength?: number | null;
  assetReferences?: Array<{
    promptKey: string;
    label: string;
    excerpt: string;
  }>;
}

export interface DailyReportModuleEvidence {
  itemId: string;
  title: string;
  url: string;
  sourceName: string;
  fact: string;
  factBasis: DailyReportEditorialFactBasis;
  role: 'primary' | 'supporting';
}

export interface DailyReportModuleSection {
  key: 'models_labs' | 'agent_products' | 'infra_compute' | 'apps_business' | 'policy_safety' | 'deep_reads' | 'china_industry';
  title: string;
  editorialTitle?: string;
  conclusion: string;
  narrativeMarkdown?: string;
  priorityArticles: DailyReportPriorityArticle[];
  primaryLinks?: DailyReportPriorityArticle[];
  secondaryLinks?: DailyReportPriorityArticle[];
  evidence?: DailyReportModuleEvidence[];
  signals: string[];
  noise: string[];
  actions: string[];
  coverageCount: number;
  evidenceCount?: number;
}

export type DailyReportEditorialPlacement = 'featured' | 'deep_read' | 'module' | 'more_dynamics' | 'coverage_index';

export type DailyReportEditorialFactBasis = 'article_asset' | 'report_summary' | 'ai_summary' | 'snippet' | 'module_summary' | 'title';

export interface DailyReportEditorialMaterial {
  itemId: string;
  title: string;
  fact: string;
  factBasis: DailyReportEditorialFactBasis;
  evidenceUrl: string;
  sourceName: string;
  theme: string;
  recommendedPlacement: DailyReportEditorialPlacement;
  placements: DailyReportEditorialPlacement[];
  reason: string;
  selectionMode?: TopItem['selectionMode'];
  score: number | null;
}

export interface DailyReportEditorialDigest {
  coverJudgement: {
    title: string;
    summary: string;
  };
  radarOverview: {
    markdown: string;
  };
  tableOfContents: string[];
  curated: DailyReportPriorityArticle[];
  moduleReferences: DailyReportPriorityArticle[];
  moreDynamics: DailyReportPriorityArticle[];
  deepReads: DailyReportPriorityArticle[];
  moduleNarratives: DailyReportModuleSection[];
  materials: DailyReportEditorialMaterial[];
  readingOrder: { markdown: string };
  nextActions: { markdown: string };
}

export interface DailyReportDegradedPresentation {
  coverJudgement: DailyReportEditorialDigest['coverJudgement'];
  moduleSections: DailyReportModuleSection[];
  markdown: string;
  bullets: string[];
}

export type DailyReportCoverageStatus = 'selected' | 'review' | 'latestFallback' | 'excluded';

export interface DailyReportCoverageItem {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  category: string;
  status: DailyReportCoverageStatus;
  statusLabel: string;
  digest: string;
  reason: string;
  action: string;
  score: number | null;
  translationStatus: string | null;
  translationStatusLabel: string;
}

export interface DailyReportCoverageSummary {
  total: number;
  selected: number;
  review: number;
  latestFallback: number;
  excluded: number;
  missingDigest: number;
}

export interface DailyReportCoverageIndex {
  summary: DailyReportCoverageSummary;
  items: DailyReportCoverageItem[];
  markdown: string;
}

export interface DailyReportPayload {
  reportScope?: {
    reportType: string;
    sourceId?: number | null;
    sourceName?: string | null;
    label: string;
  };
  snapshot: DailyReportSnapshot;
  emptyDiagnosis?: EmptyDailyReportDiagnosis;
  editorialDigest?: DailyReportEditorialDigest;
  editorialMaterials?: DailyReportEditorialMaterial[];
  coverJudgement?: DailyReportEditorialDigest['coverJudgement'];
  radarOverview?: DailyReportEditorialDigest['radarOverview'];
  eventMetrics?: DailyReportEventMetrics;
  moduleSections?: DailyReportModuleSection[];
  moduleNarratives?: DailyReportModuleSection[];
  moreDynamics?: DailyReportPriorityArticle[];
  deepReads?: DailyReportPriorityArticle[];
  tableOfContents?: string[];
  readingOrder?: DailyReportEditorialDigest['readingOrder'];
  nextActions?: DailyReportEditorialDigest['nextActions'];
  degradedPresentation?: DailyReportDegradedPresentation;
  coverageSummary?: DailyReportCoverageSummary | null;
  coverageItems?: DailyReportCoverageItem[];
  coverageMarkdown?: string;
  cleaning?: DailyReportCleaning;
  modules: Partial<Record<'decision' | 'research' | 'reading', DailyReportModule>>;
  final?: DailyReportFinal;
  preset: InsightPreset;
  generationMode: DailyReportGenerationMode;
  qualityStatus: DailyReportQualityStatus;
  qualityReasons: string[];
  qualityWarnings?: string[];
  recoveryContext?: DailyReportRecoveryContext;
}

// ─── 结构化日报输出类型（Phase C1） ─────────────────────────────────────────

export interface DailyReportStructured {
  /** 编辑总评/一句话判断 */
  coverJudgement: string;
  /** 编辑寄语/人工备注(可选) */
  editorNote?: string;
  /** 主题板块列表 */
  topicBlocks: TopicBlock[];
  /** 置顶条目 */
  topItems: StructuredTopItem[];
  /** 覆盖度指数 - 各领域覆盖情况 */
  coverageIndex: CoverageEntry[];
  /** 信源声明 */
  sourceDeclaration: string[];
}

export interface TopicBlock {
  id: string;
  title: string;
  summary: string;
  tone: 'insight' | 'evidence' | 'caution' | 'neutral';
  items: StructuredTopItem[];
  tags: string[];
}

export interface StructuredTopItem {
  id: string;
  title: string;
  source: string;
  url?: string;
  summary: string;
  readingTier: 'must-read' | 'skim' | 'reference';
  publishedAt?: string;
  tags: string[];
}

export interface CoverageEntry {
  domain: string;
  score: number; // 0-100
  sourceCount: number;
}

// ─── 结构化日报输出类型结束 ──────────────────────────────────────────────────

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
  structured?: DailyReportStructured;
  options: ResolvedDailyReportOptions;
}

const DAILY_PIPELINE_VERSION = 3;
const DAILY_COMPARE_WINDOW_DAYS = 7;
const FINAL_AGENT_MIN_CHINESE_CHARS = 1800;

export function buildDailyReportItemUrl(itemId: string) {
  return `/feed/${encodeURIComponent(String(itemId || '').trim())}`;
}

export function resolveFinalReportLengthTarget(snapshot: DailyReportSnapshot) {
  const evidenceIds = new Set<string>();
  const addItems = (items: Array<{ id?: string; url?: string }> | undefined) => {
    for (const item of items || []) evidenceIds.add(String(item.id || item.url || ''));
  };
  addItems(snapshot.topItems);
  addItems(snapshot.editorialSupplementArticles);
  for (const section of snapshot.moduleSections || []) addItems(section.priorityArticles);
  evidenceIds.delete('');
  const evidenceCount = evidenceIds.size;
  if (evidenceCount >= 35) return { evidenceCount, minChars: 6000, targetLabel: '6000-9000 个中文字符' };
  if (evidenceCount >= 21) return { evidenceCount, minChars: 4500, targetLabel: '5000-7000 个中文字符' };
  if (evidenceCount >= 9) return { evidenceCount, minChars: 3200, targetLabel: '3500-5000 个中文字符' };
  return { evidenceCount, minChars: 1800, targetLabel: '2200-3200 个中文字符' };
}

export function buildDailyInsightType(sourceId?: number | null): string {
  return Number.isInteger(sourceId) && Number(sourceId) > 0 ? `daily_source_${Number(sourceId)}` : 'daily';
}

function buildDailyReportScopeMeta(sourceId?: number | null, sourceName?: string | null, reportType?: string) {
  const resolvedType = String(reportType || buildDailyInsightType(sourceId)).trim() || 'daily';
  const normalizedName = String(sourceName || '').trim() || null;
  return {
    reportType: resolvedType,
    sourceId: Number.isInteger(sourceId) && Number(sourceId) > 0 ? Number(sourceId) : null,
    sourceName: normalizedName,
    label: normalizedName ? `${normalizedName} 独立日报` : '信息中枢日报',
  };
}

export function selectDailyReportItems(
  visibleItems: TopItem[],
  options: Pick<ResolvedDailyReportOptions, 'topN' | 'minScore'>,
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
  cleaning: AI_TOKEN_BUDGETS.dailyCleaning,
  decision: AI_TOKEN_BUDGETS.dailyDecision,
  research: AI_TOKEN_BUDGETS.dailyResearch,
  reading: AI_TOKEN_BUDGETS.dailyReading,
  final: AI_TOKEN_BUDGETS.dailyFinal,
};
const DAILY_SCENE_MIN_LENGTH: Record<keyof typeof DAILY_AGENT_SCENES, number> = {
  cleaning: 80,
  decision: 220,
  research: 320,
  reading: 220,
  final: 6000,
};

const DAILY_SCENE_REQUIRED_SECTIONS: Partial<Record<keyof typeof DAILY_AGENT_SCENES, string[]>> = {
  decision: ['## 总体判断', '## 关键变化', '## 风险与机会', '## 下一步动作'],
  research: ['## 主题脉络', '## 代表性证据', '## 分歧与空白', '## 值得追踪的问题'],
  reading: ['## 必读', '## 速览', '## 可跳过'],
  final: ['## 今天怎么读', '## 下一步关注'],
};

export function shouldRunDailyReportAiStage(
  generationMode: DailyReportGenerationMode,
  stage: keyof typeof DAILY_AGENT_SCENES,
  moduleEnabled: boolean,
  preset: InsightPreset,
): boolean {
  if (!moduleEnabled) return false;
  if (stage === 'final') return true;
  if (generationMode === 'fast') return false;
  if (stage === 'cleaning') return true;
  return preset === 'full' || preset === stage;
}

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
    '你是一名独立编辑，负责把当天的精选文章写成可直接发布、愿意读完的中文日报。这是最终成稿，不是候选池、运行日志或模块拼接结果。',
    '目标长度：正文约 {lengthTarget}；证据不足时宁可更短更密，不得重复扩写或伪造趋势。',
    '要求：',
    '- 首行必须是一个有判断的 Markdown H1 主标题，不要使用“信息中枢日报 + 日期”这类机械标题',
    '- 不按系统分类硬拆章节。先从材料中自主归纳 3-5 条有关联的编辑主线，每条主线说清“发生了什么、为什么重要、证据强度如何、接下来看什么”',
    '- 每条编辑主线必须使用独立的 Markdown 二级标题（##），标题应是对当天变化的判断，不是“模型与实验室”这类分类名',
    '- 编辑主线使用 Markdown 二级标题（##），主线内的文章证据使用三级标题（###）；不要把文章标题提升为主线',
    '- H1 后用一段引用块写今日最值得知道的变化，不写收集数量。开头用“## 今日精选”给出 3-5 条带阅读链接的事实速览',
    '- 每个 H3 必须是 [中文事件标题](/feed/item-id)，正文写 150-350 中文字：具体进展、关键事实与限制、明确标为“编辑判断”的影响，以及一个可验证的跟踪点。保留列表与分段，不机械复制摘要',
    '- 英文标题和事实也必须用中文表达，专有名词保留英文。照片说明、作者头像、订阅广告和“暂无摘要”不属于事实材料；只有片段时明确限制，不补造缺失内容',
    '- 重要文章融入主线深写；剩余有价值但不值得展开的材料，放入简短的“更多值得知道”，不逐条复制摘要',
    '- 必须区分证据强度：官方发布、媒体报道、公司自述、合同文字推断不能写成同一级别的确定事实',
    '- 每篇被引用的文章都使用材料中给出的“信息中枢阅读链接”，格式为 [文章标题](/feed/item-id)，禁止裸 URL，不要使用原始站外链接作为主链接',
    '- 结尾必须包含“## 今天怎么读”和“## 下一步关注”，只给阅读顺序与可验证的跟踪点',
    '- 禁止出现“为什么先读”“摘要与判断”“本地兜底”“模型摘要暂时不可用”“入报原因”“达到精选分”“候选池”“评分阈值”等中间过程语言',
    '- 不要输出目录、运行分析、Token、模型、失败重试、raw 分类或生成口径',
    '- 不要输出字数、长度是否达标、标题是否齐全等生成自检；这些是系统验收信息，不是日报正文',
    '- 不得编造材料中没有的数字、引语、因果或趋势；单篇证据只能写成单篇观察',
    '- 某个主线缺少文章证据时直接删除，不要输出“素材中仅提及”或自行补充背景',
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

function truncateContextText(value: string | null | undefined, limit: number) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit).trimEnd()}...`;
}

function compactStringArray(values: string[] | undefined, limit: number, textLimit: number) {
  return (values || [])
    .slice(0, limit)
    .map((value) => truncateContextText(value, textLimit))
    .filter(Boolean);
}

function compactCleaningOutput(cleaning: DailyCleaningOutput): DailyCleaningOutput {
  const domainBuckets = Object.fromEntries(
    Object.entries(cleaning.domainBuckets || {}).map(([key, values]) => [
      key,
      compactStringArray(values, 5, 140),
    ]),
  );
  return {
    summary: truncateContextText(cleaning.summary, 360),
    prioritySignals: compactStringArray(cleaning.prioritySignals, 6, 180),
    themeLabels: compactStringArray(cleaning.themeLabels, 8, 100),
    watchlist: compactStringArray(cleaning.watchlist, 6, 160),
    ...(Object.keys(domainBuckets).length > 0 ? { domainBuckets } : {}),
  };
}

function buildInsightContext(
  snapshot: DailyReportSnapshot,
  options: { topItems?: number; summaryChars?: number; categories?: number; themes?: number } = {},
): string {
  const topItems = options.topItems ?? 16;
  const summaryChars = options.summaryChars ?? 520;
  const categories = options.categories ?? 12;
  const themes = options.themes ?? 8;
  const categoryLines = snapshot.byCategory
    .filter((entry) => entry.category !== '未分类待治理线索')
      .slice(0, categories)
    .map((entry) => `- ${entry.category}: 今日 ${entry.count}，近${snapshot.compareWindowDays}日均值 ${entry.baselineAvg.toFixed(1)}，变化 ${entry.delta >= 0 ? '+' : ''}${entry.delta.toFixed(1)}`)
    .join('\n');

  const themeLines = snapshot.themeClusters
    .slice(0, themes)
    .map((cluster) => `- ${cluster.label}: ${cluster.count} 条；样例：${cluster.sampleTitles.join(' / ')}`)
    .join('\n');

  const topItemLines = snapshot.topItems
    .slice(0, topItems)
    .map((item, index) => {
      const score = item.aiScore != null ? `AI ${item.aiScore}` : 'AI -';
      const summary = truncateContextText(item.reportSummary || item.aiSummary || '暂无摘要', summaryChars);
      return `${index + 1}. ${item.displayTitle || item.title}\n来源: ${item.sourceName} / ${item.category}\n评分: ${score}\n入报原因: ${item.selectionReason || '按默认日报规则入选'}\n摘要: ${summary}\n链接: ${item.url}`;
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

export interface FinalMarkdownStructureDiagnostics {
  h1Count: number;
  h2Count: number;
  h3Count: number;
  editorialH2Count: number;
  substantiveH2Count: number;
  substantiveH3Count: number;
  boldHeadingCandidateCount: number;
  codeFenceCount: number;
  outerMarkdownFence: boolean;
}

type MarkdownHeadingSection = {
  level: number;
  heading: string;
  body: string;
};

function collectMarkdownHeadingSections(markdown: string): MarkdownHeadingSection[] {
  const normalized = normalizeMarkdownForQuality(markdown);
  const matches = [...normalized.matchAll(/^(#{1,6})\s+(.+)$/gm)];
  return matches.map((match, index) => {
    const level = String(match[1] || '').length;
    const start = Number(match.index || 0) + match[0].length;
    const next = matches.slice(index + 1).find((candidate) => String(candidate[1] || '').length <= level);
    return {
      level,
      heading: String(match[2] || '').trim(),
      body: normalized.slice(start, next ? Number(next.index || normalized.length) : normalized.length).trim(),
    };
  });
}

function isSubstantiveMarkdownBody(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '$1')
    .replace(/[*_`>#-]/g, ' ')
    .replace(/\s+/g, '')
    .length >= 40;
}

function isOuterMarkdownFence(markdown: string) {
  return /^```(?:markdown|md)?\s*\n[\s\S]*\n```\s*$/i.test(normalizeMarkdownForQuality(markdown));
}

function stripOuterMarkdownFence(markdown: string) {
  const normalized = normalizeMarkdownForQuality(markdown);
  const match = normalized.match(/^```(?:markdown|md)?\s*\n([\s\S]*)\n```\s*$/i);
  return match ? normalizeMarkdownForQuality(match[1]) : normalized;
}

function countBoldHeadingCandidates(markdown: string) {
  return (normalizeMarkdownForQuality(markdown).match(/^\*\*[^*\n]{4,90}\*\*\s*$/gm) || []).length;
}

export function inspectFinalMarkdownStructure(markdown: string): FinalMarkdownStructureDiagnostics {
  const normalized = normalizeMarkdownForQuality(markdown);
  const sections = collectMarkdownHeadingSections(normalized);
  const h2Sections = sections.filter((section) => section.level === 2);
  const h3Sections = sections.filter((section) => section.level === 3);
  const reserved = new Set((DAILY_SCENE_REQUIRED_SECTIONS.final || []).map((heading) => heading.replace(/^##\s+/, '').replace(/\s+/g, '').toLowerCase()));
  return {
    h1Count: sections.filter((section) => section.level === 1).length,
    h2Count: h2Sections.length,
    h3Count: h3Sections.length,
    editorialH2Count: h2Sections.filter((section) => !reserved.has(section.heading.replace(/\s+/g, '').toLowerCase())).length,
    substantiveH2Count: h2Sections.filter((section) => isSubstantiveMarkdownBody(section.body)).length,
    substantiveH3Count: h3Sections.filter((section) => isSubstantiveMarkdownBody(section.body)).length,
    boldHeadingCandidateCount: countBoldHeadingCandidates(normalized),
    codeFenceCount: (normalized.match(/^```/gm) || []).length,
    outerMarkdownFence: isOuterMarkdownFence(normalized),
  };
}

function formatFinalMarkdownStructureDiagnostics(value: FinalMarkdownStructureDiagnostics) {
  return [
    `h1=${value.h1Count}`,
    `h2=${value.h2Count}`,
    `h3=${value.h3Count}`,
    `editorial=${value.editorialH2Count}`,
    `substantive=${value.substantiveH2Count}`,
    `bold=${value.boldHeadingCandidateCount}`,
    `fenced=${value.outerMarkdownFence ? 1 : 0}`,
  ].join(',');
}

function promoteSubstantiveHeadingLines(markdown: string, matcher: RegExp, render: (match: RegExpMatchArray) => string) {
  const lines = markdown.split('\n');
  let fenced = false;
  const candidates: Array<{ index: number; match: RegExpMatchArray }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = line.match(matcher);
    if (match) candidates.push({ index, match });
  }
  const substantive = candidates.filter((candidate, candidateIndex) => {
    const nextCandidate = candidates[candidateIndex + 1]?.index ?? lines.length;
    const nextHigherHeading = lines.findIndex((line, index) => index > candidate.index && index < nextCandidate && /^#{1,2}\s+/.test(line));
    const end = nextHigherHeading >= 0 ? nextHigherHeading : nextCandidate;
    return isSubstantiveMarkdownBody(lines.slice(candidate.index + 1, end).join('\n'));
  });
  if (substantive.length < 3) return markdown;
  for (const candidate of substantive) lines[candidate.index] = render(candidate.match);
  return lines.join('\n');
}

export function normalizeFinalSceneMarkdownStructure(markdown: string) {
  let normalized = stripOuterMarkdownFence(markdown)
    .replace(/^\s*<h1[^>]*>(.*?)<\/h1>\s*$/gim, '# $1')
    .replace(/^\s*<h2[^>]*>(.*?)<\/h2>\s*$/gim, '## $1')
    .replace(/^\s*<h3[^>]*>(.*?)<\/h3>\s*$/gim, '### $1')
    .replace(/^\s*[-*]\s+(#{2,3})\s*/gm, '$1 ')
    .replace(/^(#{1,6})([^#\s])/gm, '$1 $2');

  if (inspectFinalMarkdownStructure(normalized).h2Count === 0) {
    normalized = promoteSubstantiveHeadingLines(normalized, /^###\s+(.+)$/, (match) => `## ${String(match[1] || '').trim()}`);
  }
  if (inspectFinalMarkdownStructure(normalized).h2Count === 0) {
    normalized = promoteSubstantiveHeadingLines(normalized, /^\*\*([^*\n]{4,90})\*\*\s*$/, (match) => `## ${String(match[1] || '').trim()}`);
  }
  return normalizeMarkdownForQuality(normalized);
}

function normalizeReportCategoryLabel(category?: string | null) {
  const raw = (category || '').trim();
  if (!raw || raw.toLowerCase() === 'uncategorized') return '未分类待治理线索';
  const genericLabels: Record<string, string> = {
    tech: '技术动态',
    technology: '技术动态',
    ai: 'AI 动态',
    news: '新闻动态',
    blog: '深度博客',
    blogs: '深度博客',
  };
  if (genericLabels[raw.toLowerCase()]) return genericLabels[raw.toLowerCase()];
  return raw;
}

function normalizeDailyReportReaderPresentation(markdown: string) {
  const lines = markdown.split('\n');
  const firstHeading = lines.find((line) => /^#{2,4}\s/.test(line)) || '';
  const legacyNumberedHierarchy = /^###\s+\d+[.、.)]/.test(firstHeading);
  const reservedH2 = /^(?:原文证据索引|今天怎么读|下一步关注)$/;
  let fenced = false;
  let insideEditorialGroup = false;
  let insideReservedSection = false;
  let sawNumberedEditorialGroup = false;

  const normalized = lines.map((rawLine) => {
    if (/^\s*```/.test(rawLine)) {
      fenced = !fenced;
      return rawLine;
    }
    if (fenced) return rawLine;

    let line = rawLine
      .replace(/(?:[（(]\s*)?信息中枢链接\s*[:：]\s*(\/feed\/[A-Za-z0-9-]+(?:\?[A-Za-z0-9_=&%.-]+)?)(?:\s*[）)])?/g, '[查看信息中枢原文]($1)')
      .replace(/[（(]?\s*信息中枢链接同上\s*[）)]?/g, '')
      .replace(/[（(]\s*(?:全文|本文|正文)约\s*[\d,]+\s*(?:个?中文)?(?:字|字符)\s*[）)]/g, '')
      .replace(/[ \t]+$/g, '');

    // Generation self-checks belong in run logs, never in the reader. Remove
    // the entire line because leaving its tail still reads like a model trace.
    if (/^[（(]?\s*(?:注\s*[:：]\s*)?(?:(?:全文|本文|正文)约\s*[\d,]+\s*(?:个?中文)?(?:字|字符)|符合\s*\d+\s*(?:字|字符)|各标题下均包含|素材不足处已明确说明)/.test(line.trim())) {
      return '';
    }

    const evidenceBoundary = line.match(/^#{2,4}\s*[（(]?素材中仅提及\s*(.+?)[，,]\s*暂无.+?故补充说明\s*[）)]?\s*$/);
    if (evidenceBoundary) {
      return `> **证据边界：** 当前只有${String(evidenceBoundary[1] || '').trim()}这一项材料，以下仅作单点观察，不外推为行业趋势。`;
    }

    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (!heading) return line;

    const rawLevel = heading[1].length;
    let label = heading[2].trim();
    const numberedEditorialGroup = /^(?:(?:第)?(?:\d{1,2}|[一二三四五六七八九十]+)[.、.)）：:]\s*)+/.test(label);
    label = label.replace(/^(?:(?:第)?(?:\d{1,2}|[一二三四五六七八九十]+)[.、.)）：:]\s*)+/, '');

    if (reservedH2.test(label)) {
      insideEditorialGroup = false;
      insideReservedSection = true;
      return `## ${label}`;
    }

    if (numberedEditorialGroup && (rawLevel === 2 || legacyNumberedHierarchy)) {
      sawNumberedEditorialGroup = true;
      insideEditorialGroup = true;
      insideReservedSection = false;
      return `## ${label}`;
    }

    if (insideReservedSection && rawLevel <= 2) return `### ${label}`;
    if (legacyNumberedHierarchy && sawNumberedEditorialGroup && insideEditorialGroup && rawLevel <= 2) return `### ${label}`;
    if (rawLevel >= 3) return `${'#'.repeat(rawLevel)} ${label}`;
    return `## ${label}`;
  }).join('\n');

  return normalized.replace(/\n{3,}/g, '\n\n').trim();
}

export function sanitizeDailyReportMarkdown(markdown: string) {
  const cleaned = markdown
    .replace(/\buncategorized\b/gi, '未分类待治理线索')
    .replace(/(?:及|和|、)\s*未分类待治理线索/g, '')
    .replace(/分类\s*[:：]\s*未分类待治理线索/g, '分类：未分类待治理线索（仅用于治理诊断）')
    .replace(/\*\*未分类待治理线索（(\d+)\s*条）\*\*/g, '分类治理诊断项 $1 条（不作为日报主题）')
    .replace(/未分类待治理线索/g, '分类治理诊断项')
    .replace(/入报原因[:：]\s*/g, '价值判断：')
    .replace(/(?:达到|高于|超过)\s*精选分(?:阈值)?(?:\s*(?:[:：为]|[><=≥≤]+)?\s*\*{0,2}\d+(?:\.\d+)?\*{0,2})?(?:[，,、且匹配日报范围。]*)?/g, '高价值信号明确')
    .replace(/（?\s*(?:AI\s*)?评分\s*[:：为]?\s*\*{0,2}\d+(?:\.\d+)?\*{0,2}\s*）?/gi, '')
    .replace(/[；;，,、]\s*[SABCD]\s*来源/g, '')
    .replace(/\*{0,2}[SABCD]\*{0,2}\s*来源/gi, '')
    .replace(/\bAI\s+\d{2,3}(?:\.\d+)?\b/g, 'AI 信号')
    .replace(/评分阈值/g, '筛选门槛')
    .replace(/候选池/g, '素材池')
    .replace(/为什么先读\s*[:：]?/g, '阅读价值：')
    .replace(/摘要与判断\s*[:：]?/g, '内容导读：')
    .replace(/本地兜底/g, '待人工复核')
    .replace(/模型摘要暂(?:时)?不可用，?先提供本地阅读导读。?/g, '当前缺少可靠摘要，请优先核对原文。')
    .replace(/(?<!\]\()https?:\/\/[^\s)）]+/g, '');

  return normalizeDailyReportReaderPresentation(cleaned);
}

function countMarkdownLinks(markdown: string) {
  return (markdown.match(/\[[^\]\n]{2,}\]\((?:https?:\/\/[^)\s]+?|\/feed\/[^)\s]+?)\)/g) || []).length;
}

function hasBareUrl(markdown: string) {
  return /(?<!\]\()https?:\/\/[^\s)）]+/.test(markdown);
}

function finalReportQualityIssue(markdown: string): string | null {
  const normalized = normalizeMarkdownForQuality(markdown);
  if (/uncategorized/i.test(normalized)) return 'raw_category_label';
  if (/##\s*(?:生成口径|运行分析|模型用量)|(?:^|\n)\s*(?:[-*]\s*)?(?:生成模式|模型调用次数|Token\s*(?:用量|消耗|统计|明细)|tokens?)\s*[:：]/im.test(normalized)) return 'operational_debug_content';
  if (/达到精选分|入报原因|评分阈值|评分\s*\d|\bAI\s+\d{2,3}(?:\.\d+)?\b|为什么先读|摘要与判断|本地兜底|模型摘要暂(?:时)?不可用|^\s*\d+\.\s+[^\n·]+·\s*(?:tech|blogs?|news|ai)\s*$/im.test(normalized)) return 'machine_selection_language';
  if (hasBareUrl(normalized)) return 'bare_url';
  return null;
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
  minLength = DAILY_SCENE_MIN_LENGTH[sceneKey],
): { ok: boolean; reason?: string } {
  const normalized = normalizeMarkdownForQuality(sceneKey === 'final'
    ? normalizeFinalSceneMarkdownStructure(sanitizeDailyReportMarkdown(markdown))
    : markdown);
  if (normalized.length < minLength) {
    return { ok: false, reason: 'too_short' };
  }
  if (looksTruncated(normalized)) {
    return { ok: false, reason: 'truncated' };
  }

  const required = DAILY_SCENE_REQUIRED_SECTIONS[sceneKey];
  if (required && !hasAllSections(normalized, required)) {
    return { ok: false, reason: 'missing_sections' };
  }
  if (sceneKey === 'final') {
    const issue = finalReportQualityIssue(normalized);
    if (issue) return { ok: false, reason: issue };
    const headings = normalized.match(/^##\s+.+$/gm) || [];
    const editorialHeadings = headings.filter((heading) => !DAILY_SCENE_REQUIRED_SECTIONS.final?.includes(heading.trim()));
    if (!/^#\s+\S/.test(normalized) || editorialHeadings.length < 3) {
      return { ok: false, reason: 'missing_editorial_structure' };
    }
  }

  return { ok: true };
}

export function shouldTryDeterministicSceneRepairFirst(reason?: string): boolean {
  return reason === 'missing_sections' || reason === 'too_short' || reason === 'truncated' || reason === 'bare_url' || reason === 'machine_selection_language' || reason === 'raw_category_label';
}

export function shouldComposeFinalExpansion(reason?: string): boolean {
  return reason === 'too_short' || reason === 'missing_editorial_structure';
}

export function appendSceneMarkdownContract(
  sceneKey: keyof typeof DAILY_AGENT_SCENES,
  prompt: string,
  minLength = DAILY_SCENE_MIN_LENGTH[sceneKey],
): string {
  const required = DAILY_SCENE_REQUIRED_SECTIONS[sceneKey];
  if (!required) return prompt;
  return [
    prompt.trim(),
    '',
    '输出格式硬约束：',
    ...(sceneKey === 'final' ? [
      '- 必须输出完整日报，不是只输出下面两个结尾章节。完整顺序：H1 编辑标题 → 一段事实导语 → 今日精选 → 3-5 个主题章节 → 今天怎么读 → 下一步关注。',
      '- 主题用 ##，文章用 ### [中文标题](/feed/item-id)。每篇展开具体事实、编辑判断与证据限制。编号不能替代标题层级。',
      '- 下列精确标题只约束结尾，不限制前面的主体章节；正文主要篇幅必须用于事实与主题分析。',
    ] : []),
    ...required.map((section) => `- 必须包含精确标题：${section}`),
    '- 不要省略标题，不要把标题改成同义词，不要只输出项目符号。',
    `- 全文至少 ${minLength} 个字符，每个标题下至少写 2 条具体内容；如果素材不足，明确写“暂无明确证据”，不要用重复句凑长度，也不要在正文汇报字数或格式自检结果。`,
  ].join('\n');
}

function truncateForRepairPrompt(value: string, limit = 6000) {
  const normalized = normalizeMarkdownForQuality(value);
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit).trimEnd()}\n\n[已截断，以上为原输出前 ${limit} 字符]`;
}

export function buildSceneRepairPrompt(
  sceneKey: keyof typeof DAILY_AGENT_SCENES,
  invalidMarkdown: string,
  fallbackMarkdown: string,
  context: string,
  reason = 'unknown',
  minLength = DAILY_SCENE_MIN_LENGTH[sceneKey],
): string {
  const required = DAILY_SCENE_REQUIRED_SECTIONS[sceneKey] || [];
  return appendSceneMarkdownContract(sceneKey, [
    sceneKey === 'final'
      ? '请重新编辑上一次不合格的最终日报。保留可核实事实，但可以完全重组标题和主线。'
      : '请修复并补全上一次不合格的日报模块输出。',
    `不合格原因：${reason}`,
    '要求：',
    sceneKey === 'final'
      ? '- 删除所有候选池、本地兜底、评分、分类卡片和运行话术；重新组织为连贯的编辑型文章。'
      : '- 不要删除已有有效内容；只补足缺失标题、证据、解释和行动价值。',
    ...(sceneKey === 'final' ? [
      '- 必须重写出至少 3 条编辑主线，每条主线使用独立的 Markdown 二级标题（##）。',
      '- 首行必须是 H1 编辑标题；每个文章小节必须用 ### [中文事件标题](/feed/item-id)，原文 ID 必须来自下方材料。',
      '- 正文用中文，保留必要专有名词；不把图注、署名、头像、导航或失败摘要写成事实。',
    ] : []),
    '- 不要编造输入素材之外的事实；证据不足时明确写“暂无明确证据”。',
    `- final 模块必须达到本期证据量对应的至少 ${minLength} 字要求，使用 Markdown 链接，禁止裸 URL、重复扩写和机器筛选话术。`,
    '- 输出最终 Markdown 正文，不要解释你如何修复。',
    ...(required.length > 0 ? ['- 必须保留这些精确标题：', ...required.map((section) => `  - ${section}`)] : []),
    '',
    '上一次不合格输出：',
    truncateForRepairPrompt(invalidMarkdown),
    '',
    ...(sceneKey === 'final' ? [] : [
      '可参考的确定性草稿：',
      truncateForRepairPrompt(fallbackMarkdown, 3000),
      '',
    ]),
    '原始上下文：',
    sceneKey === 'final' ? context : truncateForRepairPrompt(context, 8000),
  ].join('\n'), minLength);
}

export function buildFinalExpansionPrompt(
  initialMarkdown: string,
  context: string,
  minLength: number,
) {
  const currentChineseChars = countChineseCharacters(initialMarkdown);
  const expansionTarget = Math.min(3800, Math.max(1800, minLength - currentChineseChars + 600));
  const existingHeadings = (normalizeMarkdownForQuality(initialMarkdown).match(/^##\s+.+$/gm) || [])
    .map((heading) => `- ${heading}`);
  return [
    '你是最终日报的扩展编辑。第一版已经形成编辑判断，但正文深度不足。请只补写新的深度章节，不要重写第一版。',
    `本次补写至少 ${expansionTarget} 个中文字符，输出 3-5 个全新的 Markdown 二级章节（##）。`,
    '要求：',
    '- 新章节必须补充第一版尚未展开的证据关系、分歧、影响和后续核验点；不要复述第一版。',
    '- 至少保留 3 个有完整正文的新二级章节，不要用目录、空标题或一句话章节充数。',
    '- 每个章节都要引用输入素材中的信息中枢阅读链接，并说明证据强度；禁止裸 URL 和站外主链接。',
    '- 不得再次输出 H1、“## 今天怎么读”或“## 下一步关注”；这三部分由第一版保留。',
    '- 不得使用与第一版相同的二级标题，不要输出目录、运行分析、评分、候选池或生成说明。',
    '- 不得编造素材之外的数字、引语、因果或趋势；证据不足时明确写“暂无独立证据”。',
    '- 只输出新增章节，不要解释补写过程。',
    '',
    '第一版已有二级标题：',
    ...(existingHeadings.length ? existingHeadings : ['- 暂无']),
    '',
    '第一版正文（只用于避免重复，不要改写）：',
    truncateForRepairPrompt(initialMarkdown, 7000),
    '',
    '可用事实材料：',
    truncateForRepairPrompt(context, 9000),
  ].join('\n');
}

type FinalMarkdownSection = {
  heading: string;
  body: string;
};

function splitFinalMarkdownSections(markdown: string) {
  const normalized = normalizeMarkdownForQuality(markdown);
  const matches = [...normalized.matchAll(/^##\s+(.+)$/gm)];
  const preamble = matches.length > 0 ? normalized.slice(0, matches[0].index).trim() : normalized;
  const sections: FinalMarkdownSection[] = matches.map((match, index) => {
    const start = Number(match.index || 0);
    const end = index + 1 < matches.length ? Number(matches[index + 1].index || normalized.length) : normalized.length;
    const heading = `## ${String(match[1] || '').trim()}`;
    return {
      heading,
      body: normalized.slice(start + match[0].length, end).trim(),
    };
  });
  return { preamble, sections };
}

function normalizedFinalHeading(heading: string) {
  return heading.replace(/^##\s+/, '').replace(/\s+/g, '').trim().toLowerCase();
}

function extractEditorialH1(markdown: string) {
  return markdown.match(/^#(?!#)\s+\S.*$/m)?.[0]?.trim() || '';
}

function stripEditorialH1(markdown: string) {
  return markdown.replace(/^#(?!#)\s+[^\n]*(?:\n+|$)/gm, '').trim();
}

export function mergeFinalSceneExpansion(primaryMarkdown: string, expansionMarkdown: string) {
  const primarySource = normalizeFinalSceneMarkdownStructure(sanitizeDailyReportMarkdown(primaryMarkdown));
  const expansionSource = normalizeFinalSceneMarkdownStructure(sanitizeDailyReportMarkdown(expansionMarkdown));
  const editorialH1 = extractEditorialH1(primarySource) || extractEditorialH1(expansionSource);
  const primary = splitFinalMarkdownSections(stripEditorialH1(primarySource));
  const expansionWithoutH1 = stripEditorialH1(expansionSource);
  const expansion = splitFinalMarkdownSections(expansionWithoutH1);
  const reserved = new Set(['今天怎么读', '下一步关注'].map((heading) => normalizedFinalHeading(`## ${heading}`)));
  const existing = new Set(primary.sections.map((section) => normalizedFinalHeading(section.heading)));
  const additions = expansion.sections.filter((section) => {
    const key = normalizedFinalHeading(section.heading);
    if (!key || reserved.has(key) || existing.has(key) || section.body.length < 40) return false;
    existing.add(key);
    return true;
  });
  if (additions.length === 0 && expansion.preamble.length >= 240) {
    additions.push({ heading: '## 补充证据与判断', body: expansion.preamble });
  }

  const tailSections = primary.sections.filter((section) => reserved.has(normalizedFinalHeading(section.heading)));
  const bodySections = primary.sections.filter((section) => !reserved.has(normalizedFinalHeading(section.heading)));
  return normalizeMarkdownForQuality([
    editorialH1,
    primary.preamble,
    ...bodySections.map((section) => `${section.heading}\n\n${section.body}`),
    ...additions.map((section) => `${section.heading}\n\n${section.body}`),
    ...tailSections.map((section) => `${section.heading}\n\n${section.body}`),
  ].filter(Boolean).join('\n\n'));
}

function extractMarkdownSection(markdown: string, section: string) {
  const normalized = normalizeMarkdownForQuality(markdown);
  const start = normalized.indexOf(section);
  if (start < 0) return null;
  const next = normalized.indexOf('\n## ', start + section.length);
  return normalized.slice(start, next >= 0 ? next : undefined).trim();
}

function replaceMarkdownSection(markdown: string, section: string, replacement: string) {
  const normalized = normalizeMarkdownForQuality(markdown);
  const start = normalized.indexOf(section);
  if (start < 0) return [normalized, replacement.trim()].filter(Boolean).join('\n\n');
  const next = normalized.indexOf('\n## ', start + section.length);
  const before = normalized.slice(0, start).trimEnd();
  const after = next >= 0 ? normalized.slice(next).trimStart() : '';
  return [before, replacement.trim(), after].filter(Boolean).join('\n\n');
}

function cleanDanglingLatinFragment(value: string): string {
  return value.replace(/([。！？.!?])\s*[A-Za-z][A-Za-z0-9+#./-]{0,16}$/u, '$1').trimEnd();
}

function cleanMarkdownSectionTail(markdown: string, section: string): string {
  const currentSection = extractMarkdownSection(markdown, section);
  if (!currentSection) return markdown;
  const body = currentSection.slice(section.length).trim();
  if (!body) return markdown;
  const cleanedBody = cleanDanglingLatinFragment(body);
  if (cleanedBody === body) return markdown;
  return replaceMarkdownSection(markdown, section, [section, '', cleanedBody].join('\n'));
}

function normalizeConclusionSection(markdown: string): string {
  const section = markdown.includes('## 今日判断') ? '## 今日判断' : '## 今日结论';
  const currentSection = extractMarkdownSection(markdown, section);
  if (!currentSection) return markdown;
  const body = currentSection.slice(section.length).trim();
  if (!body) return markdown;
  let cleanedBody = cleanDanglingLatinFragment(body);
  if (cleanedBody && !/[。！？.!?]$/u.test(cleanedBody)) {
    cleanedBody = `${cleanedBody}。`;
  }
  if (cleanedBody === body) return markdown;
  return replaceMarkdownSection(markdown, section, [section, '', cleanedBody].join('\n'));
}

export function repairSceneMarkdownWithFallback(
  sceneKey: keyof typeof DAILY_AGENT_SCENES,
  primaryMarkdown: string,
  fallbackMarkdown: string,
): string {
  const required = DAILY_SCENE_REQUIRED_SECTIONS[sceneKey];
  const primary = normalizeMarkdownForQuality(primaryMarkdown);
  const fallback = normalizeMarkdownForQuality(fallbackMarkdown);
  if (!required || required.length === 0) return primary || fallback;

  const primaryHasRequiredSection = required.some((section) => primary.includes(section));
  const finalEvidenceSections = new Set(['## 今日精选', '## 模块日报', '## 更多动态', '## 重点研究/深读']);
  const repaired = required.map((section, index) => {
    const primarySection = extractMarkdownSection(primary, section);
    const fallbackSection = extractMarkdownSection(fallback, section);
    const needsTrustedLinks = sceneKey === 'final'
      && finalEvidenceSections.has(section)
      && Boolean(fallbackSection && countMarkdownLinks(fallbackSection) > 0)
      && countMarkdownLinks(primarySection || '') === 0;
    const primarySectionUsable = primarySection
      && !(index === required.length - 1 && looksTruncated(primarySection))
      && !needsTrustedLinks;
    const selected = primarySectionUsable ? primarySection : (fallbackSection || `${section}\n\n- 暂无明确证据。`);
    if (index === 0 && !primaryHasRequiredSection && primary) {
      return `${selected}\n\n### AI 原始补充\n\n${primary}`;
    }
    return selected;
  });

  const merged = repaired.join('\n\n').trim();
  return sceneKey === 'final' ? sanitizeDailyReportMarkdown(merged) : merged;
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
      : `今日新增 ${snapshot.newItems} 条，重点集中在 ${snapshot.byCategory.filter((item) => item.category !== '未分类待治理线索').slice(0, 3).map((item) => item.category).join(' / ') || '暂无主类目'}，主线围绕 AI 产业、头部舆论和资本/监管变化展开。`;

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

function compactModuleForFinalContext(module?: DailyReportModule) {
  if (!module) return '暂无';
  const bullets = module.bullets.length > 0
    ? module.bullets.slice(0, 6).map((bullet) => `- ${truncateContextText(bullet, 180)}`).join('\n')
    : `- ${truncateContextText(module.markdown, 900)}`;
  const citations = module.citations.slice(0, 5)
    .map((item) => `- ${item.title} · ${item.sourceName} · ${buildDailyReportItemUrl(item.id)}`)
    .join('\n');
  return [
    `标题：${module.title}`,
    '要点：',
    bullets || '- 暂无',
    ...(citations ? ['', '引用：', citations] : []),
  ].join('\n');
}

export function buildDailyReportEditorialContext(item: TopItem, content?: {
  readabilityContent?: string | null;
  content?: string | null;
  translatedTitle?: string | null;
}) {
  const parts = [
    ['已有摘要', item.reportSummary || item.aiSummary],
    ['中文材料', item.aiTranslation],
    ['正文事实', content?.readabilityContent || content?.content],
    ['RSS 导读', item.snippet],
  ] as const;
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const [label, value] of parts) {
    const cleaned = cleanReportInlineText(value, label === '正文事实' ? 2600 : 900);
    const key = cleaned.slice(0, 180).toLowerCase();
    if (!cleaned || containsDailyPlaceholder(cleaned) || seen.has(key)) continue;
    seen.add(key);
    resolved.push(`${label}：${cleaned}`);
  }
  if (resolved.length === 0) resolved.push(`可核实材料：${item.title}`);
  return {
    translatedTitle: String(content?.translatedTitle || '').trim() || null,
    editorialContext: truncateContextText(resolved.join('\n'), 2400),
  };
}

function buildFinalEvidenceContext(snapshot: DailyReportSnapshot) {
  return snapshot.topItems.map((item, index) => [
    `### 素材 ${index + 1}：${item.displayTitle || item.translatedTitle || item.title}`,
    `- 信息中枢阅读链接：${item.readerUrl || buildDailyReportItemUrl(item.id)}`,
    `- 原始出处：${item.url}`,
    `- 来源：${item.sourceName}`,
    `- 发布时间：${item.publishedAt || item.fetchedAt || '未记录'}`,
    '- 可核实内容：',
    item.editorialContext || cleanReportInlineText(item.reportSummary || item.aiSummary || item.snippet || item.title, 1200),
  ].join('\n')).join('\n\n');
}

export function buildFinalContext(
  snapshot: DailyReportSnapshot,
  cleaning: DailyCleaningOutput,
  modules: Partial<Record<'decision' | 'research' | 'reading', DailyReportModule>>,
) {
  const categoryLines = snapshot.byCategory
    .filter((entry) => entry.category !== '未分类待治理线索')
    .slice(0, 8)
    .map((entry) => `- ${entry.category}：今日 ${entry.count} 条，近 ${snapshot.compareWindowDays} 日日均 ${entry.baselineAvg.toFixed(1)} 条`);
  const sourceLines = snapshot.topSources
    .slice(0, 6)
    .map((entry) => `- ${entry.sourceName}：${entry.count} 篇`);
  return [
    '【可核实的当日统计】',
    `- 日期：${snapshot.date}`,
    `- 今日新增：${snapshot.newItems} 条`,
    `- 本次精选素材：${snapshot.topItems.length} 篇`,
    '- 主要来源：',
    ...(sourceLines.length > 0 ? sourceLines : ['- 暂无']),
    '- 内容分布：',
    ...(categoryLines.length > 0 ? categoryLines : ['- 暂无']),
    '',
    '【编辑边界】',
    '- 标题和导语必须概括真实事件，不把分类名与数量改写成趋势。',
    '',
    '【结构化清洗结果，仅用于帮助归纳】',
    JSON.stringify(compactCleaningOutput(cleaning), null, 2),
    '',
    '【模块观察，可质疑、合并或放弃】',
    '决策观察：',
    compactModuleForFinalContext(modules.decision),
    '',
    '研究观察：',
    compactModuleForFinalContext(modules.research),
    '',
    '阅读观察：',
    compactModuleForFinalContext(modules.reading),
    '',
    '【精选文章事实材料，这是成稿的主要依据】',
    buildFinalEvidenceContext(snapshot) || '暂无可用材料',
  ].join('\n');
}

export function buildModuleContext(
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
    buildInsightContext(snapshot, { topItems: 10, summaryChars: 180, categories: 8, themes: 6 }),
    '',
    '结构化清洗结果：',
    JSON.stringify(compactCleaningOutput(cleaning), null, 2),
    '',
    `当前模块要求：${focusMap[sceneKey]}`,
  ].join('\n');
}

async function resolveDailyConfig(userId: string, sceneType: string): Promise<{ config: ResolvedAiConfig; resolvedConfigType: string } | null> {
  if (frozenEvaluation.getStore()) {
    const key = (Object.keys(DAILY_AGENT_SCENES) as Array<keyof typeof DAILY_AGENT_SCENES>).find(k => DAILY_AGENT_SCENES[k] === sceneType)!;
    return { config: { id: 0, ownerUserId: userId, scope: 'self', type: sceneType, provider: 'deepseek', model: 'deepseek-flash', temperature: 0, promptTemplate: DEFAULT_SCENE_PROMPTS[key], isActive: true }, resolvedConfigType: sceneType };
  }
  const config = await getEffectiveAiConfig(userId, sceneType);
  if (config) return { config, resolvedConfigType: sceneType };
  const fallback = await getEffectiveAiConfig(userId, LEGACY_DAILY_SCENE);
  if (fallback) return { config: fallback, resolvedConfigType: LEGACY_DAILY_SCENE };
  return null;
}

export function resolveScenePromptTemplate(
  sceneKey: keyof typeof DAILY_AGENT_SCENES,
  configuredTemplate: string,
  resolvedConfigType: string,
): string {
  if (sceneKey === 'cleaning') return configuredTemplate;
  const defaultTemplate = DEFAULT_SCENE_PROMPTS[sceneKey];
  if (resolvedConfigType !== DAILY_AGENT_SCENES[sceneKey]) return defaultTemplate;
  const template = String(configuredTemplate || '').trim();
  if (sceneKey === 'final') {
    const looksLikeLegacyWorkflowPrompt = /(?:今日封面判断|信息雷达总览|候选池|评分阈值|必须包含：)/.test(template);
    if (!template || looksLikeLegacyWorkflowPrompt) return defaultTemplate;
    return [
      defaultTemplate,
      '',
      '用户自定义编辑偏好（不得放松上述证据、内部链接和禁止中间话术要求）：',
      template.replaceAll('{context}', '').replaceAll('{lengthTarget}', '').trim(),
    ].join('\n');
  }
  const tooTerse = template.length < 260;
  if (!tooTerse) return template;
  return [
    defaultTemplate,
    '',
    '用户补充要求：',
    template,
  ].join('\n');
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

  const template = resolveScenePromptTemplate(sceneKey, resolved.config.promptTemplate, resolved.resolvedConfigType);

  const sceneContext = contextOverride || buildInsightContext(snapshot);
  const prompt = appendSceneMarkdownContract(sceneKey, interpolatePrompt(template, {
    date: snapshot.date,
    newItems: String(snapshot.newItems),
    totalItems: String(snapshot.totalItems),
    compareWindowDays: String(snapshot.compareWindowDays),
    context: sceneContext,
    highlights: snapshot.topItems.map((item, index) => `${index + 1}. ${item.title}`).join('\n'),
    categories: snapshot.byCategory.map((item) => `${item.category}: ${item.count}`).join('\n'),
  }));

  try {
    let result = await callLLM(resolved.config, prompt, {
      maxTokens: DAILY_SCENE_MAX_TOKENS[sceneKey],
    });
    const quality = validateSceneMarkdown(sceneKey, result.text);
    let promptForLog = prompt;
    let repaired = false;
    let repairReason: string | undefined;
    if (!quality.ok) {
      repairReason = quality.reason || 'unknown';
      if (shouldTryDeterministicSceneRepairFirst(repairReason)) {
        const deterministicRepair = repairSceneMarkdownWithFallback(sceneKey, result.text, fallbackMarkdown);
        const deterministicQuality = validateSceneMarkdown(sceneKey, deterministicRepair);
        if (deterministicQuality.ok) {
          result = {
            ...result,
            text: deterministicRepair,
          };
          repaired = true;
          repairReason = `${repairReason}; deterministic_repair_first`;
        }
      }
    }
    if (!quality.ok && !repaired) {
      const repairPrompt = buildSceneRepairPrompt(sceneKey, result.text, fallbackMarkdown, sceneContext, repairReason);
      const repairResult = await callLLM(resolved.config, repairPrompt, {
        maxTokens: DAILY_SCENE_MAX_TOKENS[sceneKey],
      });
      const repairQuality = validateSceneMarkdown(sceneKey, repairResult.text);
      const combinedTokens = {
        inputTokens: (result.inputTokens || 0) + (repairResult.inputTokens || 0),
        outputTokens: (result.outputTokens || 0) + (repairResult.outputTokens || 0),
        totalTokens: (result.totalTokens || 0) + (repairResult.totalTokens || 0),
        estimatedCost: (result.estimatedCost || 0) + (repairResult.estimatedCost || 0),
      };
      if (!repairQuality.ok) {
        const deterministicRepair = repairSceneMarkdownWithFallback(
          sceneKey,
          [result.text, repairResult.text].filter(Boolean).join('\n\n'),
          fallbackMarkdown,
        );
        const deterministicQuality = validateSceneMarkdown(sceneKey, deterministicRepair);
        if (!deterministicQuality.ok) {
          throw new Error(`invalid_daily_scene_output:${repairReason}; repair_failed:${repairQuality.reason}; deterministic_repair_failed:${deterministicQuality.reason}`);
        }
        result = {
          ...repairResult,
          text: deterministicRepair,
          ...combinedTokens,
        };
        promptForLog = repairPrompt;
        repaired = true;
        repairReason = `${repairReason}; deterministic_repair_after:${repairQuality.reason || 'unknown'}`;
      } else {
        result = {
          ...repairResult,
          ...combinedTokens,
        };
        promptForLog = repairPrompt;
        repaired = true;
      }
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
      promptPreview: promptForLog,
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
        ...(repaired ? { repaired, repairReason } : {}),
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

function normalizeDailyReportTitleKey(value?: string | null) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
}

function itemDisplayTitle(item: Pick<TopItem, 'displayTitle' | 'title'>) {
  return item.displayTitle || item.title;
}

function buildTopNewsReferenceMap(items: TopItem[]) {
  const map = new Map<string, number>();
  items.forEach((item, index) => {
    const title = itemDisplayTitle(item);
    const key = normalizeDailyReportTitleKey(title);
    if (key && !map.has(key)) map.set(key, index + 1);
  });
  return map;
}

function summarizePrioritySignal(signal: string, newsReferences: Map<string, number>) {
  const ref = newsReferences.get(normalizeDailyReportTitleKey(signal));
  return ref ? '头部新闻焦点已覆盖同一事件，关键进展只保留一次展开。' : signal;
}

function compactReadingRecommendation(item: TopItem, _newsReferences: Map<string, number>) {
  return `- [${itemDisplayTitle(item)}](${item.url}) · ${item.sourceName} · ${item.category}`;
}

function compactWatchlistRecommendation(title: string, newsReferences: Map<string, number>) {
  const ref = newsReferences.get(normalizeDailyReportTitleKey(title));
  return ref ? `- ${title} · 已在头部新闻焦点覆盖，阅读时只核对原始出处。` : `- ${title}`;
}

function buildReadingAdviceLine(item: TopItem, newsReferences: Map<string, number>, reason: string) {
  const ref = newsReferences.get(normalizeDailyReportTitleKey(itemDisplayTitle(item)));
  if (ref) {
    return `- 先读上方“关键证据与链接”中的对应条目，原文链接见上节 · ${reason}`;
  }
  return `- [${itemDisplayTitle(item)}](${item.url}) · ${reason}`;
}

function buildTieredReadingAdvice(snapshot: DailyReportSnapshot, newsReferences: Map<string, number>) {
  const priorityPool = snapshot.highScoreItems.length > 0 ? snapshot.highScoreItems : snapshot.topItems;
  const mustRead = priorityPool
    .filter((item) => (item.aiScore ?? 0) >= 70 || item.selectionMode === 'scored')
    .slice(0, 2);
  const mustIds = new Set(mustRead.map((item) => item.id));
  const skim = snapshot.topItems
    .filter((item) => !mustIds.has(item.id) && (item.aiScore ?? 0) >= 55 && item.selectionMode !== 'latest_visible')
    .slice(0, 3);
  const skimIds = new Set([...mustIds, ...skim.map((item) => item.id)]);
  const defer = snapshot.topItems
    .filter((item) => !skimIds.has(item.id) && ((item.aiScore ?? 0) < 55 || item.selectionMode === 'latest_visible'))
    .slice(0, 3);

  return [
    '### 先读',
    '',
    ...(mustRead.length > 0
      ? mustRead.map((item) => buildReadingAdviceLine(item, newsReferences, '会影响今日主线判断，先核对原文事实与增量。'))
      : ['- 暂无明确先读条目。']),
    '',
    '### 扫读',
    '',
    ...(skim.length > 0
      ? skim.map((item) => buildReadingAdviceLine(item, newsReferences, '用于补齐产品、产业或技术侧背景，快速扫摘要即可。'))
      : ['- 暂无明确扫读条目。']),
    '',
    '### 暂缓',
    '',
    ...(defer.length > 0
      ? defer.map((item) => buildReadingAdviceLine(item, newsReferences, item.selectionMode === 'latest_visible' ? '来自最新兜底或低分内容，等后续信号验证后再读。' : '当前信号强度较低，暂不占用深读时间。'))
      : ['- 暂无需要暂缓的条目。']),
  ];
}

function normalizeFinalReportSectionNames(markdown: string) {
  return markdown
    .replace(/## 整体趋势/g, '## 收集趋势')
    .replace(/## 内容趋势/g, '## 收集趋势')
    .replace(/## 重点文章/g, '## 今日重点文章')
    .replace(/## 今日结论/g, '## 今日判断')
    .replace(/## 关键进展/g, '## 关键证据与链接')
    .replace(/## 头部舆论\/新闻焦点/g, '## 三条核心主线')
    .replace(/## AI 产业与产品信号/g, '## 三条核心主线')
    .replace(/## 下一步动作/g, '## 下一步行动');
}

function countChineseCharacters(value: string) {
  return (value.match(/[\u3400-\u9fff]/g) || []).length;
}

function extractStructuredReportInlineText(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('{') || !/"(?:translatedTitle|blocks|summary|content)"\s*:/.test(raw)) return raw;
  try {
    const parsed = JSON.parse(raw) as {
      translatedTitle?: unknown;
      summary?: unknown;
      content?: unknown;
      blocks?: Array<{ markdown?: unknown; text?: unknown; content?: unknown }>;
    };
    const blockText = Array.isArray(parsed.blocks)
      ? parsed.blocks
        .flatMap((block) => [block?.markdown, block?.text, block?.content])
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .join('\n')
      : '';
    const resolved = [parsed.summary, blockText, parsed.content, parsed.translatedTitle]
      .find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    return resolved?.trim() || raw;
  } catch {
    // Truncated structured payloads are processing artifacts, not reader text.
    // Return empty so callers can fall through to a real snippet or title.
    return '';
  }
}

export function cleanReportInlineText(value?: string | null, limit = 180) {
  const withoutReaderChrome = extractStructuredReportInlineText(value)
    .replace(/\[(?:Back to Articles|返回文章)\]\([^)]*\)/gi, ' ')
    .replace(/!\[avatar\]\([^\n]*?\)/gi, ' ')
    .replace(/(?:\bavatar\b|Back to Articles|返回文章)/gi, ' ')
    .replace(/(?:\)\s*){3,}/g, ' ');
  return truncateContextText(
    sanitizeDailyReportMarkdown(withoutReaderChrome)
      .replace(/!\[[^\]\n]*\]\([^\n)]+\)/g, ' ')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/\s+#{1,6}\s+/g, '。')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/gm, '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\[([^\]\n]+)\]\([^\n)]*\)/g, '$1')
      .replace(/\[([^\]\n]+)\]\([^\n)]*$/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/(?:\)\s*){2,}/g, ' ')
      .replace(/\]\s*\(\s*/g, ' ')
      .replace(/[\[\]]\s*\(\s*$/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    limit,
  );
}

function removeRepeatedTopItemTitles(value: string, snapshot: DailyReportSnapshot) {
  let cleaned = value;
  for (const item of snapshot.topItems.slice(0, 8)) {
    const title = itemDisplayTitle(item);
    if (!title || title.length < 6) continue;
    cleaned = cleaned.replaceAll(title, '对应重点文章');
  }
  return cleaned;
}

export function humanizeDailyReportSelectionReason(
  reason?: string | null,
  item?: Pick<TopItem, 'title' | 'category'>,
) {
  const value = (reason || '').trim();
  const fallback = (() => {
    const context = `${item?.category || ''} ${item?.title || ''}`;
    if (/模型|Agent|智能体|AI|产品|工具/.test(context)) return '产品、技术或智能体落地信号明确，可支撑今日主线判断。';
    if (/资本|融资|公司|战略|产业|商业/.test(context)) return '产业协同或资源配置变化明确，适合纳入今日趋势判断。';
    if (/监管|政策|标准|安全|治理/.test(context)) return '监管、标准或安全边界出现变化，适合放入风险与后续观察。';
    if (/研究|论文|技术|基础设施|算力|芯片/.test(context)) return '技术路线或基础设施侧出现事实增量，适合用于判断中长期能力曲线。';
    return '条目具备可核对的事实增量，可支撑今日主线判断。';
  })();
  if (!value) return fallback;
  const cleaned = sanitizeDailyReportMarkdown(value)
    .replace(/价值判断[:：]\s*/g, '')
    .replace(/高价值信号明确(?:[（(][^）)]*[）)])?/g, '')
    .replace(/具备产品、技术或产业直接增量/g, '产品、技术或产业增量明确')
    .replace(/\b[SABCD]\s*来源\b/g, '')
    .replace(/；+/g, '；')
    .replace(/；。/g, '。')
    .trim();
  const usefulParts = cleaned
    .split(/[；;。]/)
    .map((part) => part.trim())
    .filter((part) => part && !/筛选|素材池|治理诊断|评分|来源等级/.test(part))
    .slice(0, 2);
  return usefulParts.join('；') || fallback;
}

export function humanizeDailyReportExcludedDetail(
  detail?: string | null,
  reason?: string | null,
  item?: Pick<TopItem, 'title' | 'category'>,
) {
  const value = (detail || '').trim();
  if (/webpage_snapshot|网页监控|快照/i.test(`${reason || ''} ${value}`)) return '这是网页监控快照，不等同于单篇文章，暂不进入正式日报主线。';
  if (/translation|翻译|中文化/i.test(`${reason || ''} ${value}`)) return '中文化结果不足，暂不进入正式日报。';
  if (/business_noise|泛商业|行情|公告|融资/i.test(`${reason || ''} ${value}`)) return '偏行情、公告或泛商业信息，暂不作为今日主线。';
  if (/uncategorized|未分类/i.test(`${reason || ''} ${value}`)) return '分类不够明确，建议先归类或降权后再判断。';
  if (/未达到精选分|兜底|分数|评分|score|threshold/i.test(value)) {
    return '当前信号强度不足，先保留为复核线索。';
  }
  if (!value) return humanizeDailyReportSelectionReason(null, item);
  const cleaned = sanitizeDailyReportMarkdown(value)
    .replace(/未达到精选分[^。；;]*/g, '当前信号强度不足')
    .replace(/未启用最新兜底/g, '未进入今日主线')
    .replace(/评分\s*\d+(?:\.\d+)?/g, '')
    .replace(/\b[SABCD]\s*来源\b/g, '')
    .replace(/；+/g, '；')
    .replace(/；。/g, '。')
    .trim();
  return cleaned || humanizeDailyReportSelectionReason(null, item);
}

const coverageStatusLabels: Record<DailyReportCoverageStatus, string> = {
  selected: '已精选',
  review: '待复核',
  latestFallback: '最新兜底',
  excluded: '未入报',
};

const coverageTranslationStatusLabels: Record<string, string> = {
  ready: '中文可读',
  skipped: '无需处理',
  translated: '已中文化',
  pending: '待中文化',
  failed: '中文化失败',
  translation_failed: '中文化失败',
  summary_failed: '摘要失败',
  summary_must_be_chinese: '摘要需中文化',
};

function cleanCoverageText(value?: string | null) {
  const cleaned = sanitizeDailyReportMarkdown(String(value || ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\b(skipped|ready|pending|not_run|fallback_scored|translation_failed)\b/gi, '')
    .replace(/达到精选分[^。；;\n]*/g, '')
    .replace(/未达到精选分[^。；;\n]*/g, '当前信号强度不足')
    .replace(/\b[SABCD]\s*来源\b/g, '')
    .replace(/评分\s*\d+(?:\.\d+)?/g, '')
    .replace(/Token\s*(?:用量|消耗|统计|明细)[:：]?\s*\d*/gi, '')
    .replace(/tokens?\s*[:：]\s*\d+/gi, '')
    .replace(/uncategorized/gi, '分类待治理')
    .replace(/\s+/g, ' ')
    .replace(/；+/g, '；')
    .replace(/；。/g, '。')
    .trim();
  if (cleaned.length <= 180) return cleaned;
  const clipped = cleaned.slice(0, 180);
  const boundary = Math.max(clipped.lastIndexOf('。'), clipped.lastIndexOf('；'), clipped.lastIndexOf('，'));
  return `${(boundary > 60 ? clipped.slice(0, boundary + 1) : clipped).trim()}...`;
}

function resolveCoverageDigest(item: DailyReportCoverageRawItem) {
  return cleanCoverageText(
    item.reportSummary
    || item.aiTranslation
    || item.aiSummary
    || item.snippet
    || item.detail
    || item.title,
  );
}

function coverageActionFor(status: DailyReportCoverageStatus, excludedReason?: string | null) {
  if (status === 'selected') return '优先阅读，可结合正文主线和原文判断后续行动。';
  if (status === 'review') return '建议人工复核评分、摘要或来源质量，再决定是否进入下一版日报。';
  if (status === 'latestFallback') return '作为补充线索扫读，观察后续是否出现更强证据。';
  if (excludedReason === 'translation_failed' || excludedReason === 'not_chinese') return '先补中文化或摘要，再判断是否值得入报。';
  if (excludedReason === 'business_noise') return '保持降权，除非它和 AI、技术、监管或长期趋势形成明确连接。';
  if (excludedReason === 'fallback_scored') return '先回收低置信评分，再决定是否纳入复核池。';
  if (excludedReason === 'webpage_snapshot') return '如需深读，把来源改成索引源或单篇正文源后再补正文。';
  return '保留为可追溯线索，暂不进入高质量日报正文。';
}

type DailyReportCoverageRawItem = {
  id: string;
  title?: string | null;
  displayTitle?: string | null;
  url?: string | null;
  sourceName?: string | null;
  category?: string | null;
  aiScore?: number | null;
  reportSummary?: string | null;
  aiTranslation?: string | null;
  aiSummary?: string | null;
  snippet?: string | null;
  selectionReason?: string | null;
  translationStatus?: string | null;
  reason?: string | null;
  detail?: string | null;
};

function coverageReasonFor(
  status: DailyReportCoverageStatus,
  item: DailyReportCoverageRawItem,
) {
  const context = { title: item.title || '', category: item.category || '' };
  if (status === 'excluded') return humanizeDailyReportExcludedDetail(item.detail, item.reason, context);
  return humanizeDailyReportSelectionReason(item.selectionReason, context);
}

function coverageTranslationStatusLabel(value?: string | null) {
  if (!value) return '未标注';
  return coverageTranslationStatusLabels[value] || cleanCoverageText(value) || '未标注';
}

function buildCoverageMarkdown(items: DailyReportCoverageItem[], summary: DailyReportCoverageSummary) {
  const groups: Array<[DailyReportCoverageStatus, string]> = [
    ['selected', '已精选'],
    ['review', '待复核'],
    ['latestFallback', '最新兜底'],
    ['excluded', '未入报'],
  ];
  const lines = [
    '## 候选全池摘要索引',
    '',
    `共覆盖 ${summary.total} 条：已精选 ${summary.selected} 条，待复核 ${summary.review} 条，最新兜底 ${summary.latestFallback} 条，未入报 ${summary.excluded} 条。`,
  ];
  for (const [status, title] of groups) {
    const groupItems = items.filter((item) => item.status === status);
    if (groupItems.length === 0) continue;
    lines.push('', `### ${title}`, '');
    for (const item of groupItems) {
      const linkedTitle = item.url ? `[${item.title}](${item.url})` : item.title;
      lines.push(`- ${linkedTitle} · ${item.sourceName} · ${item.category}：${item.digest}（${item.reason}）`);
    }
  }
  return lines.join('\n');
}

export function buildDailyReportCoverageIndex(
  preparation?: Pick<DailyReportCandidatePreparation, 'finalCandidates' | 'reviewCandidates' | 'latestFallbackCandidates' | 'excluded'> | null,
): DailyReportCoverageIndex {
  const seen = new Set<string>();
  const items: DailyReportCoverageItem[] = [];
  const addItem = (
    rawItem: DailyReportCoverageRawItem,
    status: DailyReportCoverageStatus,
  ) => {
    if (!rawItem.id || seen.has(rawItem.id)) return;
    seen.add(rawItem.id);
    const digest = resolveCoverageDigest(rawItem);
    const reason = cleanCoverageText(coverageReasonFor(status, rawItem));
    const action = cleanCoverageText(coverageActionFor(status, rawItem.reason));
    items.push({
      id: rawItem.id,
      title: cleanCoverageText(rawItem.displayTitle || rawItem.title) || '未命名条目',
      url: rawItem.url || '',
      sourceName: cleanCoverageText(rawItem.sourceName) || '未知来源',
      category: cleanCoverageText(rawItem.category) || '未分类',
      status,
      statusLabel: coverageStatusLabels[status],
      digest: digest || reason || action || '暂无可用摘要，请回到 Feed 检查正文和摘要状态。',
      reason: reason || '按当前日报工作流进入该状态。',
      action,
      score: typeof rawItem.aiScore === 'number' ? rawItem.aiScore : null,
      translationStatus: rawItem.translationStatus || null,
      translationStatusLabel: coverageTranslationStatusLabel(rawItem.translationStatus),
    });
  };

  for (const item of preparation?.finalCandidates || []) addItem(item, 'selected');
  for (const item of preparation?.reviewCandidates || []) addItem(item, 'review');
  for (const item of preparation?.latestFallbackCandidates || []) addItem(item, 'latestFallback');
  for (const item of preparation?.excluded || []) addItem(item, 'excluded');

  const summary: DailyReportCoverageSummary = {
    total: items.length,
    selected: items.filter((item) => item.status === 'selected').length,
    review: items.filter((item) => item.status === 'review').length,
    latestFallback: items.filter((item) => item.status === 'latestFallback').length,
    excluded: items.filter((item) => item.status === 'excluded').length,
    missingDigest: items.filter((item) => !item.digest || item.digest.startsWith('暂无可用摘要')).length,
  };
  return {
    summary,
    items,
    markdown: buildCoverageMarkdown(items, summary),
  };
}

function dailyReportEditorialDependencies(): DailyReportEditorialDependencies {
  return {
    displayTitle: itemDisplayTitle,
    normalizeCategory: normalizeReportCategoryLabel,
    cleanInlineText: cleanReportInlineText,
    humanizeSelectionReason: humanizeDailyReportSelectionReason,
    buildTrendMarkdown,
    buildReadingOrderMarkdown,
    buildNextActionsMarkdown,
  };
}

function describeReportItemValue(item: TopItem) {
  return describeReportItemValueService(item, dailyReportEditorialDependencies());
}

export function buildDailyReportTrendSummary(snapshot: DailyReportSnapshot): DailyReportTrendSummary {
  return buildDailyReportTrendSummaryService(snapshot, dailyReportEditorialDependencies());
}

export function buildDailyReportPriorityArticles(snapshot: DailyReportSnapshot): DailyReportPriorityArticle[] {
  return buildDailyReportPriorityArticlesService(snapshot, dailyReportEditorialDependencies());
}

function shortSignalForItem(item: DailyReportPriorityArticle): string {
  return `${item.summary || item.reason || '这条材料提供了可核对的事实增量。'}`.replace(/\s+/g, ' ').slice(0, 120);
}

function compactNarrativeSentence(input: string | null | undefined, maxLength = 92) {
  const text = String(input || '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:标题|摘要|发生了什么|为什么重要|核心信息是)\s*[:：]\s*/g, '')
    .trim();
  if (!text) return '提供了可核对的事实增量。';
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const lastStop = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('；'), slice.lastIndexOf('，'));
  return `${(lastStop >= 24 ? slice.slice(0, lastStop) : slice).trim()}...`;
}

function markdownArticleLink(article: { id?: string; itemId?: string; title: string; url?: string }) {
  const itemId = article.id || article.itemId;
  return itemId ? `[${article.title}](${buildDailyReportItemUrl(itemId)})` : (article.url ? `[${article.title}](${article.url})` : article.title);
}

export function buildDailyReportModuleSections(snapshot: DailyReportSnapshot): DailyReportModuleSection[] {
  return buildDailyReportModuleSectionsService(snapshot, dailyReportEditorialDependencies());
}

export function buildDailyReportSupplementalArticles(
  snapshot: DailyReportSnapshot,
  coverageItems: DailyReportCoverageItem[] = [],
  targetDistinctLinks = 25,
) {
  return buildDailyReportSupplementalArticlesService(
    snapshot,
    coverageItems,
    targetDistinctLinks,
    dailyReportEditorialDependencies(),
  );
}

export function buildDailyReportEditorialDigest(snapshot: DailyReportSnapshot): DailyReportEditorialDigest {
  return buildDailyReportEditorialDigestService(snapshot, dailyReportEditorialDependencies());
}

function uniqueDailyReportArticles(snapshot: DailyReportSnapshot) {
  return uniqueDailyReportArticlesService(snapshot, dailyReportEditorialDependencies());
}

function uniqueDailyReportPriorityArticles(articles: DailyReportPriorityArticle[]) {
  return uniqueDailyReportPriorityArticlesService(articles);
}

function isValidReportArticleUrl(value?: string | null) {
  return isValidReportArticleUrlService(value);
}

function buildTrendMarkdown(snapshot: DailyReportSnapshot) {
  const trend = buildDailyReportTrendSummary(snapshot);
  const categoryLines = trend.categories.slice(0, 3).map((item) => {
    const delta = item.delta === 0 ? '与近 7 日均值基本持平' : `${item.delta > 0 ? '高于' : '低于'}近 7 日均值 ${Math.abs(item.delta).toFixed(1)} 条`;
    return `- ${item.category}：今日 ${item.count} 条，近 7 日均值 ${item.baselineAvg.toFixed(1)} 条，${delta}。`;
  });
  const sourceLine = trend.sources.length
    ? trend.sources.slice(0, 4).map((item) => `${item.sourceName} ${item.count} 条`).join('、')
    : '暂无明显集中来源';
  const themeLine = trend.themes.length
    ? trend.themes.slice(0, 4).map((item) => `${item.label} ${item.count} 条`).join('、')
    : '暂无稳定主题聚类';
  const funnel = trend.funnel;
  const funnelLine = funnel
    ? `入报漏斗：主流程可见 ${funnel.mainVisible} 条，范围命中 ${funnel.scopeMatched} 条，高分候选 ${funnel.scoredCandidates} 条，最终入报 ${funnel.finalCandidates} 条。`
    : '入报漏斗：当前报告没有保存候选漏斗快照。';
  const eventLine = trend.eventMetrics
    ? `事件口径：本地 ${trend.eventMetrics.localItemCount} 条内容归并为 ${trend.eventMetrics.independentEventCount} 个独立事件，其中 ${trend.eventMetrics.multiSourceEventCount} 个获得多源交叉验证，${trend.eventMetrics.firstPartyEventCount} 个包含一手来源（占 ${Math.round(trend.eventMetrics.firstPartyEventShare * 100)}%），${trend.eventMetrics.modelProductEventCount} 个涉及新模型或产品。外部雷达发现 ${trend.eventMetrics.externalRadarEventCount} 个可核对事件，AI HOT 命中但本地遗漏 ${trend.eventMetrics.aihotLocalMissCount} 个；另有 ${trend.eventMetrics.unverifiableRadarItemCount} 条外部材料因缺少原始链接未计入事件证据。`
    : '事件口径：当前报告没有保存事件级覆盖快照。';
  return [
    `今日新增 ${trend.newItems} 条，总库存 ${trend.totalItems} 条。先看整体收集趋势：来源集中在 ${sourceLine}，主题集中在 ${themeLine}。`,
    '',
    eventLine,
    '',
    ...(categoryLines.length ? categoryLines : ['- 暂无可用分类趋势。']),
    '',
    funnelLine,
  ];
}

function buildPriorityArticleMarkdown(snapshot: DailyReportSnapshot) {
  const articles = buildDailyReportPriorityArticles(snapshot).slice(0, 8);
  if (articles.length === 0) return ['- 暂无重点文章。'];
  return articles.map((item, index) => (
    `- ${index + 1}. [${item.title}](${item.url}) · ${item.sourceName} · ${item.category}。先读理由：${item.reason}${item.summary ? ` 摘要：${item.summary}` : ''}`
  ));
}

function buildModuleSectionsMarkdown(snapshot: DailyReportSnapshot, options?: { excludeArticleIds?: Set<string> }) {
  const sections = snapshot.moduleSections || buildDailyReportModuleSections(snapshot);
  if (sections.length === 0) return ['- 暂无可展开模块。'];
  const excludeArticleIds = options?.excludeArticleIds || new Set<string>();
  const rendered = sections.map((section) => {
    const displayArticles = section.priorityArticles
      .filter((article) => !excludeArticleIds.has(article.id))
      .slice(0, 8);
    if (displayArticles.length === 0) return null;
    const articleLines = displayArticles.map((article, index) => (
      `- ${index + 1}. [${article.title}](${article.url}) · ${article.sourceName}。${article.summary || article.reason}`
    ));
    return [
      `### ${section.title}`,
      '',
      `${section.title}今天还有 ${displayArticles.length} 条可展开材料，先看 ${displayArticles[0]?.title || '本模块头部条目'}。`,
      '',
      '共同信号：',
      ...displayArticles.slice(0, 3).map((article) => `- ${shortSignalForItem(article)}`),
      '',
      '重点文章：',
      ...articleLines,
      '',
      '建议动作：',
      ...section.actions.map((action) => `- ${action}`),
    ].join('\n');
  }).filter((section): section is string => Boolean(section));
  return rendered.length > 0 ? rendered : ['- 暂无可展开模块。'];
}

function buildTableOfContentsMarkdown(digest: DailyReportEditorialDigest) {
  return [
    '## 目录',
    '',
    ...digest.tableOfContents.map((item, index) => `${index + 1}. ${item}`),
  ].join('\n');
}

function buildCoverJudgementMarkdown(digest: DailyReportEditorialDigest) {
  return [
    '## 今日封面判断',
    '',
    `# ${digest.coverJudgement.title}`,
    '',
    digest.coverJudgement.summary,
  ].join('\n');
}

function buildCuratedArticlesMarkdown(digest: DailyReportEditorialDigest) {
  const items = digest.curated.slice(0, 12);
  if (items.length === 0) return ['## 今日精选', '', '- 暂无精选文章。'].join('\n');
  return [
    '## 今日精选',
    '',
    ...items.map((item, index) => [
      `### ${index + 1}. ${item.sourceName} · ${item.category}`,
      '',
      `${markdownArticleLink(item)} · ${item.sourceName} · ${item.category}`,
      '',
      `为什么先读：${item.reason}`,
      '',
      `摘要与判断：${item.summary || '当前摘要不足，建议先打开原文核对。'}`,
    ].join('\n')),
  ].join('\n\n');
}

function buildModuleNarrativesMarkdown(digest: DailyReportEditorialDigest) {
  const sections = digest.moduleNarratives.filter((section) => section.narrativeMarkdown || section.priorityArticles.length);
  if (sections.length === 0) return ['## 模块日报', '', '- 暂无模块日报。'].join('\n');
  return [
    '## 模块日报',
    '',
    ...sections.map((section) => section.narrativeMarkdown || [
      `### ${section.editorialTitle || section.title}`,
      '',
      section.conclusion,
      '',
      ...section.priorityArticles.slice(0, 6).map((item) => `- ${markdownArticleLink(item)}：${item.summary || item.reason}`),
    ].join('\n')),
  ].join('\n\n');
}

function buildMoreDynamicsMarkdown(digest: DailyReportEditorialDigest) {
  const items = digest.moreDynamics.slice(0, 20);
  if (items.length === 0) return ['## 更多动态', '', '- 暂无更多动态。'].join('\n');
  return [
    '## 更多动态',
    '',
    ...items.map((item) => `- ${markdownArticleLink(item)} · ${item.sourceName}：${item.summary || item.reason}`),
  ].join('\n');
}

function buildDeepReadsMarkdown(digest: DailyReportEditorialDigest) {
  const items = digest.deepReads.slice(0, 10);
  if (items.length === 0) return ['## 重点研究/深读', '', '- 今日没有足够明确的长文/研究类材料，先把深读精力留给精选条目。'].join('\n');
  return [
    '## 重点研究/深读',
    '',
    ...items.map((item, index) => {
      const summary = cleanReportInlineText(item.summary, 280) || '这篇材料提供了较完整的论证或技术背景，适合回到原文深读。';
      return `- ${index + 1}. ${markdownArticleLink(item)} · ${item.sourceName}：${summary}`;
    }),
  ].join('\n');
}

function buildDailyReportReaderCue(item: DailyReportPriorityArticle) {
  const category = `${item.category || ''} ${item.title || ''}`;
  if (/模型|实验室|评测|开源|权重/i.test(category)) {
    return '用于判断模型能力、开放策略或可部署条件的实际变化。';
  }
  if (/Agent|智能体|产品|工具|应用/i.test(category)) {
    return '用于判断 AI 能力是否已进入稳定的产品或工作流。';
  }
  if (/算力|芯片|基础设施|能源|推理/i.test(category)) {
    return '用于理解算力供给、推理成本与部署条件的变化。';
  }
  if (/政策|监管|安全|治理|标准/i.test(category)) {
    return '用于核对能力边界、使用限制与风险治理的新变化。';
  }
  if (/博客|深读|研究|论文|Blogs?/i.test(category)) {
    return '用于补充方法、论证与技术背景，建议结合原文阅读。';
  }
  return '用于快速核对今日主线中的关键事实变化。';
}

function buildReadingOrderMarkdown(
  snapshot: DailyReportSnapshot,
  digest: Pick<DailyReportEditorialDigest, 'curated' | 'moreDynamics'>,
) {
  const newsReferences = new Map<string, number>();
  const tieredAdvice = buildTieredReadingAdvice(snapshot, newsReferences);
  const deferHeadingIndex = tieredAdvice.indexOf('### 暂缓');
  const deferLines = deferHeadingIndex >= 0
    ? tieredAdvice.slice(deferHeadingIndex + 1)
    : ['- 暂无需要暂缓的条目。'];
  return [
    '## 阅读顺序',
    '',
    '### 先读',
    '',
    ...digest.curated.slice(0, 5).map((item) => `- ${markdownArticleLink(item)}：${buildDailyReportReaderCue(item)}`),
    '',
    '### 扫读',
    '',
    ...digest.moreDynamics.slice(0, 8).map((item) => `- ${markdownArticleLink(item)}：作为补充信号扫一遍即可。`),
    '',
    '### 暂缓',
    '',
    ...deferLines.filter((line, index) => index < 5),
  ].join('\n');
}

function buildNextActionsMarkdown(snapshot: DailyReportSnapshot) {
  const funnel = snapshot.candidateFunnel;
  const hasRepairableQualityDebt = Boolean(funnel && (
    (funnel.fallbackScoredCandidates || 0) > 0
    || (funnel.scoreFailedCandidates || 0) > 0
    || (funnel.translationFailed || 0) > 0
  ));
  return [
    '## 下一步行动',
    '',
    '- 先按“阅读建议”完成原文核对，把真正值得跟踪的主题沉淀为专题，不要把全部候选都变成待办。',
    ...(hasRepairableQualityDebt
      ? ['- 今天仍有低置信、摘要不完整或翻译不完整的处理债，建议先回工作台补处理，再重新生成正式日报。']
      : []),
    '- 明天复盘时只看一个问题：今天的主线是否被新证据强化。如果没有强化，就降级为背景信号。',
  ].join('\n');
}

function degradedModuleEvidence(section: DailyReportModuleSection): DailyReportModuleEvidence[] {
  if (section.evidence?.length) return section.evidence;
  return section.priorityArticles.map((article, index) => ({
    itemId: article.id,
    title: article.title,
    url: article.url,
    sourceName: article.sourceName,
    fact: cleanReportInlineText(article.summary || article.reason || article.title, 220),
    factBasis: article.summary ? 'module_summary' : 'title',
    role: index < 4 ? 'primary' : 'supporting',
  }));
}

function buildDegradedModuleSection(section: DailyReportModuleSection): DailyReportModuleSection {
  const evidence = degradedModuleEvidence(section);
  const evidenceLines = evidence.slice(0, 8).map((item) => (
    `- ${markdownArticleLink(item)} · ${item.sourceName}：${compactNarrativeSentence(item.fact, 160)}`
  ));
  return {
    ...section,
    editorialTitle: `${section.title}：${evidence.length} 条可核验材料`,
    conclusion: `本模块保留 ${evidence.length} 条带来源链接的事实材料；编辑质量门禁未通过，当前不作趋势强弱判断。`,
    narrativeMarkdown: [
      `### ${section.title}：${evidence.length} 条可核验材料`,
      '',
      '#### 可核验事实',
      '',
      ...(evidenceLines.length ? evidenceLines : ['- 当前没有可核验事实材料。']),
      '',
      '#### 素材缺口',
      '',
      '- 尚未形成通过质量门禁的编辑结论，本模块不输出趋势判断或行动建议。',
      '- 需要更多独立来源或完整正文后，再判断这些事实是否构成连续信号。',
    ].join('\n'),
    evidence,
    signals: [],
    noise: [],
    actions: [],
    evidenceCount: evidence.length,
    coverageCount: evidence.length,
  };
}

export function buildDegradedDailyReportPresentation(
  snapshot: DailyReportSnapshot,
  moduleSections: DailyReportModuleSection[] = snapshot.moduleSections || buildDailyReportModuleSections(snapshot),
  reportLabel = '信息中枢日报',
): DailyReportDegradedPresentation {
  const allVerifiableArticles = uniqueDailyReportPriorityArticles([
    ...uniqueDailyReportArticles(snapshot),
    ...moduleSections.flatMap((section) => section.priorityArticles),
  ]);
  const articles = allVerifiableArticles.slice(0, 12);
  const safeModules = moduleSections.map(buildDegradedModuleSection);
  const supplementalArticles = uniqueDailyReportPriorityArticles(snapshot.editorialSupplementArticles || []);
  const visibleUrls = new Set(
    articles.map((article) => article.url).filter((url) => isValidReportArticleUrl(url)),
  );
  for (const section of safeModules) {
    for (const evidence of degradedModuleEvidence(section).slice(0, 8)) {
      if (isValidReportArticleUrl(evidence.url)) visibleUrls.add(evidence.url);
    }
  }
  const appendDistinct = (target: DailyReportPriorityArticle[], candidates: DailyReportPriorityArticle[]) => {
    for (const article of candidates) {
      if (!isValidReportArticleUrl(article.url) || visibleUrls.has(article.url)) continue;
      visibleUrls.add(article.url);
      target.push(article);
    }
  };
  const supplementalFactArticles: DailyReportPriorityArticle[] = [];
  appendDistinct(supplementalFactArticles, allVerifiableArticles);
  appendDistinct(supplementalFactArticles, supplementalArticles);
  const factLines = articles.map((article) => (
    `- ${markdownArticleLink(article)} · ${article.sourceName} · ${article.category}：${compactNarrativeSentence(article.summary || article.reason, 180)}`
  ));
  const supplementalFactLines = supplementalFactArticles.map((article) => (
    `- ${markdownArticleLink(article)} · ${article.sourceName} · ${article.category}：${compactNarrativeSentence(article.summary || article.reason, 180)}`
  ));
  const funnel = snapshot.candidateFunnel;
  const gapLines = [
    '- 最终编辑结果未通过质量门禁，因此不输出封面趋势判断、阅读优先级或下一步行动。',
    ...(articles.length < 6 ? [`- 当前只有 ${articles.length} 篇可核验重点材料，无法支撑完整深度日报。`] : []),
    ...(funnel?.translationFailed ? [`- 仍有 ${funnel.translationFailed} 条候选翻译失败，需要补齐中文化后再判断。`] : []),
    ...(funnel?.scoreFailedCandidates ? [`- 仍有 ${funnel.scoreFailedCandidates} 条候选评分失败，当前不把它们包装成精选内容。`] : []),
    ...(safeModules.length === 0 ? ['- 当前没有形成可用模块证据，需要补处理正文、摘要或分类。'] : []),
  ];
  const markdown = [
    `# ${reportLabel} — ${snapshot.date}`,
    '',
    '> 本期为降级事实汇总：只保留可核验材料与素材缺口，不代表正式编辑判断。',
    '',
    '## 可核验事实',
    '',
    ...(factLines.length ? factLines : ['- 当前没有可核验重点材料。']),
    '',
    '## 分模块事实',
    '',
    ...(safeModules.length ? safeModules.map((section) => section.narrativeMarkdown || '').filter(Boolean) : ['- 当前没有可用模块证据。']),
    '',
    ...(supplementalFactLines.length ? [
      '## 补充事实线索',
      '',
      '> 以下条目补齐未在头部和模块中展开的候选事实；其中待复核或最新兜底内容只作线索，不作为精选或趋势判断。',
      '',
      ...supplementalFactLines,
      '',
    ] : []),
    '## 素材缺口',
    '',
    ...gapLines,
  ].join('\n');
  return {
    coverJudgement: {
      title: `${snapshot.date} 信息事实汇总`,
      summary: `今日收集 ${snapshot.newItems} 条，当前保留 ${articles.length} 篇可核验重点材料${supplementalFactArticles.length ? `，另展开 ${supplementalFactArticles.length} 篇补充事实线索` : ''}${supplementalArticles.length ? `，其中 ${supplementalArticles.length} 篇来自待复核或最新兜底` : ''}。由于编辑质量门禁未通过，本页不输出趋势结论和行动建议。`,
    },
    moduleSections: safeModules,
    markdown,
    bullets: articles.slice(0, 5).map((article) => `${article.title} · ${article.sourceName}`),
  };
}

function buildEditorialDailyReportMarkdown(snapshot: DailyReportSnapshot, rawBody?: string) {
  const digest = buildDailyReportEditorialDigest(snapshot);
  const body = sanitizeDailyReportMarkdown(rawBody || '')
    .replace(/^# .+$/m, '')
    .trim();
  return ensureFinalReportMinimumDepth([
    buildCoverJudgementMarkdown(digest),
    buildTableOfContentsMarkdown(digest),
    digest.radarOverview.markdown,
    buildCuratedArticlesMarkdown(digest),
    buildModuleNarrativesMarkdown(digest),
    buildMoreDynamicsMarkdown(digest),
    buildDeepReadsMarkdown(digest),
    body ? ['## 编辑补充判断', '', buildFinalJudgementBody(body, snapshot)].join('\n') : '',
    buildReadingOrderMarkdown(snapshot, digest),
    buildNextActionsMarkdown(snapshot),
  ].filter(Boolean).join('\n\n'), snapshot);
}

function buildFinalJudgementBody(rawBody: string, snapshot: DailyReportSnapshot) {
  const genericLinePattern = /行业持续发展，值得关注|继续关注(?:行业动态)?。?$|旧阅读建议|对应重点文章|模型能力升级。?$|模型发布值得关注。?$/;
  const sanitizedBody = sanitizeDailyReportMarkdown(rawBody);
  const explicitSection = extractMarkdownSection(sanitizedBody, '## 今日判断');
  const explicitBody = explicitSection ? explicitSection.slice('## 今日判断'.length).trim() : '';
  let explicitJudgement = cleanDanglingLatinFragment(explicitBody);
  if (explicitJudgement && !/[。！？.!?]$/u.test(explicitJudgement)) explicitJudgement = `${explicitJudgement}。`;
  if (genericLinePattern.test(explicitJudgement)) explicitJudgement = '';
  const categoryFocus = snapshot.byCategory
    .filter((item) => {
      const category = normalizeReportCategoryLabel(item.category);
      return !/未分类|分类治理|uncategorized/i.test(category);
    })
    .slice(0, 3)
    .map((item) => `${normalizeReportCategoryLabel(item.category).replace(/\s+\d+\s*条$/g, '')} ${item.count} 条`)
    .join('、');
  const sourceFocus = snapshot.topSources
    .slice(0, 3)
    .map((item) => `${item.sourceName} ${item.count} 条`)
    .join('、');
  const topThemes = snapshot.topItems
    .slice(0, 3)
    .map((item) => normalizeReportCategoryLabel(item.category))
    .filter((category, index, arr) => category && arr.indexOf(category) === index)
    .join('、');
  const overview = `今天共新增 ${snapshot.newItems} 条资讯，日报入选 ${snapshot.topItems.length} 条。值得先看的不是单条快讯数量，而是这些条目是否能互相印证：${categoryFocus || '分类分布仍需继续治理'} 是主要信息面，${sourceFocus || '来源分布暂无明显集中'} 是主要来源面。`;
  const judgement = snapshot.topItems.length > 0
    ? `我对今天的判断是：先把“今日重点文章”里的头部条目放在同一张图里看，重点主题包括 ${topThemes || 'AI 产业信号'}。它们共同指向 AI 产业从“能力展示”继续转向“资源投入、产品落地和组织采用”的阶段，阅读时要优先区分真实增量、宣传噪声和需要等待验证的二级信号。`
    : '我对今天的判断是：当前没有足够强的入报条目，不适合强行生成结论；应先回到采集、正文和评分链路检查质量。';
  const readingFrame = '这份日报只保留对个人决策和长期成长有帮助的内容：先读核心主线，再点开证据链接核对原文，最后把仍值得跟踪的方向沉淀到专题或知识库。泛商业行情、缺少上下文的公告和没有明确 AI/科技关联的内容，不应占据正式阅读时间。';
  // The surrounding report sections are rebuilt from trusted editorial
  // materials. Only the model's explicit judgement is allowed through here;
  // appending its remaining sections caused duplicated reports and unsupported
  // claims to leak back into the deterministic document.
  return [explicitJudgement, overview, judgement, readingFrame]
    .filter(Boolean)
    .join('\n\n');
}

function buildKeyEvidenceLines(snapshot: DailyReportSnapshot) {
  const items = snapshot.topItems.slice(0, 4);
  if (items.length === 0) return ['- 暂无可用链接证据。'];
  return items.map((item) => {
    const summary = cleanReportInlineText(item.reportSummary || item.aiSummary || item.snippet || '暂无摘要', 135);
    const reason = describeReportItemValue(item);
    const category = normalizeReportCategoryLabel(item.category);
    return `- [${itemDisplayTitle(item)}](${buildDailyReportItemUrl(item.id)}) · ${item.sourceName} · ${category}。为什么重要：${reason} 核对点：${summary || '原文仍需补充摘要，建议点开链接核对事实。'}`;
  });
}

function buildCoreMainlineLines(snapshot: DailyReportSnapshot) {
  const groups = new Map<string, TopItem[]>();
  for (const item of snapshot.topItems.slice(0, 12)) {
    const label = AIHOT_DAILY_BUCKET_LABELS[classifyAiNewsBucket(item)] || item.category || 'AI 信号';
    groups.set(label, [...(groups.get(label) || []), item]);
  }
  const entries = [...groups.entries()].slice(0, 3);
  if (entries.length === 0) return ['- 暂无明确主线。'];
  return entries.map(([label, items], index) => {
    const links = items.slice(0, 3).map((item) => `[${itemDisplayTitle(item)}](${buildDailyReportItemUrl(item.id)})`).join('、');
    const best = items[0];
    const second = items[1];
    const summary = cleanReportInlineText(best.reportSummary || best.aiSummary || best.snippet || '', 150);
    const secondSummary = second ? cleanReportInlineText(second.reportSummary || second.aiSummary || second.snippet || '', 90) : '';
    return [
      `### 主线 ${index + 1}：${label}`,
      '',
      `${links || '暂无链接证据'} 共同指向同一类变化。判断：${describeReportItemValue(best)} 重点是它能否改变后续选题、产品判断或知识沉淀的优先级。`,
      '',
      `证据上，${summary || '当前摘要不足，需要回到原文补齐事实。'}${secondSummary ? ` 可对照 ${itemDisplayTitle(second)}：${secondSummary}` : ''} 先核对原文，再决定是否进入专题复盘；如果没有更多来源印证，就只作为观察信号保留。`,
    ].join('\n');
  });
}

function ensureFinalReportMinimumDepth(markdown: string, snapshot: DailyReportSnapshot) {
  let normalized = sanitizeDailyReportMarkdown(markdown);
  const target = resolveFinalReportLengthTarget(snapshot);
  if (countChineseCharacters(normalized) >= target.minChars) return normalized;
  const extraEvidence = snapshot.topItems.slice(6, 10).map((item) => {
    const summary = cleanReportInlineText(item.reportSummary || item.aiSummary || item.snippet || '', 150);
    return `- [${itemDisplayTitle(item)}](${buildDailyReportItemUrl(item.id)}) 可以作为交叉验证材料。它的价值在于补齐 ${normalizeReportCategoryLabel(item.category)} 侧的背景，而不是替代主线判断。${summary ? `摘要：${summary}` : '摘要仍需补抓或重跑。'}`;
  });
  if (extraEvidence.length > 0) {
    const current = extractMarkdownSection(normalized, '## 更多动态');
    const currentBody = current ? current.slice('## 更多动态'.length).trim() : '';
    normalized = replaceMarkdownSection(normalized, '## 更多动态', [
      '## 更多动态',
      '',
      currentBody,
      '',
      '### 交叉验证材料',
      '',
      ...extraEvidence,
    ].join('\n'));
  }
  if (countChineseCharacters(normalized) >= target.minChars) return sanitizeDailyReportMarkdown(normalized);
  const actionSection = extractMarkdownSection(normalized, '## 下一步行动');
  const actionBody = actionSection ? actionSection.slice('## 下一步行动'.length).trim() : '';
  const extraAction = [
    '- 把今天的高价值条目分成“立即深读、专题跟踪、暂缓观察”三类；只对第一类做笔记，避免把信息流变成待办堆积。',
    '- 对标题很强但摘要不足的条目，优先点开原文或重跑正文补抓；如果正文仍不完整，就不要让它进入正式结论。',
    '- 明天复盘时只问一个问题：今天的主线有没有被新证据证伪或强化。若没有，就把它降为背景噪声。若有，再升级为长期专题。',
  ];
  return sanitizeDailyReportMarkdown(replaceMarkdownSection(normalized, '## 下一步行动', [
    '## 下一步行动',
    '',
    actionBody,
    '',
    ...extraAction,
  ].join('\n')));
}

export function enforceFinalReadingAdvice(markdown: string, snapshot: DailyReportSnapshot) {
  const normalizedSections = normalizeFinalReportSectionNames(markdown);
  const cleanedMarkdown = normalizeConclusionSection(cleanMarkdownSectionTail(normalizedSections, '## 今日判断'));
  return buildEditorialDailyReportMarkdown(snapshot, cleanedMarkdown);
}

export function finalizeDailyReportDelivery(
  markdown: string,
  snapshot: DailyReportSnapshot,
  deliveryMode: DailyReportModuleMeta['deliveryMode'],
) {
  const delivered = deliveryMode === 'model' || deliveryMode === 'model_composed'
    ? groundDailyReportModelMarkdown(markdown, snapshot).markdown
    : enforceFinalReadingAdvice(markdown, snapshot);
  return rewriteDailyReportLinksToReader(delivered, snapshot);
}

export function ensureFinalEditorialH1(markdown: string, snapshot: DailyReportSnapshot) {
  const normalized = normalizeFinalSceneMarkdownStructure(sanitizeDailyReportMarkdown(markdown));
  if (/^#(?!#)\s+\S/m.test(normalized)) return normalized;
  const digestTitle = buildDailyReportEditorialDigest(snapshot).coverJudgement.title
    .replace(/[#\[\]`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const title = digestTitle || '今日 AI 信息面的关键变化';
  return `# ${title}\n\n${normalized}`.trim();
}

function supplementFinalSceneEvidenceLinks(markdown: string, snapshot: DailyReportSnapshot) {
  const minimumLinks = Math.min(8, snapshot.topItems.length);
  const currentCount = countMarkdownLinks(markdown);
  if (minimumLinks === 0 || currentCount >= minimumLinks) return markdown;

  const existingLinks = new Set(
    Array.from(markdown.matchAll(/\[[^\]\n]{2,}\]\((https?:\/\/[^)\s]+?|\/feed\/[^)\s]+?)\)/g))
      .map((match) => normalizeDailyReportEvidenceUrl(match[1]))
      .filter(Boolean),
  );
  const additions = collectDailyReportEvidenceItems(snapshot)
    .filter((item) => item.id && item.url)
    .map((item) => ({
      ...item,
      readerUrl: item.readerUrl || buildDailyReportItemUrl(item.id),
    }))
    .filter((item) => !existingLinks.has(normalizeDailyReportEvidenceUrl(item.readerUrl)))
    .slice(0, minimumLinks - currentCount)
    .map((item) => {
      const sourceItem = [...snapshot.topItems, ...snapshot.highScoreItems].find((entry) => entry.id === item.id);
      const title = String(sourceItem?.displayTitle || sourceItem?.title || '原文证据').replace(/\s+/g, ' ').trim().slice(0, 120);
      const sourceName = String(sourceItem?.sourceName || '').replace(/\s+/g, ' ').trim();
      return `- [${title}](${item.readerUrl})${sourceName ? ` · ${sourceName}` : ''}`;
    });
  if (additions.length === 0) return markdown;

  const sectionHeading = '## 原文证据索引';
  const currentSection = extractMarkdownSection(markdown, sectionHeading);
  const section = [
    sectionHeading,
    '',
    '以下链接只用于核对本期判断，不替代正文中的编辑结论。',
    '',
    ...(currentSection ? currentSection.slice(sectionHeading.length).trim().split('\n').filter(Boolean) : []),
    ...additions,
  ].join('\n');
  if (currentSection) return replaceMarkdownSection(markdown, sectionHeading, section);
  const readingGuide = extractMarkdownSection(markdown, '## 今天怎么读');
  if (!readingGuide) return [markdown, section].join('\n\n');
  return markdown.replace(readingGuide, `${section}\n\n${readingGuide}`);
}

export function prepareFinalSceneOutputForQuality(markdown: string, snapshot: DailyReportSnapshot) {
  const grounding = groundDailyReportModelMarkdown(markdown, snapshot);
  let normalized = rewriteDailyReportLinksToReader(grounding.markdown, snapshot);
  const target = resolveFinalReportLengthTarget(snapshot);
  let quality = validateFinalSceneMarkdown(normalized, snapshot, target.minChars);
  if (quality.ok && grounding.modelEditorialGroupCount === 0) {
    if (grounding.preservedArticleCount === 0) quality = { ok: false, reason: 'missing_editorial_structure' };
  }
  if (quality.ok && grounding.preservedArticleCount < Math.min(4, snapshot.topItems.length)) {
    quality = { ok: false, reason: 'missing_editorial_depth' };
  }
  let prepared = false;
  if (!quality.ok && quality.reason === 'missing_markdown_links') {
    const supplemented = supplementFinalSceneEvidenceLinks(normalized, snapshot);
    if (supplemented !== normalized) {
      normalized = supplemented;
      quality = validateFinalSceneMarkdown(normalized, snapshot, target.minChars);
      prepared = quality.ok;
    }
  }
  return { markdown: normalized, quality, prepared, grounding };
}

function normalizeDailyReportEvidenceUrl(value?: string | null) {
  const raw = String(value || '').trim();
  if (/^\/feed\/[^\s?#]+(?:[?#][^\s]*)?$/.test(raw)) return raw.split(/[?#]/)[0];
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function collectDailyReportEvidenceItems(snapshot: DailyReportSnapshot) {
  const items = new Map<string, { id: string; url: string; readerUrl?: string }>();
  const remember = (item?: { id: string; url: string; readerUrl?: string } | null) => {
    if (item?.id) items.set(item.id, item);
  };
  for (const item of [...snapshot.topItems, ...snapshot.highScoreItems]) remember(item);
  for (const item of snapshot.editorialSupplementArticles || []) remember(item);
  for (const section of snapshot.moduleSections || []) {
    for (const item of section.priorityArticles || []) remember(item);
    for (const item of section.primaryLinks || []) remember(item);
    for (const item of section.secondaryLinks || []) remember(item);
    for (const item of section.evidence || []) remember({ id: item.itemId, url: item.url });
  }
  return [...items.values()];
}

export function rewriteDailyReportLinksToReader(markdown: string, snapshot: DailyReportSnapshot) {
  const externalToReader = new Map<string, string>();
  for (const item of collectDailyReportEvidenceItems(snapshot)) {
    const external = normalizeDailyReportEvidenceUrl(item.url);
    const reader = item.readerUrl || buildDailyReportItemUrl(item.id);
    if (external) externalToReader.set(external, reader);
  }
  return markdown.replace(/\[([^\]\n]{2,})\]\((https?:\/\/[^)\s]+?)\)/g, (full, label: string, rawUrl: string) => {
    const readerUrl = externalToReader.get(normalizeDailyReportEvidenceUrl(rawUrl));
    return readerUrl ? `[${label}](${readerUrl})` : full;
  });
}

export function findUnsupportedDailyReportLinks(markdown: string, snapshot: DailyReportSnapshot) {
  const allowed = new Set<string>();
  const remember = (value?: string | null) => {
    const normalized = normalizeDailyReportEvidenceUrl(value);
    if (normalized) allowed.add(normalized);
  };
  for (const item of collectDailyReportEvidenceItems(snapshot)) {
    remember(item.url);
    remember(item.readerUrl || buildDailyReportItemUrl(item.id));
  }
  const links = Array.from(markdown.matchAll(/\[[^\]\n]{2,}\]\((https?:\/\/[^)\s]+?|\/feed\/[^)\s]+?)\)/g))
    .map((match) => normalizeDailyReportEvidenceUrl(match[1]))
    .filter(Boolean);
  return Array.from(new Set(links.filter((link) => !allowed.has(link))));
}

type GroundedDailyReportGroup = {
  title: string;
  items: TopItem[];
  trustedModule?: boolean;
  moduleKey?: DailyReportModuleSection['key'];
  modelLead?: string;
  articleProse?: Record<string, { title: string; body: string }>;
};

const DAILY_REPORT_MODULE_PUBLICATION_TITLES: Record<DailyReportModuleSection['key'], string> = {
  models_labs: '模型发布与实验室动向',
  agent_products: 'Agent 与产品入口',
  infra_compute: '算力与基础设施',
  apps_business: '应用落地与商业化',
  policy_safety: '政策、安全与治理边界',
  deep_reads: '深读与方法论',
  china_industry: '国内产业动态',
};

export type GroundedDailyReportResult = {
  markdown: string;
  groundedArticleCount: number;
  droppedUngroundedSections: number;
  modelEditorialGroupCount: number;
  preservedArticleCount: number;
};

const DAILY_REPORT_MATCH_STOPWORDS = new Set([
  'about', 'after', 'against', 'agent', 'agents', 'artificial', 'codex', 'from', 'into', 'model', 'models',
  'openai', 'report', 'shows', 'technology', 'that', 'their', 'this', 'with', 'without',
]);

function normalizeDailyReportMatchText(value?: string | null) {
  return String(value || '')
    .toLowerCase()
    .replace(/\[([^\]\n]+)\]\([^)]*\)/g, '$1')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
}

function dailyReportEnglishTokens(value?: string | null) {
  return new Set(
    (String(value || '').toLowerCase().match(/[a-z][a-z0-9.+-]{2,}/g) || [])
      .filter((token) => !DAILY_REPORT_MATCH_STOPWORDS.has(token)),
  );
}

function dailyReportChineseBigrams(value?: string | null) {
  const chars = String(value || '').replace(/[^\u3400-\u9fff]/g, '');
  const result = new Set<string>();
  for (let index = 0; index < chars.length - 1; index += 1) result.add(chars.slice(index, index + 2));
  return result;
}

function isDailyReportPlaceholderSummary(value?: string | null) {
  return containsDailyPlaceholder(String(value || ''));
}

function overlapCoefficient(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const value of left) if (right.has(value)) overlap += 1;
  return overlap / Math.min(left.size, right.size);
}

export function isDailyReportEditorialItemUsable(item: TopItem) {
  const title = [item.displayTitle, item.translatedTitle, item.title].filter(Boolean).join(' ');
  const bodyEvidence = [
    item.aiSummary,
    item.reportSummary,
    item.snippet,
    item.editorialContext,
    item.aiTranslation,
  ].filter((value) => value && !isDailyReportPlaceholderSummary(value)).join(' ');
  const cleaned = cleanReportInlineText(bodyEvidence, 1200);
  if (cleaned.length < 8) return false;

  const promotional = /(?:Sponsored by|\bsponsor(?:ed|ship)?\b|赞助内容|由\s*[^\s]{2,24}\s*赞助|广告)/i.test(bodyEvidence);
  if (!promotional) return true;

  const nonPromotionalEvidence = bodyEvidence
    .split(/(?<=[。！？.!?])\s+/)
    .filter((part) => !/(?:Sponsored by|\bsponsor(?:ed|ship)?\b|赞助内容|由\s*[^\s]{2,24}\s*赞助|广告|Atlassian|Jira)/i.test(part))
    .join(' ');
  if (cleanReportInlineText(nonPromotionalEvidence, 1200).length < 24) return false;

  const englishOverlap = overlapCoefficient(dailyReportEnglishTokens(title), dailyReportEnglishTokens(nonPromotionalEvidence));
  const chineseOverlap = overlapCoefficient(dailyReportChineseBigrams(title), dailyReportChineseBigrams(nonPromotionalEvidence));
  return Math.max(englishOverlap, chineseOverlap) >= 0.12;
}

function dailyReportHeadingMatchScore(heading: string, item: TopItem) {
  const headingText = heading.replace(/^\d+[.)、]\s*/, '').trim();
  const itemText = [item.displayTitle, item.translatedTitle, item.title].filter(Boolean).join(' ');
  const normalizedHeading = normalizeDailyReportMatchText(headingText);
  const normalizedItem = normalizeDailyReportMatchText(itemText);
  if (!normalizedHeading || !normalizedItem) return 0;
  if (Math.min(normalizedHeading.length, normalizedItem.length) >= 8
    && (normalizedHeading.includes(normalizedItem) || normalizedItem.includes(normalizedHeading))) return 1;

  const tokenOverlap = overlapCoefficient(
    dailyReportEnglishTokens(headingText),
    dailyReportEnglishTokens(itemText),
  );
  const chineseOverlap = overlapCoefficient(
    dailyReportChineseBigrams(headingText),
    dailyReportChineseBigrams(itemText),
  );
  const headingNumbers = new Set(headingText.match(/\d+(?:\.\d+)?/g) || []);
  const itemNumbers = new Set(itemText.match(/\d+(?:\.\d+)?/g) || []);
  const matchingNumbers = headingNumbers.size > 0
    && [...headingNumbers].every((value) => itemNumbers.has(value));
  return Math.max(tokenOverlap * 0.82, chineseOverlap * 0.9) + (matchingNumbers ? 0.12 : 0);
}

function dailyReportEvidenceText(items: TopItem[]) {
  return items
    .flatMap((item) => [
      item.title,
      item.displayTitle,
      item.translatedTitle,
      item.aiSummary,
      item.reportSummary,
      item.snippet,
      item.aiTranslation,
      item.editorialContext,
    ])
    .filter(Boolean)
    .join(' ');
}

function cleanGroundedEditorialTitle(value: string | null | undefined, items: TopItem[], fallback: string) {
  const title = cleanReportInlineText(value, 72)
    .replace(/^(?:(?:第)?(?:\d{1,2}|[一二三四五六七八九十]+)[.、.)）：:]\s*)+/, '')
    .replace(/：(?:\d+\s*条信号|单篇观察|可核实进展|补充证据)\s*$/, '')
    .trim();
  if (title.length < 5 || /^(?:标题|日报|今日信息|今日材料)$/.test(title)) return fallback;
  if (/(?:可核实进展|补充证据|单篇观察|\d+\s*条信号|素材中仅提及|暂无.*补充说明|全文约|符合.*要求)/.test(title)) return fallback;
  const evidenceText = dailyReportEvidenceText(items);
  const unsupportedNumbers = hasUnsupportedEditorialNumbers(title, evidenceText);
  return unsupportedNumbers ? fallback : title;
}

function cleanGroundedEditorialLead(value: string | null | undefined, items: TopItem[]) {
  const lead = cleanReportInlineText(value, 420);
  if (lead.length < 24) return '';
  if (/(?:今天收录|\d+\s*篇材料|材料来自|请进入.*核对|可核实|候选池|素材池|评分阈值|全文约)/.test(lead)) return '';
  const evidenceText = dailyReportEvidenceText(items);
  const unsupportedNumbers = hasUnsupportedEditorialNumbers(lead, evidenceText);
  return unsupportedNumbers ? '' : lead;
}

export function matchDailyReportHeadingToItem(
  heading: string,
  items: TopItem[],
  excludedIds: Set<string> = new Set(),
) {
  const readerLink = heading.match(/\/feed\/([A-Za-z0-9-]+)/)?.[1];
  if (readerLink) return items.find((item) => item.id === readerLink && !excludedIds.has(item.id)) || null;
  const ranked = items
    .filter((item) => !excludedIds.has(item.id))
    .map((item) => ({ item, score: dailyReportHeadingMatchScore(heading, item) }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < 0.34) return null;
  if (second && best.score < 0.7 && best.score - second.score < 0.06) return null;
  return best.item;
}

function parseGroundedDailyReportGroups(markdown: string, snapshot: DailyReportSnapshot) {
  const normalized = normalizeFinalSceneMarkdownStructure(sanitizeDailyReportMarkdown(rewriteDailyReportLinksToReader(markdown, snapshot)));
  type ModelGroup = { title: string; headings: string[]; leadLines: string[]; bodies: Record<string, string[]> };
  const groups: ModelGroup[] = [];
  let current: ModelGroup | null = null;
  let stopped = false;
  for (const line of normalized.split('\n')) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      const title = h2[1].trim();
      if (/^(?:原文证据索引|今天怎么读|下一步关注)$/.test(title)) {
        stopped = true;
        current = null;
        continue;
      }
      if (stopped) continue;
      current = { title, headings: [], leadLines: [], bodies: {} };
      groups.push(current);
      continue;
    }
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3 && current && !stopped) {
      current.headings.push(h3[1].trim());
      current.bodies[h3[1].trim()] = [];
      continue;
    }
    if (current && !stopped && current.headings.length > 0) {
      current.bodies[current.headings.at(-1)!].push(line);
      continue;
    }
    if (current && !stopped && current.headings.length === 0 && line.trim() && !/^\s*(?:[-*]>|#{1,6}\s)/.test(line)) {
      current.leadLines.push(line.trim());
    }
  }

  const eligibleItems = snapshot.topItems.filter(isDailyReportEditorialItemUsable);
  const modelMatchedIds = new Set<string>();
  let droppedUngroundedSections = 0;
  const modelGroups: GroundedDailyReportGroup[] = [];
  const allProse: NonNullable<GroundedDailyReportGroup['articleProse']> = {};
  for (const group of groups) {
    const matched: TopItem[] = [];
    for (const heading of group.headings) {
      const bodyLines = (group.bodies[heading] || []).join('\n');
      const bodyIds = [...new Set([...bodyLines.matchAll(/\]\(\/feed\/([^)?#\s]+)[^)]*\)/g)].map((link) => link[1]))];
      const item = matchDailyReportHeadingToItem(heading, eligibleItems, modelMatchedIds)
        || (bodyIds.length === 1 ? eligibleItems.find((entry) => entry.id === bodyIds[0] && !modelMatchedIds.has(entry.id)) : null);
      if (!item) {
        droppedUngroundedSections += 1;
        continue;
      }
      modelMatchedIds.add(item.id);
      matched.push(item);
      // Only explicit item links bind generated analysis to its evidence.
      const rawBody = bodyLines.trim()
        .replace(/^\*[^*\n]+ · [^*\n]+\*\s*\n/, '');
      if ([...`${heading}\n${rawBody}`.matchAll(/\]\(\/feed\/([^)?#\s]+)[^)]*\)/g)].some((link) => link[1] === item.id)) {
        const linkedIds = new Set([item.id, ...[...rawBody.matchAll(/\]\(\/feed\/([^)?#\s]+)[^)]*\)/g)].map((match) => match[1])]);
        const linkedItems = eligibleItems.filter((entry) => linkedIds.has(entry.id));
        const body = preserveEditorialProse(rawBody, dailyReportEvidenceText(linkedItems), new Set(linkedItems.map((entry) => entry.id)));
        if (body) allProse[item.id] = {
          title: cleanGroundedEditorialTitle(heading.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'), [item], itemDisplayTitle(item)),
          body,
        };
      }
    }
    if (matched.length > 0) {
      modelGroups.push({
        title: group.title,
        items: matched,
        modelLead: cleanReportInlineText(group.leadLines.join(' '), 520) || undefined,
      });
    }
  }

  const desiredCount = Math.min(12, eligibleItems.length);
  const desiredItems = eligibleItems.slice(0, desiredCount);
  const desiredById = new Map(desiredItems.map((item) => [item.id, item]));
  const groundedGroups: GroundedDailyReportGroup[] = [];
  const used = new Set<string>();

  if ((snapshot.moduleSections || []).length > 0 && Object.keys(allProse).length === 0) {
    for (const section of snapshot.moduleSections || []) {
      const items = (section.priorityArticles || [])
        .map((article) => desiredById.get(article.id))
        .filter((item): item is TopItem => Boolean(item))
        .filter((item) => !used.has(item.id));
      if (items.length === 0) continue;
      for (const item of items) used.add(item.id);
      const itemIds = new Set(items.map((item) => item.id));
      const coherentModelGroup = modelGroups.find((group) => (
        group.items.length === items.length
        && group.items.every((item) => itemIds.has(item.id))
      ));
      const fallbackTitle = DAILY_REPORT_MODULE_PUBLICATION_TITLES[section.key];
      const title = coherentModelGroup
        ? cleanGroundedEditorialTitle(coherentModelGroup.title, items, fallbackTitle)
        : fallbackTitle;
      groundedGroups.push({
        title,
        items,
        trustedModule: true,
        moduleKey: section.key,
        modelLead: coherentModelGroup
          ? cleanGroundedEditorialLead(coherentModelGroup.modelLead, items) || undefined
          : undefined,
      });
    }
  } else {
    for (const group of modelGroups) {
      const items = group.items.filter((item) => !used.has(item.id) && desiredById.has(item.id));
      if (items.length === 0) continue;
      for (const item of items) used.add(item.id);
      groundedGroups.push({ ...group, items });
    }
  }

  const remaining = desiredItems.filter((item) => !used.has(item.id));
  if (remaining.length > 0) {
    const buckets = new Map<string, TopItem[]>();
    for (const item of remaining) {
      const label = AIHOT_DAILY_BUCKET_LABELS[classifyAiNewsBucket(item)]
        || normalizeReportCategoryLabel(item.category)
        || '其他值得知道';
      buckets.set(label, [...(buckets.get(label) || []), item]);
    }
    for (const [label, items] of buckets) {
      const title = groundedGroups.some((group) => group.title.includes(label))
        ? `${label}补充`
        : label;
      groundedGroups.push({ title, items });
    }
  }
  return { groups: groundedGroups.map((group) => ({ ...group, articleProse: allProse })), droppedUngroundedSections };
}

function groundedDailyReportGroupTitle(group: GroundedDailyReportGroup) {
  const fallback = group.moduleKey
    ? DAILY_REPORT_MODULE_PUBLICATION_TITLES[group.moduleKey]
    : group.items
      .map((item) => normalizeReportCategoryLabel(item.category))
      .filter((value, index, all) => value && all.indexOf(value) === index)
      .slice(0, 2)
      .join('与') || '今日重点';
  return cleanGroundedEditorialTitle(group.title, group.items, fallback);
}

function truncateGroundedDailyReportFact(value: string, limit = 360) {
  if (value.length <= limit) return value;
  const prefix = value.slice(0, limit + 1);
  const sentenceEnd = Math.max(
    prefix.lastIndexOf('。'),
    prefix.lastIndexOf('！'),
    prefix.lastIndexOf('？'),
    prefix.lastIndexOf('. '),
    prefix.lastIndexOf('! '),
    prefix.lastIndexOf('? '),
  );
  if (sentenceEnd >= Math.floor(limit * 0.55)) return prefix.slice(0, sentenceEnd + 1).trim();
  const wordEnd = prefix.lastIndexOf(' ');
  return `${prefix.slice(0, wordEnd >= Math.floor(limit * 0.72) ? wordEnd : limit).trimEnd()}…`;
}

function groundedDailyReportFact(item: TopItem) {
  const candidates = [
    item.aiSummary,
    item.reportSummary,
    item.language && !/^zh(?:-|$)/i.test(item.language) ? item.aiTranslation : null,
    item.snippet,
    item.aiTranslation,
  ];
  for (const value of candidates) {
    const candidate = cleanReportInlineText(value, 900);
    if (candidate.length < 4) continue;
    if (isDailyReportPlaceholderSummary(candidate)) continue;
    return truncateGroundedDailyReportFact(candidate);
  }
  return `当前只确认了文章主题“${itemDisplayTitle(item)}”，摘要仍需补充。`;
}

function groundedDailyReportEvidenceLabel(item: TopItem) {
  const source = `${item.sourceName} ${item.sourceType || ''} ${item.sourceKind || ''}`;
  if (/Reuters|TechCrunch|The Verge|Business Insider|36kr|智东西|媒体/i.test(source)) return '媒体报道';
  if (/OpenAI|Anthropic|NVIDIA|Google|Microsoft|官方|newsroom/i.test(source)) return '官方发布';
  if (/blog|博客|newsletter|Simon Willison|Daring Fireball/i.test(source)) return '作者观点';
  return '单篇材料';
}

function buildGroundedDailyReportArticle(item: TopItem, prose?: { title: string; body: string }) {
  const fact = groundedDailyReportFact(item);
  const category = normalizeReportCategoryLabel(item.category);
  const evidenceLabel = groundedDailyReportEvidenceLabel(item);
  return [
    `### [${prose?.title || itemDisplayTitle(item)}](${buildDailyReportItemUrl(item.id)})`,
    '',
    `*${item.sourceName} · ${category} · ${evidenceLabel}*`,
    '',
    prose?.body || (/[。！？.!?…]$/u.test(fact) ? fact : `${fact}。`),
    '',
  ].join('\n');
}

function buildGroundedDailyReportGroupLead(group: GroundedDailyReportGroup) {
  const modelLead = cleanGroundedEditorialLead(group.modelLead, group.items);
  if (modelLead) return modelLead;
  return '';
}

function collectGroundedDailyReportPublicationItems(snapshot: DailyReportSnapshot) {
  const byId = new Map<string, TopItem>();
  const add = (item: TopItem) => {
    if (!byId.has(item.id) && isDailyReportEditorialItemUsable(item)) byId.set(item.id, item);
  };
  snapshot.topItems.forEach(add);
  snapshot.highScoreItems.forEach(add);
  for (const item of snapshot.editorialSupplementArticles || []) {
    add({
      id: item.id,
      title: item.title,
      url: item.url,
      sourceName: item.sourceName,
      category: item.category,
      aiScore: null,
      aiSummary: item.summary,
      reportSummary: item.summary,
      fetchedAt: snapshot.generatedAt,
    });
  }
  return [...byId.values()];
}

function buildGroundedDailyReportHighlights(items: TopItem[], prose: Record<string, { title: string; body: string }> = {}) {
  const highlights = items.slice(0, 5);
  if (highlights.length === 0) return '';
  return [
    '## 今日精选',
    '',
    ...highlights.map((item) => (
      `- **[${prose[item.id]?.title || itemDisplayTitle(item)}](${buildDailyReportItemUrl(item.id)})** · ${item.sourceName}：${truncateGroundedDailyReportFact(prose[item.id] ? cleanReportInlineText(prose[item.id].body.split('\n\n')[0], 500).replace(/^发生了什么[：:]\s*/, '') : groundedDailyReportFact(item), 150)}`
    )),
  ].join('\n');
}

function buildGroundedDailyReportMoreDynamics(items: TopItem[]) {
  if (items.length === 0) return '';
  return [
    '## 更多值得知道',
    '',
    ...items.slice(0, 15).map((item) => (
      `- [${itemDisplayTitle(item)}](${buildDailyReportItemUrl(item.id)}) · ${item.sourceName}：${truncateGroundedDailyReportFact(groundedDailyReportFact(item), 130)}`
    )),
  ].join('\n');
}

function resolveGroundedDailyReportTitle(markdown: string, snapshot: DailyReportSnapshot, fallback: string) {
  const normalized = normalizeFinalSceneMarkdownStructure(sanitizeDailyReportMarkdown(markdown));
  const modelTitle = normalized.match(/^#\s+(.+)$/m)?.[1]
    || normalized.match(/^##\s+(?!今日精选|更多值得知道|今天怎么读|下一步关注)(.+)$/m)?.[1];
  return cleanGroundedEditorialTitle(modelTitle, collectGroundedDailyReportPublicationItems(snapshot), fallback);
}

function buildGroundedDailyReportRadar(snapshot: DailyReportSnapshot) {
  const sources = snapshot.topSources.slice(0, 4).map((item) => `${item.sourceName} ${item.count} 条`).join('、');
  const themes = snapshot.themeClusters
    .filter((item) => isEditorialThemeLabelService(item.label))
    .filter((item) => !/^(?:tech|technology|ai|news|blogs?)$/i.test(item.label))
    .slice(0, 4)
    .map((item) => `${item.label} ${item.count} 条`)
    .join('、');
  const categories = snapshot.byCategory
    .map((item) => normalizeReportCategoryLabel(item.category))
    .filter((item, index, all) => item && !/未分类|分类治理/.test(item) && all.indexOf(item) === index)
    .slice(0, 4)
    .join('、');
  return [
    '## 信息雷达总览',
    '',
    `今天共收集 ${snapshot.newItems} 条新内容，正式阅读层保留 ${snapshot.topItems.length} 篇。来源主要集中在 ${sources || '多个分散来源'}。`,
    '',
    `从内容面看，主要覆盖 ${categories || 'AI 与科技动态'}；可重复观察的主题包括 ${themes || '当前尚未形成稳定主题聚类'}。这些统计只描述今天看到了什么，不直接等同于趋势结论。`,
  ].join('\n');
}

function buildGroundedDailyReportReadingSections(snapshot: DailyReportSnapshot) {
  const digest = buildDailyReportEditorialDigest(snapshot);
  return [
    buildReadingOrderMarkdown(snapshot, digest).replace('## 阅读顺序', '## 今天怎么读'),
    [
      '## 下一步关注',
      '',
      '- 明天先检查今天的头部主题是否出现第二个独立来源；没有新增证据时，不把单日信号升级为长期趋势。',
      '- 对涉及模型性能、产品发布时间和融资规模的判断，优先回到信息中枢原文核对，再决定是否沉淀到专题。',
      '- 只把真正改变产品判断、研究方向或行动优先级的内容转成任务，其余材料保留为可搜索背景。',
    ].join('\n'),
  ].join('\n\n');
}

export function groundDailyReportModelMarkdown(
  markdown: string,
  snapshot: DailyReportSnapshot,
): GroundedDailyReportResult {
  const parsed = parseGroundedDailyReportGroups(markdown, snapshot);
  const publicationItems = collectGroundedDailyReportPublicationItems(snapshot);
  const publicationItemIds = new Set(publicationItems.map((item) => item.id));
  const publicationSnapshot: DailyReportSnapshot = {
    ...snapshot,
    topItems: publicationItems,
    highScoreItems: snapshot.highScoreItems.filter((item) => publicationItemIds.has(item.id)),
  };
  const digest = buildDailyReportEditorialDigest(snapshot);
  let groups: GroundedDailyReportGroup[] = parsed.groups.length > 0
    ? parsed.groups
    : publicationItems.length > 0
      ? [{ title: '今日重点', items: publicationItems.slice(0, 12) }]
      : [];
  const hasEditorialProse = groups.some((group) => group.items.some((item) => group.articleProse?.[item.id]));
  // A finished article must not be followed by machine-generated substitutes
  // for missing model sections. Those materials belong in the coverage index.
  if (hasEditorialProse) groups = groups.map((group) => ({
    ...group, items: group.items.filter((item) => group.articleProse?.[item.id]),
  })).filter((group) => group.items.length > 0);
  const groundedArticleCount = groups.reduce((total, group) => total + group.items.length, 0);
  const groupedIds = new Set(groups.flatMap((group) => group.items.map((item) => item.id)));
  const editorialDynamicIds = new Set(digest.moreDynamics.map((item) => item.id));
  const moreDynamics = publicationItems.filter((item) => (
    !groupedIds.has(item.id) && editorialDynamicIds.has(item.id)
  )).filter((item) => !hasEditorialProse || (
    !dailyProseIssue(groundedDailyReportFact(item))
    && (groundedDailyReportFact(item).match(/[\u3400-\u9fff]/g) || []).length >= 24
  ));
  const preservedArticleCount = groups.reduce((total, group) => total + group.items.filter((item) => group.articleProse?.[item.id]).length, 0);
  const modelCover = cleanGroundedEditorialLead(markdown.match(/^>\s+(.+)$/m)?.[1], publicationItems);
  const leadStory = groups[0]?.items[0];
  const leadProse = leadStory && groups[0]?.articleProse?.[leadStory.id]?.body.split('\n\n')[0];
  const coverSummary = modelCover || (leadProse ? cleanReportInlineText(leadProse, 300).replace(/^发生了什么[：:]\s*/, '') : digest.coverJudgement.summary);
  const deepReadItems = digest.deepReads.map((entry) => publicationItems.find((item) => item.id === entry.id)).filter((item): item is TopItem => Boolean(item));
  const modelReading = extractMarkdownSection(markdown, '## 下一步关注');
  const safeReading = modelReading && preserveEditorialProse(modelReading.replace(/^##[^\n]*\n/, ''), dailyReportEvidenceText(publicationItems), publicationItemIds);
  const orderSection = extractMarkdownSection(markdown, '## 今天怎么读');
  const safeOrder = orderSection && preserveEditorialProse(orderSection.replace(/^##[^\n]*\n/, ''), dailyReportEvidenceText(publicationItems), publicationItemIds);
  const readingOrder = safeOrder || groups.flatMap((group) => group.items).slice(0, 5)
    .map((item, index) => `${index + 1}. [${groups.find((group) => group.articleProse?.[item.id])?.articleProse?.[item.id]?.title || itemDisplayTitle(item)}](${buildDailyReportItemUrl(item.id)})`).join('\n');
  const body = [
    `# ${resolveGroundedDailyReportTitle(markdown, publicationSnapshot, digest.coverJudgement.title)}`,
    '',
    `> ${coverSummary}`,
    '',
    buildGroundedDailyReportRadar(snapshot),
    '',
    buildGroundedDailyReportHighlights(groups.flatMap((group) => group.items), Object.assign({}, ...groups.map((group) => group.articleProse))),
    '',
    ...groups.flatMap((group) => [
      `## ${groundedDailyReportGroupTitle(group)}`,
      '',
      buildGroundedDailyReportGroupLead(group),
      '',
      ...group.items.map((item) => buildGroundedDailyReportArticle(item, group.articleProse?.[item.id])),
      '',
    ]),
    buildGroundedDailyReportMoreDynamics(moreDynamics),
    '',
    deepReadItems.length ? ['## 重点研究/深读', '', ...deepReadItems.map((item) => `- [${itemDisplayTitle(item)}](${buildDailyReportItemUrl(item.id)}) · ${item.sourceName}`)].join('\n') : '',
    '',
    `## 今天怎么读\n\n${readingOrder || '暂无可展开的文章。'}`,
    '',
    `## 下一步关注\n\n${safeReading || '本期没有材料支持的额外行动建议。'}`,
  ].join('\n');
  return {
    markdown: normalizeDailyReportReaderPresentation(body),
    groundedArticleCount,
    droppedUngroundedSections: parsed.droppedUngroundedSections,
    modelEditorialGroupCount: groups.filter((group) => Boolean(group.modelLead)).length,
    preservedArticleCount,
  };
}

function validateFinalSceneMarkdown(markdown: string, snapshot: DailyReportSnapshot, minChars: number) {
  const proseIssue = dailyProseIssue(markdown);
  if (proseIssue) return { ok: false, reason: proseIssue };
  const quality = validateSceneMarkdown('final', markdown, minChars);
  if (!quality.ok) return quality;
  const minimumLinks = Math.min(8, snapshot.topItems.length);
  if (minimumLinks > 0 && countMarkdownLinks(markdown) < minimumLinks) {
    return { ok: false, reason: 'missing_markdown_links' };
  }
  const unsupportedLinks = findUnsupportedDailyReportLinks(markdown, snapshot);
  return unsupportedLinks.length > 0
    ? { ok: false, reason: 'unsupported_links' }
    : quality;
}

/**
 * 处理链路会把内部状态写进 aiTags（见 processors/ai-summarizer.ts 的 '本地兜底'）。
 * 这些标记用于诊断，不是内容主题，展示给用户会造成"主主题：Blogs / AI / 本地兜底"这类术语泄漏。
 */
const INTERNAL_PROCESSING_TAGS = new Set(['本地兜底', '待人工复核', '模型摘要暂不可用', '模型摘要暂时不可用']);

export function isInternalProcessingTag(label: string): boolean {
  return INTERNAL_PROCESSING_TAGS.has(label.trim());
}

export function buildFinalFallback(
  snapshot: DailyReportSnapshot,
  cleaning: DailyCleaningOutput,
  modules: Partial<Record<'decision' | 'research' | 'reading', DailyReportModule>>,
) {
  // themeLabels 来自 aiTags，其中混有 '本地兜底' 这类内部处理状态；它们不是主题，不能展示给用户
  const readerThemeLabels = cleaning.themeLabels.filter((label) => !isInternalProcessingTag(label));
  const bullets = [
    cleaning.summary,
    cleaning.prioritySignals[0] ? `优先信号：${cleaning.prioritySignals[0]}` : '暂无优先信号',
    readerThemeLabels[0] ? `主主题：${readerThemeLabels.slice(0, 3).join(' / ')}` : '暂无主主题',
  ].filter(Boolean);
  const markdown = buildEditorialDailyReportMarkdown(snapshot, [
    removeRepeatedTopItemTitles(cleaning.summary, snapshot),
    modules.decision?.markdown ? `决策简报补充：${truncateContextText(modules.decision.markdown, 900)}` : '',
    modules.research?.markdown ? `研究汇总补充：${truncateContextText(modules.research.markdown, 900)}` : '',
  ].filter(Boolean).join('\n\n'));

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

  const template = resolveScenePromptTemplate('final', resolved.config.promptTemplate, resolved.resolvedConfigType);
  const finalContext = buildFinalContext(snapshot, cleaning, modules);
  const lengthTarget = resolveFinalReportLengthTarget(snapshot);
  const prompt = appendSceneMarkdownContract('final', interpolatePrompt(template, {
    context: finalContext,
    lengthTarget: lengthTarget.targetLabel,
  }), lengthTarget.minChars);
  let invalidResponsePreview: string | null = null;
  let modelDraftMarkdown = '';

  try {
    let result = await callLLM(resolved.config, prompt, {
      maxTokens: DAILY_SCENE_MAX_TOKENS.final,
      thinking: 'disabled',
    });
    const compositionDiagnostics: NonNullable<DailyReportModuleMeta['compositionDiagnostics']> = {
      initial: inspectFinalMarkdownStructure(result.text),
    };
    invalidResponsePreview = result.text;
    modelDraftMarkdown = result.text;
    const preparedOutput = prepareFinalSceneOutputForQuality(result.text, snapshot);
    let quality = preparedOutput.quality;
    let grounding = preparedOutput.grounding;
    let deliveryMode: 'model' | 'model_composed' | 'deterministic' = 'model';
    let compositionPasses = 1;
    let evidenceLinksSupplemented = preparedOutput.prepared;
    result = { ...result, text: preparedOutput.markdown };
    let promptForLog = prompt;
    let repaired = false;
    let repairReason: string | undefined;
    if (!quality.ok) {
      repairReason = quality.reason || 'unknown';
    }
    if (!quality.ok && shouldComposeFinalExpansion(repairReason)) {
      const expansionPrompt = buildFinalExpansionPrompt(modelDraftMarkdown, finalContext, lengthTarget.minChars);
      const expansionResult = await callLLM(resolved.config, expansionPrompt, {
        maxTokens: DAILY_SCENE_MAX_TOKENS.final,
        thinking: 'disabled',
      });
      compositionDiagnostics.expansion = inspectFinalMarkdownStructure(expansionResult.text);
      const mergedMarkdown = mergeFinalSceneExpansion(modelDraftMarkdown, expansionResult.text);
      modelDraftMarkdown = mergedMarkdown;
      compositionDiagnostics.merged = inspectFinalMarkdownStructure(mergedMarkdown);
      const preparedExpansion = prepareFinalSceneOutputForQuality(mergedMarkdown, snapshot);
      grounding = preparedExpansion.grounding;
      evidenceLinksSupplemented = evidenceLinksSupplemented || preparedExpansion.prepared;
      const expansionQuality = preparedExpansion.quality;
      const combinedTokens = {
        inputTokens: (result.inputTokens || 0) + (expansionResult.inputTokens || 0),
        outputTokens: (result.outputTokens || 0) + (expansionResult.outputTokens || 0),
        totalTokens: (result.totalTokens || 0) + (expansionResult.totalTokens || 0),
        estimatedCost: (result.estimatedCost || 0) + (expansionResult.estimatedCost || 0),
        latencyMs: (result.latencyMs || 0) + (expansionResult.latencyMs || 0),
      };
      invalidResponsePreview = [result.text, expansionResult.text]
        .filter(Boolean)
        .join('\n\n--- 深度补写 ---\n\n');
      promptForLog = expansionPrompt;
      compositionPasses = 2;
      if (expansionQuality.ok) {
        result = {
          ...expansionResult,
          text: preparedExpansion.markdown,
          ...combinedTokens,
        };
        quality = expansionQuality;
        deliveryMode = 'model_composed';
      } else {
        result = {
          ...expansionResult,
          text: preparedExpansion.markdown,
          ...combinedTokens,
        };
        quality = expansionQuality;
        deliveryMode = 'model_composed';
        repaired = true;
        repairReason = `${repairReason}; model_expansion_failed:${expansionQuality.reason || 'unknown'}[${formatFinalMarkdownStructureDiagnostics(compositionDiagnostics.merged)}]`;
      }
    }
    if (!quality.ok) {
      compositionPasses += 1;
      const repairPrompt = buildSceneRepairPrompt('final', modelDraftMarkdown, fallback.markdown, finalContext, repairReason, lengthTarget.minChars);
      const repairResult = await callLLM(resolved.config, repairPrompt, {
        maxTokens: DAILY_SCENE_MAX_TOKENS.final,
        thinking: 'disabled',
      });
      compositionDiagnostics.repair = inspectFinalMarkdownStructure(repairResult.text);
      modelDraftMarkdown = repairResult.text;
      invalidResponsePreview = [result.text, repairResult.text].filter(Boolean).join('\n\n--- 修复稿 ---\n\n');
      const preparedRepair = prepareFinalSceneOutputForQuality(repairResult.text, snapshot);
      grounding = preparedRepair.grounding;
      evidenceLinksSupplemented = evidenceLinksSupplemented || preparedRepair.prepared;
      const repairQuality = preparedRepair.quality;
      const combinedTokens = {
        inputTokens: (result.inputTokens || 0) + (repairResult.inputTokens || 0),
        outputTokens: (result.outputTokens || 0) + (repairResult.outputTokens || 0),
        totalTokens: (result.totalTokens || 0) + (repairResult.totalTokens || 0),
        estimatedCost: (result.estimatedCost || 0) + (repairResult.estimatedCost || 0),
      };
      if (!repairQuality.ok) {
        result = {
          ...repairResult,
          text: fallback.markdown,
          ...combinedTokens,
        };
        deliveryMode = 'deterministic';
        promptForLog = repairPrompt;
        repaired = true;
        repairReason = `${repairReason}; model_repair_failed:${repairQuality.reason || 'unknown'}[${formatFinalMarkdownStructureDiagnostics(compositionDiagnostics.repair)}]; deterministic_fallback`;
      } else {
        result = {
          ...repairResult,
          text: preparedRepair.markdown,
          ...combinedTokens,
        };
        deliveryMode = 'model';
        promptForLog = repairPrompt;
        repaired = true;
      }
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
      promptPreview: promptForLog,
      responsePreview: deliveryMode === 'deterministic' ? invalidResponsePreview : result.text,
      label: `${snapshot.date}:final`,
    });
    const normalizedFinalMarkdown = normalizeMarkdownForQuality(result.text) || fallback.markdown;
    return {
      markdown: finalizeDailyReportDelivery(normalizedFinalMarkdown, snapshot, deliveryMode),
      modelDraftMarkdown: modelDraftMarkdown.slice(0, 60_000),
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
        deliveryMode,
        factualGroundingApplied: deliveryMode !== 'deterministic',
        preservedArticleCount: grounding.preservedArticleCount,
        ...(deliveryMode !== 'deterministic' ? {
          groundedArticleCount: grounding.groundedArticleCount,
          droppedUngroundedSections: grounding.droppedUngroundedSections,
        } : {}),
        ...(compositionPasses > 1 ? { compositionPasses } : {}),
        ...(evidenceLinksSupplemented ? { evidenceLinksSupplemented } : {}),
        compositionDiagnostics,
        ...(repaired ? { repaired, repairReason } : {}),
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
      responsePreview: invalidResponsePreview,
      label: `${snapshot.date}:final`,
      errorMessage: message,
    });
    return {
      markdown: fallback.markdown,
      modelDraftMarkdown: modelDraftMarkdown.slice(0, 60_000) || undefined,
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

export function ensureReportHeading(markdown: string, date: string, title = '信息中枢日报'): string {
  const trimmed = markdown.trim();
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!trimmed) return `# ${title} — ${date}`;
  if (/^#\s+\S/.test(trimmed)) return trimmed;
  if (new RegExp(`^#\\s+${escapedTitle}\\s+—`).test(trimmed)) return trimmed;
  return `# ${title} — ${date}\n\n${trimmed}`;
}

export function buildDailyReportInsightConflictUpdate(input: {
  summary: string;
  itemCount: number;
  topics: unknown;
  payload: unknown;
}) {
  return buildDailyReportInsightConflictUpdateService({
    ...input,
    pipelineVersion: DAILY_PIPELINE_VERSION,
  });
}

export type { DailyReportModuleTask } from './daily-report-generation.js';

export async function runDailyReportModuleTasks<T>(tasks: DailyReportModuleTask<T>[]): Promise<void> {
  await runDailyReportModuleTasksService(tasks);
}

function generationModeLabel(mode?: DailyReportGenerationMode) {
  if (mode === 'fast') return '快速交付（只阻塞最终日报；清洗/决策/研究/阅读不阻塞）';
  if (mode === 'full') return '完整深加工（清洗/决策/研究/阅读/最终日报全链路运行）';
  return '未记录';
}

export function buildGenerationScopeMarkdown(snapshot: DailyReportSnapshot) {
  const funnel = snapshot.candidateFunnel;
  if (!funnel) return '';
  return [
    '## 生成口径',
    '',
    `- 生成模式：${generationModeLabel(snapshot.generationMode)}`,
    `- 今日新增：${snapshot.newItems} 条`,
    `- 主流程可见：${funnel.mainVisible} 条`,
    `- 匹配日报范围：${funnel.scopeMatched} 条`,
    `- 高分候选：${funnel.scoredCandidates} 条`,
    `- 低分复核候选：${funnel.reviewCandidates} 条`,
    `- 低置信兜底候选：${funnel.fallbackScoredCandidates} 条`,
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

async function emitDailyGenerationProgress(
  opts: DailyReportOptions | undefined,
  stage: DailyGenerationStage,
  message?: string,
  detail?: Record<string, unknown>,
) {
  if (!opts?.onProgress) return;
  await opts.onProgress(buildDailyGenerationProgress(stage, { message, detail }));
}

export async function generateDailyReport(userId: string, date?: Date, opts?: DailyReportOptions): Promise<DailyReportData> {
  const workflowConfig = normalizeDailyReportWorkflowConfig(opts?.workflow || DEFAULT_DAILY_REPORT_WORKFLOW);
  const options: ResolvedDailyReportOptions = {
    topN: opts?.topN ?? workflowConfig.topN,
    minScore: opts?.minScore ?? workflowConfig.minScore,
    includeHighScore: opts?.includeHighScore ?? true,
    includeCategoryTop: opts?.includeCategoryTop ?? true,
    preset: opts?.preset ?? 'full',
    compareWindowDays: opts?.compareWindowDays ?? DAILY_COMPARE_WINDOW_DAYS,
    generationMode: opts?.generationMode ?? 'full',
    workflow: workflowConfig,
    sourceId: Number.isInteger(opts?.sourceId) && Number(opts?.sourceId) > 0 ? Number(opts?.sourceId) : null,
    sourceName: String(opts?.sourceName || '').trim() || null,
    reportType: String(opts?.reportType || buildDailyInsightType(opts?.sourceId)).trim() || 'daily',
  };
  const reportScope = buildDailyReportScopeMeta(options.sourceId, options.sourceName, options.reportType);

  const { dateKey: dateStr, dayStart, dayEnd } = resolveDailyReportWindow(date || new Date());
  await emitDailyGenerationProgress(opts, 'loading_data', `正在读取 ${dateStr} 的日报数据。`, { date: dateStr });
  try {
    const clusterResult = await refreshRecentEventClusters(userId);
    await emitDailyGenerationProgress(opts, 'loading_data', '事件聚类已刷新。', {
      multiSourceClusters: clusterResult.multiSourceClusterCount,
      clusterChanges: clusterResult.changedCount,
    });
  } catch (error) {
    logger.warn({
      userId,
      date: dateStr,
      error: (error as Error).message,
    }, 'Daily report event cluster refresh failed; continuing with persisted clusters');
  }
  const compareStart = new Date(dayStart);
  compareStart.setDate(compareStart.getDate() - options.compareWindowDays);
  const samplingLimit = Math.max(options.topN * 4, 60);
  const candidatePoolLimit = Math.max(options.topN * 20, 500);
  const itemBaseWhere = [
    eq(schema.items.userId, userId),
    sql`exists (
      select 1
      from hub.sources active_source
      where active_source.id = ${schema.items.sourceId}
        and active_source.user_id = ${userId}::uuid
        and active_source.status = 'active'
        and coalesce(active_source.source_role, 'normal') not in ('radar', 'reference')
        and coalesce(active_source.config->>'integrationStatus', 'active') not in ('shadow', 'paused', 'removed')
    )`,
    ...(options.sourceId ? [eq(schema.items.sourceId, options.sourceId)] : []),
  ];
  const hotSignalSql = sql<number>`
    case
      when concat_ws(
        ' ',
        ${schema.items.title},
        coalesce(${schema.items.snippet}, ''),
        coalesce(${schema.items.aiSummary}, ''),
        coalesce(${schema.items.aiTranslation}, ''),
        coalesce(${schema.sources.name}, ''),
        coalesce(${schema.sources.category}, '')
      ) ~* '(claude|anthropic|openai|gpt-?5|gemini|deepmind|fable\\s*5|mythos|opus|sonnet|haiku|agent|智能体|新模型|模型发布|大模型|推理模型|多模态模型|api|codex|cursor)'
      then 1
      else 0
    end
  `;

  const eventMetricSelection = {
    id: schema.items.id,
    sourceId: schema.items.sourceId,
    sourceName: schema.sources.name,
    sourceCategory: schema.sources.category,
    sourceType: schema.items.sourceType,
    sourceCollectorType: schema.sources.collectorType,
    sourceConfig: schema.sources.config,
    sourceRole: schema.sources.sourceRole,
    sourceKind: schema.sources.sourceKind,
    clusterId: schema.items.clusterId,
    title: schema.items.title,
    url: schema.items.url,
    originalUrl: schema.items.originalUrl,
    category: schema.sources.category,
    aiTags: schema.items.aiTags,
    curationSource: schema.items.curationSource,
    curationMeta: schema.items.curationMeta,
  };

  const [
    newItemsResult,
    totalResult,
    todayAuditRows,
    todayRows,
    todayCategoryRows,
    previousCategoryRows,
    todayEventRows,
    radarEventRows,
  ] = await Promise.all([
    db.select({ count: count() }).from(schema.items).where(and(...itemBaseWhere, gte(schema.items.fetchedAt, dayStart), lt(schema.items.fetchedAt, dayEnd))),
    db.select({ count: count() }).from(schema.items).where(and(...itemBaseWhere)),
    db.select({
      id: schema.items.id,
      isFiltered: schema.items.isFiltered,
      filterBucket: schema.items.filterBucket,
      qualityDecision: schema.items.qualityDecision,
      contentStatus: schema.items.contentStatus,
      filterReason: schema.items.filterReason,
    })
    .from(schema.items)
    .where(and(...itemBaseWhere, gte(schema.items.fetchedAt, dayStart), lt(schema.items.fetchedAt, dayEnd))),
    db.select({
      id: schema.items.id,
      sourceId: schema.items.sourceId,
      title: schema.items.title,
      url: schema.items.url,
      snippet: schema.items.snippet,
      aiScore: schema.items.aiScore,
      aiSummary: schema.items.aiSummary,
      aiTranslation: schema.items.aiTranslation,
      language: schema.items.language,
      translationStatus: schema.items.translationStatus,
      translationReason: schema.items.translationReason,
      priorityScore: schema.items.priorityScore,
      contentStatus: schema.items.contentStatus,
      summaryStatus: schema.items.summaryStatus,
      aiTags: schema.items.aiTags,
      publishedAt: schema.items.publishedAt,
      fetchedAt: schema.items.fetchedAt,
      sourceName: schema.sources.name,
      category: schema.sources.category,
      sourceType: schema.items.sourceType,
      sourceTier: schema.items.sourceTier,
      sourceKind: schema.sources.sourceKind,
      sourceRole: schema.sources.sourceRole,
      sourceCollectorType: schema.sources.collectorType,
      sourceConfig: schema.sources.config,
      sourceStatus: schema.sources.status,
      sourceAutoFetchEnabled: schema.sources.autoFetchEnabled,
      sourceTags: schema.sources.tags,
      clusterId: schema.items.clusterId,
      isFiltered: schema.items.isFiltered,
      filterBucket: schema.items.filterBucket,
      filterReason: schema.items.filterReason,
      qualityDecision: schema.items.qualityDecision,
      processingStatus: schema.items.processingStatus,
      contentLength: sql<number>`greatest(
        coalesce(length(trim(${schema.items.readabilityContent})), 0),
        coalesce(length(trim(${schema.items.content})), 0)
      )`,
    })
    .from(schema.items)
    .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
    .where(and(
      ...itemBaseWhere,
      gte(schema.items.fetchedAt, dayStart),
      lt(schema.items.fetchedAt, dayEnd),
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
    .orderBy(desc(hotSignalSql), desc(schema.items.priorityScore), desc(schema.items.fetchedAt))
    .limit(candidatePoolLimit),
    db.select({ category: schema.sources.category, count: count() })
      .from(schema.items)
      .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
      .where(and(...itemBaseWhere, gte(schema.items.fetchedAt, dayStart), lt(schema.items.fetchedAt, dayEnd), eq(schema.items.filterBucket, 'main'), eq(schema.items.isFiltered, false)))
      .groupBy(schema.sources.category)
      .orderBy(desc(count())),
    db.select({ category: schema.sources.category, count: count() })
      .from(schema.items)
      .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
      .where(and(
        ...itemBaseWhere,
        gte(schema.items.fetchedAt, compareStart),
        lt(schema.items.fetchedAt, dayStart),
        eq(schema.items.filterBucket, 'main'),
        eq(schema.items.isFiltered, false),
      ))
      .groupBy(schema.sources.category)
      .orderBy(desc(count())),
    db.select(eventMetricSelection)
      .from(schema.items)
      .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
      .where(and(
        ...itemBaseWhere,
        gte(schema.items.fetchedAt, dayStart),
        lt(schema.items.fetchedAt, dayEnd),
        eq(schema.items.filterBucket, 'main'),
        eq(schema.items.isFiltered, false),
      )),
    options.sourceId
      ? Promise.resolve([])
      : db.select(eventMetricSelection)
        .from(schema.items)
        .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
        .where(and(
          eq(schema.items.userId, userId),
          eq(schema.sources.userId, userId),
          eq(schema.sources.status, 'active'),
          inArray(schema.sources.sourceRole, ['radar', 'reference']),
          sql`coalesce(${schema.sources.config}->>'integrationStatus', 'shadow') not in ('paused', 'removed')`,
          gte(schema.items.fetchedAt, dayStart),
          lt(schema.items.fetchedAt, dayEnd),
          eq(schema.items.isFiltered, false),
        )),
  ]);

  const newItems = newItemsResult[0]?.count || 0;
  const totalItems = totalResult[0]?.count || 0;
  await emitDailyGenerationProgress(opts, 'candidate_prepare', `已读取 ${newItems} 条今日新增，正在准备候选池。`, {
    newItems,
    candidatePoolLimit,
  });
  let sampledRows = buildDailyReportCandidateSampleOrder(todayRows.map((row) => ({
    ...row,
    sourceName: row.sourceName || 'Unknown',
    category: row.category || 'uncategorized',
    sourceReadingTier: resolveSourceReadingTier({
      name: row.sourceName,
      sourceTier: row.sourceTier,
      collectorType: row.sourceCollectorType,
      sourceType: row.sourceType,
      sourceKind: row.sourceKind,
      category: row.category,
      status: row.sourceStatus,
      autoFetchEnabled: row.sourceAutoFetchEnabled,
      tags: row.sourceTags,
      config: row.sourceConfig,
    }).value,
  })), samplingLimit);

  await emitDailyGenerationProgress(opts, 'candidate_repair', `已采样 ${sampledRows.length} 条候选，正在补齐关键处理状态。`, {
    sampledCandidates: sampledRows.length,
  });
  const catchUp = await repairDailyReportCandidateReadiness(userId, sampledRows);
  if (catchUp.itemIds.length > 0) {
    const refreshedRows = await db
      .select({
        id: schema.items.id,
        sourceId: schema.items.sourceId,
        title: schema.items.title,
        url: schema.items.url,
        snippet: schema.items.snippet,
        aiScore: schema.items.aiScore,
        aiSummary: schema.items.aiSummary,
        aiTranslation: schema.items.aiTranslation,
        language: schema.items.language,
        translationStatus: schema.items.translationStatus,
        translationReason: schema.items.translationReason,
        priorityScore: schema.items.priorityScore,
        contentStatus: schema.items.contentStatus,
        summaryStatus: schema.items.summaryStatus,
        aiTags: schema.items.aiTags,
        publishedAt: schema.items.publishedAt,
        fetchedAt: schema.items.fetchedAt,
        sourceName: schema.sources.name,
        category: schema.sources.category,
        sourceType: schema.items.sourceType,
        sourceTier: schema.items.sourceTier,
        sourceKind: schema.sources.sourceKind,
        sourceRole: schema.sources.sourceRole,
        sourceCollectorType: schema.sources.collectorType,
        sourceConfig: schema.sources.config,
        sourceStatus: schema.sources.status,
        sourceAutoFetchEnabled: schema.sources.autoFetchEnabled,
        sourceTags: schema.sources.tags,
        clusterId: schema.items.clusterId,
        isFiltered: schema.items.isFiltered,
        filterBucket: schema.items.filterBucket,
        filterReason: schema.items.filterReason,
        qualityDecision: schema.items.qualityDecision,
        processingStatus: schema.items.processingStatus,
        contentLength: sql<number>`greatest(
          coalesce(length(trim(${schema.items.readabilityContent})), 0),
          coalesce(length(trim(${schema.items.content})), 0)
        )`,
      })
      .from(schema.items)
      .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
      .where(and(...itemBaseWhere, inArray(schema.items.id, catchUp.itemIds)));
    const refreshedById = new Map(refreshedRows.map((row) => [row.id, {
      ...row,
      sourceName: row.sourceName || 'Unknown',
      category: row.category || 'uncategorized',
      sourceReadingTier: resolveSourceReadingTier({
        name: row.sourceName,
        sourceTier: row.sourceTier,
        collectorType: row.sourceCollectorType,
        sourceType: row.sourceType,
        sourceKind: row.sourceKind,
        category: row.category,
        status: row.sourceStatus,
        autoFetchEnabled: row.sourceAutoFetchEnabled,
        tags: row.sourceTags,
        config: row.sourceConfig,
      }).value,
    }]));
    sampledRows = sampledRows.map((row) => refreshedById.get(row.id) || row);
  }

  const todayItemIds = sampledRows.map((row) => row.id);
  const scoreRiskRows = todayItemIds.length > 0
    ? await db
      .select({
        itemId: schema.itemScoreBreakdowns.itemId,
        riskFlags: schema.itemScoreBreakdowns.riskFlags,
      })
      .from(schema.itemScoreBreakdowns)
      .where(and(
        eq(schema.itemScoreBreakdowns.userId, userId),
        inArray(schema.itemScoreBreakdowns.itemId, todayItemIds),
      ))
    : [];
  const scoreRiskFlagsByItem = new Map<string, string[]>();
  for (const row of scoreRiskRows) {
    const flags = Array.isArray(row.riskFlags) ? row.riskFlags.map((flag) => String(flag)).filter(Boolean) : [];
    if (flags.length === 0) continue;
    scoreRiskFlagsByItem.set(row.itemId, [...(scoreRiskFlagsByItem.get(row.itemId) || []), ...flags]);
  }

  const toItem = (t: typeof sampledRows[number]): TopItem => ({
    id: t.id,
    title: t.title,
    displayTitle: t.title,
    url: t.url,
    aiScore: t.aiScore,
    aiSummary: t.aiSummary,
    snippet: t.snippet,
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
    readingTier: resolveSourceReadingTier({
      name: t.sourceName,
      sourceTier: t.sourceTier,
      collectorType: t.sourceCollectorType,
      sourceType: t.sourceType,
      sourceKind: t.sourceKind,
      category: t.category,
      status: t.sourceStatus,
      autoFetchEnabled: t.sourceAutoFetchEnabled,
      tags: t.sourceTags,
      config: t.sourceConfig,
    }).value,
    sourceKind: t.sourceKind,
    clusterId: t.clusterId,
    isFiltered: t.isFiltered,
    filterBucket: t.filterBucket,
    filterReason: t.filterReason,
    qualityDecision: t.qualityDecision,
      processingStatus: t.processingStatus,
      contentLength: Number(t.contentLength || 0),
    scoreRiskFlags: [...new Set(scoreRiskFlagsByItem.get(t.id) || [])],
  });

  const visibleItems = sampledRows.map(toItem);
  await emitDailyGenerationProgress(opts, 'candidate_prepare', '正在应用日报工作流，形成最终候选。', {
    visibleItems: visibleItems.length,
  });
  const translationDeadlineAt = Date.now() + 60_000;
  const candidatePreparation = await prepareDailyReportCandidates(visibleItems, workflowConfig, {
    translateItem: (candidate) => translateDailyReportCandidate(userId, candidate, translationDeadlineAt),
  });
  const coverageIndex = buildDailyReportCoverageIndex(candidatePreparation);
  const selection = {
    topItems: candidatePreparation.finalCandidates as DailyReportPreparedCandidate[],
    eligibleItems: candidatePreparation.funnel.finalCandidates,
    selectionMode: candidatePreparation.selectionMode,
  };
  const topItems = selection.topItems as TopItem[];
  const highScoreItems = options.includeHighScore
    ? candidatePreparation.scoredCandidates
      .filter((item) => (item.aiScore ?? 0) >= Math.max(55, options.minScore))
      .slice(0, 40)
    : [];
  if (topItems.length > 0) {
    const selectedItemIds = topItems.map((item) => item.id);
    const [assetRows, contentRows] = await Promise.all([
      db
        .select()
        .from(schema.itemReadingAssets)
        .where(and(
          eq(schema.itemReadingAssets.userId, userId),
          inArray(schema.itemReadingAssets.itemId, selectedItemIds),
          inArray(schema.itemReadingAssets.assetType, ['qa', 'rewrite']),
        )),
      db
        .select({
          id: schema.items.id,
          content: schema.items.content,
          readabilityContent: schema.items.readabilityContent,
          translatedTitle: schema.items.translatedTitle,
        })
        .from(schema.items)
        .where(and(
          eq(schema.items.userId, userId),
          inArray(schema.items.id, selectedItemIds),
        )),
    ]);
    const assetsByItem = new Map<string, typeof assetRows>();
    for (const row of assetRows) {
      const rows = assetsByItem.get(row.itemId) || [];
      rows.push(row);
      assetsByItem.set(row.itemId, rows);
    }
    const contentByItem = new Map(contentRows.map((row) => [row.id, row]));
    for (const item of topItems) {
      const content = contentByItem.get(item.id);
      const editorial = buildDailyReportEditorialContext(item, content);
      item.readingAssets = buildReadingAssetRecords(assetsByItem.get(item.id) || []);
      item.translatedTitle = editorial.translatedTitle;
      item.displayTitle = editorial.translatedTitle || item.displayTitle || item.title;
      item.readerUrl = buildDailyReportItemUrl(item.id);
      item.editorialContext = editorial.editorialContext;
    }
  }

  const previousCategoryMap = new Map(previousCategoryRows.map((row) => [normalizeReportCategoryLabel(row.category), row.count]));
  const byCategoryData = todayCategoryRows.map((row) => {
    const category = normalizeReportCategoryLabel(row.category);
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
  const candidateFunnel = normalizeDailyReportCandidateFunnelForSnapshot(
    candidatePreparation.funnel,
    newItems,
    countMainVisibleItemsForReportFunnel(todayAuditRows),
  );
  const reportFunnel = {
    newItems,
    eligibleItems: selection.eligibleItems,
    filteredItems: todayAuditRows.filter((item) => item.isFiltered).length,
    filteredBucketItems: todayAuditRows.filter((item) => item.filterBucket === 'filtered').length,
    reviewItems: todayAuditRows.filter((item) => item.qualityDecision === 'review' || (!item.isFiltered && item.filterReason)).length,
    pendingItems: todayAuditRows.filter((item) => item.contentStatus && item.contentStatus !== 'ready').length,
    scopeMatched: candidateFunnel.scopeMatched,
    scoredCandidates: candidateFunnel.scoredCandidates,
    reviewCandidates: candidateFunnel.reviewCandidates,
    softFilteredRecovered: candidateFunnel.softFilteredRecovered,
    scoreFailedCandidates: candidateFunnel.scoreFailedCandidates,
    latestFallbackCandidates: candidateFunnel.latestFallbackCandidates,
    translationPending: candidateFunnel.translationPending,
    translationFailed: candidateFunnel.translationFailed,
    finalCandidates: candidateFunnel.finalCandidates,
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
  const eventMetrics = buildDailyReportEventMetrics({
    localItems: todayEventRows,
    radarItems: radarEventRows,
  });

  const snapshot: DailyReportSnapshot = {
    date: dateStr,
    totalItems,
    newItems,
    reportFunnel,
    workflowConfig,
    candidateFunnel,
    excludedCandidates: candidatePreparation.excluded.slice(0, 20),
    excludedCandidateSummary: summarizeDailyReportExcludedCandidates(candidatePreparation.excluded),
    selectionMode: selection.selectionMode,
    compareWindowDays: options.compareWindowDays,
    topItems,
    highScoreItems,
    byCategory: byCategoryData,
    topSources,
    themeClusters: deriveThemeClusters(topItems),
    eventMetrics,
    generatedAt: new Date().toISOString(),
    generationMode: options.generationMode,
  };
  await emitDailyGenerationProgress(opts, 'module_grouping', '正在把候选文章分到模型、Agent、算力、商业、政策、深读和国内产业模块。', {
    finalCandidates: topItems.length,
    highScoreItems: highScoreItems.length,
  });
  snapshot.moduleSections = buildDailyReportModuleSections(snapshot);
  snapshot.editorialSupplementArticles = buildDailyReportSupplementalArticles(snapshot, coverageIndex.items);
  await emitDailyGenerationProgress(opts, 'module_generation', '模块日报结构已生成，正在准备最终融合。', {
    moduleCount: snapshot.moduleSections.length,
    moduleArticleCount: snapshot.moduleSections.reduce((total, section) => total + section.coverageCount, 0),
    supplementalArticleCount: snapshot.editorialSupplementArticles.length,
  });
  const editorialDigest = buildDailyReportEditorialDigest(snapshot);

  if (newItems > 0 && topItems.length === 0) {
    const emptyDiagnosis = buildEmptyDailyReportDiagnosis({
      ...reportFunnel,
      topFilterReasons: filterReasonCounts,
    });
    const degradedPresentation = buildDegradedDailyReportPresentation(snapshot, snapshot.moduleSections, reportScope.label);
    const final: DailyReportFinal = {
      markdown: degradedPresentation.markdown,
      bullets: degradedPresentation.bullets,
      meta: {
        sceneType: 'daily_report_final',
        status: 'fallback',
        error: 'empty_daily_report_diagnosis',
      },
    };
    const emptyReportQuality = buildDailyReportQuality({
      generationMode: options.generationMode,
      emptyCandidates: true,
      finalMeta: final.meta,
    });
    const payload: DailyReportPayload = {
      reportScope,
      snapshot,
      emptyDiagnosis,
      editorialDigest,
      editorialMaterials: editorialDigest.materials,
      coverJudgement: editorialDigest.coverJudgement,
      radarOverview: editorialDigest.radarOverview,
      eventMetrics: snapshot.eventMetrics,
      moduleSections: editorialDigest.moduleNarratives,
      moduleNarratives: editorialDigest.moduleNarratives,
      moreDynamics: editorialDigest.moreDynamics,
      deepReads: editorialDigest.deepReads,
      tableOfContents: editorialDigest.tableOfContents,
      readingOrder: editorialDigest.readingOrder,
      nextActions: editorialDigest.nextActions,
      degradedPresentation,
      coverageSummary: coverageIndex.summary,
      coverageItems: coverageIndex.items,
      coverageMarkdown: coverageIndex.markdown,
      modules: {},
      final,
      preset: options.preset,
      generationMode: options.generationMode,
      qualityStatus: 'degraded',
      qualityReasons: emptyReportQuality.reasons,
      qualityWarnings: emptyReportQuality.warnings,
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

    await emitDailyGenerationProgress(opts, 'saving', '正在保存空候选诊断日报。', {
      date: dateStr,
      itemCount: 0,  // 诊断报告无实际条目；newItems（今日总抓取数）在 payload 中已保存
    });
    await db.insert(schema.insights).values({
      userId,
      date: dateStr,
      type: options.reportType,
      topics: [],
      payload,
      summary: report.markdown,
      itemCount: 0,  // 诊断报告无实际条目；newItems（今日总抓取数）在 payload 中已保存
      pipelineVersion: DAILY_PIPELINE_VERSION,
    }).onConflictDoUpdate({
      target: [schema.insights.userId, schema.insights.date, schema.insights.type],
      set: buildDailyReportInsightConflictUpdate({
        summary: report.markdown,
        itemCount: 0,  // 诊断报告无实际条目；newItems（今日总抓取数）在 payload 中已保存
        topics: [],
        payload,
      }),
    });

    logger.info({ date: dateStr, newItems, reportFunnel }, 'Daily report generated as empty diagnosis');
    await emitDailyGenerationProgress(opts, 'completed', '诊断日报已生成，可以查看未入报原因。', {
      date: dateStr,
      itemCount: 0,  // 诊断报告无实际条目；newItems（今日总抓取数）在 payload 中已保存
    });
    return report;
  }

  const decisionFallback = buildDecisionFallback(snapshot);
  const researchFallback = buildResearchFallback(snapshot);
  const readingFallback = buildReadingFallback(snapshot);
  const cleaningFallback = buildCleaningFallback(snapshot);

  const modules: DailyReportData['modules'] = {};
  await emitDailyGenerationProgress(opts, 'agent_cleaning', '正在运行清洗 Agent。', {
    finalCandidates: candidateFunnel.finalCandidates,
  });
  const cleaning: DailyReportCleaning = shouldRunDailyReportAiStage(options.generationMode, 'cleaning', workflowConfig.enabledModules.cleaning, options.preset)
    ? await runCleaningScene(userId, snapshot, cleaningFallback)
    : {
      output: cleaningFallback,
      rawText: JSON.stringify(cleaningFallback, null, 2),
      meta: {
        sceneType: DAILY_AGENT_SCENES.cleaning,
        status: 'fallback',
        error: options.generationMode === 'fast' ? 'fast_generation_mode' : 'workflow_module_disabled',
      },
    };
  await emitDailyGenerationProgress(opts, 'agent_decision', '正在运行决策、研究和阅读 Agent。', {
    generationMode: options.generationMode,
    preset: options.preset,
  });
  await runDailyReportModuleTasks([
    {
      key: 'decision',
      enabled: shouldRunDailyReportAiStage(options.generationMode, 'decision', workflowConfig.enabledModules.decision, options.preset),
      run: async () => {
        await emitDailyGenerationProgress(opts, 'agent_decision', '决策 Agent 正在分析候选内容。');
        return runScene(
          userId,
          'decision',
          snapshot,
          decisionFallback.markdown,
          decisionFallback.bullets,
          snapshot.highScoreItems.slice(0, 5),
          buildModuleContext(snapshot, cleaning.output, 'decision'),
        );
      },
      assign: (result) => {
        modules.decision = {
          key: 'decision',
          title: '决策简报',
          markdown: result.markdown,
          bullets: decisionFallback.bullets,
          citations: snapshot.highScoreItems.slice(0, 5).map(({ id, title, url, sourceName, category, aiScore }) => ({ id, title, url, sourceName, category, aiScore })),
          meta: result.meta,
        };
      },
    },
    {
      key: 'research',
      enabled: shouldRunDailyReportAiStage(options.generationMode, 'research', workflowConfig.enabledModules.research, options.preset),
      run: async () => {
        await emitDailyGenerationProgress(opts, 'agent_research', '研究 Agent 正在补充主题与证据。');
        return runScene(
          userId,
          'research',
          snapshot,
          researchFallback.markdown,
          researchFallback.bullets,
          snapshot.topItems.slice(0, 6),
          buildModuleContext(snapshot, cleaning.output, 'research'),
        );
      },
      assign: (result) => {
        modules.research = {
          key: 'research',
          title: '研究汇总',
          markdown: result.markdown,
          bullets: researchFallback.bullets,
          citations: snapshot.topItems.slice(0, 6).map(({ id, title, url, sourceName, category, aiScore }) => ({ id, title, url, sourceName, category, aiScore })),
          meta: result.meta,
        };
      },
    },
    {
      key: 'reading',
      enabled: shouldRunDailyReportAiStage(options.generationMode, 'reading', workflowConfig.enabledModules.reading, options.preset),
      run: async () => {
        await emitDailyGenerationProgress(opts, 'agent_reading', '阅读 Agent 正在生成先读、扫读与暂缓建议。');
        return runScene(
          userId,
          'reading',
          snapshot,
          readingFallback.markdown,
          readingFallback.bullets,
          snapshot.topItems.slice(0, 8),
          buildModuleContext(snapshot, cleaning.output, 'reading'),
        );
      },
      assign: (result) => {
        modules.reading = {
          key: 'reading',
          title: '阅读导航',
          markdown: result.markdown,
          bullets: readingFallback.bullets,
          citations: snapshot.topItems.slice(0, 8).map(({ id, title, url, sourceName, category, aiScore }) => ({ id, title, url, sourceName, category, aiScore })),
          meta: result.meta,
        };
      },
    },
  ]);

  ensureDistinctDailyReportModules(modules, {
    decision: decisionFallback,
    research: researchFallback,
    reading: readingFallback,
  });

  await emitDailyGenerationProgress(opts, 'final_synthesis', '正在融合最终高质量日报。', {
    moduleCount: Object.keys(modules).length,
  });
  const finalFallback = buildFinalFallback(snapshot, cleaning.output, modules);
  const final: DailyReportFinal = shouldRunDailyReportAiStage(options.generationMode, 'final', workflowConfig.enabledModules.final, options.preset)
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
  const deliveryMarkdown = finalizeDailyReportDelivery(final.markdown, snapshot, final.meta.deliveryMode);
  final.markdown = ensureReportHeading(deliveryMarkdown, dateStr, reportScope.label);

  const reportQuality = buildDailyReportQuality({
    markdown: final.markdown,
    generationMode: options.generationMode,
    // Only formally curated evidence can support a high-quality label. Latest
    // fallbacks and "more dynamics" remain visible, but do not satisfy the
    // minimum editorial evidence gate.
    evidenceCount: editorialDigest.curated.length,
    minimumEvidenceCount: reportScope.sourceId ? 3 : 5,
    finalMeta: final.meta,
    stageMetas: [
      { key: 'cleaning', meta: cleaning.meta },
      { key: 'decision', meta: modules.decision?.meta },
      { key: 'research', meta: modules.research?.meta },
      { key: 'reading', meta: modules.reading?.meta },
    ],
  });
  const degradedPresentation = reportQuality.status === 'degraded'
    ? buildDegradedDailyReportPresentation(snapshot, editorialDigest.moduleNarratives, reportScope.label)
    : null;
  let recoveryContext: DailyReportRecoveryContext | undefined;
  try {
    recoveryContext = await loadDailyReportRecoveryContext(userId, dateStr, reportScope.sourceId);
  } catch (error) {
    logger.warn({
      userId,
      date: dateStr,
      sourceId: reportScope.sourceId || null,
      error: (error as Error).message,
    }, 'Daily report recovery material snapshot failed');
  }

  const payload: DailyReportPayload = {
    reportScope,
    snapshot,
    editorialDigest,
    editorialMaterials: editorialDigest.materials,
    coverJudgement: editorialDigest.coverJudgement,
    radarOverview: editorialDigest.radarOverview,
    eventMetrics: snapshot.eventMetrics,
    moduleSections: editorialDigest.moduleNarratives,
    moduleNarratives: editorialDigest.moduleNarratives,
    moreDynamics: editorialDigest.moreDynamics,
    deepReads: editorialDigest.deepReads,
    tableOfContents: editorialDigest.tableOfContents,
    readingOrder: editorialDigest.readingOrder,
    nextActions: editorialDigest.nextActions,
    ...(degradedPresentation ? { degradedPresentation } : {}),
    coverageSummary: coverageIndex.summary,
    coverageItems: coverageIndex.items,
    coverageMarkdown: coverageIndex.markdown,
    cleaning,
    modules,
    final,
    preset: options.preset,
    generationMode: options.generationMode,
    qualityStatus: reportQuality.status,
    qualityReasons: reportQuality.reasons,
    qualityWarnings: reportQuality.warnings,
    ...(recoveryContext ? { recoveryContext } : {}),
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
  report.markdown = degradedPresentation?.markdown || formatMarkdown(report);
  report.structured = buildStructuredOutput(
    snapshot,
    editorialDigest,
    editorialDigest.moduleNarratives || [],
    topItems,
  );

  await emitDailyGenerationProgress(opts, 'saving', '正在保存日报结果。', {
    date: dateStr,
    itemCount: topItems.length,  // 实际入报条目数；newItems（今日总抓取数）在 payload/report.newItems 中
  });
  await db.insert(schema.insights).values({
    userId,
    date: dateStr,
    type: options.reportType,
    topics: snapshot.themeClusters,
    payload,
    summary: report.markdown,
    itemCount: topItems.length,  // 实际入报条目数；newItems（今日总抓取数）在 payload/report.newItems 中
    pipelineVersion: DAILY_PIPELINE_VERSION,
  }).onConflictDoUpdate({
    target: [schema.insights.userId, schema.insights.date, schema.insights.type],
    set: buildDailyReportInsightConflictUpdate({
      summary: report.markdown,
      itemCount: topItems.length,  // 实际入报条目数；newItems（今日总抓取数）在 payload/report.newItems 中
      topics: snapshot.themeClusters,
      payload,
    }),
  });

  logger.info({ date: dateStr, newItems, topCount: topItems.length, highScore: highScoreItems.length, preset: options.preset, qualityStatus: reportQuality.status, qualityReasons: reportQuality.reasons, qualityWarnings: reportQuality.warnings }, 'Daily report generated');
  await emitDailyGenerationProgress(opts, 'completed', reportQuality.status === 'full' ? '高质量日报已生成，可以进入正式阅读。' : '日报已生成，但未通过完整质量门禁，已标记为降级日报。', {
    date: dateStr,
    itemCount: topItems.length,  // 实际入报条目数；newItems（今日总抓取数）在 payload/report.newItems 中
    qualityStatus: reportQuality.status,
    qualityReasons: reportQuality.reasons,
    qualityWarnings: reportQuality.warnings,
  });
  return report;
}

// ─── 结构化日报输出构建（Phase C1） ─────────────────────────────────────────

function mapReadingTier(tier: string | null | undefined): StructuredTopItem['readingTier'] {
  if (tier === 'must-read' || tier === 'must_read') return 'must-read';
  if (tier === 'skim' || tier === 'quick') return 'skim';
  return 'reference';
}

function inferSectionTone(section: DailyReportModuleSection): TopicBlock['tone'] {
  if (section.signals.length > section.noise.length && section.actions.length > 0) return 'insight';
  if (section.noise.length > 0 || section.key === 'policy_safety') return 'caution';
  if (section.evidence && section.evidence.length > 2) return 'evidence';
  return 'neutral';
}

function convertTopItemToStructured(item: TopItem): StructuredTopItem {
  return {
    id: item.id,
    title: item.displayTitle || item.title,
    source: item.sourceName,
    url: item.url || undefined,
    summary: item.reportSummary || item.aiSummary || item.snippet || '',
    readingTier: mapReadingTier(item.readingTier),
    publishedAt: item.publishedAt || undefined,
    tags: item.aiTags || [],
  };
}

function convertPriorityArticleToStructured(article: DailyReportPriorityArticle): StructuredTopItem {
  return {
    id: article.id,
    title: article.title,
    source: article.sourceName,
    url: article.url || undefined,
    summary: article.summary || article.reason || '',
    readingTier: 'must-read',
    tags: [],
  };
}

export function buildStructuredOutput(
  snapshot: DailyReportSnapshot,
  editorialDigest: DailyReportEditorialDigest | null | undefined,
  moduleSections: DailyReportModuleSection[],
  topItems: TopItem[],
): DailyReportStructured {
  // coverJudgement: 优先取编辑摘要中的总评
  const coverJudgement = editorialDigest?.coverJudgement
    ? `${editorialDigest.coverJudgement.title}${editorialDigest.coverJudgement.summary ? ' — ' + editorialDigest.coverJudgement.summary : ''}`
    : snapshot.themeClusters?.[0]?.label || '今日信息流概览';

  // topicBlocks: 从 moduleSections 转换
  const topicBlocks: TopicBlock[] = moduleSections.map((section) => ({
    id: section.key,
    title: section.editorialTitle || section.title,
    summary: section.conclusion || '',
    tone: inferSectionTone(section),
    items: section.priorityArticles.map(convertPriorityArticleToStructured),
    tags: section.signals.slice(0, 5),
  }));

  // topItems: 从 snapshot topItems 转换
  const structuredTopItems: StructuredTopItem[] = topItems.slice(0, 20).map(convertTopItemToStructured);

  // coverageIndex: 从 byCategory 转换
  const maxCount = Math.max(...snapshot.byCategory.map((c) => c.count), 1);
  const coverageIndex: CoverageEntry[] = snapshot.byCategory.map((cat) => ({
    domain: cat.category,
    score: Math.min(100, Math.round((cat.count / maxCount) * 100)),
    sourceCount: cat.count,
  }));

  // sourceDeclaration: 从 topSources 提取
  const sourceDeclaration: string[] = snapshot.topSources.map((s) => s.sourceName);

  return {
    coverJudgement,
    topicBlocks,
    topItems: structuredTopItems,
    coverageIndex,
    sourceDeclaration,
  };
}

// ─── 结构化日报输出构建结束 ──────────────────────────────────────────────────

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
