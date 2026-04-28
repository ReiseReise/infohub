import type { SourceTier } from './growth.js';

export const QUALITY_DECISIONS = ['pass', 'review', 'filter'] as const;
export type QualityDecision = typeof QUALITY_DECISIONS[number];

export const QUALITY_POLICY_MODES = ['skip', 'light', 'standard', 'strict', 'monitor'] as const;
export type QualityPolicyMode = typeof QUALITY_POLICY_MODES[number];

export type FilterBucket = 'main' | 'filtered';

export type QualityPolicy = {
  mode: QualityPolicyMode;
  onFilter: 'review' | 'filter';
  minConfidence: number;
};

export type QualityOutcome = {
  itemId: string;
  sourceTier: SourceTier;
  qualityDecision: QualityDecision;
  summary: string | null;
  qualityReason: string | null;
  qualityTags: string[];
  qualityRiskFlags: string[];
  qualityScore: number | null;
  qualityConfidence: number | null;
  filterBucket: FilterBucket;
  isFiltered: boolean;
  filterReason: string | null;
};

export const DEFAULT_TIER_QUALITY_POLICIES: Record<SourceTier, QualityPolicy> = {
  S: { mode: 'skip', onFilter: 'review', minConfidence: 1 },
  A: { mode: 'light', onFilter: 'review', minConfidence: 0.78 },
  B: { mode: 'standard', onFilter: 'filter', minConfidence: 0.72 },
  C: { mode: 'strict', onFilter: 'filter', minConfidence: 0.55 },
  D: { mode: 'monitor', onFilter: 'filter', minConfidence: 0.45 },
};

export function mergeQualityPolicy(
  base: QualityPolicy,
  override?: Partial<QualityPolicy> | null,
): QualityPolicy {
  return {
    mode: override?.mode ?? base.mode,
    onFilter: override?.onFilter ?? base.onFilter,
    minConfidence: normalizeConfidence(override?.minConfidence ?? base.minConfidence),
  };
}

export function resolveEffectiveQualityPolicy(input: {
  sourceTier: SourceTier;
  tierOverride?: Partial<QualityPolicy> | null;
  sourceOverride?: Partial<QualityPolicy> | null;
}) {
  const base = DEFAULT_TIER_QUALITY_POLICIES[input.sourceTier];
  const tierPolicy = mergeQualityPolicy(base, input.tierOverride);
  return mergeQualityPolicy(tierPolicy, input.sourceOverride);
}

export function normalizeQualityDecision(value: unknown): QualityDecision {
  const candidate = String(value || '').trim().toLowerCase();
  if (QUALITY_DECISIONS.includes(candidate as QualityDecision)) {
    return candidate as QualityDecision;
  }
  return 'review';
}

export function normalizeConfidence(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.6;
  return Math.max(0, Math.min(1, Number(parsed.toFixed(3))));
}

function toReviewReason(reason?: string | null, confidence?: number | null) {
  const trimmed = String(reason || '').trim();
  if (confidence != null && Number.isFinite(confidence)) {
    return `待复核：${trimmed || '命中过滤规则'}（置信度不足 ${Math.round(confidence * 100)}%）`;
  }
  return `待复核：${trimmed || '命中过滤规则'}`;
}

export function resolveQualityOutcome(input: {
  itemId: string;
  sourceTier: SourceTier;
  summary?: string | null;
  reason?: string | null;
  tags?: string[];
  riskFlags?: string[];
  decision?: QualityDecision | string | null;
  confidence?: number | null;
  score?: number | null;
  policy: QualityPolicy;
}): QualityOutcome {
  const confidence = input.confidence == null ? null : normalizeConfidence(input.confidence);
  const decision = normalizeQualityDecision(input.decision);
  const summary = String(input.summary || '').trim() || null;
  const reason = String(input.reason || '').trim() || null;
  const qualityTags = Array.isArray(input.tags) ? input.tags.filter(Boolean).slice(0, 8) : [];
  const qualityRiskFlags = Array.isArray(input.riskFlags) ? input.riskFlags.filter(Boolean).slice(0, 8) : [];

  if (input.policy.mode === 'skip') {
    return {
      itemId: input.itemId,
      sourceTier: input.sourceTier,
      qualityDecision: 'pass',
      summary,
      qualityReason: null,
      qualityTags,
      qualityRiskFlags,
      qualityScore: input.score ?? null,
      qualityConfidence: confidence,
      filterBucket: 'main',
      isFiltered: false,
      filterReason: null,
    };
  }

  if (decision === 'pass') {
    return {
      itemId: input.itemId,
      sourceTier: input.sourceTier,
      qualityDecision: 'pass',
      summary,
      qualityReason: null,
      qualityTags,
      qualityRiskFlags,
      qualityScore: input.score ?? null,
      qualityConfidence: confidence,
      filterBucket: 'main',
      isFiltered: false,
      filterReason: null,
    };
  }

  if (decision === 'review') {
    const reviewReason = toReviewReason(reason);
    return {
      itemId: input.itemId,
      sourceTier: input.sourceTier,
      qualityDecision: 'review',
      summary,
      qualityReason: reviewReason,
      qualityTags,
      qualityRiskFlags,
      qualityScore: input.score ?? null,
      qualityConfidence: confidence,
      filterBucket: 'main',
      isFiltered: false,
      filterReason: reviewReason,
    };
  }

  const confidenceTooLow = confidence != null && confidence < input.policy.minConfidence;
  if (confidenceTooLow || input.policy.onFilter === 'review') {
    const reviewReason = toReviewReason(reason, confidenceTooLow ? confidence : null);
    return {
      itemId: input.itemId,
      sourceTier: input.sourceTier,
      qualityDecision: 'review',
      summary,
      qualityReason: reviewReason,
      qualityTags,
      qualityRiskFlags,
      qualityScore: input.score ?? null,
      qualityConfidence: confidence,
      filterBucket: 'main',
      isFiltered: false,
      filterReason: reviewReason,
    };
  }

  return {
    itemId: input.itemId,
    sourceTier: input.sourceTier,
    qualityDecision: 'filter',
    summary,
    qualityReason: reason,
    qualityTags,
    qualityRiskFlags,
    qualityScore: input.score ?? null,
    qualityConfidence: confidence,
    filterBucket: 'filtered',
    isFiltered: true,
    filterReason: reason,
  };
}
