import { Hono } from 'hono';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { logger } from '../lib/logger.js';
import {
  buildDibaoOpml,
  checkDibaoStatus,
  type DibaoExportSource,
  type DibaoStatus,
} from '../lib/dibao-integration.js';
import {
  buildReferenceIntegrationConfigPatch,
  buildReferenceIntegrationSourceDefinition,
  evaluateReferenceSourceQuality,
  resolveReferenceIntegrationStatus,
  assertReferenceSourceCapacity,
  summarizeReferenceFetchRuns,
  REFERENCE_SOURCE_LIMITS,
  type ReferenceIntegrationStatus,
  type ReferenceSourceQualityInput,
  type ReferenceSourceQualityMetrics,
} from '../lib/reference-source-integration.js';
import {
  loadReferenceSourceCatalog,
  type ReferenceSourceCatalog,
  type ReferenceSourceCatalogItem,
} from '../lib/reference-source-catalog.js';
import { buildSourceFingerprint } from '../lib/source-normalization.js';
import { CustomCollector } from '../collectors/custom.js';
import { RssCollector } from '../collectors/rss.js';
import { WebpageIndexCollector } from '../collectors/webpage-index.js';
import type { Collector, RawItem, SourceConfig } from '../collectors/base.js';

type ReferenceRuntimeSource = {
  id: number;
  userId: string;
  name: string;
  sourceType: string;
  collectorType: string;
  sourceKind: string;
  sourceRole: string;
  sourceTier: string;
  config: unknown;
  category: string | null;
  status: string | null;
  autoFetchEnabled: boolean | null;
  createdAt: Date;
};

type ReferenceCatalogItemView = ReferenceSourceCatalogItem & {
  integrationStatus: ReferenceIntegrationStatus;
  sourceId: number | null;
  quality: ReferenceSourceQualityMetrics;
  canPreview: boolean;
};

type ReferenceCatalogPayload = {
  version: number;
  updatedAt: string;
  enabled: boolean;
  total: number;
  recommended: number;
  limits: typeof REFERENCE_SOURCE_LIMITS;
  activeCounts: {
    total: number;
    reference: number;
    formalReference: number;
    referenceShadow: number;
    referenceFormal: number;
    totalScheduled: number;
  };
  items: ReferenceCatalogItemView[];
};

type ReferencePreviewPayload = {
  key: string;
  status: 'ready' | 'empty' | 'failed';
  fetchedAt: string;
  error: string | null;
  items: Array<Pick<RawItem, 'title' | 'url' | 'originalUrl' | 'curationUrl' | 'curationSource' | 'content' | 'publishedAt' | 'curationMeta'>>;
};

type ReferenceSourceService = {
  catalog: (userId: string) => Promise<ReferenceCatalogPayload>;
  preview: (userId: string, key: string) => Promise<ReferencePreviewPayload>;
  enable: (userId: string, key: string, status: 'shadow' | 'active') => Promise<unknown>;
  disable: (userId: string, key: string, status: 'paused' | 'removed') => Promise<unknown>;
};

type IntegrationsDeps = {
  checkDibao?: () => Promise<DibaoStatus>;
  listDibaoSources?: (userId: string) => Promise<DibaoExportSource[]>;
  generatedAt?: () => Date;
  referenceSources?: ReferenceSourceService;
  referenceSourcesEnabled?: () => boolean;
};

const dibaoBaseUrl = (process.env.DIBAO_BASE_URL || 'http://dibao-reader:8080').replace(/\/+$/, '');
const dibaoPublicUrl = process.env.DIBAO_PUBLIC_URL || 'http://localhost:8082';
const rsshubBaseUrl = process.env.RSSHUB_BASE_URL || 'http://rsshub:1200';

export function referenceSourceIntegrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.INFOHUB_REFERENCE_SOURCES_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizedName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}

function referenceCatalogKey(source: Pick<ReferenceRuntimeSource, 'config'>): string {
  return String(asObject(source.config).referenceCatalogKey || '').trim();
}

async function listUserRuntimeSources(userId: string): Promise<ReferenceRuntimeSource[]> {
  return db
    .select({
      id: schema.sources.id,
      userId: schema.sources.userId,
      name: schema.sources.name,
      sourceType: schema.sources.sourceType,
      collectorType: schema.sources.collectorType,
      sourceKind: schema.sources.sourceKind,
      sourceRole: schema.sources.sourceRole,
      sourceTier: schema.sources.sourceTier,
      config: schema.sources.config,
      category: schema.sources.category,
      status: schema.sources.status,
      autoFetchEnabled: schema.sources.autoFetchEnabled,
      createdAt: schema.sources.createdAt,
    })
    .from(schema.sources)
    .where(eq(schema.sources.userId, userId));
}

