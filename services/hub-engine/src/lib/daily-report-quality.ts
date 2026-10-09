import { dailyProseIssue } from '../outputs/daily-report-prose.js';

export type DailyReportQualityStatus = 'full' | 'degraded';
export type DailyReportPublicationStatus = 'published' | 'draft' | 'missing';

export type DailyReportQualityMeta = {
  status?: 'ai' | 'fallback' | string | null;
  error?: string | null;
  repaired?: boolean | null;
  repairReason?: string | null;
  deliveryMode?: 'model' | 'model_composed' | 'deterministic' | string | null;
};

export type DailyReportQualityInput = {
  markdown?: string | null;
  generationMode?: 'fast' | 'full' | string | null;
  emptyCandidates?: boolean;
  evidenceCount?: number | null;
  minimumEvidenceCount?: number | null;
  finalMeta?: DailyReportQualityMeta | null;
  stageMetas?: Array<{
    key: string;
    meta?: DailyReportQualityMeta | null;
  }>;
};

export type DailyReportQualityResult = {
  status: DailyReportQualityStatus;
  reasons: string[];
  warnings: string[];
};

export type DailyReportDeliveryDecision = {
  quality: DailyReportQualityResult;
  allowExternalPush: boolean;
  allowAutomaticFormalExport: boolean;
  message: string;
};

type PersistedDailyReportPayload = {
  markdown?: string | null;
  generationMode?: string | null;
  emptyDiagnosis?: unknown;
  qualityStatus?: DailyReportQualityStatus | string | null;
  qualityReasons?: unknown;
  qualityWarnings?: unknown;
  final?: { markdown?: string | null; meta?: DailyReportQualityMeta | null } | null;
  cleaning?: { meta?: DailyReportQualityMeta | null } | null;
  modules?: Record<string, { meta?: DailyReportQualityMeta | null } | null> | null;
};

export type DailyReportPublicationNavigation = {
  currentDate: string | null;
  latestDate: string | null;
  previousDate: string | null;
  nextDate: string | null;
  recentDates: string[];
  latestPublishedDate: string | null;
  previousPublishedDate: string | null;
  nextPublishedDate: string | null;
  publishedDates: string[];
};

function normalizeReason(value: string | null | undefined, fallback: string) {
  const normalized = String(value || '').trim().replace(/\s+/g, '_');
  return normalized || fallback;
}

export function buildDailyReportQuality(input: DailyReportQualityInput): DailyReportQualityResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const proseIssue = dailyProseIssue(input.markdown || '');
  if (proseIssue) reasons.push(`final_content:${proseIssue}`);

  if (input.generationMode !== 'full') reasons.push('generation_mode_fast');
  if (input.emptyCandidates) reasons.push('empty_candidates');
  if (
    Number.isFinite(input.evidenceCount)
    && Number.isFinite(input.minimumEvidenceCount)
    && Number(input.minimumEvidenceCount) > 0
    && Number(input.evidenceCount) < Number(input.minimumEvidenceCount)
  ) {
    reasons.push(`insufficient_evidence:${Number(input.evidenceCount)}/${Number(input.minimumEvidenceCount)}`);
  }

  const finalMeta = input.finalMeta;
  if (!finalMeta) {
    reasons.push('final_missing');
  } else if (finalMeta.status !== 'ai') {
    reasons.push(`final_fallback:${normalizeReason(finalMeta.error, 'unknown')}`);
  } else if (finalMeta.deliveryMode !== 'model' && finalMeta.deliveryMode !== 'model_composed') {
    reasons.push(finalMeta.deliveryMode === 'deterministic'
      ? 'final_deterministic_fallback'
      : 'final_delivery_mode_unverified');
  } else if (finalMeta.repaired) {
    // A repaired final means the user-facing synthesis did not pass its original
    // contract. Keep the deterministic facts, but never label that run as a
    // complete high-quality report.
    reasons.push(`final_repaired:${normalizeReason(finalMeta.repairReason, 'quality_gate_failed')}`);
  }

  for (const stage of input.stageMetas || []) {
    const key = normalizeReason(stage.key, 'unknown');
    if (!stage.meta) {
      reasons.push(`stage_missing:${key}`);
      continue;
    }
    if (stage.meta.status !== 'ai') {
      reasons.push(`stage_fallback:${key}:${normalizeReason(stage.meta.error, 'unknown')}`);
    } else if (stage.meta.repaired) {
      warnings.push(`stage_repaired:${key}:${normalizeReason(stage.meta.repairReason, 'quality_gate_failed')}`);
    }
  }

  const uniqueReasons = [...new Set(reasons)];
  const uniqueWarnings = [...new Set(warnings)];
  return {
    status: uniqueReasons.length > 0 ? 'degraded' : 'full',
    reasons: uniqueReasons,
    warnings: uniqueWarnings,
  };
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

/**
 * Persisted quality labels are advisory because older rows may have been saved
 * before the current publication gate. A deterministic or repaired final must
 * never remain publishable merely because the stored label still says full.
 */
export function resolvePersistedDailyReportQuality(payload?: PersistedDailyReportPayload | null): DailyReportQualityResult {
  const storedStatus = payload?.qualityStatus === 'full' || payload?.qualityStatus === 'degraded'
    ? payload.qualityStatus
    : null;
  const stored: DailyReportQualityResult | null = storedStatus
    ? {
      status: storedStatus,
      reasons: stringArray(payload?.qualityReasons),
      warnings: stringArray(payload?.qualityWarnings),
    }
    : null;

  if (stored?.status === 'degraded') return stored;

  const finalMeta = payload?.final?.meta || null;

  const stageMetas = [
    { key: 'cleaning', meta: payload?.cleaning?.meta || null },
    { key: 'decision', meta: payload?.modules?.decision?.meta || null },
    { key: 'research', meta: payload?.modules?.research?.meta || null },
    { key: 'reading', meta: payload?.modules?.reading?.meta || null },
  ].filter((stage) => stage.meta != null);
  const computed = buildDailyReportQuality({
    markdown: payload?.markdown || payload?.final?.markdown,
    generationMode: payload?.generationMode || (stored?.status === 'full' ? 'full' : null),
    emptyCandidates: Boolean(payload?.emptyDiagnosis),
    finalMeta,
    stageMetas,
  });

  if (computed.status === 'degraded') return computed;
  return stored || computed;
}

