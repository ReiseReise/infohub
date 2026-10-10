import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { logger } from '../lib/logger.js';
import { buildSourceFingerprint, normalizeCollectorType } from '../lib/source-normalization.js';
import {
  buildSubscriptionPackageSourcePayload,
  isSubscriptionPackageSlug,
  listSubscriptionPackages,
  loadSubscriptionPackage,
} from '../lib/subscription-packages.js';
import { deriveSourceProfile } from '../lib/growth.js';
import { classifySourceKind, normalizeAuthorityWeight } from '../lib/aihot-governance.js';
import {
  buildReferenceSourcePayload,
  enrichReferenceSourceCatalog,
  filterReferenceSourceCatalog,
  loadReferenceSourceCatalog,
} from '../lib/reference-source-catalog.js';

const app = new Hono();

type SourcePayload = {
  name: string;
  sourceType: string;
  collectorType: string;
  config: Record<string, unknown>;
  category?: string;
  priority?: number;
  fetchInterval?: number;
  autoTranscribe?: boolean;
  status?: string;
  tags?: unknown[];
  sourceRole?: string;
  sourceKind?: string;
  sourceTier?: string;
  authorityWeight?: number;
  processingProfile?: string;
  growthAxes?: unknown[];
  trustScore?: number;
  noiseScore?: number;
  upgradeRules?: Record<string, unknown>;
};

function normalizePayload(raw: unknown, categoryDefault?: string): SourcePayload {
  const body = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const name = String(body.name || '').trim();
  const collectorType = normalizeCollectorType(String(body.collectorType || 'rss'));
  const sourceType = String(body.sourceType || (collectorType === 'podcast' ? 'audio' : collectorType || 'rss')).trim();
  const config = (body.config && typeof body.config === 'object')
    ? (body.config as Record<string, unknown>)
    : {};

  return {
    name,
    sourceType,
    collectorType,
    config,
    category: String(body.category || categoryDefault || 'uncategorized').trim() || 'uncategorized',
    priority: typeof body.priority === 'number' ? body.priority : 3,
    fetchInterval: typeof body.fetchInterval === 'number' ? body.fetchInterval : 60,
    autoTranscribe: Boolean(body.autoTranscribe),
    status: typeof body.status === 'string' ? body.status : 'active',
    tags: Array.isArray(body.tags) ? body.tags : [],
    sourceRole: typeof body.sourceRole === 'string' ? body.sourceRole : 'normal',
    sourceKind: typeof body.sourceKind === 'string' ? body.sourceKind : undefined,
    sourceTier: typeof body.sourceTier === 'string' ? body.sourceTier : undefined,
    authorityWeight: typeof body.authorityWeight === 'number' ? body.authorityWeight : undefined,
    processingProfile: typeof body.processingProfile === 'string' ? body.processingProfile : undefined,
    growthAxes: Array.isArray(body.growthAxes) ? body.growthAxes : undefined,
    trustScore: typeof body.trustScore === 'number' ? body.trustScore : undefined,
    noiseScore: typeof body.noiseScore === 'number' ? body.noiseScore : undefined,
    upgradeRules: body.upgradeRules && typeof body.upgradeRules === 'object' ? body.upgradeRules as Record<string, unknown> : undefined,
  };
}

function validatePayload(payload: SourcePayload): string | null {
  if (!payload.name) return 'name is required';
  if (!payload.sourceType) return 'sourceType is required';
  if (!payload.collectorType) return 'collectorType is required';

  if (
    payload.collectorType === 'rss'
    || payload.collectorType === 'changedetection'
    || payload.collectorType === 'webpage'
    || payload.collectorType === 'webpage_index'
  ) {
    if (!payload.config.url) return 'config.url is required';
  }
  if (payload.collectorType === 'rsshub' && !payload.config.route) {
    return 'config.route is required for rsshub';
  }
  if (payload.collectorType === 'youtube' && !payload.config.route && !payload.config.channelId) {
    return 'config.route or config.channelId is required for youtube';
  }
  if (payload.collectorType === 'custom' && !payload.config.endpoint) {
    return 'config.endpoint is required for custom';
  }
  return null;
}

