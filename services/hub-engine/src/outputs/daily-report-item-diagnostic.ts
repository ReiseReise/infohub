import type {
  DailyReportExcludedCandidate,
  DailyReportPreparedCandidate,
} from './daily-report-workflow.js';

export type DailyReportItemDiagnosticTone = 'ok' | 'warning' | 'danger' | 'neutral';

export type DailyReportItemDiagnosticStatus =
  | 'selected'
  | 'review'
  | 'latest_visible'
  | 'excluded'
  | 'not_in_window'
  | 'not_generated';

export type DailyReportItemDiagnostic = {
  itemId: string;
  status: DailyReportItemDiagnosticStatus;
  label: string;
  reason: string;
  detail: string | null;
  action: string;
  tone: DailyReportItemDiagnosticTone;
  selectionMode: string | null;
  selectionReason: string | null;
  excludedReason: DailyReportExcludedCandidate['reason'] | null;
  diagnosticBasis?: 'insight_snapshot' | 'current_rules';
  diagnosticBasisLabel?: string;
  snapshotGeneratedAt?: string | null;
};

export type DailyReportItemDiagnosticPreparation = Pick<
  {
    finalCandidates: Array<Pick<DailyReportPreparedCandidate, 'id' | 'title' | 'selectionMode' | 'selectionReason'>>;
    reviewCandidates: Array<Pick<DailyReportPreparedCandidate, 'id' | 'title' | 'selectionMode' | 'selectionReason'>>;
    latestFallbackCandidates: Array<Pick<DailyReportPreparedCandidate, 'id' | 'title' | 'selectionMode' | 'selectionReason'>>;
    excluded: Array<Pick<DailyReportExcludedCandidate, 'id' | 'title' | 'reason' | 'detail'>>;
  },
  'finalCandidates' | 'reviewCandidates' | 'latestFallbackCandidates' | 'excluded'
>;

