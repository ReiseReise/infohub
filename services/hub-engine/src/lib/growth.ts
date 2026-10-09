export const GROWTH_AXES = ['认知升级', '技术能力', '商业判断', '表达输出'] as const;
export type GrowthAxis = typeof GROWTH_AXES[number];

export const SOURCE_TIERS = ['S', 'A', 'B', 'C', 'D'] as const;
export type SourceTier = typeof SOURCE_TIERS[number];

export const PROCESSING_PROFILES = ['full', 'smart', 'brief', 'monitor'] as const;
export type ProcessingProfile = typeof PROCESSING_PROFILES[number];

const DEFAULT_GROWTH_AXES: GrowthAxis[] = ['认知升级'];

const GROWTH_AXIS_KEYWORDS: Record<GrowthAxis, RegExp[]> = {
  '认知升级': [/研究/i, /认知/i, /学习/i, /决策/i, /方法/i, /框架/i, /思维/i, /哲学/i, /productivity/i, /workflow/i, /systems thinking/i, /strategy/i],
  '技术能力': [/技术/i, /模型/i, /工程/i, /代码/i, /开发/i, /agent/i, /api/i, /开源/i, /infra/i, /framework/i, /benchmark/i, /deployment/i, /prompt/i, /llm/i],
  '商业判断': [/商业/i, /市场/i, /增长/i, /融资/i, /资本/i, /营收/i, /创业/i, /竞争/i, /公司/i, /战略/i, /定价/i, /监管/i, /business/i, /startup/i, /funding/i, /revenue/i, /policy/i],
  '表达输出': [/写作/i, /表达/i, /内容/i, /传播/i, /叙事/i, /品牌/i, /演讲/i, /营销/i, /播客/i, /newsletter/i, /storytelling/i, /communication/i, /creator/i],
};

export type GrowthAxisMappingSource = 'explicit' | 'inferred' | 'fallback';

export type GrowthAxisResolution = {
  primaryAxis: GrowthAxis;
  secondaryAxes: GrowthAxis[];
  allAxes: GrowthAxis[];
  mappingSource: GrowthAxisMappingSource;
};

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
  if (candidate === 'T1') return 'S';
  if (candidate === 'T1.5') return 'A';
  if (candidate === 'T2') return 'B';
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
  if (sourceType === 'curated_index' || collectorType === 'webpage_index') {
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

function scoreAxisText(axis: GrowthAxis, text: string, weight: number) {
  return GROWTH_AXIS_KEYWORDS[axis].reduce(
    (score, keyword) => score + (keyword.test(text) ? weight : 0),
    0,
  );
}

function inferAxisByKeyword(input: {
  title?: string | null;
  summary?: string | null;
  tags?: unknown;
  category?: string | null;
}): GrowthAxis[] {
  const title = String(input.title || '');
  const summary = String(input.summary || '');
  const tags = normalizeStringArray(input.tags, 8).join(' ');
  const category = String(input.category || '');
  return GROWTH_AXES.map((axis, order) => ({
    axis,
    order,
    score: scoreAxisText(axis, title, 4)
      + scoreAxisText(axis, tags, 3)
      + scoreAxisText(axis, category, 2)
      + scoreAxisText(axis, summary, 1),
  }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map((entry) => entry.axis);
}

export function inferGrowthAxesFromText(input: {
  title?: string | null;
  summary?: string | null;
  tags?: unknown;
  category?: string | null;
}): GrowthAxis[] {
  const inferred = inferAxisByKeyword(input);
  return inferred.length > 0 ? inferred : [...DEFAULT_GROWTH_AXES];
}

export function resolveItemGrowthAxis(input: {
  growthAxes?: unknown;
  title?: string | null;
  aiSummary?: string | null;
  aiTags?: unknown;
  sourceCategory?: string | null;
}): GrowthAxisResolution {
  const explicitAxes = normalizeGrowthAxes(input.growthAxes, []);
  const inferredAxes = inferAxisByKeyword({
    title: input.title,
    summary: input.aiSummary,
    tags: input.aiTags,
    category: input.sourceCategory,
  });
  // Historical imports assigned every source the same cognitive default. Treat
  // that single legacy value as weak evidence so content can recover a useful
  // primary axis; multi-axis or non-default manual mappings still win.
  if (
    explicitAxes.length === 1
    && explicitAxes[0] === DEFAULT_GROWTH_AXES[0]
    && inferredAxes.length > 0
    && inferredAxes[0] !== DEFAULT_GROWTH_AXES[0]
  ) {
    const allAxes = Array.from(new Set([...inferredAxes, ...explicitAxes]));
    return {
      primaryAxis: allAxes[0],
      secondaryAxes: allAxes.slice(1),
      allAxes,
      mappingSource: 'inferred',
    };
  }
  if (explicitAxes.length > 0) {
    return {
      primaryAxis: explicitAxes[0],
      secondaryAxes: explicitAxes.slice(1),
      allAxes: explicitAxes,
      mappingSource: 'explicit',
    };
  }
  const allAxes = inferredAxes.length > 0 ? inferredAxes : [...DEFAULT_GROWTH_AXES];
  return {
    primaryAxis: allAxes[0],
    secondaryAxes: allAxes.slice(1),
    allAxes,
    mappingSource: inferredAxes.length > 0 ? 'inferred' : 'fallback',
  };
}

export function resolveItemGrowthAxes(input: {
  growthAxes?: unknown;
  title?: string | null;
  aiSummary?: string | null;
  aiTags?: unknown;
  sourceCategory?: string | null;
}): GrowthAxis[] {
  return resolveItemGrowthAxis(input).allAxes;
}
