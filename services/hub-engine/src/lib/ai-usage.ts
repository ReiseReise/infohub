import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

type UsageValue = number | null | undefined;

export type AiUsageLogInput = {
  userId: string;
  sceneType: string;
  status: 'success' | 'error' | 'skipped' | string;
  provider?: string | null;
  modelName?: string | null;
  endpointId?: string | null;
  modelConfigId?: string | null;
  promptTemplateId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  inputTokens?: UsageValue;
  outputTokens?: UsageValue;
  totalTokens?: UsageValue;
  estimatedCost?: UsageValue;
  latencyMs?: UsageValue;
  providerRequestId?: string | null;
  apiKind?: string | null;
  promptPreview?: string | null;
  responsePreview?: string | null;
  label?: string | null;
  errorMessage?: string | null;
};

export type AiUsageTimeQuery = {
  timeWindow?: '24h' | '7d' | '30d' | string | null;
  interval?: 'hour' | 'day' | string | null;
  from?: string | null;
  to?: string | null;
};

type SummaryBucket = {
  key: string;
  count: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  avgLatencyMs?: number | null;
};

type TrendBucket = {
  bucket: string;
  calls: number;
  success: number;
  error: number;
  estimatedCost: number;
  totalTokens: number;
  avgLatencyMs: number | null;
};

type HotspotBucket = {
  key: string;
  count: number;
  estimatedCost: number;
  avgLatencyMs: number | null;
};

type AiUsageSummary = {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCost: number;
  byScene: SummaryBucket[];
  byProvider: SummaryBucket[];
  byModel: SummaryBucket[];
  byStatus: SummaryBucket[];
  trends: TrendBucket[];
  hotspots: {
    errors: HotspotBucket[];
    expensive: HotspotBucket[];
    slow: HotspotBucket[];
  };
};

