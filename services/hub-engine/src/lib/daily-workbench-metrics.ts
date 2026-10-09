export type DailyUsageInputRow = {
  status?: string | null;
  calls?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  estimatedCost?: number | null;
  errorMessage?: string | null;
};

export type DailyUsageSummary = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  byStatus: Array<{ key: string; count: number }>;
  hotspotErrors: Array<{ key: string; count: number }>;
};

export type DailyReportState = {
  status: 'missing' | 'full' | 'stale' | 'degraded';
  label: string;
  generatedAt: string | null;
  itemCount: number;
  reason: string;
};

export function canViewSystemAiUsage(role?: string | null): boolean {
  return role === 'admin';
}

export function summarizeDailyUsageRows(rows: DailyUsageInputRow[]): DailyUsageSummary {
  const byStatus = new Map<string, number>();
  const errors = new Map<string, number>();
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCost = 0;

  for (const row of rows) {
    const rowCalls = Number(row.calls || 0);
    calls += rowCalls;
    inputTokens += Number(row.inputTokens || 0);
    outputTokens += Number(row.outputTokens || 0);
    estimatedCost += Number(row.estimatedCost || 0);
    const status = row.status || 'unknown';
    byStatus.set(status, (byStatus.get(status) || 0) + rowCalls);
    const error = String(row.errorMessage || '').trim();
    if (error) errors.set(error, (errors.get(error) || 0) + rowCalls);
  }

  return {
    calls,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost,
    byStatus: [...byStatus.entries()].map(([key, count]) => ({ key, count })),
    hotspotErrors: [...errors.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

export function buildDailyReportState(input: {
  generatedAt?: string | Date | null;
  previewGeneratedAt?: string | Date | null;
  candidateDataUpdatedAt?: string | Date | null;
  itemCount?: number | null;
  qualityStatus?: 'full' | 'degraded' | string | null;
  qualityReason?: string | null;
}): DailyReportState {
  const generatedAt = input.generatedAt ? new Date(input.generatedAt) : null;
  if (!generatedAt || Number.isNaN(generatedAt.getTime())) {
    return {
      status: 'missing',
      label: '尚未生成',
      generatedAt: null,
      itemCount: 0,
      reason: '当前日期还没有保存的正式日报。',
    };
  }

  const freshnessInput = input.candidateDataUpdatedAt ?? input.previewGeneratedAt;
  const candidateDataUpdatedAt = freshnessInput ? new Date(freshnessInput) : null;
  const stale = candidateDataUpdatedAt
    && !Number.isNaN(candidateDataUpdatedAt.getTime())
    && candidateDataUpdatedAt.getTime() > generatedAt.getTime();

  if (input.qualityStatus === 'degraded') {
    return {
      status: 'degraded',
      label: stale ? '降级日报（需刷新）' : '降级日报',
      generatedAt: generatedAt.toISOString(),
      itemCount: Number(input.itemCount || 0),
      reason: [
        input.qualityReason || '本次日报未通过完整质量门禁。',
        stale ? '候选数据晚于已保存日报，建议重新生成。' : '',
      ].filter(Boolean).join(' '),
    };
  }

  return {
    status: stale ? 'stale' : 'full',
    label: stale ? '日报已过期' : '高质量日报',
    generatedAt: generatedAt.toISOString(),
    itemCount: Number(input.itemCount || 0),
    reason: stale
      ? '候选数据晚于已保存日报，建议重新生成。'
      : '已保存日报通过完整质量门禁，并与当前工作台日期一致。',
  };
}
