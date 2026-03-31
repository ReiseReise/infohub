export const GROWTH_AXES = ['认知升级', '技术能力', '商业判断', '表达输出'] as const;
export type GrowthAxis = typeof GROWTH_AXES[number];

export const SOURCE_TIERS = ['S', 'A', 'B', 'C', 'D'] as const;
export type SourceTier = typeof SOURCE_TIERS[number];

export const PROCESSING_PROFILES = ['full', 'smart', 'brief', 'monitor'] as const;
export type ProcessingProfile = typeof PROCESSING_PROFILES[number];

const DEFAULT_GROWTH_AXES: GrowthAxis[] = ['认知升级'];

const SOURCE_TIER_DEFAULTS: Record<SourceTier, { trust: number; noise: number; processingProfile: ProcessingProfile }> = {
  S: { trust: 92, noise: 12, processingProfile: 'full' },
  A: { trust: 78, noise: 24, processingProfile: 'smart' },
  B: { trust: 62, noise: 42, processingProfile: 'brief' },
  C: { trust: 40, noise: 72, processingProfile: 'brief' },
  D: { trust: 48, noise: 58, processingProfile: 'monitor' },
};

export function normalizeStringArray(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function normalizeGrowthAxes(value: unknown, fallback: GrowthAxis[] = DEFAULT_GROWTH_AXES): GrowthAxis[] {
  const candidate = normalizeStringArray(value, GROWTH_AXES.length)
    .filter((entry): entry is GrowthAxis => GROWTH_AXES.includes(entry as GrowthAxis));
  return candidate.length > 0 ? Array.from(new Set(candidate)) : [...fallback];
}

export function normalizeSourceTier(value: unknown, fallback: SourceTier = 'B'): SourceTier {
  const candidate = String(value || '').trim().toUpperCase();
  return SOURCE_TIERS.includes(candidate as SourceTier) ? (candidate as SourceTier) : fallback;
}

export function normalizeProcessingProfile(
  value: unknown,
  fallback: ProcessingProfile = 'brief',
): ProcessingProfile {
  const candidate = String(value || '').trim().toLowerCase();
  return PROCESSING_PROFILES.includes(candidate as ProcessingProfile)
    ? (candidate as ProcessingProfile)
    : fallback;
}

export function defaultSourceTierForContext(input: {
  sourceRole?: string | null;
  collectorType?: string | null;
  sourceType?: string | null;
  category?: string | null;
}): SourceTier {
  const sourceRole = String(input.sourceRole || '').trim().toLowerCase();
  const collectorType = String(input.collectorType || '').trim().toLowerCase();
  const sourceType = String(input.sourceType || '').trim().toLowerCase();
  const category = String(input.category || '').trim().toLowerCase();

  if (
    sourceRole === 'monitor'
    || collectorType === 'changedetection'
    || category === '监控'
    || category === 'monitor'
  ) {
    return 'D';
  }
  if (sourceType === 'podcast' || sourceType === 'audio' || sourceType === 'newsletter') {
    return 'A';
  }
  if (collectorType === 'custom') {
    return 'S';
  }
  if (collectorType === 'webpage') {
    return 'B';
  }
  return 'B';
}

export function defaultProcessingProfileForTier(
  tier: SourceTier,
  sourceRole?: string | null,
): ProcessingProfile {
  if (String(sourceRole || '').trim().toLowerCase() === 'monitor') return 'monitor';
  return SOURCE_TIER_DEFAULTS[tier].processingProfile;
}

export function normalizeTrustScore(value: unknown, tier: SourceTier): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return SOURCE_TIER_DEFAULTS[tier].trust;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function normalizeNoiseScore(value: unknown, tier: SourceTier): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return SOURCE_TIER_DEFAULTS[tier].noise;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function normalizeUpgradeRules(value: unknown, tier: SourceTier): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (tier === 'D') {
    return {
      promoteOnHighScore: 85,
      promoteOnRepeatedSignals: 3,
      enableFullTextOnPromotion: true,
    };
  }
  if (tier === 'C') {
    return {
      promoteOnHighScore: 78,
      promoteOnRepeatedSignals: 2,
      enableFullTextOnPromotion: true,
    };
  }
  return {
    promoteOnHighScore: 72,
    promoteOnRepeatedSignals: 2,
    enableFullTextOnPromotion: tier !== 'B',
  };
}

export function deriveSourceProfile(input: {
  sourceTier?: unknown;
  processingProfile?: unknown;
  growthAxes?: unknown;
  trustScore?: unknown;
  noiseScore?: unknown;
  upgradeRules?: unknown;
  sourceRole?: string | null;
  collectorType?: string | null;
  sourceType?: string | null;
  category?: string | null;
}) {
  const derivedTier = normalizeSourceTier(
    input.sourceTier,
    defaultSourceTierForContext(input),
  );
  const processingProfile = normalizeProcessingProfile(
    input.processingProfile,
    defaultProcessingProfileForTier(derivedTier, input.sourceRole),
  );
  return {
    sourceTier: derivedTier,
    processingProfile,
    growthAxes: normalizeGrowthAxes(input.growthAxes),
    trustScore: normalizeTrustScore(input.trustScore, derivedTier),
    noiseScore: normalizeNoiseScore(input.noiseScore, derivedTier),
    upgradeRules: normalizeUpgradeRules(input.upgradeRules, derivedTier),
  };
}

function inferAxisByKeyword(text: string): GrowthAxis[] {
  const normalized = text.toLowerCase();
  const axes = new Set<GrowthAxis>();

  if (/(研究|认知|学习|决策|方法|框架|思维|哲学|productivity|workflow|systems thinking|strategy)/i.test(normalized)) {
    axes.add('认知升级');
  }
  if (/(技术|模型|工程|代码|开发|agent|api|开源|infra|framework|benchmark|deployment|prompt|llm)/i.test(normalized)) {
    axes.add('技术能力');
  }
  if (/(商业|市场|增长|融资|资本|营收|创业|竞争|公司|战略|定价|监管|business|startup|funding|revenue|policy)/i.test(normalized)) {
    axes.add('商业判断');
  }
  if (/(写作|表达|内容|传播|叙事|品牌|演讲|营销|播客|newsletter|storytelling|communication|creator)/i.test(normalized)) {
    axes.add('表达输出');
  }

  return axes.size > 0 ? Array.from(axes) : [...DEFAULT_GROWTH_AXES];
}

export function inferGrowthAxesFromText(input: {
  title?: string | null;
  summary?: string | null;
  tags?: unknown;
  category?: string | null;
}): GrowthAxis[] {
  const tags = normalizeStringArray(input.tags, 8).join(' ');
  const merged = [
    input.title || '',
    input.summary || '',
    input.category || '',
    tags,
  ].join(' \n ');
  return inferAxisByKeyword(merged);
}

export function resolveItemGrowthAxes(input: {
  growthAxes?: unknown;
  title?: string | null;
  aiSummary?: string | null;
  aiTags?: unknown;
  sourceCategory?: string | null;
}): GrowthAxis[] {
  const explicitAxes = normalizeGrowthAxes(input.growthAxes, []);
  if (explicitAxes.length > 0) return explicitAxes;
  return inferGrowthAxesFromText({
    title: input.title,
    summary: input.aiSummary,
    tags: input.aiTags,
    category: input.sourceCategory,
  });
}