function preview(value?: string | null, limit = 400) {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1).trimEnd()}…`;
}

function resolveTimeRange(query: AiUsageTimeQuery = {}) {
  const now = new Date();
  const parsedFrom = query.from ? new Date(query.from) : null;
  const parsedTo = query.to ? new Date(query.to) : null;
  if (parsedFrom && !Number.isNaN(parsedFrom.getTime())) {
    return {
      from: parsedFrom,
      to: parsedTo && !Number.isNaN(parsedTo.getTime()) ? parsedTo : now,
      interval: query.interval === 'hour' ? 'hour' : 'day',
    } as const;
  }

  const from = new Date(now);
  const timeWindow = query.timeWindow || '7d';
  if (timeWindow === '24h') from.setHours(from.getHours() - 24);
  else if (timeWindow === '30d') from.setDate(from.getDate() - 30);
  else from.setDate(from.getDate() - 7);

  return {
    from,
    to: now,
    interval: query.interval === 'hour' || timeWindow === '24h' ? 'hour' : 'day',
  } as const;
}

function toSummaryBuckets<T extends { key: string | null; count: number | null; inputTokens: number | null; outputTokens: number | null; estimatedCost: number | null; avgLatencyMs?: number | null }>(
  rows: T[],
): SummaryBucket[] {
  return rows.map((row) => ({
    key: row.key || 'unknown',
    count: Number(row.count || 0),
    inputTokens: Number(row.inputTokens || 0),
    outputTokens: Number(row.outputTokens || 0),
    estimatedCost: Number(row.estimatedCost || 0),
    avgLatencyMs: row.avgLatencyMs != null ? Number(row.avgLatencyMs) : null,
  }));
}

export async function logAiUsage(entry: AiUsageLogInput) {
  await db.insert(schema.aiUsageLogs).values({
    userId: entry.userId,
    sceneType: entry.sceneType,
    status: entry.status,
    provider: entry.provider || null,
    modelName: entry.modelName || null,
    endpointId: entry.endpointId || null,
    modelConfigId: entry.modelConfigId || null,
    promptTemplateId: entry.promptTemplateId || null,
    targetType: entry.targetType || null,
    targetId: entry.targetId || null,
    inputTokens: entry.inputTokens ?? null,
    outputTokens: entry.outputTokens ?? null,
    totalTokens: entry.totalTokens ?? null,
    estimatedCost: entry.estimatedCost ?? null,
    latencyMs: entry.latencyMs ?? null,
    providerRequestId: entry.providerRequestId || null,
    apiKind: entry.apiKind || null,
    promptPreview: preview(entry.promptPreview),
    responsePreview: preview(entry.responsePreview),
    label: entry.label || null,
    errorMessage: entry.errorMessage || null,
  });
}

export async function getAiUsageSummary(query: AiUsageTimeQuery = {}): Promise<AiUsageSummary> {
  const timeRange = resolveTimeRange(query);
  const conditions = [
    gte(schema.aiUsageLogs.createdAt, timeRange.from),
    lte(schema.aiUsageLogs.createdAt, timeRange.to),
  ];
  const bucketExpr = timeRange.interval === 'hour'
    ? sql<string>`to_char(date_trunc('hour', ${schema.aiUsageLogs.createdAt}), 'YYYY-MM-DD"T"HH24:00:00OF')`
    : sql<string>`to_char(date_trunc('day', ${schema.aiUsageLogs.createdAt}), 'YYYY-MM-DD"T"00:00:00OF')`;
  const targetExpr = sql<string>`coalesce(${schema.aiUsageLogs.endpointId}, ${schema.aiUsageLogs.modelName}, ${schema.aiUsageLogs.sceneType})`;

  const [totals, byScene, byProvider, byModel, byStatus, trends, hotspotErrors, hotspotExpensive, hotspotSlow] = await Promise.all([
    db
      .select({
        totalCalls: sql<number>`count(*)::int`,
        totalInputTokens: sql<number>`coalesce(sum(${schema.aiUsageLogs.inputTokens}), 0)::int`,
        totalOutputTokens: sql<number>`coalesce(sum(${schema.aiUsageLogs.outputTokens}), 0)::int`,
        totalEstimatedCost: sql<number>`coalesce(sum(${schema.aiUsageLogs.estimatedCost}), 0)::float`,
      })
      .from(schema.aiUsageLogs)
      .where(and(...conditions)),
    db
      .select({
        key: schema.aiUsageLogs.sceneType,
        count: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${schema.aiUsageLogs.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${schema.aiUsageLogs.outputTokens}), 0)::int`,
        estimatedCost: sql<number>`coalesce(sum(${schema.aiUsageLogs.estimatedCost}), 0)::float`,
        avgLatencyMs: sql<number>`coalesce(avg(${schema.aiUsageLogs.latencyMs}), 0)::float`,
      })
      .from(schema.aiUsageLogs)
      .where(and(...conditions))
      .groupBy(schema.aiUsageLogs.sceneType)
      .orderBy(sql`coalesce(sum(${schema.aiUsageLogs.estimatedCost}), 0) desc`, sql`count(*) desc`),
    db
      .select({
        key: schema.aiUsageLogs.provider,
        count: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${schema.aiUsageLogs.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${schema.aiUsageLogs.outputTokens}), 0)::int`,
        estimatedCost: sql<number>`coalesce(sum(${schema.aiUsageLogs.estimatedCost}), 0)::float`,
        avgLatencyMs: sql<number>`coalesce(avg(${schema.aiUsageLogs.latencyMs}), 0)::float`,
      })
      .from(schema.aiUsageLogs)
      .where(and(...conditions))
      .groupBy(schema.aiUsageLogs.provider)
      .orderBy(sql`coalesce(sum(${schema.aiUsageLogs.estimatedCost}), 0) desc`, sql`count(*) desc`),
    db
      .select({
        key: targetExpr,
        count: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${schema.aiUsageLogs.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${schema.aiUsageLogs.outputTokens}), 0)::int`,
        estimatedCost: sql<number>`coalesce(sum(${schema.aiUsageLogs.estimatedCost}), 0)::float`,
        avgLatencyMs: sql<number>`coalesce(avg(${schema.aiUsageLogs.latencyMs}), 0)::float`,
      })
      .from(schema.aiUsageLogs)
      .where(and(...conditions))
      .groupBy(targetExpr)
      .orderBy(sql`coalesce(sum(${schema.aiUsageLogs.estimatedCost}), 0) desc`, sql`count(*) desc`),
    db
      .select({
        key: schema.aiUsageLogs.status,
        count: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${schema.aiUsageLogs.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${schema.aiUsageLogs.outputTokens}), 0)::int`,
        estimatedCost: sql<number>`coalesce(sum(${schema.aiUsageLogs.estimatedCost}), 0)::float`,
        avgLatencyMs: sql<number>`coalesce(avg(${schema.aiUsageLogs.latencyMs}), 0)::float`,
      })
      .from(schema.aiUsageLogs)
      .where(and(...conditions))
      .groupBy(schema.aiUsageLogs.status)
      .orderBy(sql`count(*) desc`),
    db
      .select({
        bucket: bucketExpr,
        calls: sql<number>`count(*)::int`,
        success: sql<number>`sum(case when ${schema.aiUsageLogs.status} = 'success' then 1 else 0 end)::int`,
        error: sql<number>`sum(case when ${schema.aiUsageLogs.status} = 'error' then 1 else 0 end)::int`,
        estimatedCost: sql<number>`coalesce(sum(${schema.aiUsageLogs.estimatedCost}), 0)::float`,
        totalTokens: sql<number>`coalesce(sum(${schema.aiUsageLogs.totalTokens}), 0)::int`,
        avgLatencyMs: sql<number>`coalesce(avg(${schema.aiUsageLogs.latencyMs}), 0)::float`,
      })
      .from(schema.aiUsageLogs)
      .where(and(...conditions))
      .groupBy(bucketExpr)
      .orderBy(bucketExpr),
    db
      .select({
        key: sql<string>`coalesce(${schema.aiUsageLogs.errorMessage}, '未知错误')`,
        count: sql<number>`count(*)::int`,
        estimatedCost: sql<number>`coalesce(sum(${schema.aiUsageLogs.estimatedCost}), 0)::float`,
        avgLatencyMs: sql<number>`coalesce(avg(${schema.aiUsageLogs.latencyMs}), 0)::float`,
      })
      .from(schema.aiUsageLogs)
      .where(and(...conditions, eq(schema.aiUsageLogs.status, 'error')))
      .groupBy(sql`coalesce(${schema.aiUsageLogs.errorMessage}, '未知错误')`)
      .orderBy(sql`count(*) desc`)
      .limit(6),
    db
      .select({
        key: targetExpr,
        count: sql<number>`count(*)::int`,
        estimatedCost: sql<number>`coalesce(sum(${schema.aiUsageLogs.estimatedCost}), 0)::float`,
        avgLatencyMs: sql<number>`coalesce(avg(${schema.aiUsageLogs.latencyMs}), 0)::float`,
      })
      .from(schema.aiUsageLogs)
      .where(and(...conditions))
      .groupBy(targetExpr)
      .orderBy(sql`coalesce(sum(${schema.aiUsageLogs.estimatedCost}), 0) desc`, sql`count(*) desc`)
      .limit(6),
    db
      .select({
        key: schema.aiUsageLogs.sceneType,
        count: sql<number>`count(*)::int`,
        estimatedCost: sql<number>`coalesce(sum(${schema.aiUsageLogs.estimatedCost}), 0)::float`,
        avgLatencyMs: sql<number>`coalesce(avg(${schema.aiUsageLogs.latencyMs}), 0)::float`,
      })
      .from(schema.aiUsageLogs)
      .where(and(...conditions))
      .groupBy(schema.aiUsageLogs.sceneType)
      .orderBy(sql`coalesce(avg(${schema.aiUsageLogs.latencyMs}), 0) desc`, sql`count(*) desc`)
      .limit(6),
  ]);

  const totalRow = totals[0];
  return {
    totalCalls: Number(totalRow?.totalCalls || 0),
    totalInputTokens: Number(totalRow?.totalInputTokens || 0),
    totalOutputTokens: Number(totalRow?.totalOutputTokens || 0),
    totalEstimatedCost: Number(totalRow?.totalEstimatedCost || 0),
    byScene: toSummaryBuckets(byScene),
    byProvider: toSummaryBuckets(byProvider),
    byModel: toSummaryBuckets(byModel),
    byStatus: toSummaryBuckets(byStatus),
    trends: trends.map((row) => ({
      bucket: row.bucket,
      calls: Number(row.calls || 0),
      success: Number(row.success || 0),
      error: Number(row.error || 0),
      estimatedCost: Number(row.estimatedCost || 0),
      totalTokens: Number(row.totalTokens || 0),
      avgLatencyMs: row.avgLatencyMs != null ? Number(row.avgLatencyMs) : null,
    })),
    hotspots: {
      errors: hotspotErrors.map((row) => ({
        key: row.key || '未知错误',
        count: Number(row.count || 0),
        estimatedCost: Number(row.estimatedCost || 0),
        avgLatencyMs: row.avgLatencyMs != null ? Number(row.avgLatencyMs) : null,
      })),
      expensive: hotspotExpensive.map((row) => ({
        key: row.key || 'unknown',
        count: Number(row.count || 0),
        estimatedCost: Number(row.estimatedCost || 0),
        avgLatencyMs: row.avgLatencyMs != null ? Number(row.avgLatencyMs) : null,
      })),
      slow: hotspotSlow.map((row) => ({
        key: row.key || 'unknown',
        count: Number(row.count || 0),
        estimatedCost: Number(row.estimatedCost || 0),
        avgLatencyMs: row.avgLatencyMs != null ? Number(row.avgLatencyMs) : null,
      })),
    },
  };
}

export type AiUsageEventsQuery = {
  limit?: number;
  status?: string | null;
  sceneType?: string | null;
  provider?: string | null;
  search?: string | null;
  from?: string | null;
  to?: string | null;
  userId?: string | null;
};

export async function getAiUsageEvents(query: AiUsageEventsQuery = {}) {
  const conditions = [];
  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);

  if (query.status) conditions.push(eq(schema.aiUsageLogs.status, query.status));
  if (query.sceneType) conditions.push(eq(schema.aiUsageLogs.sceneType, query.sceneType));
  if (query.provider) conditions.push(eq(schema.aiUsageLogs.provider, query.provider));
  if (query.userId) conditions.push(eq(schema.aiUsageLogs.userId, query.userId));
  if (query.search?.trim()) {
    const pattern = `%${query.search.trim()}%`;
    conditions.push(or(
      ilike(schema.aiUsageLogs.sceneType, pattern),
      ilike(schema.aiUsageLogs.provider, pattern),
      ilike(schema.aiUsageLogs.modelName, pattern),
      ilike(schema.aiUsageLogs.endpointId, pattern),
      ilike(schema.aiUsageLogs.label, pattern),
      ilike(schema.aiUsageLogs.errorMessage, pattern),
      ilike(schema.aiUsageLogs.providerRequestId, pattern),
      ilike(schema.users.username, pattern),
      ilike(schema.users.email, pattern),
    ));
  }
  if (query.from) {
    const from = new Date(query.from);
    if (!Number.isNaN(from.getTime())) conditions.push(gte(schema.aiUsageLogs.createdAt, from));
  }
  if (query.to) {
    const to = new Date(query.to);
    if (!Number.isNaN(to.getTime())) conditions.push(lte(schema.aiUsageLogs.createdAt, to));
  }

  return db
    .select({
      id: schema.aiUsageLogs.id,
      userId: schema.aiUsageLogs.userId,
      username: schema.users.username,
      email: schema.users.email,
      sceneType: schema.aiUsageLogs.sceneType,
      status: schema.aiUsageLogs.status,
      provider: schema.aiUsageLogs.provider,
      modelName: schema.aiUsageLogs.modelName,
      endpointId: schema.aiUsageLogs.endpointId,
      modelConfigId: schema.aiUsageLogs.modelConfigId,
      promptTemplateId: schema.aiUsageLogs.promptTemplateId,
      targetType: schema.aiUsageLogs.targetType,
      targetId: schema.aiUsageLogs.targetId,
      inputTokens: schema.aiUsageLogs.inputTokens,
      outputTokens: schema.aiUsageLogs.outputTokens,
      totalTokens: schema.aiUsageLogs.totalTokens,
      estimatedCost: schema.aiUsageLogs.estimatedCost,
      latencyMs: schema.aiUsageLogs.latencyMs,
      providerRequestId: schema.aiUsageLogs.providerRequestId,
      apiKind: schema.aiUsageLogs.apiKind,
      promptPreview: schema.aiUsageLogs.promptPreview,
      responsePreview: schema.aiUsageLogs.responsePreview,
      label: schema.aiUsageLogs.label,
      errorMessage: schema.aiUsageLogs.errorMessage,
      createdAt: schema.aiUsageLogs.createdAt,
    })
    .from(schema.aiUsageLogs)
    .leftJoin(schema.users, eq(schema.aiUsageLogs.userId, schema.users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.aiUsageLogs.createdAt))
    .limit(limit);
}
