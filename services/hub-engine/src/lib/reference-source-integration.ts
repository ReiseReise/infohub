import type { ReferenceSourceCatalogItem } from './reference-source-catalog.js';
import { FOLLOW_BUILDERS_X_URL, FOLLOW_BUILDERS_X_HANDLES } from '../collectors/follow-builders.js';

export type ReferenceIntegrationStatus = 'available' | 'shadow' | 'active' | 'paused' | 'removed';

export type ReferenceSourceQualityInput = {
  createdAt?: Date | string | null;
  fetchAttempts: number;
  fetchSuccesses: number;
  itemCount: number;
  relevantItemCount: number;
  aiProcessedItemCount: number;
  originalLinkCount: number;
  noiseItemCount: number;
  duplicateCount: number;
  componentHealth?: Record<string, {
    name?: string;
    required?: boolean;
    attempts7d?: number;
    successes7d?: number;
    successRate?: number | null;
    lastOutcome?: string;
    lastError?: string | null;
    lastCheckedAt?: string;
  }>;
};

export type ReferenceComponentQuality = {
  key: string;
  name: string;
  required: boolean;
  attempts7d: number;
  successes7d: number;
  successRate: number | null;
  lastOutcome: string;
  lastError: string | null;
  lastCheckedAt: string | null;
  eligible: boolean;
};

export type ReferenceSourceQualityMetrics = {
  windowDays: 7;
  observationDays: number;
  fetchAttempts: number;
  fetchSuccessRate: number | null;
  itemCount: number;
  aiRelevanceRate: number | null;
  aiProcessingRate: number | null;
  originalLinkRate: number | null;
  noiseRate: number | null;
  duplicateRate: number | null;
  componentHealth: ReferenceComponentQuality[];
  eligibleForActivation: boolean;
  activationReasons: string[];
};

export type ReferenceFetchAttempt = {
  status?: string | null;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
};

export type ReferenceFetchRunSummary = {
  rawAttempts: number;
  fetchAttempts: number;
  fetchSuccesses: number;
  recoveredRetries: number;
};

export type ReferenceIntegrationSourceDefinition = {
  name: string;
  sourceType: string;
  collectorType: string;
  sourceKind: string;
  sourceRole: string;
  sourceTier: string;
  authorityWeight: number;
  processingProfile: string;
  trustScore: number;
  noiseScore: number;
  growthAxes: string[];
  upgradeRules: Record<string, unknown>;
  config: Record<string, unknown>;
  category: string;
  priority: number;
  fetchInterval: number;
  autoFetchEnabled: boolean;
  autoTranscribe: boolean;
  status: 'active' | 'paused';
  tags: string[];
};

const REFERENCE_SHADOW_LIMIT = 10;
const REFERENCE_FORMAL_LIMIT = 5;
const TOTAL_SCHEDULED_LIMIT = 31;
export const MIN_REFERENCE_AI_PROCESSING_RATE = 0.60;

export const REFERENCE_SOURCE_LIMITS = {
  // Legacy fields remain for API compatibility.
  referenceActive: REFERENCE_FORMAL_LIMIT,
  totalActive: TOTAL_SCHEDULED_LIMIT,
  referenceShadow: REFERENCE_SHADOW_LIMIT,
  referenceFormal: REFERENCE_FORMAL_LIMIT,
  totalScheduled: TOTAL_SCHEDULED_LIMIT,
} as const;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.max(0, Math.min(1, numerator / denominator));
}

function observedDays(createdAt: ReferenceSourceQualityInput['createdAt'], now: Date): number {
  if (!createdAt) return 0;
  const parsed = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / (24 * 3600 * 1000)));
}

function timestamp(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  const result = parsed.getTime();
  return Number.isFinite(result) ? result : null;
}

/**
 * BullMQ retries create a fetch log for every attempt. Collapse a transient
 * failure followed by a quick success into one logical run so the activation
 * gate measures unresolved failures instead of retry mechanics.
 */