async function loadReferenceQuality(source: ReferenceRuntimeSource | null): Promise<ReferenceSourceQualityMetrics> {
  if (!source) {
    return evaluateReferenceSourceQuality({
      fetchAttempts: 0,
      fetchSuccesses: 0,
      itemCount: 0,
      relevantItemCount: 0,
      aiProcessedItemCount: 0,
      originalLinkCount: 0,
      noiseItemCount: 0,
      duplicateCount: 0,
    });
  }
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const fetchRows = await db.select({
    status: schema.fetchLogs.status,
    startedAt: schema.fetchLogs.startedAt,
    finishedAt: schema.fetchLogs.finishedAt,
    itemsDuplicate: schema.fetchLogs.itemsDuplicate,
  })
    .from(schema.fetchLogs)
    .where(and(eq(schema.fetchLogs.sourceId, source.id), gte(schema.fetchLogs.startedAt, since)))
    .orderBy(asc(schema.fetchLogs.startedAt));
  const rows = await db.execute(sql`
    select
      count(*)::int as item_count,
      count(*) filter (
        where is_filtered = false
          and filter_bucket = 'main'
          and quality_decision = 'pass'
      )::int as relevant_item_count,
      count(*) filter (
        where ai_score is not null
           or coalesce(jsonb_array_length(ai_tags), 0) > 0
      )::int as ai_processed_item_count,
      count(*) filter (
        where length(trim(coalesce(original_url, url, ''))) > 0
      )::int as original_link_count,
      count(*) filter (
        where is_filtered = true
           or filter_bucket = 'filtered'
           or quality_decision = 'filter'
      )::int as noise_item_count
    from hub.items
    where source_id = ${source.id}
      and fetched_at >= now() - interval '7 days'
  `) as unknown as Array<{
    item_count: number;
    relevant_item_count: number;
    ai_processed_item_count: number;
    original_link_count: number;
    noise_item_count: number;
  }>;
  const fetchSummary = summarizeReferenceFetchRuns(fetchRows);
  const row = rows[0];
  return evaluateReferenceSourceQuality({
    createdAt: source.createdAt,
    fetchAttempts: fetchSummary.fetchAttempts,
    fetchSuccesses: fetchSummary.fetchSuccesses,
    itemCount: Number(row?.item_count || 0),
    relevantItemCount: Number(row?.relevant_item_count || 0),
    aiProcessedItemCount: Number(row?.ai_processed_item_count || 0),
    originalLinkCount: Number(row?.original_link_count || 0),
    noiseItemCount: Number(row?.noise_item_count || 0),
    duplicateCount: fetchRows.reduce((sum, fetchRow) => sum + Number(fetchRow.itemsDuplicate || 0), 0),
    componentHealth: asObject(source.config).componentHealth as ReferenceSourceQualityInput['componentHealth'],
  });
}

function canPreviewCandidate(candidate: ReferenceSourceCatalogItem): boolean {
  try {
    buildReferenceIntegrationSourceDefinition(candidate);
    return true;
  } catch {
    return false;
  }
}

function getCandidate(catalog: ReferenceSourceCatalog, key: string): ReferenceSourceCatalogItem {
  const candidate = catalog.sources.find((source) => source.key === key);
  if (!candidate) throw new Error('候选来源不存在或目录已更新');
  return candidate;
}

export function summarizeReferenceSourceCounts(sources: Array<{
  status?: string | null;
  config?: unknown;
}>) {
  const activeReferenceSources = sources.filter((source) => (
    source.status === 'active' && asObject(source.config).integrationType === 'reference_source'
  ));
  return {
    total: sources.filter((source) => source.status === 'active').length,
    reference: activeReferenceSources.length,
    formalReference: activeReferenceSources.filter((source) => (
      asObject(source.config).integrationStatus === 'active'
    )).length,
    referenceShadow: activeReferenceSources.filter((source) => (
      asObject(source.config).integrationStatus === 'shadow'
    )).length,
    referenceFormal: activeReferenceSources.filter((source) => (
      asObject(source.config).integrationStatus === 'active'
    )).length,
    totalScheduled: sources.filter((source) => source.status === 'active').length,
  };
}