/**
 * Recompute the persisted payload at every delivery boundary. Stored labels are
 * never trusted on their own because older or repaired rows may still claim
 * `full`. Degraded reports remain saved and rerunnable, but cannot leave the
 * application through automatic push or formal export paths.
 */
export function resolveDailyReportDeliveryDecision(
  payload?: PersistedDailyReportPayload | null,
): DailyReportDeliveryDecision {
  const quality = resolvePersistedDailyReportQuality(payload);
  const allowed = quality.status === 'full';
  return {
    quality,
    allowExternalPush: allowed,
    allowAutomaticFormalExport: allowed,
    message: allowed
      ? '日报已生成；推送已排队，并允许自动正式导出。'
      : '日报已保存为降级草稿；未推送、未自动正式导出，可修复后重跑。',
  };
}

export function resolveDailyReportPublicationStatus(
  hasReport: boolean,
  quality?: DailyReportQualityResult | null,
): DailyReportPublicationStatus {
  if (!hasReport) return 'missing';
  return quality?.status === 'full' ? 'published' : 'draft';
}

export function buildDailyReportPublicationNavigation(
  rows: Array<{ date?: string | null; payload?: PersistedDailyReportPayload | null }>,
  currentDate?: string | null,
): DailyReportPublicationNavigation {
  const recentDates = [...new Set(rows.map((row) => String(row.date || '').trim()).filter(Boolean))];
  const latestDate = recentDates[0] || null;
  const activeDate = currentDate || latestDate;
  const sortedAsc = [...recentDates].sort();
  const index = activeDate ? sortedAsc.indexOf(activeDate) : -1;
  const publishedDates = [...new Set(rows
    .filter((row) => resolvePersistedDailyReportQuality(row.payload).status === 'full')
    .map((row) => String(row.date || '').trim())
    .filter(Boolean))];
  const publishedAsc = [...publishedDates].sort();
  const previousPublishedDate = activeDate
    ? [...publishedAsc].reverse().find((date) => date < activeDate) || null
    : publishedDates[0] || null;
  const nextPublishedDate = activeDate
    ? publishedAsc.find((date) => date > activeDate) || null
    : null;

  return {
    currentDate: activeDate || null,
    latestDate,
    previousDate: index > 0 ? sortedAsc[index - 1] : null,
    nextDate: index >= 0 && index < sortedAsc.length - 1 ? sortedAsc[index + 1] : null,
    recentDates,
    latestPublishedDate: publishedDates[0] || null,
    previousPublishedDate,
    nextPublishedDate,
    publishedDates,
  };
}

export function describeDailyReportQualityReason(reason: string): string {
  const stageNames: Record<string, string> = { cleaning: '素材整理', decision: '重点判断', research: '证据分析', reading: '阅读建议', final: '最终编辑' };
  if (reason === 'final_content:placeholder_content') return '正文混入摘要失败等中间结果，需要重新编辑后发布。';
  if (reason === 'final_content:broken_editorial_markup') return '正文包含损坏的图片或链接标记，需要修复排版后发布。';
  if (reason === 'final_content:photo_caption_as_summary') return '正文将图片署名或图注当成文章摘要，需要重新编辑。';
  if (reason === 'generation_mode_fast') return '本次使用快速模式，部分日报 Agent 未运行。';
  if (reason === 'empty_candidates') return '当前日期没有通过候选门槛的内容，只保存了诊断结果。';
  if (reason.startsWith('insufficient_evidence:')) {
    const [actual = '0', minimum = '0'] = reason.slice('insufficient_evidence:'.length).split('/');
    return `本次只有 ${actual} 篇可核验证据，至少需要 ${minimum} 篇才能生成高质量日报。`;
  }
  if (reason === 'final_missing') return '最终融合结果缺失。';
  if (reason.startsWith('final_fallback:')) return '最终融合 Agent 未通过质量门禁，当前使用保底输出。';
  if (reason === 'final_deterministic_fallback') return '最终编辑稿未通过质量门禁；事实草稿已保留，但未发布为正式日报。';
  if (reason === 'final_delivery_mode_unverified') return '最终融合缺少可核验的模型交付方式，未发布为正式日报。';
  if (reason.startsWith('final_repaired:')) return '最终融合原始输出未通过质量门禁，当前内容经过自动修补。';
  if (reason.startsWith('stage_missing:')) return `${stageNames[reason.split(':')[1]] || '内容处理'}尚未完成。`;
  if (reason.startsWith('stage_fallback:')) return `${stageNames[reason.split(':')[1]] || '内容处理'}未能完成，仅保留事实草稿。`;
  if (reason.startsWith('stage_repaired:')) return `${stageNames[reason.split(':')[1]] || '内容处理'}经过自动修补，需要复核。`;
  return '本次日报未达到完整质量门禁。';
}

export function summarizeDailyReportQualityReasons(reasons: string[] | null | undefined): string {
  const labels = (reasons || []).map(describeDailyReportQualityReason);
  return labels.length > 0 ? labels.slice(0, 3).join(' ') : '日报已通过完整质量门禁。';
}