export function summarizeReferenceFetchRuns(
  rows: ReferenceFetchAttempt[],
  retryRecoveryWindowMs = 60_000,
): ReferenceFetchRunSummary {
  const terminalRows = rows
    .map((row, index) => ({ row, index, startedAt: timestamp(row.startedAt) }))
    .filter(({ row }) => row.status === 'success' || row.status === 'error')
    .sort((left, right) => {
      if (left.startedAt === null && right.startedAt === null) return left.index - right.index;
      if (left.startedAt === null) return 1;
      if (right.startedAt === null) return -1;
      return left.startedAt - right.startedAt || left.index - right.index;
    });

  let fetchAttempts = 0;
  let fetchSuccesses = 0;
  let recoveredRetries = 0;
  let pendingFailure: { startedAt: number | null; finishedAt: number | null } | null = null;

  const flushFailure = () => {
    if (!pendingFailure) return;
    fetchAttempts += 1;
    pendingFailure = null;
  };

  for (const { row, startedAt } of terminalRows) {
    const finishedAt = timestamp(row.finishedAt);
    if (row.status === 'success') {
      if (pendingFailure) {
        const failureEndedAt = pendingFailure.finishedAt ?? pendingFailure.startedAt;
        const recovered = failureEndedAt !== null
          && startedAt !== null
          && startedAt >= failureEndedAt
          && startedAt - failureEndedAt <= retryRecoveryWindowMs;
        if (recovered) {
          fetchAttempts += 1;
          fetchSuccesses += 1;
          recoveredRetries += 1;
          pendingFailure = null;
          continue;
        }
        flushFailure();
      }
      fetchAttempts += 1;
      fetchSuccesses += 1;
      continue;
    }

    if (pendingFailure) {
      const previousEndedAt = pendingFailure.finishedAt ?? pendingFailure.startedAt;
      const sameRetryRun = previousEndedAt !== null
        && startedAt !== null
        && startedAt >= previousEndedAt
        && startedAt - previousEndedAt <= retryRecoveryWindowMs;
      if (!sameRetryRun) flushFailure();
    }
    pendingFailure = { startedAt, finishedAt };
  }

  flushFailure();
  return {
    rawAttempts: terminalRows.length,
    fetchAttempts,
    fetchSuccesses,
    recoveredRetries,
  };
}

export function evaluateReferenceSourceQuality(
  input: ReferenceSourceQualityInput,
  now = new Date(),
): ReferenceSourceQualityMetrics {
  const observationDays = observedDays(input.createdAt, now);
  const fetchSuccessRate = rate(input.fetchSuccesses, input.fetchAttempts);
  const aiRelevanceRate = rate(input.relevantItemCount, input.itemCount);
  const aiProcessingRate = rate(input.aiProcessedItemCount, input.itemCount);
  const originalLinkRate = rate(input.originalLinkCount, input.itemCount);
  const noiseRate = rate(input.noiseItemCount, input.itemCount);
  const duplicateRate = rate(input.duplicateCount, input.duplicateCount + input.itemCount);
  const activationReasons: string[] = [];
  const componentHealth = Object.entries(input.componentHealth || {}).map(([key, component]) => {
    const attempts7d = Number(component.attempts7d || 0);
    const successes7d = Number(component.successes7d || 0);
    const successRate = component.successRate === null || component.successRate === undefined
      ? rate(successes7d, attempts7d)
      : Number(component.successRate);
    const required = component.required !== false;
    const eligible = !required || (attempts7d > 0 && (successRate || 0) >= 0.95);
    return {
      key,
      name: String(component.name || key),
      required,
      attempts7d,
      successes7d,
      successRate,
      lastOutcome: String(component.lastOutcome || 'unknown'),
      lastError: component.lastError ? String(component.lastError) : null,
      lastCheckedAt: component.lastCheckedAt ? String(component.lastCheckedAt) : null,
      eligible,
    } satisfies ReferenceComponentQuality;
  });

  if (observationDays < 7) activationReasons.push(`影子观察尚未满 7 天（当前 ${observationDays} 天）`);
  if (input.fetchAttempts === 0) activationReasons.push('尚无抓取记录');
  else if ((fetchSuccessRate || 0) < 0.95) activationReasons.push('抓取成功率低于 95%');
  if (input.itemCount === 0) activationReasons.push('尚无候选内容');
  else {
    if ((aiRelevanceRate || 0) < 0.85) activationReasons.push('主题相关率低于 85%');
    if ((aiProcessingRate || 0) < MIN_REFERENCE_AI_PROCESSING_RATE) activationReasons.push('AI 处理率低于 60%');
    if ((originalLinkRate || 0) < 0.95) activationReasons.push('原文链接完整率低于 95%');
    if ((noiseRate ?? 1) >= 0.1) activationReasons.push('噪音率未低于 10%');
  }
  for (const component of componentHealth.filter((entry) => entry.required && !entry.eligible)) {
    activationReasons.push(`${component.name} 组件抓取成功率未达到 95%`);
  }

  return {
    windowDays: 7,
    observationDays,
    fetchAttempts: input.fetchAttempts,
    fetchSuccessRate,
    itemCount: input.itemCount,
    aiRelevanceRate,
    aiProcessingRate,
    originalLinkRate,
    noiseRate,
    duplicateRate,
    componentHealth,
    eligibleForActivation: activationReasons.length === 0,
    activationReasons,
  };
}

