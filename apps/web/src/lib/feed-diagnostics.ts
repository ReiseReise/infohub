export type FeedQualityDecisionInput = {
  qualityDecision?: string | null;
  qualityScore?: number | null;
  qualityCheckedAt?: string | null;
  qualityReason?: string | null;
};

export type FeedReprocessStage = 'content' | 'quality' | 'scoring' | 'summary' | 'translation' | 'all';
export type FeedReprocessActionKind = FeedReprocessStage | 'full-ai';

export type NoticeTone = 'success' | 'warning' | 'danger';

export type FeedReprocessActionInput = {
  summaryStatus?: string | null;
  summaryReason?: string | null;
  translationStatus?: string | null;
  translationReason?: string | null;
};

export type ReprocessStageActionState = {
  disabled: boolean;
  reason: string | null;
};

export type ReprocessBatchResultInput = {
  matched?: number | null;
  content?: number | null;
  quality?: number | null;
  scored?: number | null;
  summarized?: number | null;
  translated?: number | null;
  skipped?: {
    quality?: number | null;
    scoring?: number | null;
    summary?: number | null;
    translation?: number | null;
  } | null;
  errors?: Record<string, string[] | undefined> | null;
};

export type ReprocessStageNotice = {
  message: string;
  tone: NoticeTone;
};

export type EnrichScoreRefreshInput = {
  scored?: number | null;
};

export type ScoreBreakdownDiagnosticInput = {
  aiScore?: number | null;
  breakdowns?: Array<{
    score?: number | null;
    confidence?: number | null;
    riskFlags?: string[] | null;
  }> | null;
};

export type ScoreBreakdownDiagnostic = {
  kind: 'skill_breakdown' | 'fallback_score' | 'legacy_single_score' | 'missing_score';
  title: string;
  description: string;
  tone: 'ok' | 'warning' | 'danger' | 'neutral';
  riskFlags: string[];
};

export type FeedDetailSectionKey = 'summary' | 'original' | 'translation' | 'transcript' | 'knowledge';

export type FeedDetailEmptyInput = {
  contentStatus?: string | null;
  contentError?: string | null;
  blockedReason?: string | null;
  summaryStatus?: string | null;
  summaryReason?: string | null;
  translationStatus?: string | null;
  translationReason?: string | null;
  filterReason?: string | null;
};

export type FeedDetailEmptyState = {
  title: string;
  reason: string;
  action: string;
  tone: 'neutral' | 'warning' | 'danger';
};

const FALLBACK_SCORE_FLAG_LABELS: Record<string, string> = {
  deterministic_fallback: '确定性兜底',
  model_circuit_breaker: '模型熔断',
  ai_scoring_unavailable: '评分模型不可用',
};

const FALLBACK_SCORE_FLAGS = new Set(Object.keys(FALLBACK_SCORE_FLAG_LABELS));

const REPROCESS_STAGE_LABELS: Record<FeedReprocessStage, string> = {
  content: '正文',
  quality: '质检',
  scoring: '评分',
  summary: '摘要',
  translation: '翻译',
  all: '全链路',
};

function stageProcessedCount(stage: FeedReprocessStage, result: ReprocessBatchResultInput): number {
  if (stage === 'content') return Number(result.content || 0);
  if (stage === 'quality') return Number(result.quality || 0);
  if (stage === 'scoring') return Number(result.scored || 0);
  if (stage === 'summary') return Number(result.summarized || 0);
  if (stage === 'translation') return Number(result.translated || 0);
  return Number(result.content || 0)
    + Number(result.quality || 0)
    + Number(result.scored || 0)
    + Number(result.summarized || 0)
    + Number(result.translated || 0);
}

function stageSkippedCount(stage: FeedReprocessStage, result: ReprocessBatchResultInput): number {
  const skipped = result.skipped || {};
  if (stage === 'quality') return Number(skipped.quality || 0);
  if (stage === 'scoring') return Number(skipped.scoring || 0);
  if (stage === 'summary') return Number(skipped.summary || 0);
  if (stage === 'translation') return Number(skipped.translation || 0);
  if (stage === 'all') {
    return Number(skipped.quality || 0)
      + Number(skipped.scoring || 0)
      + Number(skipped.summary || 0)
      + Number(skipped.translation || 0);
  }
  return 0;
}

