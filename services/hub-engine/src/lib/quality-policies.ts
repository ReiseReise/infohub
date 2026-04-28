import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  DEFAULT_TIER_QUALITY_POLICIES,
  QUALITY_POLICY_MODES,
  mergeQualityPolicy,
  normalizeConfidence,
  resolveEffectiveQualityPolicy,
  type QualityPolicy,
} from './quality-filtering.js';
import type { SourceTier } from './growth.js';

export type QualityPolicyScope = 'user' | 'global' | 'effective';
export type QualityPolicyTargetType = 'tier' | 'source';

export type QualityPolicyConfigInput = Partial<QualityPolicy>;

export function mergeQualityPolicyConfigInputs(...configs: Array<QualityPolicyConfigInput | null | undefined>) {
  return configs.reduce<QualityPolicyConfigInput>((acc, config) => ({
    ...acc,
    ...normalizeQualityPolicyConfig(config),
  }), {});
}

export function resolveLayeredTierPolicy(input: {
  sourceTier: SourceTier;
  globalOverride?: QualityPolicyConfigInput | null;
  userOverride?: QualityPolicyConfigInput | null;
}) {
  return resolveEffectiveQualityPolicy({
    sourceTier: input.sourceTier,
    tierOverride: mergeQualityPolicyConfigInputs(input.globalOverride, input.userOverride),
  });
}

export function normalizeQualityPolicyConfig(value: unknown): QualityPolicyConfigInput {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const mode = String(raw.mode || '').trim().toLowerCase();
  const onFilter = String(raw.onFilter || '').trim().toLowerCase();
  const config: QualityPolicyConfigInput = {};
  if (QUALITY_POLICY_MODES.includes(mode as QualityPolicy['mode'])) {
    config.mode = mode as QualityPolicy['mode'];
  }
  if (onFilter === 'review' || onFilter === 'filter') {
    config.onFilter = onFilter;
  }
  if (raw.minConfidence !== undefined) {
    config.minConfidence = normalizeConfidence(raw.minConfidence);
  }
  return config;
}

async function getEffectiveRows(userId: string) {
  const globalRows = await db
    .select()
    .from(schema.qualityPolicies)
    .where(and(eq(schema.qualityPolicies.scope, 'global'), eq(schema.qualityPolicies.enabled, true)));
  const userRows = await db
    .select()
    .from(schema.qualityPolicies)
    .where(and(eq(schema.qualityPolicies.userId, userId), eq(schema.qualityPolicies.enabled, true)));
  return [...globalRows, ...userRows];
}

export async function listQualityPolicyRows(userId: string, scope: QualityPolicyScope) {
  if (scope === 'global') {
    return db
      .select()
      .from(schema.qualityPolicies)
      .where(and(eq(schema.qualityPolicies.scope, 'global'), eq(schema.qualityPolicies.enabled, true)));
  }
  if (scope === 'effective') {
    return getEffectiveRows(userId);
  }
  return db
    .select()
    .from(schema.qualityPolicies)
    .where(and(eq(schema.qualityPolicies.userId, userId), eq(schema.qualityPolicies.enabled, true)));
}

type ResolvedTierEntry = {
  tier: SourceTier;
  overrideId: number | null;
  overrideScope: 'system' | 'global' | 'user';
  overrideConfig: QualityPolicyConfigInput | null;
  resolved: QualityPolicy;
};

type ResolvedSourceOverride = {
  id: number;
  sourceId: number;
  sourceName: string;
  sourceTier: SourceTier;
  config: QualityPolicyConfigInput;
  resolved: QualityPolicy;
  scope: 'user';
};

