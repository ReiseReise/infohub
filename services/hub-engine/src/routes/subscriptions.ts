import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { logger } from '../lib/logger.js';
import { buildSourceFingerprint, normalizeCollectorType } from '../lib/source-normalization.js';
import { listSubscriptionPackages, loadSubscriptionPackage } from '../lib/subscription-packages.js';
import type { OpmlFeed } from '../lib/opml-parser.js';
import { deriveSourceProfile } from '../lib/growth.js';

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
  sourceTier?: string;
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
    sourceTier: typeof body.sourceTier === 'string' ? body.sourceTier : undefined,
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

  if (payload.collectorType === 'rss' || payload.collectorType === 'changedetection' || payload.collectorType === 'webpage') {
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
    sourceRole: payload.sourceRole || 'normal',
    sourceTier: derivedProfile.sourceTier,
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

function opmlFeedToPayload(feed: OpmlFeed, categoryDefault?: string): SourcePayload {
  const xmlUrl = feed.xmlUrl.trim();
  const normalizedCategory = (feed.category || categoryDefault || 'hn-popular-blogs').trim() || 'hn-popular-blogs';

  try {
    const parsed = new URL(xmlUrl);
    const isRsshubHost = /rsshub/i.test(parsed.hostname);
    if (isRsshubHost) {
      return {
        name: feed.title,
        sourceType: 'rsshub',
        collectorType: 'rsshub',
        config: { route: parsed.pathname + parsed.search },
        category: normalizedCategory,
        priority: 3,
        fetchInterval: 60,
        autoTranscribe: false,
        status: 'active',
        tags: ['hn-popular-blogs'],
      };
    }
  } catch {
    // fall through to rss payload
  }

  return {
    name: feed.title,
    sourceType: 'rss',
    collectorType: 'rss',
    config: { url: xmlUrl, htmlUrl: feed.htmlUrl },
    category: normalizedCategory,
    priority: 3,
    fetchInterval: 60,
    autoTranscribe: false,
    status: 'active',
    tags: ['hn-popular-blogs'],
    sourceRole: 'normal',
    sourceTier: 'B',
    processingProfile: 'brief',
    growthAxes: ['认知升级'],
  };
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
  if (slug !== 'hn-popular-blogs') {
    return c.json({ error: 'Unknown package slug' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const categoryDefault = typeof body.categoryDefault === 'string' ? body.categoryDefault : 'hn-popular-blogs';
  const limit = Math.max(1, Math.min(Number(body.limit || 92), 200));

  const feeds = (await loadSubscriptionPackage('hn-popular-blogs')).slice(0, limit);
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
    const payload = opmlFeedToPayload(feeds[index], categoryDefault);
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