async function getUserSources(userId: string) {
  return db
    .select({
      id: schema.sources.id,
      userId: schema.sources.userId,
      name: schema.sources.name,
      sourceType: schema.sources.sourceType,
      collectorType: schema.sources.collectorType,
      config: schema.sources.config,
      category: schema.sources.category,
      status: schema.sources.status,
      createdAt: schema.sources.createdAt,
    })
    .from(schema.sources)
    .where(eq(schema.sources.userId, userId))
    .orderBy(desc(schema.sources.createdAt))
    .limit(800);
}

async function createSource(userId: string, payload: SourcePayload) {
  const derivedProfile = deriveSourceProfile({
    sourceTier: payload.sourceTier,
    processingProfile: payload.processingProfile,
    growthAxes: payload.growthAxes,
    trustScore: payload.trustScore,
    noiseScore: payload.noiseScore,
    upgradeRules: payload.upgradeRules,
    sourceRole: payload.sourceRole,
    collectorType: payload.collectorType,
    sourceType: payload.sourceType,
    category: payload.category,
  });
  const inserted = await db.insert(schema.sources).values({
    userId,
    name: payload.name,
    sourceType: payload.sourceType,
    collectorType: payload.collectorType,
    sourceKind: payload.sourceKind || classifySourceKind(payload),
    sourceRole: payload.sourceRole || 'normal',
    sourceTier: derivedProfile.sourceTier,
    authorityWeight: normalizeAuthorityWeight(payload.authorityWeight, derivedProfile.sourceTier, payload.sourceKind || classifySourceKind(payload)),
    processingProfile: derivedProfile.processingProfile,
    trustScore: derivedProfile.trustScore,
    noiseScore: derivedProfile.noiseScore,
    growthAxes: derivedProfile.growthAxes,
    upgradeRules: derivedProfile.upgradeRules,
    config: payload.config,
    category: payload.category || 'uncategorized',
    priority: payload.priority ?? 3,
    fetchInterval: payload.fetchInterval ?? 60,
    autoTranscribe: payload.autoTranscribe ?? false,
    status: payload.status || 'active',
    tags: payload.tags || [],
  }).returning();

  return inserted[0]!;
}

// GET /api/subscriptions/packages
app.get('/packages', async (c) => {
  const authUser = requireAuth(c);
  void authUser;
  const packages = await listSubscriptionPackages();
  return c.json({ data: packages });
});

