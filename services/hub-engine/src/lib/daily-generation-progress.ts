export type DailyGenerationStage =
  | 'queued'
  | 'loading_data'
  | 'candidate_prepare'
  | 'candidate_repair'
  | 'module_grouping'
  | 'module_generation'
  | 'agent_cleaning'
  | 'agent_decision'
  | 'agent_research'
  | 'agent_reading'
  | 'final_synthesis'
  | 'saving'
  | 'completed'
  | 'failed';

export type DailyGenerationProgress = {
  stage: DailyGenerationStage;
  label: string;
  percent: number;
  message: string;
  detail?: Record<string, unknown> | null;
  updatedAt: string;
};

const STAGE_META: Record<DailyGenerationStage, { label: string; percent: number; message: string }> = {
  queued: { label: '任务已创建', percent: 5, message: '日报生成任务已创建，等待开始。' },
  loading_data: { label: '读取数据', percent: 15, message: '正在读取当日内容和历史对比窗口。' },
  candidate_prepare: { label: '准备候选', percent: 30, message: '正在筛选日报候选池。' },
  candidate_repair: { label: '补处理', percent: 42, message: '正在补评分、摘要或翻译等关键处理债务。' },
  module_grouping: { label: '模块分组', percent: 48, message: '正在按主题模块组织候选文章。' },
  module_generation: { label: '模块日报', percent: 58, message: '正在生成各模块的结论、重点文章和建议动作。' },
  agent_cleaning: { label: '清洗 Agent', percent: 64, message: '正在清洗候选内容并合并重复信号。' },
  agent_decision: { label: '决策分析', percent: 72, message: '正在生成决策视角分析。' },
  agent_research: { label: '研究分析', percent: 80, message: '正在生成研究视角分析。' },
  agent_reading: { label: '阅读建议', percent: 86, message: '正在生成阅读建议。' },
  final_synthesis: { label: '最终融合', percent: 90, message: '正在融合高质量日报正文。' },
  saving: { label: '保存日报', percent: 96, message: '正在保存日报并更新工作台。' },
  completed: { label: '已完成', percent: 100, message: '日报已生成。' },
  failed: { label: '生成失败', percent: 100, message: '日报生成失败。' },
};

export function humanizeDailyGenerationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/constraint|foreign key|database|postgres|sqlstate|relation .* does not exist/i.test(message)) {
    return '日报保存失败，请稍后重试；若持续出现，请检查数据库服务。';
  }
  if (/timeout|timed out|abort(?:ed)?|econnreset|econnrefused/i.test(message)) {
    return '日报生成超时，请稍后重新生成。';
  }
  if (/provider|\bllm\b|rate limit|\b429\b|model service|empty (?:response|output)/i.test(message)) {
    return '模型服务暂时不可用，请稍后重新生成日报。';
  }
  if (/invalid_daily_scene_output|quality_gate|too_short|missing_sections|machine_selection/i.test(message)) {
    return '日报内容未通过质量检查，请调整候选或模型后重新生成。';
  }
  return '日报生成失败，请稍后重试。';
}

function isDailyGenerationStage(value: unknown): value is DailyGenerationStage {
  return typeof value === 'string' && value in STAGE_META;
}

export function buildDailyGenerationProgress(
  stage: DailyGenerationStage,
  overrides: Partial<Pick<DailyGenerationProgress, 'message' | 'detail' | 'percent'>> = {},
): DailyGenerationProgress {
  const meta = STAGE_META[stage];
  const percent = Number.isFinite(overrides.percent)
    ? Math.max(0, Math.min(100, Number(overrides.percent)))
    : meta.percent;
  return {
    stage,
    label: meta.label,
    percent,
    message: overrides.message || meta.message,
    detail: overrides.detail || null,
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeDailyGenerationProgress(value: unknown): DailyGenerationProgress {
  if (!value || typeof value !== 'object') {
    return buildDailyGenerationProgress('queued');
  }
  const record = value as Record<string, unknown>;
  if (!isDailyGenerationStage(record.stage)) {
    return buildDailyGenerationProgress('queued');
  }
  return buildDailyGenerationProgress(record.stage, {
    message: typeof record.message === 'string' ? record.message : undefined,
    percent: typeof record.percent === 'number' ? record.percent : undefined,
    detail: record.detail && typeof record.detail === 'object'
      ? record.detail as Record<string, unknown>
      : null,
  });
}