function flattenErrors(errors?: ReprocessBatchResultInput['errors']): string[] {
  return Object.values(errors || {}).flatMap((entries) => entries || []).filter(Boolean);
}

export function hasQualityCheckEvidence(item?: FeedQualityDecisionInput | null) {
  return Boolean(item?.qualityCheckedAt || item?.qualityScore != null || item?.qualityReason);
}

export function qualityDecisionLabel(item?: FeedQualityDecisionInput | null) {
  switch (item?.qualityDecision) {
    case 'pass':
      return hasQualityCheckEvidence(item) ? '质检通过' : '规则通过（未做 AI 质检）';
    case 'review':
      return '进入复核';
    case 'filter':
      return '质检过滤';
    default:
      return '等待质检';
  }
}

export function buildReprocessStageNotice(
  stage: FeedReprocessStage,
  result: ReprocessBatchResultInput,
): ReprocessStageNotice {
  const label = REPROCESS_STAGE_LABELS[stage];
  const matched = Number(result.matched || 0);
  const processed = stageProcessedCount(stage, result);
  const skipped = stageSkippedCount(stage, result);
  const errors = flattenErrors(result.errors);
  const detail = `命中 ${matched}，正文 ${Number(result.content || 0)}，质检 ${Number(result.quality || 0)}，评分 ${Number(result.scored || 0)}，摘要 ${Number(result.summarized || 0)}，翻译 ${Number(result.translated || 0)}`;

  if (matched <= 0) {
    return {
      message: `${label}修复未执行：没有命中可修复条目。`,
      tone: 'warning',
    };
  }

  if (processed <= 0 && errors.length > 0) {
    return {
      message: `${label}修复失败：${errors.slice(0, 2).join('；')}`,
      tone: 'danger',
    };
  }

  if (processed <= 0 && skipped > 0) {
    return {
      message: `${label}修复未产生新结果：${skipped} 条按策略跳过。${detail}`,
      tone: 'warning',
    };
  }

  if (processed <= 0) {
    return {
      message: `${label}修复未产生新结果：请查看当前状态和诊断原因。${detail}`,
      tone: 'warning',
    };
  }

  if (errors.length > 0) {
    return {
      message: `${label}修复部分完成：${detail}；错误：${errors.slice(0, 2).join('；')}`,
      tone: 'warning',
    };
  }

  return {
    message: `${label}修复完成：${detail}`,
    tone: 'success',
  };
}

export function shouldRefreshScoreBreakdownAfterReprocess(action: FeedReprocessActionKind): boolean {
  return action === 'full-ai' || action === 'scoring' || action === 'all';
}

export function shouldRefreshScoreBreakdownAfterEnrich(result?: EnrichScoreRefreshInput | null): boolean {
  return Number(result?.scored || 0) > 0;
}

export function getReprocessStageActionState(
  stage: FeedReprocessStage,
  item?: FeedReprocessActionInput | null,
): ReprocessStageActionState {
  if (stage === 'summary' && item?.summaryStatus === 'skipped') {
    return {
      disabled: true,
      reason: item.summaryReason || '摘要已按策略跳过',
    };
  }
  if (stage === 'translation' && item?.translationStatus === 'skipped') {
    return {
      disabled: true,
      reason: item.translationReason || '翻译已按策略跳过',
    };
  }
  return {
    disabled: false,
    reason: null,
  };
}

