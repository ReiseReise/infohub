import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import {
  discoverCandidates,
  extractRsshubRoute,
  previewRssFeed,
  previewRsshubRoute,
  type DiscoverMode,
  type SourceLike,
} from '../lib/discovery.js';
import { buildSourceFingerprint, normalizeCollectorType } from '../lib/source-normalization.js';

const app = new Hono();

function parseMode(rawMode: string | undefined): DiscoverMode {
  const mode = (rawMode || 'search').toLowerCase();
  if (mode === 'rss' || mode === 'rsshub') return mode;
  return 'search';
}

async function getUserSources(userId: string): Promise<SourceLike[]> {
  return db
    .select({
      id: schema.sources.id,
      name: schema.sources.name,
      sourceType: schema.sources.sourceType,
      collectorType: schema.sources.collectorType,
      config: schema.sources.config,
      category: schema.sources.category,
    })
    .from(schema.sources)
    .where(eq(schema.sources.userId, userId))
    .orderBy(desc(schema.sources.createdAt))
    .limit(500);
}

// GET /api/discovery/search?q=xxx&type=search|rss|rsshub
app.get('/search', async (c) => {
  const authUser = requireAuth(c);
  const query = (c.req.query('q') || '').trim();
  const mode = parseMode(c.req.query('type'));
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '8', 10), 1), 20);

  if (!query) {
    return c.json({ error: 'q is required' }, 400);
  }

  const sources = await getUserSources(authUser.userId);
  const discovered = await discoverCandidates({ query, mode, sources, limit });

  const existingFingerprints = new Set(
    sources
      .map((source) => buildSourceFingerprint(source.collectorType, source.config))
      .filter((value): value is string => Boolean(value)),
  );

  const data = discovered.map((candidate) => {
    const fingerprint = buildSourceFingerprint(candidate.collectorType, candidate.config);
    const alreadySubscribed = fingerprint ? existingFingerprints.has(fingerprint) : false;
    return {
      ...candidate,
      alreadySubscribed,
    };
  });

  return c.json({
    query,
    mode,
    total: data.length,
    data,
  });
});

// POST /api/discovery/preview
app.post('/preview', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const collectorType = normalizeCollectorType(String(body.collectorType || 'rss'));
  const url = String(body.url || '').trim();
  const route = String(body.route || '').trim();

  let candidate = null;

  if (collectorType === 'rsshub' || route || url.startsWith('rsshub://') || url.startsWith('/')) {
    const normalizedRoute = route || extractRsshubRoute(url);
    if (!normalizedRoute) {
      return c.json({ error: 'route is required for rsshub preview' }, 400);
    }
    candidate = await previewRsshubRoute(normalizedRoute);
  } else {
    if (!url) {
      return c.json({ error: 'url is required for preview' }, 400);
    }
    candidate = await previewRssFeed(url);
  }

  if (!candidate) {
    return c.json({ error: 'Preview failed. Please verify the source URL/route.' }, 404);
  }

  const sources = await getUserSources(authUser.userId);
  const existingFingerprints = new Set(
    sources
      .map((source) => buildSourceFingerprint(source.collectorType, source.config))
      .filter((value): value is string => Boolean(value)),
  );
  const fingerprint = buildSourceFingerprint(candidate.collectorType, candidate.config);

  return c.json({
    data: {
      ...candidate,
      alreadySubscribed: fingerprint ? existingFingerprints.has(fingerprint) : false,
    },
  });
});

export default app;