export async function buildQualityPolicySnapshot(userId: string, scope: QualityPolicyScope) {
  const rows = await listQualityPolicyRows(userId, scope);

  const globalTierOverrides = new Map<SourceTier, { id: number; config: QualityPolicyConfigInput }>();
  const userTierOverrides = new Map<SourceTier, { id: number; config: QualityPolicyConfigInput }>();
  const sourceRows = rows.filter((row) => row.targetType === 'source' && row.scope === 'user');
  for (const row of rows) {
    if (row.targetType !== 'tier') continue;
    const tier = String(row.targetKey || '').trim().toUpperCase() as SourceTier;
    if (!(tier in DEFAULT_TIER_QUALITY_POLICIES)) continue;
    const entry = {
      id: row.id,
      config: normalizeQualityPolicyConfig(row.config),
    };
    if (row.scope === 'global') {
      globalTierOverrides.set(tier, entry);
    } else if (row.scope === 'user') {
      userTierOverrides.set(tier, entry);
    }
  }

  const tiers = (Object.keys(DEFAULT_TIER_QUALITY_POLICIES) as SourceTier[]).map((tier) => {
    const globalOverride = globalTierOverrides.get(tier);
    const userOverride = userTierOverrides.get(tier);
    const isEffectiveScope = scope === 'effective';
    const activeOverride = isEffectiveScope
      ? (userOverride ?? globalOverride)
      : (scope === 'global' ? globalOverride : userOverride);
    return {
      tier,
      overrideId: activeOverride?.id ?? null,
      overrideScope: activeOverride
        ? (activeOverride === userOverride ? 'user' : 'global')
        : 'system',
      overrideConfig: activeOverride
        ? mergeQualityPolicyConfigInputs(globalOverride?.config, userOverride?.config)
        : null,
      resolved: isEffectiveScope
        ? resolveLayeredTierPolicy({
          sourceTier: tier,
          globalOverride: globalOverride?.config,
          userOverride: userOverride?.config,
        })
        : mergeQualityPolicy(
          DEFAULT_TIER_QUALITY_POLICIES[tier],
          (scope === 'global' ? globalOverride : userOverride)?.config,
        ),
    } satisfies ResolvedTierEntry;
  });
  const resolvedTierMap = new Map(tiers.map((entry) => [entry.tier, entry.resolved]));

  const sourceIds = sourceRows
    .map((row) => Number(row.targetKey))
    .filter((value) => Number.isInteger(value) && value > 0);
  const sources = sourceIds.length > 0
    ? await db
      .select({
        id: schema.sources.id,
        name: schema.sources.name,
        sourceTier: schema.sources.sourceTier,
        userId: schema.sources.userId,
      })
      .from(schema.sources)
      .where(and(eq(schema.sources.userId, userId), inArray(schema.sources.id, sourceIds)))
    : [];
  const sourceMap = new Map(sources.map((row) => [row.id, row]));

  const sourceOverrides = sourceRows
    .map((row) => {
      const sourceId = Number(row.targetKey);
      const source = sourceMap.get(sourceId);
      if (!source) return null;
      const config = normalizeQualityPolicyConfig(row.config);
      return {
        id: row.id,
        sourceId,
        sourceName: source.name,
        sourceTier: source.sourceTier as SourceTier,
        config,
        resolved: mergeQualityPolicy(
          resolvedTierMap.get(source.sourceTier as SourceTier)
            || DEFAULT_TIER_QUALITY_POLICIES[source.sourceTier as SourceTier],
          config,
        ),
        scope: 'user',
      } satisfies ResolvedSourceOverride;
    })
    .filter((row): row is ResolvedSourceOverride => row !== null)
    .sort((left, right) => left.sourceName.localeCompare(right.sourceName, 'zh-CN'));

  return {
    tiers,
    sourceOverrides,
  };
}

export async function getEffectiveQualityPolicyForSource(userId: string, sourceId: number, sourceTier: SourceTier) {
  const rows = await getEffectiveRows(userId);
  const globalTierOverride = rows.find((row) => (
    row.targetType === 'tier'
    && row.scope === 'global'
    && String(row.targetKey || '').toUpperCase() === sourceTier
  ));
  const userTierOverride = rows.find((row) => (
    row.targetType === 'tier'
    && row.scope === 'user'
    && String(row.targetKey || '').toUpperCase() === sourceTier
  ));
  const sourceOverride = rows.find((row) => row.targetType === 'source' && Number(row.targetKey) === sourceId && row.scope === 'user');

  return mergeQualityPolicy(
    resolveLayeredTierPolicy({
      sourceTier,
      globalOverride: normalizeQualityPolicyConfig(globalTierOverride?.config),
      userOverride: normalizeQualityPolicyConfig(userTierOverride?.config),
    }),
    normalizeQualityPolicyConfig(sourceOverride?.config),
  );
}

export async function upsertQualityPolicy(input: {
  userId: string;
  scope: 'user' | 'global';
  targetType: QualityPolicyTargetType;
  targetKey: string;
  config: QualityPolicyConfigInput;
}) {
  const existing = await db
    .select()
    .from(schema.qualityPolicies)
    .where(and(
      eq(schema.qualityPolicies.scope, input.scope),
      eq(schema.qualityPolicies.targetType, input.targetType),
      eq(schema.qualityPolicies.targetKey, input.targetKey),
      input.scope === 'global'
        ? isNull(schema.qualityPolicies.userId)
        : eq(schema.qualityPolicies.userId, input.userId),
    ))
    .limit(1);

  if (existing[0]) {
    const rows = await db.update(schema.qualityPolicies)
      .set({
        config: input.config,
        enabled: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.qualityPolicies.id, existing[0].id))
      .returning();
    return rows[0] || null;
  }

  const rows = await db.insert(schema.qualityPolicies).values({
    userId: input.scope === 'global' ? null : input.userId,
    scope: input.scope,
    targetType: input.targetType,
    targetKey: input.targetKey,
    config: input.config,
    enabled: true,
    updatedAt: new Date(),
  }).returning();
  return rows[0] || null;
}

export async function deleteQualityPolicy(input: {
  userId: string;
  scope: 'user' | 'global';
  targetType: QualityPolicyTargetType;
  targetKey: string;
}) {
  const rows = await db
    .delete(schema.qualityPolicies)
    .where(and(
      eq(schema.qualityPolicies.scope, input.scope),
      eq(schema.qualityPolicies.targetType, input.targetType),
      eq(schema.qualityPolicies.targetKey, input.targetKey),
      input.scope === 'global'
        ? isNull(schema.qualityPolicies.userId)
        : eq(schema.qualityPolicies.userId, input.userId),
    ))
    .returning();
  return rows[0] || null;
}