async function getActiveCounts(sources?: ReferenceRuntimeSource[]) {
  const rows = sources || await db
    .select({
      id: schema.sources.id,
      userId: schema.sources.userId,
      name: schema.sources.name,
      sourceType: schema.sources.sourceType,
      collectorType: schema.sources.collectorType,
      sourceKind: schema.sources.sourceKind,
      sourceRole: schema.sources.sourceRole,
      sourceTier: schema.sources.sourceTier,
      config: schema.sources.config,
      category: schema.sources.category,
      status: schema.sources.status,
      autoFetchEnabled: schema.sources.autoFetchEnabled,
      createdAt: schema.sources.createdAt,
    })
    .from(schema.sources);
  return summarizeReferenceSourceCounts(rows);
}

async function defaultReferenceCatalog(userId: string): Promise<ReferenceCatalogPayload> {
  const [catalog, sources] = await Promise.all([
    loadReferenceSourceCatalog(),
    listUserRuntimeSources(userId),
  ]);
  const sourcesByKey = new Map<string, ReferenceRuntimeSource>(sources.flatMap((source) => {
    const key = referenceCatalogKey(source);
    return key ? [[key, source] as const] : [];
  }));
  const counts = await getActiveCounts(sources);
  const items = await Promise.all(catalog.sources.map(async (candidate) => {
    const source = sourcesByKey.get(candidate.key) || null;
    return {
      ...candidate,
      integrationStatus: resolveReferenceIntegrationStatus(source),
      sourceId: source?.id || null,
      quality: await loadReferenceQuality(source),
      canPreview: canPreviewCandidate(candidate),
    } satisfies ReferenceCatalogItemView;
  }));
  return {
    version: catalog.version,
    updatedAt: catalog.updatedAt,
    enabled: referenceSourceIntegrationEnabled(),
    total: items.length,
    recommended: items.filter((item) => item.recommended).length,
    limits: REFERENCE_SOURCE_LIMITS,
    activeCounts: counts,
    items,
  };
}

function collectorForDefinition(definition: ReturnType<typeof buildReferenceIntegrationSourceDefinition>): Collector {
  if (definition.collectorType === 'custom') return new CustomCollector();
  if (definition.collectorType === 'rss') return new RssCollector();
  if (definition.collectorType === 'webpage_index') return new WebpageIndexCollector();
  throw new Error(`不支持预览采集器 ${definition.collectorType}`);
}

async function defaultReferencePreview(_userId: string, key: string): Promise<ReferencePreviewPayload> {
  const catalog = await loadReferenceSourceCatalog();
  const candidate = getCandidate(catalog, key);
  const definition = buildReferenceIntegrationSourceDefinition(candidate);
  const collector = collectorForDefinition(definition);
  const result = await collector.fetch({
    id: -1,
    name: definition.name,
    sourceType: definition.sourceType,
    collectorType: definition.collectorType,
    sourceTier: definition.sourceTier,
    processingProfile: definition.processingProfile,
    sourceRole: definition.sourceRole,
    config: definition.config,
    category: definition.category,
    priority: definition.priority,
    fetchInterval: definition.fetchInterval,
    status: definition.status,
  } satisfies SourceConfig);
  return {
    key,
    status: result.error && result.items.length === 0 ? 'failed' : result.items.length > 0 ? 'ready' : 'empty',
    fetchedAt: result.fetchedAt.toISOString(),
    error: result.error || null,
    items: result.items.slice(0, 10).map((item) => ({
      title: item.title,
      url: item.url,
      originalUrl: item.originalUrl,
      curationUrl: item.curationUrl,
      curationSource: item.curationSource,
      content: item.content,
      publishedAt: item.publishedAt,
      curationMeta: item.curationMeta,
    })),
  };
}

function findExistingCandidateSource(
  candidate: ReferenceSourceCatalogItem,
  sources: ReferenceRuntimeSource[],
): ReferenceRuntimeSource | null {
  const byKey = sources.find((source) => referenceCatalogKey(source) === candidate.key);
  if (byKey) return byKey;
  const definition = buildReferenceIntegrationSourceDefinition(candidate);
  const fingerprint = buildSourceFingerprint(definition.collectorType, definition.config);
  return sources.find((source) => (
    normalizedName(source.name) === normalizedName(candidate.name)
    || (fingerprint && buildSourceFingerprint(source.collectorType, source.config) === fingerprint)
  )) || null;
}