// POST /api/subscriptions/packages/:slug/import
app.post('/packages/:slug/import', async (c) => {
  const authUser = requireAuth(c);
  const slug = c.req.param('slug');
  if (!isSubscriptionPackageSlug(slug)) {
    return c.json({ error: 'Unknown package slug' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const packages = await listSubscriptionPackages();
  const packageMeta = packages.find((pkg) => pkg.slug === slug);
  const categoryDefault = typeof body.categoryDefault === 'string'
    ? body.categoryDefault
    : packageMeta?.categoryDefault;
  const packageSize = packageMeta?.sourceCount || 200;
  const limit = Math.max(1, Math.min(Number(body.limit || packageSize), 1000));

  const feeds = (await loadSubscriptionPackage(slug)).slice(0, limit);
  const existing = await getUserSources(authUser.userId);
  const existingFingerprintMap = new Map<string, (typeof existing)[number]>();
  for (const source of existing) {
    const fp = buildSourceFingerprint(source.collectorType, source.config);
    if (fp && !existingFingerprintMap.has(fp)) existingFingerprintMap.set(fp, source);
  }

  const created: Array<{ index: number; data: unknown }> = [];
  const duplicates: Array<{ index: number; data: unknown }> = [];
  const failed: Array<{ index: number; error: string }> = [];

  for (let index = 0; index < feeds.length; index += 1) {
    const payload = buildSubscriptionPackageSourcePayload(slug, feeds[index], categoryDefault);
    const validationError = validatePayload(payload);
    if (validationError) {
      failed.push({ index, error: validationError });
      continue;
    }

    const fp = buildSourceFingerprint(payload.collectorType, payload.config);
    if (fp && existingFingerprintMap.has(fp)) {
      duplicates.push({ index, data: existingFingerprintMap.get(fp) });
      continue;
    }

    try {
      const row = await createSource(authUser.userId, payload);
      created.push({ index, data: row });
      if (fp) existingFingerprintMap.set(fp, row);
    } catch (err) {
      failed.push({
        index,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info({
    userId: authUser.userId,
    slug,
    limit,
    created: created.length,
    duplicates: duplicates.length,
    failed: failed.length,
  }, 'Subscription package imported');

  return c.json({
    message: 'Subscription package imported',
    summary: {
      total: feeds.length,
      created: created.length,
      duplicates: duplicates.length,
      failed: failed.length,
    },
    created,
    duplicates,
    failed,
  });
});

function queryBoolean(value?: string): boolean | undefined {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}

function normalizedSourceName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}

// GET /api/subscriptions/reference-catalog
app.get('/reference-catalog', async (c) => {
  const authUser = requireAuth(c);
  try {
    const [catalog, existing] = await Promise.all([
      loadReferenceSourceCatalog(),
      getUserSources(authUser.userId),
    ]);
    const enriched = enrichReferenceSourceCatalog(catalog.sources, existing);
    const filtered = filterReferenceSourceCatalog(enriched, {
      q: c.req.query('q'),
      provider: c.req.query('provider'),
      channel: c.req.query('channel'),
      recommended: queryBoolean(c.req.query('recommended')),
      importable: queryBoolean(c.req.query('importable')),
    });
    const offset = Math.max(0, Number.parseInt(c.req.query('offset') || '0', 10) || 0);
    const limit = Math.max(1, Math.min(Number.parseInt(c.req.query('limit') || '100', 10) || 100, 500));

    return c.json({
      data: {
        version: catalog.version,
        updatedAt: catalog.updatedAt,
        description: catalog.description,
        sourcePolicy: catalog.sourcePolicy,
        stats: catalog.stats,
        total: filtered.length,
        offset,
        limit,
        providers: Array.from(new Set(catalog.sources.map((source) => source.provider))).sort(),
        channels: Array.from(new Set(catalog.sources.map((source) => source.channel))).sort(),
        items: filtered.slice(offset, offset + limit),
      },
    });
  } catch (err) {
    logger.error({ err, userId: authUser.userId }, 'Reference source catalog unavailable');
    return c.json({ error: '参考源候选库暂时不可用，请稍后重试' }, 503);
  }
});

// POST /api/subscriptions/reference-catalog/import
app.post('/reference-catalog/import', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const requestedKeys: string[] = Array.isArray(body.keys)
    ? Array.from(new Set<string>(body.keys.map((key: unknown) => String(key || '').trim()).filter(Boolean)))
    : [];

  if (requestedKeys.length === 0) {
    return c.json({ error: '请至少选择一个候选来源' }, 400);
  }

  let catalog;
  try {
    catalog = await loadReferenceSourceCatalog();
  } catch (err) {
    logger.error({ err, userId: authUser.userId }, 'Reference source catalog unavailable for import');
    return c.json({ error: '参考源候选库暂时不可用，请稍后重试' }, 503);
  }

  if (requestedKeys.length > catalog.sourcePolicy.maxImportPerRequest) {
    return c.json({ error: `单次最多选择 ${catalog.sourcePolicy.maxImportPerRequest} 个来源` }, 400);
  }

  const existing = await getUserSources(authUser.userId);
  const existingFingerprintMap = new Map<string, (typeof existing)[number]>();
  const existingNameMap = new Map<string, (typeof existing)[number]>();
  for (const source of existing) {
    const fingerprint = buildSourceFingerprint(source.collectorType, source.config);
    if (fingerprint && !existingFingerprintMap.has(fingerprint)) existingFingerprintMap.set(fingerprint, source);
    const sourceName = normalizedSourceName(source.name);
    if (sourceName && !existingNameMap.has(sourceName)) existingNameMap.set(sourceName, source);
  }

  const catalogByKey = new Map(catalog.sources.map((source) => [source.key, source]));
  const created: Array<{ index: number; key: string; data: unknown }> = [];
  const duplicates: Array<{ index: number; key: string; data: unknown }> = [];
  const failed: Array<{ index: number; key: string; error: string }> = [];

  for (let index = 0; index < requestedKeys.length; index += 1) {
    const key = requestedKeys[index];
    const candidate = catalogByKey.get(key);
    if (!candidate) {
      failed.push({ index, key, error: '候选来源不存在或目录已更新' });
      continue;
    }

    const duplicateByName = existingNameMap.get(normalizedSourceName(candidate.name));
    if (duplicateByName) {
      duplicates.push({ index, key, data: duplicateByName });
      continue;
    }

    let payload: SourcePayload;
    try {
      payload = normalizePayload(buildReferenceSourcePayload(candidate), candidate.category);
    } catch (err) {
      failed.push({ index, key, error: err instanceof Error ? err.message : '该来源暂不能直接导入' });
      continue;
    }

    const validationError = validatePayload(payload);
    if (validationError) {
      failed.push({ index, key, error: validationError });
      continue;
    }

    const fingerprint = buildSourceFingerprint(payload.collectorType, payload.config);
    if (fingerprint && existingFingerprintMap.has(fingerprint)) {
      duplicates.push({ index, key, data: existingFingerprintMap.get(fingerprint) });
      continue;
    }

    try {
      const row = await createSource(authUser.userId, payload);
      created.push({ index, key, data: row });
      if (fingerprint) existingFingerprintMap.set(fingerprint, row);
      existingNameMap.set(normalizedSourceName(row.name), row);
    } catch (err) {
      failed.push({ index, key, error: err instanceof Error ? err.message : String(err) });
    }
  }

  logger.info({
    userId: authUser.userId,
    requested: requestedKeys.length,
    created: created.length,
    duplicates: duplicates.length,
    failed: failed.length,
  }, 'Reference source candidates imported');

  return c.json({
    message: '候选来源处理完成',
    summary: {
      total: requestedKeys.length,
      created: created.length,
      duplicates: duplicates.length,
      failed: failed.length,
    },
    created,
    duplicates,
    failed,
  });
});

// POST /api/subscriptions
app.post('/', async (c) => {
  const authUser = requireAuth(c);
  const payload = normalizePayload(await c.req.json().catch(() => ({})));
  const validationError = validatePayload(payload);
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  const sources = await getUserSources(authUser.userId);
  const targetFingerprint = buildSourceFingerprint(payload.collectorType, payload.config);

  if (targetFingerprint) {
    const duplicate = sources.find((source) => {
      const sourceFingerprint = buildSourceFingerprint(source.collectorType, source.config);
      return sourceFingerprint === targetFingerprint;
    });
    if (duplicate) {
      return c.json({
        data: duplicate,
        created: false,
        duplicate: true,
      });
    }
  }

  const created = await createSource(authUser.userId, payload);
  logger.info({ sourceId: created.id, collectorType: created.collectorType }, 'Subscription created');
  return c.json({
    data: created,
    created: true,
    duplicate: false,
  }, 201);
});

// POST /api/subscriptions/batch
app.post('/batch', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];
  const categoryDefault = typeof body.categoryDefault === 'string' ? body.categoryDefault : undefined;

  if (items.length === 0) {
    return c.json({ error: 'items is required' }, 400);
  }
  if (items.length > 100) {
    return c.json({ error: 'items length exceeds 100' }, 400);
  }

  const existing = await getUserSources(authUser.userId);
  const existingFingerprintMap = new Map<string, (typeof existing)[number]>();
  for (const source of existing) {
    const fp = buildSourceFingerprint(source.collectorType, source.config);
    if (fp && !existingFingerprintMap.has(fp)) {
      existingFingerprintMap.set(fp, source);
    }
  }

  const created: any[] = [];
  const duplicates: any[] = [];
  const failed: Array<{ index: number; error: string }> = [];

  for (let index = 0; index < items.length; index++) {
    const payload = normalizePayload(items[index], categoryDefault);
    const validationError = validatePayload(payload);
    if (validationError) {
      failed.push({ index, error: validationError });
      continue;
    }

    const fp = buildSourceFingerprint(payload.collectorType, payload.config);
    if (fp && existingFingerprintMap.has(fp)) {
      duplicates.push({ index, data: existingFingerprintMap.get(fp) });
      continue;
    }

    try {
      const row = await createSource(authUser.userId, payload);
      created.push({ index, data: row });
      if (fp) existingFingerprintMap.set(fp, row);
    } catch (err) {
      failed.push({
        index,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return c.json({
    message: 'Batch subscription processed',
    summary: {
      total: items.length,
      created: created.length,
      duplicates: duplicates.length,
      failed: failed.length,
    },
    created,
    duplicates,
    failed,
  });
});

export default app;
