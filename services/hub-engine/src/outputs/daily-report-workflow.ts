import { AIHOT_DAILY_BUCKET_LABELS, classifyAihotDailyBucket } from '../lib/aihot-governance.js';
import { evaluateTranslationArtifact } from '../lib/translation-quality.js';

export type DailyReportSelectionMode = 'scored' | 'review' | 'latest_visible' | 'empty';
export type DailyReportReviewBucket = 'ai_tech_review' | 'business_noise_review';

export type DailyReportWorkflowConfig = {
  name?: string;
  version?: string;
  targetAudience?: string[];
  reportTemplateId?: string;
  fallbackStrategy?: 'none' | 'latest_visible' | 'semantic_related' | 'source_priority' | 'manual_review';
  normalization?: {
    translationMode?: 'fast' | 'precise';
    terminologyNormalization?: boolean;
    entityNormalization?: boolean;
    dedupStrategy?: 'event' | 'title' | 'semantic';
  };
  topN: number;
  minScore: number;
  enableLatestFallback: boolean;
  perSourceLimit: number;
  requireChinese: boolean;
  scope: {
    categories: string[];
    keywords: string[];
    sourceTiers: string[];
    sourceIds: number[];
    sourceNames: string[];
  };
  enabledModules: {
    cleaning: boolean;
    decision: boolean;
    research: boolean;
    reading: boolean;
    final: boolean;
  };
};

export type DailyReportCandidateInput = {
  id: string;
  sourceId?: number | null;
  title: string;
  url: string;
  aiScore: number | null;
  aiSummary: string | null;
  snippet?: string | null;
  aiTranslation?: string | null;
  language?: string | null;
  translationStatus?: string | null;
  translationReason?: string | null;
  sourceName: string;
  category: string;
  sourceType?: string | null;
  sourceTier?: string | null;
  readingTier?: 'high_value' | 'light_reading' | 'explore' | 'paused' | string | null;
  sourceKind?: string | null;
  clusterId?: string | null;
  isFiltered?: boolean | null;
  filterBucket?: string | null;
  filterReason?: string | null;
  qualityDecision?: string | null;
  processingStatus?: string | null;
  scoreRiskFlags?: string[];
  publishedAt?: string | null;
  fetchedAt?: string | null;
  aiTags?: string[];
  contentLength?: number | null;
  translationSourceText?: string | null;
};

export type DailyReportPreparedCandidate = DailyReportCandidateInput & {
  displayTitle: string;
  reportSummary: string;
  selectionReason: string;
  selectionMode: Exclude<DailyReportSelectionMode, 'empty'>;
  reviewBucket?: DailyReportReviewBucket;
  scopeMatched: boolean;
  chineseReady: boolean;
};

export type DailyReportCandidateFunnel = {
  todayNew: number;
  mainVisible: number;
  scopeMatched: number;
  scoredCandidates: number;
  reviewCandidates: number;
  fallbackScoredCandidates: number;
  softFilteredRecovered: number;
  scoreFailedCandidates: number;
  latestFallbackCandidates: number;
  translationPending: number;
  translationFailed: number;
  finalCandidates: number;
};

export type DailyReportExcludedCandidate = {
  id: string;
  title: string;
  reason: 'translation_failed' | 'not_chinese' | 'not_selected' | 'business_noise' | 'fallback_scored' | 'webpage_snapshot';
  detail?: string | null;
  url?: string | null;
  sourceName?: string | null;
  category?: string | null;
  aiScore?: number | null;
  translationStatus?: string | null;
};

export type DailyReportExcludedCandidateSummary = {
  total: number;
  byReason: Array<{
    reason: DailyReportExcludedCandidate['reason'];
    count: number;
    samples: DailyReportExcludedCandidate[];
  }>;
};

export type DailyReportCandidatePreparation = {
  config: DailyReportWorkflowConfig;
  selectionMode: DailyReportSelectionMode;
  funnel: DailyReportCandidateFunnel;
  scopedCandidates: DailyReportPreparedCandidate[];
  scoredCandidates: DailyReportPreparedCandidate[];
  reviewCandidates: DailyReportPreparedCandidate[];
  latestFallbackCandidates: DailyReportPreparedCandidate[];
  finalCandidates: DailyReportPreparedCandidate[];
  excluded: DailyReportExcludedCandidate[];
};

export type DailyReportTranslationUpdate = Partial<Pick<
  DailyReportCandidateInput,
  'aiTranslation' | 'language' | 'translationStatus' | 'translationReason' | 'aiSummary'
>>;

export type PrepareDailyReportCandidateOptions = {
  translateItem?: (candidate: DailyReportCandidateInput) => Promise<DailyReportTranslationUpdate | null | undefined>;
  allowPendingTranslationCandidates?: boolean;
};

export const DEFAULT_DAILY_REPORT_WORKFLOW: DailyReportWorkflowConfig = {
  name: '默认工作流（高价值优先）',
  version: 'v2.0',
  targetAudience: ['个人决策', '成长复盘'],
  reportTemplateId: 'high_quality_v2',
  fallbackStrategy: 'latest_visible',
  normalization: {
    translationMode: 'precise',
    terminologyNormalization: true,
    entityNormalization: true,
    dedupStrategy: 'event',
  },
  topN: 42,
  minScore: 55,
  enableLatestFallback: true,
  perSourceLimit: 8,
  requireChinese: true,
  scope: {
    categories: ['AI', 'tech', 'tech-cn', 'App&效率工具', 'Product Changelog', '研报&数据'],
    keywords: [
      'AI',
      'OpenAI',
      'Claude',
      'Anthropic',
      'Agent',
      '智能体',
      '模型',
      '大模型',
      'Cursor',
      'Codex',
      '机器人',
      '算力',
      '芯片',
      'API',
      '产品',
      '监管',
      '科技',
      '工具',
    ],
    sourceTiers: ['S', 'A'],
    sourceIds: [],
    sourceNames: [],
  },
  enabledModules: {
    cleaning: true,
    decision: true,
    research: true,
    reading: true,
    final: true,
  },
};

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(Math.round(numeric), max));
}

function normalizeStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const normalized = value.map((item) => String(item || '').trim()).filter(Boolean);
  return normalized.length > 0 ? Array.from(new Set(normalized)) : fallback;
}

function normalizeSourceTierArray(value: unknown, fallback: string[]) {
  const legacyMap: Record<string, string | null> = {
    T1: 'S',
    'T1.5': 'A',
    T2: null,
  };
  const allowed = new Set(['S', 'A', 'B', 'C', 'D']);
  const normalized = normalizeStringArray(value, fallback)
    .map((item) => Object.prototype.hasOwnProperty.call(legacyMap, item.toUpperCase())
      ? legacyMap[item.toUpperCase()]
      : item.toUpperCase())
    .filter((item): item is string => Boolean(item) && allowed.has(item as string));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : [...fallback];
}

function normalizeIntegerArray(value: unknown, fallback: number[]) {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .map((item) => typeof item === 'number' ? item : Number(item))
    .filter((item) => Number.isInteger(item) && item > 0)
    .map((item) => Math.trunc(item));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : fallback;
}

function normalizeModuleFlags(value: unknown): DailyReportWorkflowConfig['enabledModules'] {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    cleaning: input.cleaning !== false,
    decision: input.decision !== false,
    research: input.research !== false,
    reading: input.reading !== false,
    final: input.final !== false,
  };
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const normalized = String(value || '').trim();
  return allowed.includes(normalized as T) ? normalized as T : fallback;
}

export function normalizeDailyReportWorkflowConfig(input?: unknown): DailyReportWorkflowConfig {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const rawScope = raw.scope && typeof raw.scope === 'object' ? raw.scope as Record<string, unknown> : {};
  const rawNormalization = raw.normalization && typeof raw.normalization === 'object' ? raw.normalization as Record<string, unknown> : {};
  return {
    name: String(raw.name || DEFAULT_DAILY_REPORT_WORKFLOW.name).trim() || DEFAULT_DAILY_REPORT_WORKFLOW.name,
    version: String(raw.version || DEFAULT_DAILY_REPORT_WORKFLOW.version).trim() || DEFAULT_DAILY_REPORT_WORKFLOW.version,
    targetAudience: normalizeStringArray(raw.targetAudience, DEFAULT_DAILY_REPORT_WORKFLOW.targetAudience || []),
    reportTemplateId: String(raw.reportTemplateId || DEFAULT_DAILY_REPORT_WORKFLOW.reportTemplateId).trim() || DEFAULT_DAILY_REPORT_WORKFLOW.reportTemplateId,
    fallbackStrategy: normalizeEnum(raw.fallbackStrategy, ['none', 'latest_visible', 'semantic_related', 'source_priority', 'manual_review'] as const, DEFAULT_DAILY_REPORT_WORKFLOW.fallbackStrategy || 'latest_visible'),
    normalization: {
      translationMode: normalizeEnum(rawNormalization.translationMode, ['fast', 'precise'] as const, DEFAULT_DAILY_REPORT_WORKFLOW.normalization?.translationMode || 'precise'),
      terminologyNormalization: typeof rawNormalization.terminologyNormalization === 'boolean'
        ? rawNormalization.terminologyNormalization
        : DEFAULT_DAILY_REPORT_WORKFLOW.normalization?.terminologyNormalization ?? true,
      entityNormalization: typeof rawNormalization.entityNormalization === 'boolean'
        ? rawNormalization.entityNormalization
        : DEFAULT_DAILY_REPORT_WORKFLOW.normalization?.entityNormalization ?? true,
      dedupStrategy: normalizeEnum(rawNormalization.dedupStrategy, ['event', 'title', 'semantic'] as const, DEFAULT_DAILY_REPORT_WORKFLOW.normalization?.dedupStrategy || 'event'),
    },
    topN: clampInteger(raw.topN, DEFAULT_DAILY_REPORT_WORKFLOW.topN, 1, 50),
    minScore: clampInteger(raw.minScore, DEFAULT_DAILY_REPORT_WORKFLOW.minScore, 0, 100),
    enableLatestFallback: typeof raw.enableLatestFallback === 'boolean'
      ? raw.enableLatestFallback
      : DEFAULT_DAILY_REPORT_WORKFLOW.enableLatestFallback,
    perSourceLimit: clampInteger(raw.perSourceLimit, DEFAULT_DAILY_REPORT_WORKFLOW.perSourceLimit, 1, 20),
    requireChinese: typeof raw.requireChinese === 'boolean'
      ? raw.requireChinese
      : DEFAULT_DAILY_REPORT_WORKFLOW.requireChinese,
    scope: {
      categories: normalizeStringArray(rawScope.categories, DEFAULT_DAILY_REPORT_WORKFLOW.scope.categories),
      keywords: normalizeStringArray(rawScope.keywords, DEFAULT_DAILY_REPORT_WORKFLOW.scope.keywords),
      sourceTiers: normalizeSourceTierArray(rawScope.sourceTiers, DEFAULT_DAILY_REPORT_WORKFLOW.scope.sourceTiers),
      sourceIds: normalizeIntegerArray(rawScope.sourceIds, DEFAULT_DAILY_REPORT_WORKFLOW.scope.sourceIds),
      sourceNames: normalizeStringArray(rawScope.sourceNames, DEFAULT_DAILY_REPORT_WORKFLOW.scope.sourceNames),
    },
    enabledModules: normalizeModuleFlags(raw.enabledModules),
  };
}