async function createReferenceSource(userId: string, candidate: ReferenceSourceCatalogItem, status: 'shadow' | 'active') {
  const definition = buildReferenceIntegrationSourceDefinition(candidate, status);
  const inserted = await db.insert(schema.sources).values({
    userId,
    ...definition,
    nextFetchAt: definition.status === 'active' ? new Date() : null,
    lastOutcome: definition.status === 'active' ? 'scheduled' : 'paused',
  }).returning();
  return inserted[0];
}

async function updateReferenceSource(
  source: ReferenceRuntimeSource,
  candidate: ReferenceSourceCatalogItem,
  status: 'shadow' | 'active' | 'paused' | 'removed',
) {
  const definition = status === 'removed'
    ? buildReferenceIntegrationSourceDefinition(candidate, 'paused')
    : buildReferenceIntegrationSourceDefinition(candidate, status);
  const sourceStatus = status === 'shadow' || status === 'active' ? 'active' : 'paused';
  const config = buildReferenceIntegrationConfigPatch({
    ...asObject(source.config),
    ...definition.config,
  }, status);
  const updated = await db.update(schema.sources).set({
    sourceType: definition.sourceType,
    collectorType: definition.collectorType,
    sourceKind: definition.sourceKind,
    sourceRole: status === 'active' && candidate.key !== 'aihot:channel:selected' ? 'normal' : definition.sourceRole,
    sourceTier: definition.sourceTier,
    authorityWeight: definition.authorityWeight,
    processingProfile: definition.processingProfile,
    trustScore: definition.trustScore,
    noiseScore: definition.noiseScore,
    growthAxes: definition.growthAxes,
    upgradeRules: definition.upgradeRules,
    config,
    category: definition.category,
    priority: definition.priority,
    fetchInterval: definition.fetchInterval,
    autoFetchEnabled: sourceStatus === 'active',
    status: sourceStatus,
    tags: definition.tags.filter((tag) => !tag.startsWith('integration:')).concat(`integration:${status}`),
    nextFetchAt: sourceStatus === 'active' ? new Date() : null,
    lastOutcome: sourceStatus === 'active' ? 'scheduled' : 'paused',
    updatedAt: new Date(),
  }).where(and(eq(schema.sources.id, source.id), eq(schema.sources.userId, source.userId))).returning();
  return updated[0];
}

async function defaultReferenceEnable(userId: string, key: string, status: 'shadow' | 'active') {
  const [catalog, sources] = await Promise.all([loadReferenceSourceCatalog(), listUserRuntimeSources(userId)]);
  const candidate = getCandidate(catalog, key);
  const existing = findExistingCandidateSource(candidate, sources);
  if (status === 'active' && !existing) {
    throw new Error('请先开始影子观察，达到 7 天质量门禁后再启用');
  }
  const counts = await getActiveCounts(sources);
  const existingIsActive = existing?.status === 'active';
  assertReferenceSourceCapacity({
    totalScheduled: counts.totalScheduled,
    referenceShadow: counts.referenceShadow,
    referenceFormal: counts.referenceFormal,
    targetStatus: status,
    alreadyScheduled: existingIsActive,
    alreadyFormal: resolveReferenceIntegrationStatus(existing) === 'active',
  });
  if (status === 'active' && existing) {
    const quality = await loadReferenceQuality(existing);
    if (!quality.eligibleForActivation) {
      throw new Error(`尚未达到启用门禁：${quality.activationReasons.join('；')}`);
    }
  }
  const source = existing
    ? await updateReferenceSource(existing, candidate, status)
    : await createReferenceSource(userId, candidate, status);
  return { source, integrationStatus: status, quality: await loadReferenceQuality(source as ReferenceRuntimeSource) };
}

async function defaultReferenceDisable(userId: string, key: string, status: 'paused' | 'removed') {
  const [catalog, sources] = await Promise.all([loadReferenceSourceCatalog(), listUserRuntimeSources(userId)]);
  const candidate = getCandidate(catalog, key);
  const existing = findExistingCandidateSource(candidate, sources);
  if (!existing) throw new Error('该候选尚未进入影子观察，无需暂停');
  const source = await updateReferenceSource(existing, candidate, status);
  return { source, integrationStatus: status, dataPreserved: true };
}

function defaultReferenceSourceService(): ReferenceSourceService {
  return {
    catalog: defaultReferenceCatalog,
    preview: defaultReferencePreview,
    enable: defaultReferenceEnable,
    disable: defaultReferenceDisable,
  };
}