export function ensureDailyReportDiagnosticTargetRows<T extends { id: string }>(
  rows: T[],
  targetRows: T[],
  itemId: string,
): T[] {
  if (rows.some((row) => row.id === itemId)) return rows;
  const targetRow = targetRows.find((row) => row.id === itemId);
  if (!targetRow) return rows;
  return [targetRow, ...rows.filter((row) => row.id !== itemId)];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function isExcludedReason(value: unknown): value is DailyReportExcludedCandidate['reason'] {
  return value === 'translation_failed'
    || value === 'not_chinese'
    || value === 'not_selected'
    || value === 'business_noise'
    || value === 'fallback_scored';
}

function isPreparedSelectionMode(value: unknown): value is DailyReportPreparedCandidate['selectionMode'] {
  return value === 'scored' || value === 'review' || value === 'latest_visible';
}

function selectedLabel(selectionMode?: string | null): string {
  if (selectionMode === 'review') return '低分复核入报';
  if (selectionMode === 'latest_visible') return '最新兜底入报';
  return '已进入日报';
}

function actionForExcluded(reason: DailyReportExcludedCandidate['reason']): string {
  if (reason === 'fallback_scored') return '先点击“重跑评分”回收真实评分，再回到 Insights 重新预览日报候选池。';
  if (reason === 'translation_failed' || reason === 'not_chinese') return '先重跑摘要或翻译，让条目具备可用中文材料后再生成日报。';
  if (reason === 'business_noise') return '如果判断这是误伤，可在当前详情提交“值得重点关注”反馈，或重跑评分后重新预览日报。';
  return '可重跑评分/摘要，或在 Insights 调整日报范围、最低分和最新兜底策略。';
}

function labelForExcluded(reason: DailyReportExcludedCandidate['reason']): string {
  if (reason === 'fallback_scored') return '未入报：低置信评分';
  if (reason === 'translation_failed') return '未入报：中文化失败';
  if (reason === 'not_chinese') return '未入报：缺少中文材料';
  if (reason === 'business_noise') return '未入报：泛商业噪声';
  return '未入报：未达到候选门槛';
}

function toneForExcluded(reason: DailyReportExcludedCandidate['reason']): DailyReportItemDiagnosticTone {
  if (reason === 'fallback_scored' || reason === 'translation_failed') return 'danger';
  if (reason === 'business_noise' || reason === 'not_chinese') return 'warning';
  return 'neutral';
}

function fromExcluded(itemId: string, excluded: DailyReportItemDiagnosticPreparation['excluded'][number]): DailyReportItemDiagnostic {
  return {
    itemId,
    status: 'excluded',
    label: labelForExcluded(excluded.reason),
    reason: excluded.detail || labelForExcluded(excluded.reason),
    detail: excluded.detail || null,
    action: actionForExcluded(excluded.reason),
    tone: toneForExcluded(excluded.reason),
    selectionMode: null,
    selectionReason: null,
    excludedReason: excluded.reason,
  };
}

function fromPrepared(
  itemId: string,
  candidate: DailyReportItemDiagnosticPreparation['finalCandidates'][number],
  status: Extract<DailyReportItemDiagnosticStatus, 'selected' | 'review' | 'latest_visible'>,
): DailyReportItemDiagnostic {
  if (status === 'selected') {
    return {
      itemId,
      status,
      label: selectedLabel(candidate.selectionMode),
      reason: candidate.selectionReason || '该条目已按日报候选规则进入最终日报。',
      detail: candidate.selectionReason || null,
      action: '查看 Insights 的 TOP 入报理由，并按标题链接回到原文核对。',
      tone: 'ok',
      selectionMode: candidate.selectionMode || null,
      selectionReason: candidate.selectionReason || null,
      excludedReason: null,
    };
  }

  if (status === 'latest_visible') {
    return {
      itemId,
      status,
      label: '同范围最新兜底',
      reason: candidate.selectionReason || '该条目匹配日报范围，但分数不足，只能作为最新兜底候选。',
      detail: candidate.selectionReason || null,
      action: '如果它确实重要，先重跑评分或在 Insights 降低最低分后重新预览。',
      tone: 'warning',
      selectionMode: candidate.selectionMode || null,
      selectionReason: candidate.selectionReason || null,
      excludedReason: null,
    };
  }

  return {
    itemId,
    status,
    label: '日报复核候选',
    reason: candidate.selectionReason || '该条目匹配日报范围，但需要先处理评分、过滤或质量债。',
    detail: candidate.selectionReason || null,
    action: '先按提示修复评分/摘要/翻译，再回到 Insights 重新预览候选池。',
    tone: 'warning',
    selectionMode: candidate.selectionMode || null,
    selectionReason: candidate.selectionReason || null,
    excludedReason: null,
  };
}

function withInsightSnapshotBasis(
  diagnostic: DailyReportItemDiagnostic,
  generatedAt?: string | null,
): DailyReportItemDiagnostic {
  return {
    ...diagnostic,
    diagnosticBasis: 'insight_snapshot',
    diagnosticBasisLabel: '依据：同日最新日报快照',
    snapshotGeneratedAt: generatedAt || null,
  };
}

function mapSnapshotTopItem(value: unknown): DailyReportItemDiagnosticPreparation['finalCandidates'][number] | null {
  const record = asRecord(value);
  const id = asString(record?.id);
  if (!record || !id) return null;
  return {
    id,
    title: asString(record.title) || 'Untitled',
    selectionMode: isPreparedSelectionMode(record.selectionMode) ? record.selectionMode : 'scored',
    selectionReason: asString(record.selectionReason) || '该条目已进入已生成日报快照。',
  };
}

function mapSnapshotExcludedItem(value: unknown): DailyReportItemDiagnosticPreparation['excluded'][number] | null {
  const record = asRecord(value);
  const id = asString(record?.id);
  if (!record || !id) return null;
  const rawReason = record.reason;
  return {
    id,
    title: asString(record.title) || 'Untitled',
    reason: isExcludedReason(rawReason) ? rawReason : 'not_selected',
    detail: asString(record.detail),
  };
}

function snapshotExcludedItems(snapshot: Record<string, unknown>): DailyReportItemDiagnosticPreparation['excluded'] {
  const direct = asArray(snapshot.excludedCandidates)
    .map(mapSnapshotExcludedItem)
    .filter((item): item is DailyReportItemDiagnosticPreparation['excluded'][number] => Boolean(item));

  const summary = asRecord(snapshot.excludedCandidateSummary);
  const summaryItems = asArray(summary?.byReason)
    .flatMap((group) => asArray(asRecord(group)?.samples))
    .map(mapSnapshotExcludedItem)
    .filter((item): item is DailyReportItemDiagnosticPreparation['excluded'][number] => Boolean(item));

  const seen = new Set<string>();
  return [...direct, ...summaryItems].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function buildDailyReportItemDiagnosticFromSnapshot(
  itemId: string,
  snapshot: unknown,
): DailyReportItemDiagnostic | null {
  const record = asRecord(snapshot);
  if (!record) return null;

  const finalCandidates = asArray(record.topItems)
    .map(mapSnapshotTopItem)
    .filter((item): item is DailyReportItemDiagnosticPreparation['finalCandidates'][number] => Boolean(item));
  const excluded = snapshotExcludedItems(record);
  if (finalCandidates.length === 0 && excluded.length === 0) return null;

  const preparation: DailyReportItemDiagnosticPreparation = {
    finalCandidates,
    reviewCandidates: [],
    latestFallbackCandidates: [],
    excluded,
  };

  const generatedAt = asString(record.generatedAt);
  return withInsightSnapshotBasis(buildDailyReportItemDiagnostic(itemId, preparation), generatedAt);
}

export function buildDailyReportItemDiagnostic(
  itemId: string,
  preparation?: DailyReportItemDiagnosticPreparation | null,
): DailyReportItemDiagnostic {
  if (!preparation) {
    return {
      itemId,
      status: 'not_generated',
      label: '尚未生成日报诊断',
      reason: '当前还没有可用日报候选池结果。',
      detail: null,
      action: '先在 Insights 预览或生成日报，再回到 Feed 查看入报解释。',
      tone: 'neutral',
      selectionMode: null,
      selectionReason: null,
      excludedReason: null,
    };
  }

  const finalCandidate = preparation.finalCandidates.find((candidate) => candidate.id === itemId);
  if (finalCandidate) return fromPrepared(itemId, finalCandidate, 'selected');

  const excluded = preparation.excluded.find((candidate) => candidate.id === itemId);
  if (excluded) return fromExcluded(itemId, excluded);

  const reviewCandidate = preparation.reviewCandidates.find((candidate) => candidate.id === itemId);
  if (reviewCandidate) return fromPrepared(itemId, reviewCandidate, 'review');

  const latestCandidate = preparation.latestFallbackCandidates.find((candidate) => candidate.id === itemId);
  if (latestCandidate) return fromPrepared(itemId, latestCandidate, 'latest_visible');

  return {
    itemId,
    status: 'not_in_window',
    label: '未进入本次日报候选池',
    reason: '当前条目没有出现在该日的入报、复核、兜底或排除诊断中，通常是未匹配日报范围、时间窗口或候选采样。',
    detail: null,
    action: '在 Insights 查看日报工作流范围；如果这是重要内容，可反馈偏好或调整入报分类/关键词。',
    tone: 'neutral',
    selectionMode: null,
    selectionReason: null,
    excludedReason: null,
  };
}