function countMatches(input: string, pattern: RegExp): number {
  return (input.match(pattern) || []).length;
}

export function isChineseEnough(input?: string | null): boolean {
  const text = (input || '').trim();
  if (!text) return false;
  const han = countMatches(text, /[\u4e00-\u9fff]/g);
  const latin = countMatches(text, /[A-Za-z]/g);
  if (han >= 16) return true;
  if (han >= 8 && han >= latin * 0.35) return true;
  return han > 0 && latin <= 16;
}

export function looksTruncatedReportSummary(input?: string | null): boolean {
  const text = (input || '').trim();
  if (!text) return true;
  if (/[—\-–:：,，、（(]$/.test(text)) return true;
  if (/(例如|比如|包括|覆盖|采用|通过|实现|基于|面向|支持|including|such as|for example)$/i.test(text)) return true;
  const han = countMatches(text, /[\u4e00-\u9fff]/g);
  const endsWithTerminal = /[。！？.!?」）)]$/.test(text);
  const terminals = [...text.matchAll(/[。！？.!?]/g)];
  const lastTerminal = terminals.at(-1);
  if (!endsWithTerminal && lastTerminal?.index != null && lastTerminal.index < text.length - 1) return true;
  if (text.length >= 110 && !endsWithTerminal) return true;
  const endsWithLatinFragment = /(?:^|[\s\u4e00-\u9fff，、：:])([A-Za-z][A-Za-z0-9.+#/-]{0,18})$/.test(text);
  return han >= 20 && !endsWithTerminal && endsWithLatinFragment;
}

export function looksLikeModelMetaReportSummary(input?: string | null): boolean {
  const text = (input || '').trim();
  if (!text) return false;
  return /(请提供|未提供|无法进行|不能进行|很抱歉|您似乎没有提供).{0,40}(摘要|改写|内容|文本)/.test(text);
}

export function normalizeReportSummaryText(input?: string | null): string {
  const text = (input || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (looksLikeModelMetaReportSummary(text)) return '';
  if (!looksTruncatedReportSummary(text)) return text;
  const matches = [...text.matchAll(/[。！？.!?]/g)];
  const last = matches.at(-1);
  const index = last?.index ?? -1;
  if (index >= 40) return text.slice(0, index + 1).trim();
  return '';
}

function needsChineseMaterial(candidate: DailyReportCandidateInput): boolean {
  if (candidate.language && candidate.language !== 'zh') return true;
  const combined = `${candidate.title}\n${candidate.aiSummary || ''}`;
  const han = countMatches(combined, /[\u4e00-\u9fff]/g);
  const latin = countMatches(combined, /[A-Za-z]/g);
  return latin >= 30 && han < 12;
}

function resolveReportSummary(candidate: DailyReportCandidateInput): string {
  const translation = normalizeReportSummaryText(candidate.aiTranslation);
  if (isChineseEnough(translation)) return translation;
  const summary = normalizeReportSummaryText(candidate.aiSummary);
  if (isChineseEnough(summary)) return summary;
  const snippet = normalizeReportSummaryText(candidate.snippet);
  if (isChineseEnough(snippet)) return snippet;
  if (isChineseEnough(candidate.title)) return candidate.title.trim();
  return '';
}

export function sanitizeDailyReportTranslation(candidate: DailyReportCandidateInput): DailyReportCandidateInput {
  if (!candidate.aiTranslation?.trim()) return candidate;
  const quality = evaluateTranslationArtifact(
    candidate.aiTranslation,
    candidate.translationSourceText,
    { basisLength: candidate.contentLength },
  );
  if (quality.usable) return candidate;
  return {
    ...candidate,
    aiTranslation: null,
    translationStatus: 'failed',
    translationReason: quality.reason || candidate.translationReason || '译文质量校验未通过。',
  };
}

function itemMatchesDailyScope(candidate: DailyReportCandidateInput, config: DailyReportWorkflowConfig): boolean {
  const scopedSourceIds = config.scope.sourceIds || [];
  const scopedSourceNames = (config.scope.sourceNames || []).map((name) => name.toLowerCase());
  const hasSourceScope = scopedSourceIds.length > 0 || scopedSourceNames.length > 0;
  const sourceName = String(candidate.sourceName || '').trim().toLowerCase();
  const matchesSourceScope = (
    (candidate.sourceId != null && scopedSourceIds.includes(candidate.sourceId))
    || (sourceName.length > 0 && scopedSourceNames.includes(sourceName))
  );
  if (hasSourceScope) return matchesSourceScope;

  const category = candidate.category || '';
  if (config.scope.categories.some((entry) => entry.toLowerCase() === category.toLowerCase())) return true;
  if (candidate.sourceTier && config.scope.sourceTiers.includes(candidate.sourceTier)) return true;
  const haystack = [
    candidate.title,
    candidate.aiSummary || '',
    candidate.aiTranslation || '',
    candidate.category,
    candidate.sourceName,
    ...(candidate.aiTags || []),
  ].join('\n').toLowerCase();
  return config.scope.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

function normalizeDailyCategoryLabel(candidate: Pick<DailyReportCandidateInput, 'title' | 'aiSummary' | 'aiTags' | 'category'>): string {
  const category = String(candidate.category || '').trim();
  if (category && !/^uncategorized$/i.test(category)) return category;
  const bucket = classifyAihotDailyBucket(candidate);
  return AIHOT_DAILY_BUCKET_LABELS[bucket] || 'AI 线索';
}

export function classifyDailyReportReviewBucket(candidate: Pick<
  DailyReportCandidateInput,
  'title' | 'aiSummary' | 'aiTranslation' | 'category' | 'sourceName' | 'aiTags'
>): DailyReportReviewBucket {
  const signalText = [
    candidate.title,
    candidate.aiSummary || '',
    candidate.aiTranslation || '',
    ...(candidate.aiTags || []),
  ].join('\n').toLowerCase();
  const text = [
    candidate.title,
    candidate.aiSummary || '',
    candidate.aiTranslation || '',
    candidate.category,
    candidate.sourceName,
    ...(candidate.aiTags || []),
  ].join('\n').toLowerCase();

  const explicitNonAiTech = /(?:ai|人工智能|科技|技术|产品|大模型).{0,16}(?:无关|不相关|没有关系)|(?:无关|不相关).{0,16}(?:ai|人工智能|科技|技术|产品|大模型)/i.test(signalText);
  const strongAiTechSignal = /(ai|openai|anthropic|claude|gpt|agent|智能体|模型|大模型|算力|芯片|api|cursor|codex|机器人|科技|技术|开发者|产品发布|自动驾驶|算法|软件|开源)/i.test(signalText);
  const regulatoryAiTechSignal = /(监管|合规|治理|政策|法案|实施细则)/i.test(signalText)
    && /(ai|人工智能|大模型|模型|算法|数据|平台|科技|自动驾驶|机器人|芯片|算力|智能体)/i.test(signalText);
  const aiTechSignal = !explicitNonAiTech && (strongAiTechSignal || regulatoryAiTechSignal);
  const marketNoisePattern = /(恒指|a股|港股|美股|沪深|科创50|创业板|开盘|收盘|盘中|午间休盘|日内|涨超|跌超|涨幅|跌幅|指数|股价|股票|新开仓|加仓|平仓|持仓|投资者账户|资金划转|财报|公告|融资余额|主力资金|成交额|板块|快手涨|公司公告|爱企查|天眼查|黄金|现货|期货|逆回购|央行公开市场)/i;
  const titleMarketNoise = marketNoisePattern.test(candidate.title || '');
  const titleAiTechSignal = /(ai|人工智能|openai|anthropic|claude|gpt|gemini|大模型|模型发布|智能体|芯片|算力|机器人|自动驾驶|codex|cursor)/i.test(candidate.title || '');
  const marketNoise = marketNoisePattern.test(text);
  const genericBusiness = /(商业快讯|财经|证券|券商|投资理财|资本市场|股市|基金|银行|保险|地产|存量业务|内地业务清理|跨境证券|行业监管|点心债|债券|境外发行人|发行规模|融资成本|外资入场|外资机构|人民币国际化|人民币资产|金融市场开放)/i.test(text);
  const genericFinanceGovernance = /(证监会|基金业协会|证券投资基金|基金行业|投资投研|客户服务|内控|错位发展|风险防控|概念炒作|过度投机|通道空转|伪创新|乱创新)/i.test(text)
    && !hasDirectProductOrTechnicalSignal(candidate);
  const genericAggregation = /BestBlogs\.dev|AI洞察日报|RSS Feed/i.test(candidate.sourceName || '');

  if (titleMarketNoise && !titleAiTechSignal) return 'business_noise_review';
  if (genericFinanceGovernance) return 'business_noise_review';
  if (genericAggregation && !aiTechSignal) return 'business_noise_review';
  if (!aiTechSignal && (marketNoise || genericBusiness)) return 'business_noise_review';
  if (marketNoise && !/(ai|人工智能|大模型|芯片|算力|机器人|自动驾驶|智能体)/i.test(text)) return 'business_noise_review';
  return 'ai_tech_review';
}

export function isSoftScoreFilteredCandidate(candidate: DailyReportCandidateInput): boolean {
  const reason = String(candidate.filterReason || '').trim();
  const restoredReview = candidate.qualityDecision === 'review' && reason.includes('低分复核');
  return Boolean(
    restoredReview
    || (
      candidate.isFiltered
      && candidate.filterBucket === 'filtered'
      && /^ai score too low:\s*\d+\s*<\s*\d+/i.test(reason)
    ),
  );
}

function isScoreFailedCandidate(candidate: DailyReportCandidateInput): boolean {
  return candidate.processingStatus === 'score_failed';
}

const FALLBACK_SCORE_RISK_FLAGS = new Set(['deterministic_fallback', 'model_circuit_breaker', 'ai_scoring_unavailable']);

function fallbackScoreRiskFlags(candidate: DailyReportCandidateInput): string[] {
  if (!Array.isArray(candidate.scoreRiskFlags)) return [];
  return candidate.scoreRiskFlags
    .map((flag) => String(flag || '').trim())
    .filter((flag) => FALLBACK_SCORE_RISK_FLAGS.has(flag));
}

function isFallbackScoredCandidate(candidate: DailyReportCandidateInput): boolean {
  return fallbackScoreRiskFlags(candidate).length > 0;
}

function buildExcludedCandidate(
  candidate: DailyReportCandidateInput,
  reason: DailyReportExcludedCandidate['reason'],
  detail?: string | null,
): DailyReportExcludedCandidate {
  return {
    id: candidate.id,
    title: candidate.title,
    reason,
    detail: detail || null,
    url: candidate.url,
    sourceName: candidate.sourceName,
    category: normalizeDailyCategoryLabel(candidate),
    aiScore: candidate.aiScore,
    translationStatus: candidate.translationStatus || null,
  };
}

const EXCLUDED_REASON_PRIORITY: DailyReportExcludedCandidate['reason'][] = [
  'translation_failed',
  'not_chinese',
  'fallback_scored',
  'webpage_snapshot',
  'business_noise',
  'not_selected',
];

export function summarizeDailyReportExcludedCandidates(
  excluded: DailyReportExcludedCandidate[],
  sampleLimit = 10,
): DailyReportExcludedCandidateSummary {
  const grouped = new Map<DailyReportExcludedCandidate['reason'], DailyReportExcludedCandidate[]>();
  for (const item of excluded) {
    const items = grouped.get(item.reason) || [];
    items.push(item);
    grouped.set(item.reason, items);
  }
  const reasons = [...grouped.keys()].sort((left, right) => {
    const leftRank = EXCLUDED_REASON_PRIORITY.indexOf(left);
    const rightRank = EXCLUDED_REASON_PRIORITY.indexOf(right);
    return (leftRank === -1 ? 99 : leftRank) - (rightRank === -1 ? 99 : rightRank);
  });
  return {
    total: excluded.length,
    byReason: reasons.map((reason) => {
      const items = grouped.get(reason) || [];
      return {
        reason,
        count: items.length,
        samples: items.slice(0, sampleLimit),
      };
    }),
  };
}

function toPreparedCandidate(
  candidate: DailyReportCandidateInput,
  scopeMatched: boolean,
  selectionMode: Exclude<DailyReportSelectionMode, 'empty'>,
  selectionReason: string,
  allowPendingTranslation = false,
): DailyReportPreparedCandidate | null {
  const reportSummary = resolveReportSummary(candidate);
  const chineseReady = isChineseEnough(reportSummary) || isChineseEnough(candidate.title);
  if (!chineseReady && !allowPendingTranslation) return null;
  return {
    ...candidate,
    displayTitle: candidate.title.trim(),
    category: normalizeDailyCategoryLabel(candidate),
    reportSummary: reportSummary || candidate.title.trim(),
    scopeMatched,
    selectionMode,
    selectionReason,
    reviewBucket: selectionMode === 'review' ? classifyDailyReportReviewBucket(candidate) : undefined,
    chineseReady,
  };
}

export function resolveDailyReportSourceLimit(
  readingTier: DailyReportCandidateInput['readingTier'],
  configuredLimit: number,
): number {
  const tierLimit = readingTier === 'high_value'
    ? 5
    : readingTier === 'light_reading'
      ? 2
      : readingTier === 'explore'
        ? 1
        : readingTier === 'paused'
          ? 0
          : configuredLimit;
  return Math.max(0, Math.min(configuredLimit, tierLimit));
}

function applyPerSourceLimit<T extends { sourceName: string; readingTier?: DailyReportCandidateInput['readingTier'] }>(
  items: T[],
  limit: number,
  options: { respectReadingTier?: boolean } = {},
): T[] {
  const counts = new Map<string, number>();
  const result: T[] = [];
  for (const item of items) {
    const key = item.sourceName || '未知来源';
    const current = counts.get(key) || 0;
    const itemLimit = options.respectReadingTier === false
      ? limit
      : resolveDailyReportSourceLimit(item.readingTier, limit);
    if (current >= itemLimit) continue;
    counts.set(key, current + 1);
    result.push(item);
  }
  return result;
}

export function enforceDailyReportSourceShare<T extends { sourceName: string }>(items: T[], maxShare = 0.35): T[] {
  if (items.length <= 1 || maxShare <= 0 || maxShare >= 1) return items;
  if (new Set(items.map((item) => item.sourceName || '未知来源')).size < 3) return items;
  let result = [...items];
  let previousLength = -1;
  while (result.length !== previousLength) {
    previousLength = result.length;
    const maxPerSource = Math.max(1, Math.floor(result.length * maxShare));
    const counts = new Map<string, number>();
    result = result.filter((item) => {
      const key = item.sourceName || '未知来源';
      const current = counts.get(key) || 0;
      if (current >= maxPerSource) return false;
      counts.set(key, current + 1);
      return true;
    });
  }
  return result;
}

function isAggregationDigestCandidate(candidate: Pick<DailyReportCandidateInput, 'title' | 'sourceName' | 'aiSummary'>): boolean {
  const title = String(candidate.title || '').trim();
  const sourceName = String(candidate.sourceName || '').trim();
  const summary = String(candidate.aiSummary || '').trim();
  return Boolean(
    /(?:\d{4}-\d{2}-\d{2}|今日|每日).{0,8}(?:日刊|日报|早报|晚报|Top Stories|热门)/i.test(title)
    || /Hacker News Top Stories/i.test(title)
    || /AI洞察日报|BestBlogs\.dev|RSS Feed/i.test(sourceName)
    || /汇总了多条|热门内容|今日信息汇总|日报包含/.test(summary),
  );
}

export function isWebpageSnapshotDailyCandidate(candidate: Pick<
  DailyReportCandidateInput,
  'title' | 'sourceName' | 'sourceType' | 'snippet' | 'aiSummary'
>): boolean {
  if (String(candidate.sourceType || '').toLowerCase() === 'webpage') return true;
  const text = [
    candidate.title || '',
    candidate.sourceName || '',
    candidate.snippet || '',
    candidate.aiSummary || '',
  ].join('\n');
  return /newsroom\s*(?:\\|\|)\s*anthropic/i.test(text)
    || (/\bpress\b|\bsupport\b|download\s+press\s+kit/i.test(text) && /newsroom|anthropic/i.test(text));
}

function hasDirectProductOrTechnicalSignal(candidate: Pick<DailyReportCandidateInput, 'title' | 'aiSummary' | 'category' | 'sourceName' | 'aiTags'>): boolean {
  const text = [
    candidate.title,
    candidate.aiSummary || '',
    candidate.category || '',
    candidate.sourceName || '',
    ...(candidate.aiTags || []),
  ].join('\n');
  const strongDirectSignal = /(开源|框架|SDK|API|Agent Studio|Claude|Codex|MCP|RAG|模型|大模型|芯片|算力|智能体|AI Agent|机器人|WebAssembly|WASM)/i.test(text);
  if (strongDirectSignal) return true;
  const launchVerb = /(推出|发布|上线|公测|集成|部署|新品)/i.test(text);
  const technicalContext = /(AI|人工智能|Agent|智能体|模型|芯片|算力|API|SDK|平台|工具|软件|算法|开发者|云|自动驾驶|硬件|WebAssembly|WASM)/i.test(text);
  return launchVerb && technicalContext;
}

function sourceTierRank(tier?: string | null): number {
  const normalized = String(tier || '').toUpperCase();
  if (normalized === 'S') return 12;
  if (normalized === 'A') return 8;
  if (normalized === 'B') return 4;
  if (normalized === 'C') return -4;
  if (normalized === 'D') return -8;
  return 0;
}

function rankDailyReportCandidate(candidate: DailyReportPreparedCandidate): number {
  const base = candidate.aiScore ?? 0;
  const aggregationPenalty = isAggregationDigestCandidate(candidate) ? 30 : 0;
  const directSignalBoost = hasDirectProductOrTechnicalSignal(candidate) ? 8 : 0;
  const categoryPenalty = /浅阅读|扫读|Blog/i.test(candidate.category || '') ? 4 : 0;
  const modeBoost = candidate.selectionMode === 'scored'
    ? 6
    : candidate.selectionMode === 'review'
      ? 2
      : -8;
  return base + sourceTierRank(candidate.sourceTier) + directSignalBoost + modeBoost - aggregationPenalty - categoryPenalty;
}

function sortDailyReportCandidates(items: DailyReportPreparedCandidate[]): DailyReportPreparedCandidate[] {
  return [...items].sort((left, right) => {
    const rankDiff = rankDailyReportCandidate(right) - rankDailyReportCandidate(left);
    if (rankDiff !== 0) return rankDiff;
    const scoreDiff = (right.aiScore ?? 0) - (left.aiScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return String(right.fetchedAt || '').localeCompare(String(left.fetchedAt || ''));
  });
}

function applyAggregationDigestLimit(items: DailyReportPreparedCandidate[], maxAggregationDigests = 2): DailyReportPreparedCandidate[] {
  let aggregationCount = 0;
  const result: DailyReportPreparedCandidate[] = [];
  for (const item of items) {
    if (isAggregationDigestCandidate(item)) {
      if (aggregationCount >= maxAggregationDigests) continue;
      aggregationCount += 1;
    }
    result.push(item);
  }
  return result;
}

function dailyReportEventKey(candidate: Pick<DailyReportCandidateInput, 'title' | 'aiSummary' | 'aiTranslation' | 'aiTags' | 'clusterId'>): string | null {
  // Persisted event identity must win over historical keyword shortcuts.
  if (candidate.clusterId) return candidate.clusterId;
  const text = [
    candidate.title,
    candidate.aiSummary || '',
    candidate.aiTranslation || '',
    ...(candidate.aiTags || []),
  ].join('\n').toLowerCase();

  // Compatibility for unclustered historical release rows only, never all
  // articles mentioning Mythos, manufacturing, or a company name.
  if (/claude/i.test(candidate.title) && /(?:opus\s*)?4[\s.]*8\b/i.test(candidate.title)
    && /发布|登场|炸场|release|launch/i.test(text)) return 'claude:4.8:release';

  return candidate.clusterId || null;
}

function applyDailyReportEventDedupe(items: DailyReportPreparedCandidate[]): DailyReportPreparedCandidate[] {
  const seen = new Set<string>();
  const result: DailyReportPreparedCandidate[] = [];
  for (const item of items) {
    const key = dailyReportEventKey(item);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    result.push(item);
  }
  return result;
}

function buildSelectionReason(
  candidate: DailyReportCandidateInput,
  _config: DailyReportWorkflowConfig,
  mode: Exclude<DailyReportSelectionMode, 'empty'>,
  baseReason: string,
): string {
  const details: string[] = [];
  const categoryLabel = normalizeDailyCategoryLabel(candidate);
  if (categoryLabel) details.push(categoryLabel);
  if (candidate.sourceTier) details.push(`${candidate.sourceTier} 来源`);
  const tags = (candidate.aiTags || []).slice(0, 2).filter(Boolean);
  if (tags.length > 0) details.push(tags.join('/'));
  if (hasDirectProductOrTechnicalSignal(candidate)) details.push('具备产品、技术或产业直接增量');
  if (isAggregationDigestCandidate(candidate)) details.push('聚合源已降权，仅保留高价值线索');

  if (mode === 'scored') {
    return [`高价值信号明确（评分 ${candidate.aiScore ?? 0}）`, ...details].join('；') + '。';
  }
  if (mode === 'review') {
    return [baseReason.replace(/[。.]$/, ''), ...details].join('；') + '。';
  }
  return ['候选不足时作为同范围最新线索补齐', ...details].join('；') + '。';
}

async function ensureChineseCandidate(
  candidate: DailyReportCandidateInput,
  config: DailyReportWorkflowConfig,
  options: PrepareDailyReportCandidateOptions,
): Promise<{
  candidate: DailyReportCandidateInput;
  pending: boolean;
  failed: boolean;
  policySkipped: boolean;
}> {
  if (!config.requireChinese || !needsChineseMaterial(candidate)) {
    return { candidate, pending: false, failed: false, policySkipped: false };
  }
  if (isChineseEnough(candidate.aiTranslation) || isChineseEnough(candidate.aiSummary)) {
    return { candidate, pending: false, failed: false, policySkipped: false };
  }

  const pending = candidate.translationStatus !== 'ready';
  if (!options.translateItem) {
    return {
      candidate,
      pending,
      failed: !options.allowPendingTranslationCandidates,
      policySkipped: false,
    };
  }

  const update = await options.translateItem(candidate);
  const next = sanitizeDailyReportTranslation({ ...candidate, ...(update || {}) });
  const ready = isChineseEnough(resolveReportSummary(next)) || isChineseEnough(next.title);
  const policySkipped = !ready
    && next.translationStatus === 'skipped'
    && /未能识别为外文|原文已是中文|监控档位默认不做翻译|AI 评分过低|轻处理档位仅翻译高分内容|未进入翻译/.test(
      next.translationReason || '',
    );
  return {
    candidate: next,
    pending: policySkipped ? false : pending,
    failed: !ready && !policySkipped && next.translationStatus !== 'pending',
    policySkipped,
  };
}

export async function prepareDailyReportCandidates(
  inputItems: DailyReportCandidateInput[],
  workflowInput?: unknown,
  options: PrepareDailyReportCandidateOptions = {},
): Promise<DailyReportCandidatePreparation> {
  const config = normalizeDailyReportWorkflowConfig(workflowInput);
  const hasSourceScope = (config.scope.sourceIds || []).length > 0 || (config.scope.sourceNames || []).length > 0;
  const scopedCandidates: DailyReportPreparedCandidate[] = [];
  const scoredCandidates: DailyReportPreparedCandidate[] = [];
  const reviewCandidates: DailyReportPreparedCandidate[] = [];
  const latestFallbackCandidates: DailyReportPreparedCandidate[] = [];
  const excluded: DailyReportExcludedCandidate[] = [];
  let translationPending = 0;
  let translationFailed = 0;
  let softFilteredRecovered = 0;
  let scoreFailedCandidates = 0;
  let fallbackScoredCandidates = 0;
  let scopeMatchedCount = 0;

  for (const inputCandidate of inputItems) {
    const rawCandidate = sanitizeDailyReportTranslation(inputCandidate);
    const scopeMatched = itemMatchesDailyScope(rawCandidate, config);
    if (hasSourceScope && !scopeMatched) continue;

    if (isWebpageSnapshotDailyCandidate(rawCandidate)) {
      excluded.push(buildExcludedCandidate(rawCandidate, 'webpage_snapshot', '网页监控快照只进入覆盖诊断，不进入正式日报主线；请改用索引源或单篇正文源。'));
      continue;
    }

    const softScoreFiltered = isSoftScoreFilteredCandidate(rawCandidate);
    const scoreFailed = isScoreFailedCandidate(rawCandidate);
    const fallbackScored = isFallbackScoredCandidate(rawCandidate);
    const reviewBucket = classifyDailyReportReviewBucket(rawCandidate);
    const businessNoise = reviewBucket === 'business_noise_review';
    const highScoreBusinessNoise = businessNoise && (rawCandidate.aiScore ?? 0) >= config.minScore;
    const canEnterScored = scopeMatched && !businessNoise && !fallbackScored && (rawCandidate.aiScore ?? 0) >= config.minScore;
    const canEnterReview = scopeMatched && !businessNoise && (softScoreFiltered || scoreFailed || fallbackScored);
    const canEnterFallback = config.enableLatestFallback && scopeMatched && !businessNoise;
    if (scopeMatched) scopeMatchedCount += 1;
    if (softScoreFiltered) softFilteredRecovered += 1;
    if (scoreFailed) scoreFailedCandidates += 1;
    if (fallbackScored) fallbackScoredCandidates += 1;

    if (businessNoise && (softScoreFiltered || scoreFailed || fallbackScored || scopeMatched || highScoreBusinessNoise)) {
      excluded.push(buildExcludedCandidate(rawCandidate, 'business_noise', '泛商业、行情或公告类内容不进入日报复核/兜底候选'));
      continue;
    }

    if (!canEnterScored && !canEnterReview && !canEnterFallback) {
      excluded.push(buildExcludedCandidate(rawCandidate, 'not_selected', '未达到精选分且未启用最新兜底'));
      continue;
    }

    const {
      candidate,
      pending,
      failed,
      policySkipped,
    } = await ensureChineseCandidate(rawCandidate, config, options);
    if (pending) translationPending += 1;
    if (policySkipped) {
      excluded.push(buildExcludedCandidate(
        candidate,
        'not_selected',
        candidate.translationReason || '当前条目不满足自动翻译策略',
      ));
      continue;
    }
    if (failed) {
      translationFailed += 1;
      excluded.push(buildExcludedCandidate(candidate, 'translation_failed', candidate.translationReason || '英文内容未能在入报前完成中文化'));
      continue;
    }
    if (pending && candidate.translationStatus === 'pending'
      && !isChineseEnough(resolveReportSummary(candidate)) && !isChineseEnough(candidate.title)
      && !options.allowPendingTranslationCandidates) {
      excluded.push(buildExcludedCandidate(candidate, 'not_selected', candidate.translationReason || '中文化任务仍在排队或处理中'));
      continue;
    }

    const scopedPreparedMode: Exclude<DailyReportSelectionMode, 'empty'> = fallbackScored || softScoreFiltered || scoreFailed ? 'review' : 'scored';
    const scopedPrepared = scopeMatched && !businessNoise
      ? toPreparedCandidate(
        candidate,
        true,
        scopedPreparedMode,
        scopedPreparedMode === 'review'
          ? '匹配日报范围，但评分状态需要复核。'
          : `达到精选分阈值 ${config.minScore}，且匹配日报范围。`,
        options.allowPendingTranslationCandidates,
      )
      : null;
    if (scopedPrepared) scopedCandidates.push(scopedPrepared);

    if (canEnterScored) {
      const scored = toPreparedCandidate(
        candidate,
        true,
        'scored',
        buildSelectionReason(candidate, config, 'scored', ''),
        options.allowPendingTranslationCandidates,
      );
      if (scored) scoredCandidates.push(scored);
      else excluded.push(buildExcludedCandidate(candidate, 'not_chinese', '缺少可用中文标题或摘要'));
      continue;
    }

    if (canEnterReview) {
      const review = toPreparedCandidate(
        candidate,
        true,
        'review',
        buildSelectionReason(candidate, config, 'review', fallbackScored
          ? `低置信兜底评分待复核：${fallbackScoreRiskFlags(candidate).join('/')}，不作为高分精选。`
          : softScoreFiltered
            ? `低分复核：${candidate.filterReason || '低于精选分'}，不再作为硬垃圾过滤。`
            : '评分失败待复核：AI 评分链路未产出可靠分数，先保留为日报候选。'),
        options.allowPendingTranslationCandidates,
      );
      if (review) reviewCandidates.push(review);
      else excluded.push(buildExcludedCandidate(candidate, 'not_chinese', '缺少可用中文标题或摘要'));
      continue;
    }

    if (canEnterFallback) {
      const fallback = toPreparedCandidate(
        candidate,
        scopeMatched,
        'latest_visible',
        buildSelectionReason(candidate, config, 'latest_visible', ''),
        options.allowPendingTranslationCandidates,
      );
      if (fallback) latestFallbackCandidates.push(fallback);
      else excluded.push(buildExcludedCandidate(candidate, 'not_chinese', '缺少可用中文标题或摘要'));
    }
  }

  const perSourceOptions = { respectReadingTier: !hasSourceScope };
  const limitedScored = applyAggregationDigestLimit(applyPerSourceLimit(applyDailyReportEventDedupe(sortDailyReportCandidates(scoredCandidates)), config.perSourceLimit, perSourceOptions)).slice(0, config.topN);
  const limitedReview = applyAggregationDigestLimit(applyPerSourceLimit(applyDailyReportEventDedupe(sortDailyReportCandidates(reviewCandidates)), config.perSourceLimit, perSourceOptions)).slice(0, config.topN);
  const latestCandidates = applyAggregationDigestLimit(applyPerSourceLimit(applyDailyReportEventDedupe(sortDailyReportCandidates(latestFallbackCandidates)), config.perSourceLimit, perSourceOptions)).slice(0, config.topN);
  const trustedReview = limitedReview.filter((candidate) => !isFallbackScoredCandidate(candidate));
  const fallbackReviewPool = limitedReview.filter((candidate) => isFallbackScoredCandidate(candidate));
  const sourceScopedReviewCandidates = hasSourceScope && limitedScored.length === 0 && limitedReview.length > 0
    ? limitedReview
    : [];
  const fallbackReviewThreshold = Math.min(
    10,
    Math.max(3, Math.min(Math.ceil(config.topN / 2), Math.ceil(scopeMatchedCount / 2))),
  );
  const substantialFallbackReviewPool = fallbackReviewPool.length >= fallbackReviewThreshold;
  const fallbackReviewCandidates = limitedScored.length === 0
    && sourceScopedReviewCandidates.length === 0
    && trustedReview.length === 0
    && substantialFallbackReviewPool
    ? fallbackReviewPool
    : [];
  const minimumFinalEvidence = Math.min(config.topN, hasSourceScope ? 3 : 5);
  const recoveryEvidenceTarget = Math.min(config.topN, hasSourceScope ? 3 : 10);
  const recoveryReviewPool = [
    ...trustedReview,
    ...(substantialFallbackReviewPool ? fallbackReviewPool : []),
  ];
  const reviewSupplementCandidates = limitedScored.length > 0
    && limitedScored.length < minimumFinalEvidence
    ? recoveryReviewPool.slice(0, Math.max(0, recoveryEvidenceTarget - limitedScored.length))
    : [];
  const selectedReviewIds = new Set([
    ...sourceScopedReviewCandidates.map((candidate) => candidate.id),
    ...fallbackReviewCandidates.map((candidate) => candidate.id),
    ...reviewSupplementCandidates.map((candidate) => candidate.id),
  ]);
  for (const candidate of limitedReview) {
    if (isFallbackScoredCandidate(candidate) && !selectedReviewIds.has(candidate.id)) {
      excluded.push(buildExcludedCandidate(candidate, 'fallback_scored', '低置信兜底评分只进入复核诊断，不进入最终日报候选；请先回收评分。'));
    }
  }
  const preliminaryFinalCandidates = limitedScored.length > 0
    ? [...limitedScored, ...reviewSupplementCandidates]
    : sourceScopedReviewCandidates.length > 0
      ? sourceScopedReviewCandidates
    : trustedReview.length > 0
      ? trustedReview
      : fallbackReviewCandidates.length > 0
        ? fallbackReviewCandidates
        : latestCandidates;
  const finalCandidates = hasSourceScope
    ? preliminaryFinalCandidates
    : enforceDailyReportSourceShare(preliminaryFinalCandidates, 0.35);
  const selectionMode: DailyReportSelectionMode = finalCandidates.length === 0
    ? 'empty'
    : limitedScored.length > 0 && reviewSupplementCandidates.length === 0
      ? 'scored'
    : sourceScopedReviewCandidates.length > 0
        || trustedReview.length > 0
        || fallbackReviewCandidates.length > 0
        || reviewSupplementCandidates.length > 0
        ? 'review'
        : 'latest_visible';

  return {
    config,
    selectionMode,
    funnel: {
      todayNew: inputItems.length,
      mainVisible: inputItems.length,
      scopeMatched: scopeMatchedCount,
      scoredCandidates: limitedScored.length,
      reviewCandidates: limitedReview.length,
      fallbackScoredCandidates,
      softFilteredRecovered,
      scoreFailedCandidates,
      latestFallbackCandidates: latestFallbackCandidates.length,
      translationPending,
      translationFailed,
      finalCandidates: finalCandidates.length,
    },
    scopedCandidates,
    scoredCandidates: limitedScored,
    reviewCandidates: limitedReview,
    latestFallbackCandidates,
    finalCandidates,
    excluded,
  };
}