export function resolveReferenceIntegrationStatus(source: {
  status?: string | null;
  config?: unknown;
} | null | undefined): ReferenceIntegrationStatus {
  if (!source) return 'available';
  const config = asObject(source.config);
  const configured = String(config.integrationStatus || '').trim();
  if (configured === 'shadow' || configured === 'active' || configured === 'paused' || configured === 'removed') {
    return configured;
  }
  return source.status === 'active' ? 'active' : source.status === 'paused' ? 'paused' : 'available';
}

export function assertReferenceSourceCapacity(params: {
  totalScheduled: number;
  referenceShadow: number;
  referenceFormal: number;
  targetStatus: 'shadow' | 'active';
  alreadyScheduled?: boolean;
  alreadyFormal?: boolean;
}): void {
  if (!params.alreadyScheduled && params.totalScheduled >= TOTAL_SCHEDULED_LIMIT) {
    throw new Error(`总调度来源已达到上限 ${TOTAL_SCHEDULED_LIMIT}，请先暂停其他来源`);
  }
  if (params.targetStatus === 'shadow' && !params.alreadyScheduled && params.referenceShadow >= REFERENCE_SHADOW_LIMIT) {
    throw new Error(`影子来源已达到上限 ${REFERENCE_SHADOW_LIMIT}，第 11 个影子来源不会进入调度`);
  }
  if (params.targetStatus === 'active' && !params.alreadyFormal && params.referenceFormal >= REFERENCE_FORMAL_LIMIT) {
    throw new Error(`正式参考来源已达到上限 ${REFERENCE_FORMAL_LIMIT}，请先暂停其他正式参考来源`);
  }
}

function commonConfig(candidate: ReferenceSourceCatalogItem, status: Exclude<ReferenceIntegrationStatus, 'available'>) {
  return {
    integrationType: 'reference_source',
    integrationStatus: status,
    externalSourceId: candidate.providerSourceId,
    referenceCatalogKey: candidate.key,
    referenceProvider: candidate.provider,
    readingTier: candidate.readingTier,
    attribution: {
      provider: candidate.providerLabel,
      sourceUrl: candidate.provenance.sourceUrl,
      siteUrl: candidate.siteUrl,
      license: candidate.provenance.license || null,
      required: Boolean(candidate.provenance.attributionRequired),
    },
    lastFingerprint: null,
  };
}

function sourceProfile(candidate: ReferenceSourceCatalogItem) {
  const highValue = candidate.readingTier === 'high_value';
  const lightReading = candidate.readingTier === 'light_reading';
  return {
    sourceTier: candidate.sourceTier,
    authorityWeight: candidate.sourceTier === 'S' ? 1.5 : candidate.sourceTier === 'A' ? 1.25 : 1,
    processingProfile: highValue ? 'full' : lightReading ? 'smart' : 'brief',
    trustScore: candidate.sourceTier === 'S' ? 94 : candidate.sourceTier === 'A' ? 84 : 70,
    noiseScore: highValue ? 14 : lightReading ? 30 : 55,
    growthAxes: highValue ? ['技术能力', '认知升级'] : ['认知升级'],
  };
}