async function listUserDibaoSources(userId: string): Promise<DibaoExportSource[]> {
  const rows = await db
    .select({
      id: schema.sources.id,
      name: schema.sources.name,
      sourceType: schema.sources.sourceType,
      collectorType: schema.sources.collectorType,
      category: schema.sources.category,
      sourceTier: schema.sources.sourceTier,
      status: schema.sources.status,
      config: schema.sources.config,
    })
    .from(schema.sources)
    .where(and(
      eq(schema.sources.userId, userId),
      eq(schema.sources.status, 'active'),
    ));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    sourceType: row.sourceType,
    collectorType: row.collectorType,
    category: row.category,
    sourceTier: row.sourceTier,
    status: row.status,
    config: row.config,
  }));
}

export function createIntegrationsRoutes(deps: IntegrationsDeps = {}) {
  const app = new Hono();
  const referenceSources = deps.referenceSources || defaultReferenceSourceService();
  const referenceSourcesEnabled = deps.referenceSourcesEnabled || referenceSourceIntegrationEnabled;

  app.get('/dibao/status', async (c) => {
    requireAuth(c);
    const status = deps.checkDibao
      ? await deps.checkDibao()
      : await checkDibaoStatus({
        baseUrl: dibaoBaseUrl,
        publicUrl: dibaoPublicUrl,
      });
    return c.json({ data: status });
  });

  app.get('/dibao/opml', async (c) => {
    const authUser = requireAuth(c);
    const sources = deps.listDibaoSources
      ? await deps.listDibaoSources(authUser.userId)
      : await listUserDibaoSources(authUser.userId);
    const opml = buildDibaoOpml(sources, {
      ownerName: '信息中枢 V3',
      rsshubBaseUrl,
      generatedAt: deps.generatedAt ? deps.generatedAt() : new Date(),
    });

    c.header('Content-Type', 'application/xml; charset=UTF-8');
    c.header('Content-Disposition', 'attachment; filename="infohub-dibao-sources.opml"');
    return c.body(opml);
  });

  app.get('/reference-sources/catalog', async (c) => {
    const authUser = requireAuth(c);
    try {
      return c.json({ data: await referenceSources.catalog(authUser.userId) });
    } catch (error) {
      logger.error({ error, userId: authUser.userId }, 'Reference source integration catalog failed');
      return c.json({ error: '参考来源质量目录暂时不可用，请稍后重试' }, 503);
    }
  });

  app.post('/reference-sources/:key/preview', async (c) => {
    const authUser = requireAuth(c);
    const key = decodeURIComponent(c.req.param('key'));
    if (!referenceSourcesEnabled()) {
      return c.json({ error: '参考来源预览已通过运行开关关闭' }, 503);
    }
    try {
      return c.json({ data: await referenceSources.preview(authUser.userId, key) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ error, userId: authUser.userId, key }, 'Reference source preview failed');
      return c.json({ error: message || '候选来源预览失败' }, /不存在|缺少|不支持/.test(message) ? 400 : 502);
    }
  });

  app.post('/reference-sources/:key/enable', async (c) => {
    const authUser = requireAuth(c);
    const key = decodeURIComponent(c.req.param('key'));
    if (!referenceSourcesEnabled()) {
      return c.json({ error: '参考来源接入已通过运行开关关闭' }, 503);
    }
    const body = await c.req.json().catch(() => ({}));
    const status = body.status === 'active' ? 'active' : 'shadow';
    try {
      const data = await referenceSources.enable(authUser.userId, key, status);
      return c.json({
        message: status === 'active' ? '参考来源已启用' : '参考来源已开始影子观察',
        data,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ error, userId: authUser.userId, key, status }, 'Reference source enable failed');
      const conflict = /上限|门禁|先开始|达到/.test(message);
      return c.json({ error: message || '参考来源状态更新失败' }, conflict ? 409 : 400);
    }
  });

  app.post('/reference-sources/:key/disable', async (c) => {
    const authUser = requireAuth(c);
    const key = decodeURIComponent(c.req.param('key'));
    const body = await c.req.json().catch(() => ({}));
    const status = body.status === 'removed' ? 'removed' : 'paused';
    try {
      return c.json({
        message: status === 'removed' ? '候选已移出观察，历史数据仍保留' : '参考来源已暂停',
        data: await referenceSources.disable(authUser.userId, key, status),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ error, userId: authUser.userId, key, status }, 'Reference source disable failed');
      return c.json({ error: message || '参考来源状态更新失败' }, 400);
    }
  });

  return app;
}

export default createIntegrationsRoutes();