export function getDetailEmptyState(
  section: FeedDetailSectionKey,
  item?: FeedDetailEmptyInput | null,
): FeedDetailEmptyState {
  if (section === 'summary') {
    if (item?.summaryStatus === 'skipped') {
      return {
        title: '摘要按策略跳过',
        reason: item.summaryReason || item.filterReason || '当前条目未达到摘要生成策略。',
        action: '建议先重跑评分；如果分数恢复，再点击“重跑摘要”。',
        tone: 'warning',
      };
    }
    if (item?.summaryStatus === 'failed') {
      return {
        title: '摘要生成失败',
        reason: item.summaryReason || '摘要模型没有返回可用结果。',
        action: '点击阶段修复里的“重跑摘要”；如果连续失败，检查摘要模型配置。',
        tone: 'danger',
      };
    }
    return {
      title: '等待摘要',
      reason: item?.filterReason || '当前还没有摘要结果。',
      action: '可点击阶段修复里的“重跑摘要”，或先补正文后再生成摘要。',
      tone: 'neutral',
    };
  }

  if (section === 'original') {
    if (item?.contentStatus === 'failed') {
      return {
        title: '正文抓取失败',
        reason: item.contentError || item.blockedReason || '正文抓取没有返回可读内容。',
        action: '点击“补正文”重新抓取；如果仍失败，打开原文确认是否需要登录或被站点阻断。',
        tone: 'danger',
      };
    }
    if (item?.blockedReason) {
      return {
        title: '正文被阻断',
        reason: item.blockedReason,
        action: '打开原文确认访问条件，必要时改用登录态抓取模板。',
        tone: 'warning',
      };
    }
    return {
      title: '正文缺失',
      reason: item?.contentError || '当前没有缓存正文或可读片段。',
      action: '点击“补正文”重新抓取正文。',
      tone: 'neutral',
    };
  }

  if (section === 'translation') {
    if (item?.translationStatus === 'skipped') {
      return {
        title: '翻译按策略跳过',
        reason: item.translationReason || '当前条目不需要翻译。',
        action: '如果原文已经是中文，无需翻译；如判断错误，可先重跑摘要/正文识别后再重跑翻译。',
        tone: 'warning',
      };
    }
    if (item?.translationStatus === 'failed') {
      return {
        title: '翻译失败',
        reason: item.translationReason || '翻译模型没有返回可用结果。',
        action: '点击阶段修复里的“重跑翻译”；如果连续失败，检查翻译模型配置。',
        tone: 'danger',
      };
    }
    return {
      title: '等待翻译',
      reason: item?.translationReason || '当前还没有翻译结果。',
      action: '可点击阶段修复里的“重跑翻译”。',
      tone: 'neutral',
    };
  }

  if (section === 'transcript') {
    return {
      title: '暂无转写',
      reason: '当前条目还没有音频转写结果。',
      action: '如果这是音频内容，可使用“播客转写”创建转写任务。',
      tone: 'neutral',
    };
  }

  return {
    title: '暂无知识提炼',
    reason: '当前条目还没有知识提炼结果。',
    action: '等待摘要和正文可用后，再进入知识提炼流程。',
    tone: 'neutral',
  };
}

export function getScoreBreakdownDiagnostic(input?: ScoreBreakdownDiagnosticInput | null): ScoreBreakdownDiagnostic {
  const breakdowns = input?.breakdowns || [];
  const riskFlags = [...new Set(
    breakdowns.flatMap((entry) => entry.riskFlags || []).filter((flag) => FALLBACK_SCORE_FLAGS.has(flag)),
  )];

  if (riskFlags.length > 0) {
    const labels = riskFlags.map((flag) => FALLBACK_SCORE_FLAG_LABELS[flag] || flag);
    return {
      kind: 'fallback_score',
      title: '低置信评分',
      description: `当前总分来自兜底链路或模型熔断结果，不能等同于真实 Skill 评分。标记：${labels.join(' / ')}`,
      tone: 'danger',
      riskFlags,
    };
  }

  if (breakdowns.length > 0) {
    return {
      kind: 'skill_breakdown',
      title: 'Skill 评分已拆解',
      description: '当前总分有评分技能拆解依据，可查看各 Skill 的分数、置信度、理由和风险标记。',
      tone: 'ok',
      riskFlags: [],
    };
  }

  if (input?.aiScore != null) {
    return {
      kind: 'legacy_single_score',
      title: '旧版单分',
      description: '当前条目有总分，但缺少评分 Skill 拆解。建议重跑评分，让系统补齐理由、置信度和风险标记。',
      tone: 'warning',
      riskFlags: [],
    };
  }

  return {
    kind: 'missing_score',
    title: '等待评分',
    description: '当前条目还没有 AI 评分。可重跑评分，或先补正文后再评分。',
    tone: 'neutral',
    riskFlags: [],
  };
}