export function buildReferenceIntegrationSourceDefinition(
  candidate: ReferenceSourceCatalogItem,
  integrationStatus: Exclude<ReferenceIntegrationStatus, 'available' | 'removed'> = 'shadow',
): ReferenceIntegrationSourceDefinition {
  const profile = sourceProfile(candidate);
  const sourceStatus: 'active' | 'paused' = integrationStatus === 'paused' ? 'paused' : 'active';
  const sourceRole = candidate.key === 'aihot:channel:selected'
    ? 'radar'
    : integrationStatus === 'active'
      ? 'normal'
      : 'reference';
  const base = {
    name: candidate.name,
    sourceKind: candidate.sourceKind,
    sourceRole,
    ...profile,
    upgradeRules: {},
    category: candidate.category,
    priority: candidate.sourceTier === 'S' ? 5 : candidate.sourceTier === 'A' ? 4 : 3,
    autoFetchEnabled: integrationStatus !== 'paused',
    autoTranscribe: false,
    status: sourceStatus,
    tags: [
      `reference:${candidate.provider}`,
      `channel:${candidate.channel}`,
      candidate.readingTier,
      `integration:${integrationStatus}`,
    ],
  };

  if (candidate.key === 'follow_builders:feed:x-selected' && candidate.provider === 'follow_builders') {
    return {
      ...base, sourceType: 'social', sourceKind: 'x', collectorType: 'custom', processingProfile: 'brief',
      config: {
        ...commonConfig(candidate, integrationStatus),
        provider: 'follow_builders_x', endpoint: FOLLOW_BUILDERS_X_URL,
        selectedHandles: [...FOLLOW_BUILDERS_X_HANDLES], contentStrategy: 'brief', maxItems: 15,
      },
      fetchInterval: 360,
    };
  }

  if (candidate.provider === 'follow_builders' && candidate.channel === 'x') {
    throw new Error('单个 X 账号仅保留为候选线索；请使用已适配的 Follow Builders X 精选');
  }

  if (candidate.provider === 'origin12') {
    const definitions: Record<string, {
      provider: string;
      fetchInterval: number;
      sourceType: string;
      maxItems: number;
    }> = {
      'origin12:ai-news': { provider: 'origin12_ai_news', fetchInterval: 360, sourceType: 'curated_index', maxItems: 1 },
      'origin12:the-batch': { provider: 'origin12_the_batch', fetchInterval: 720, sourceType: 'curated_index', maxItems: 1 },
      'origin12:research-radar': { provider: 'origin12_research_radar', fetchInterval: 360, sourceType: 'curated_index', maxItems: 30 },
      'origin12:model-reality': { provider: 'origin12_model_reality', fetchInterval: 1440, sourceType: 'curated_index', maxItems: 1 },
      'origin12:semianalysis': { provider: 'origin12_semianalysis', fetchInterval: 720, sourceType: 'curated_index', maxItems: 20 },
    };
    const origin = definitions[candidate.key];
    if (!origin) throw new Error('源头信息员候选缺少已登记的专用适配器');
    return {
      ...base,
      sourceType: origin.sourceType,
      collectorType: 'custom',
      config: {
        ...commonConfig(candidate, integrationStatus),
        provider: origin.provider,
        contentStrategy: 'brief',
        maxItems: origin.maxItems,
      },
      fetchInterval: origin.fetchInterval,
    };
  }

  if (candidate.key === 'aihot:channel:selected') {
    return {
      ...base,
      sourceType: 'curated_index',
      collectorType: 'custom',
      sourceRole: 'radar',
      config: {
        ...commonConfig(candidate, integrationStatus),
        provider: 'aihot_selected',
        endpoint: 'https://aihot.virxact.com/api/public/items?mode=selected',
        contentStrategy: 'smart',
        maxItems: 50,
      },
      fetchInterval: 120,
    };
  }

  if (candidate.importMode === 'podcast' && candidate.feedUrl) {
    return {
      ...base,
      sourceType: 'audio',
      collectorType: 'rss',
      config: {
        ...commonConfig(candidate, integrationStatus),
        url: candidate.feedUrl,
        htmlUrl: candidate.siteUrl,
        contentStrategy: 'smart',
      },
      fetchInterval: 720,
    };
  }

  if (candidate.importMode === 'rss' && candidate.feedUrl) {
    return {
      ...base,
      sourceType: 'rss',
      collectorType: 'rss',
      config: {
        ...commonConfig(candidate, integrationStatus),
        url: candidate.feedUrl,
        htmlUrl: candidate.siteUrl,
        contentStrategy: candidate.readingTier === 'high_value' ? 'full' : 'smart',
      },
      fetchInterval: candidate.readingTier === 'high_value' ? 90 : 180,
    };
  }

  if (candidate.importMode === 'adapter_required' && candidate.siteUrl) {
    return {
      ...base,
      sourceType: 'curated_index',
      collectorType: 'webpage_index',
      config: {
        ...commonConfig(candidate, integrationStatus),
        url: candidate.siteUrl,
        indexKind: 'generic_article_index',
        renderMode: 'auto',
        contentStrategy: 'full',
      },
      fetchInterval: 180,
    };
  }

  throw new Error('该候选来源缺少可验证的接入方式，只能保留在候选库中');
}

export function buildReferenceIntegrationConfigPatch(
  sourceConfig: unknown,
  status: Exclude<ReferenceIntegrationStatus, 'available'>,
): Record<string, unknown> {
  return {
    ...asObject(sourceConfig),
    integrationType: 'reference_source',
    integrationStatus: status,
    integrationUpdatedAt: new Date().toISOString(),
  };
}
