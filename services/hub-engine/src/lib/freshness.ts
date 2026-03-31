type SourceFreshnessInput = {
  status?: string | null;
  autoFetchEnabled?: boolean | null;
  fetchInterval?: number | null;
  nextFetchAt?: Date | string | null;
  lastSuccessAt?: Date | string | null;
  lastOutcome?: string | null;
  lastError?: string | null;
};

export type SourceFreshnessState = 'healthy' | 'due' | 'stale' | 'paused' | 'error';
export type GlobalFreshnessStatus = 'fresh' | 'warning' | 'stale';

function asDate(value?: Date | string | null): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function minutesBetween(earlier: Date, later: Date) {
  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 60_000));
}

export function computeSourceFreshness(source: SourceFreshnessInput, now = new Date()): {
  freshnessState: SourceFreshnessState;
  staleReason: string | null;
  oldestDueMinutes: number | null;
} {
  if (source.status && source.status !== 'active') {
    return {
      freshnessState: source.status === 'error' ? 'error' : 'paused',
      staleReason: source.status === 'error'
        ? (source.lastError || '信源处于错误状态')
        : '信源未激活或已暂停',
      oldestDueMinutes: null,
    };
  }

  if (source.autoFetchEnabled === false) {
    return {
      freshnessState: 'paused',
      staleReason: '已关闭自动抓取',
      oldestDueMinutes: null,
    };
  }

  const nextFetchAt = asDate(source.nextFetchAt);
  if (nextFetchAt && nextFetchAt <= now) {
    return {
      freshnessState: 'due',
      staleReason: '已到抓取时间但尚未补抓',
      oldestDueMinutes: minutesBetween(nextFetchAt, now),
    };
  }

  const lastSuccessAt = asDate(source.lastSuccessAt);
  const staleWindowMinutes = Math.max(360, Number(source.fetchInterval || 60) * 2);
  if (!lastSuccessAt) {
    return {
      freshnessState: 'stale',
      staleReason: '尚无成功抓取记录',
      oldestDueMinutes: null,
    };
  }

  const silenceMinutes = minutesBetween(lastSuccessAt, now);
  if (silenceMinutes >= staleWindowMinutes) {
    return {
      freshnessState: 'stale',
      staleReason: `最近成功抓取距今已 ${silenceMinutes} 分钟`,
      oldestDueMinutes: null,
    };
  }

  return {
    freshnessState: 'healthy',
    staleReason: source.lastOutcome === 'error'
      ? (source.lastError || '最近一次抓取失败，等待下一轮重试')
      : null,
    oldestDueMinutes: null,
  };
}

export function summarizeFreshness<T extends SourceFreshnessInput>(sources: T[], now = new Date()) {
  let dueSources = 0;
  let staleSources = 0;
  let oldestDueMinutes = 0;
  let lastSuccessfulFetchAt: Date | null = null;
  const staleDetails: Array<{ name?: string | null; freshnessState: SourceFreshnessState; staleReason: string | null }> = [];

  for (const source of sources) {
    const freshness = computeSourceFreshness(source, now);
    if (freshness.freshnessState === 'due') {
      dueSources += 1;
      oldestDueMinutes = Math.max(oldestDueMinutes, freshness.oldestDueMinutes || 0);
    }
    if (freshness.freshnessState === 'stale' || freshness.freshnessState === 'error') {
      staleSources += 1;
      staleDetails.push({
        name: (source as { name?: string | null }).name || null,
        freshnessState: freshness.freshnessState,
        staleReason: freshness.staleReason,
      });
    }
    const lastSuccessAt = asDate(source.lastSuccessAt);
    if (lastSuccessAt && (!lastSuccessfulFetchAt || lastSuccessAt > lastSuccessfulFetchAt)) {
      lastSuccessfulFetchAt = lastSuccessAt;
    }
  }

  let freshnessStatus: GlobalFreshnessStatus = 'fresh';
  let staleReason: string | null = null;
  if (staleSources > 0) {
    freshnessStatus = 'stale';
    staleReason = staleDetails[0]?.staleReason || '存在过期或错误信源';
  } else if (dueSources > 0) {
    freshnessStatus = 'warning';
    staleReason = `当前有 ${dueSources} 个到期信源待补抓`;
  }

  return {
    freshnessStatus,
    staleReason,
    staleSources,
    oldestDueMinutes: oldestDueMinutes || null,
    lastSuccessfulFetchAt: lastSuccessfulFetchAt?.toISOString() || null,
    staleDetails: staleDetails.slice(0, 8),
  };
}
