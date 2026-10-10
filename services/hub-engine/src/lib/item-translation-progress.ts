export type ItemTranslationStage =
  | 'queued'
  | 'fetching_content'
  | 'preparing_translation'
  | 'translating'
  | 'saving'
  | 'completed'
  | 'failed';

export type ItemTranslationProgress = {
  stage: ItemTranslationStage;
  label: string;
  percent: number;
  message: string;
  detail?: Record<string, unknown> | null;
  updatedAt: string;
};

const STAGE_META: Record<ItemTranslationStage, { label: string; percent: number; message: string }> = {
  queued: { label: '任务已创建', percent: 5, message: '全文翻译任务已创建，等待开始。' },
  fetching_content: { label: '补抓正文', percent: 25, message: '正在检查并补抓原站正文。' },
  preparing_translation: { label: '准备翻译', percent: 42, message: '正在准备全文翻译上下文。' },
  translating: { label: '翻译全文', percent: 62, message: '正在分块翻译全文。' },
  saving: { label: '保存译文', percent: 88, message: '正在保存译文并刷新阅读状态。' },
  completed: { label: '已完成', percent: 100, message: '全文翻译已完成。' },
  failed: { label: '翻译失败', percent: 100, message: '全文翻译失败。' },
};

function isItemTranslationStage(value: unknown): value is ItemTranslationStage {
  return typeof value === 'string' && value in STAGE_META;
}

export function buildItemTranslationProgress(
  stage: ItemTranslationStage,
  overrides: Partial<Pick<ItemTranslationProgress, 'message' | 'detail' | 'percent'>> = {},
): ItemTranslationProgress {
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

export function normalizeItemTranslationProgress(value: unknown): ItemTranslationProgress {
  if (!value || typeof value !== 'object') {
    return buildItemTranslationProgress('queued');
  }
  const record = value as Record<string, unknown>;
  if (!isItemTranslationStage(record.stage)) {
    return buildItemTranslationProgress('queued');
  }
  return buildItemTranslationProgress(record.stage, {
    message: typeof record.message === 'string' ? record.message : undefined,
    percent: typeof record.percent === 'number' ? record.percent : undefined,
    detail: record.detail && typeof record.detail === 'object'
      ? record.detail as Record<string, unknown>
      : null,
  });
}

export function resolveItemTranslationJobProgress(
  state: string,
  value: unknown,
  options: {
    failedReason?: string | null;
    result?: Record<string, unknown> | null;
  } = {},
): ItemTranslationProgress {
  if (state === 'completed') {
    return buildItemTranslationProgress('completed', {
      detail: options.result || null,
    });
  }
  if (state === 'failed') {
    const rawReason = options.failedReason || '';
    const message = /stalled|lock|timeout|timed out|abort|\b5\d\d\b|fetch failed|econn|network|socket/i.test(rawReason)
      ? '翻译服务暂时不可用，任务未完成。请稍后重试，或检查翻译模型配置。'
      : rawReason || '全文翻译失败。';
    return buildItemTranslationProgress('failed', {
      message,
    });
  }
  return normalizeItemTranslationProgress(value);
}
