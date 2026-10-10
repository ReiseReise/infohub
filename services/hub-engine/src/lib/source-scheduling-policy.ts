// Factor model independently adapted from QMReader's MIT-licensed freshness sweep
// (joeseesun/qmreader@95efab9); no upstream runtime code is bundled here.
export type SourceSchedulingCandidate = {
  id: number;
  priority?: number | null;
  sourceTier?: string | null;
  processingProfile?: string | null;
  collectorType?: string | null;
  fetchInterval?: number | null;
  lastFetchedAt?: Date | string | null;
  nextFetchAt?: Date | string | null;
  healthScore?: number | null;
  errorCount?: number | null;
};

export type SourceSchedulingScore<T extends SourceSchedulingCandidate = SourceSchedulingCandidate> = T & {
  score: number;
  overdueRatio: number;
  priorityScore: number;
  starvationScore: number;
  fetchCost: number;
  costPenalty: number;
  reliabilityPenalty: number;
  reason: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function timestamp(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function estimateSourceFetchCost(candidate: SourceSchedulingCandidate): number {
  const collectorCost: Record<string, number> = {
    rss: 1,
    rsshub: 1.1,
    custom: 1.35,
    youtube: 1.75,
    changedetection: 2.1,
    webpage_index: 2.5,
    webpage: 3.2,
  };
  const profileMultiplier: Record<string, number> = {
    brief: 0.85,
    smart: 1.15,
    full: 1.6,
  };
  const base = collectorCost[candidate.collectorType || 'rss'] ?? 1.5;
  const multiplier = profileMultiplier[candidate.processingProfile || 'brief'] ?? 1;
  return round(base * multiplier);
}

function resolvePriority(candidate: SourceSchedulingCandidate): number {
  if (Number.isFinite(candidate.priority)) {
    return clamp(Number(candidate.priority), 1, 10);
  }
  const fallback: Record<string, number> = { S: 5, A: 4, B: 3, C: 2 };
  return fallback[String(candidate.sourceTier || '').toUpperCase()] ?? 3;
}

export function scoreSourceSchedulingCandidate<T extends SourceSchedulingCandidate>(
  candidate: T,
  now = new Date(),
): SourceSchedulingScore<T> {
  const nowMs = now.getTime();
  const intervalMs = Math.max(Number(candidate.fetchInterval) || 60, 5) * 60_000;
  const nextFetchMs = timestamp(candidate.nextFetchAt);
  const lastFetchedMs = timestamp(candidate.lastFetchedAt);
  const overdueRatio = nextFetchMs == null
    ? 2
    : clamp((nowMs - nextFetchMs) / intervalMs, 0, 12);
  const ageRatio = lastFetchedMs == null
    ? 8
    : Math.max(0, (nowMs - lastFetchedMs) / intervalMs);
  const priority = resolvePriority(candidate);
  const priorityScore = round((1 + overdueRatio) * priority);
  const starvationScore = lastFetchedMs == null
    ? 12
    : round(clamp(ageRatio - 2, 0, 12) * 1.5);
  const fetchCost = estimateSourceFetchCost(candidate);
  const costPenalty = round(fetchCost * 0.75);
  const healthScore = clamp(Number(candidate.healthScore) || 0, 0, 100);
  const errorCount = Math.max(0, Number(candidate.errorCount) || 0);
  const reliabilityPenalty = round(
    clamp((60 - healthScore) / 20, 0, 3)
    + clamp(errorCount, 0, 6) * 0.5,
  );
  const score = round(priorityScore + starvationScore - costPenalty - reliabilityPenalty);

  const reason = lastFetchedMs == null
    ? '首次抓取优先'
    : starvationScore > priorityScore
      ? '长期未抓取补偿'
      : overdueRatio >= 1
        ? '逾期程度与来源优先级'
        : '来源优先级与抓取成本';

  return {
    ...candidate,
    score,
    overdueRatio: round(overdueRatio),
    priorityScore,
    starvationScore,
    fetchCost,
    costPenalty,
    reliabilityPenalty,
    reason,
  };
}

export function rankDueSources<T extends SourceSchedulingCandidate>(
  candidates: T[],
  now = new Date(),
): Array<SourceSchedulingScore<T>> {
  return candidates
    .map((candidate) => scoreSourceSchedulingCandidate(candidate, now))
    .sort((left, right) => (
      right.score - left.score
      || right.overdueRatio - left.overdueRatio
      || (timestamp(left.nextFetchAt) ?? 0) - (timestamp(right.nextFetchAt) ?? 0)
      || left.id - right.id
    ));
}
