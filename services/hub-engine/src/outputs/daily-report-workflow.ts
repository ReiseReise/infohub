export type DailyReportSelectionMode = 'scored' | 'review' | 'latest_visible' | 'empty';

export type DailyReportWorkflowConfig = {
  topN: number;
  minScore: number;
  enableLatestFallback: boolean;
  perSourceLimit: number;
  requireChinese: boolean;
  scope: {
    categories: string[];
    keywords: string[];
    sourceTiers: string[];
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
  title: string;
  url: string;
  aiScore: number | null;
  aiSummary: string | null;
  aiTranslation?: string | null;
  language?: string | null;
  translationStatus?: string | null;
  translationReason?: string | null;
  sourceName: string;
  category: string;
  sourceType?: string | null;
  sourceTier?: string | null;
  sourceKind?: string | null;
  isFiltered?: boolean | null;
  filterBucket?: string | null;
  filterReason?: string | null;
  qualityDecision?: string | null;
  processingStatus?: string | null;
  publishedAt?: string | null;
  fetchedAt?: string | null;
  aiTags?: string[];
};

export type DailyReportPreparedCandidate = DailyReportCandidateInput & {
  displayTitle: string;
  reportSummary: string;
  selectionReason: string;
  selectionMode: Exclude<DailyReportSelectionMode, 'empty'>;
  scopeMatched: boolean;
  chineseReady: boolean;
};

export type DailyReportCandidateFunnel = {
  todayNew: number;
  mainVisible: number;
  scopeMatched: number;
  scoredCandidates: number;
  reviewCandidates: number;
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
  reason: 'translation_failed' | 'not_chinese' | 'not_selected';
  detail?: string | null;
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
};

export const DEFAULT_DAILY_REPORT_WORKFLOW: DailyReportWorkflowConfig = {
  topN: 18,
  minScore: 55,
  enableLatestFallback: true,
  perSourceLimit: 4,
  requireChinese: true,
  scope: {
    categories: ['AI', 'tech', 'tech-cn', 'App&效率工具', 'Product Changelog', 'News', '研报&数据'],
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
      '商业',
      '融资',
      '监管',
      '科技',
      '工具',
    ],
    sourceTiers: ['T1', 'T1.5', 'T2', 'S', 'A'],
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

export function normalizeDailyReportWorkflowConfig(input?: unknown): DailyReportWorkflowConfig {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const rawScope = raw.scope && typeof raw.scope === 'object' ? raw.scope as Record<string, unknown> : {};
  return {
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
      sourceTiers: normalizeStringArray(rawScope.sourceTiers, DEFAULT_DAILY_REPORT_WORKFLOW.scope.sourceTiers),
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

function needsChineseMaterial(candidate: DailyReportCandidateInput): boolean {
  if (candidate.language && candidate.language !== 'zh') return true;
  const combined = `${candidate.title}\n${candidate.aiSummary || ''}`;
  const han = countMatches(combined, /[\u4e00-\u9fff]/g);
  const latin = countMatches(combined, /[A-Za-z]/g);
  return latin >= 30 && han < 12;
}

function resolveReportSummary(candidate: DailyReportCandidateInput): string {
  if (isChineseEnough(candidate.aiTranslation)) return candidate.aiTranslation!.trim();
  if (isChineseEnough(candidate.aiSummary)) return candidate.aiSummary!.trim();
  if (isChineseEnough(candidate.title)) return candidate.aiSummary?.trim() || candidate.title.trim();
  return '';
}

function itemMatchesDailyScope(candidate: DailyReportCandidateInput, config: DailyReportWorkflowConfig): boolean {
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

function toPreparedCandidate(
  candidate: DailyReportCandidateInput,
  scopeMatched: boolean,
  selectionMode: Exclude<DailyReportSelectionMode, 'empty'>,
  selectionReason: string,
): DailyReportPreparedCandidate | null {
  const reportSummary = resolveReportSummary(candidate);
  const chineseReady = isChineseEnough(reportSummary) || isChineseEnough(candidate.title);
  if (!chineseReady) return null;
  return {
    ...candidate,
    displayTitle: candidate.title.trim(),
    reportSummary: reportSummary || candidate.title.trim(),
    scopeMatched,
    selectionMode,
    selectionReason,
    chineseReady,
  };
}

function applyPerSourceLimit<T extends { sourceName: string }>(items: T[], limit: number): T[] {
  const counts = new Map<string, number>();
  const result: T[] = [];
  for (const item of items) {
    const key = item.sourceName || '未知来源';
    const current = counts.get(key) || 0;
    if (current >= limit) continue;
    counts.set(key, current + 1);
    result.push(item);
  }
  return result;
}

async function ensureChineseCandidate(
  candidate: DailyReportCandidateInput,
  config: DailyReportWorkflowConfig,
  options: PrepareDailyReportCandidateOptions,
): Promise<{ candidate: DailyReportCandidateInput; pending: boolean; failed: boolean }> {
  if (!config.requireChinese || !needsChineseMaterial(candidate)) {
    return { candidate, pending: false, failed: false };
  }
  if (isChineseEnough(candidate.aiTranslation) || isChineseEnough(candidate.aiSummary)) {
    return { candidate, pending: false, failed: false };
  }

  const pending = candidate.translationStatus !== 'ready';
  if (!options.translateItem) {
    return { candidate, pending, failed: true };
  }

  const update = await options.translateItem(candidate);
  const next = { ...candidate, ...(update || {}) };
  const ready = next.translationStatus === 'ready' && isChineseEnough(next.aiTranslation);
  return { candidate: next, pending, failed: !ready };
}

export async function prepareDailyReportCandidates(
  inputItems: DailyReportCandidateInput[],
  workflowInput?: unknown,
  options: PrepareDailyReportCandidateOptions = {},
): Promise<DailyReportCandidatePreparation> {
  const config = normalizeDailyReportWorkflowConfig(workflowInput);
  const scopedCandidates: DailyReportPreparedCandidate[] = [];
  const scoredCandidates: DailyReportPreparedCandidate[] = [];
  const reviewCandidates: DailyReportPreparedCandidate[] = [];
  const latestFallbackCandidates: DailyReportPreparedCandidate[] = [];
  const excluded: DailyReportExcludedCandidate[] = [];
  let translationPending = 0;
  let translationFailed = 0;
  let softFilteredRecovered = 0;
  let scoreFailedCandidates = 0;

  for (const rawCandidate of inputItems) {
    const scopeMatched = itemMatchesDailyScope(rawCandidate, config);
    const softScoreFiltered = isSoftScoreFilteredCandidate(rawCandidate);
    const scoreFailed = isScoreFailedCandidate(rawCandidate);
    if (softScoreFiltered) softFilteredRecovered += 1;
    if (scoreFailed) scoreFailedCandidates += 1;
    const { candidate, pending, failed } = await ensureChineseCandidate(rawCandidate, config, options);
    if (pending) translationPending += 1;
    if (failed) {
      translationFailed += 1;
      excluded.push({
        id: rawCandidate.id,
        title: rawCandidate.title,
        reason: 'translation_failed',
        detail: candidate.translationReason || '英文内容未能在入报前完成中文化',
      });
      continue;
    }

    const scopedPrepared = scopeMatched
      ? toPreparedCandidate(candidate, true, 'scored', `达到精选分阈值 ${config.minScore}，且匹配日报范围。`)
      : null;
    if (scopedPrepared) scopedCandidates.push(scopedPrepared);

    if (scopeMatched && (candidate.aiScore ?? 0) >= config.minScore) {
      const scored = toPreparedCandidate(candidate, true, 'scored', `达到精选分 ${candidate.aiScore ?? 0} >= ${config.minScore}。`);
      if (scored) scoredCandidates.push(scored);
      else excluded.push({ id: candidate.id, title: candidate.title, reason: 'not_chinese', detail: '缺少可用中文标题或摘要' });
      continue;
    }

    if (scopeMatched && (softScoreFiltered || scoreFailed)) {
      const review = toPreparedCandidate(
        candidate,
        true,
        'review',
        softScoreFiltered
          ? `低分复核：${candidate.filterReason || '低于精选分'}，不再作为硬垃圾过滤。`
          : '评分失败待复核：AI 评分链路未产出可靠分数，先保留为日报候选。',
      );
      if (review) reviewCandidates.push(review);
      else excluded.push({ id: candidate.id, title: candidate.title, reason: 'not_chinese', detail: '缺少可用中文标题或摘要' });
      continue;
    }

    if (config.enableLatestFallback) {
      const fallback = toPreparedCandidate(
        candidate,
        scopeMatched,
        'latest_visible',
        scopeMatched
          ? `未达到精选分 ${config.minScore}，作为同范围最新兜底入报。`
          : '未匹配日报默认范围，作为最新兜底入报。',
      );
      if (fallback) latestFallbackCandidates.push(fallback);
      else excluded.push({ id: candidate.id, title: candidate.title, reason: 'not_chinese', detail: '缺少可用中文标题或摘要' });
    } else {
      excluded.push({ id: candidate.id, title: candidate.title, reason: 'not_selected', detail: '未达到精选分且未启用最新兜底' });
    }
  }

  const limitedScored = applyPerSourceLimit(scoredCandidates, config.perSourceLimit).slice(0, config.topN);
  const limitedReview = applyPerSourceLimit(reviewCandidates, config.perSourceLimit).slice(0, config.topN);
  const finalCandidates = limitedScored.length > 0
    ? limitedScored
    : limitedReview.length > 0
      ? limitedReview
      : applyPerSourceLimit(latestFallbackCandidates, config.perSourceLimit).slice(0, config.topN);
  const selectionMode: DailyReportSelectionMode = finalCandidates.length === 0
    ? 'empty'
    : limitedScored.length > 0
      ? 'scored'
      : limitedReview.length > 0
        ? 'review'
        : 'latest_visible';

  return {
    config,
    selectionMode,
    funnel: {
      todayNew: inputItems.length,
      mainVisible: inputItems.length,
      scopeMatched: scopedCandidates.length,
      scoredCandidates: limitedScored.length,
      reviewCandidates: limitedReview.length,
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
