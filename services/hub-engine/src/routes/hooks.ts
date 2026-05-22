import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { requireAuth } from '../lib/auth.js';
import { config } from '../config/index.js';
import {
  hasCaptureMetadata,
  normalizeCaptureIngestItem,
  resolveIngestSourceDefaults,
} from '../lib/capture-inbox.js';

const app = new Hono();

// POST /api/hooks/audio-callback — audio-service 回调更新 Feed 条目
app.post('/audio-callback', async (c) => {
  const expectedSecret = config.audio.webhookSecret;
  if (expectedSecret) {
    const providedSecret = c.req.header('X-Webhook-Secret') || '';
    if (providedSecret !== expectedSecret) {
      logger.warn('Audio callback unauthorized: invalid webhook secret');
      return c.json({ error: 'Unauthorized webhook' }, 401);
    }
  }

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) {
    return c.json({ error: 'Invalid payload' }, 400);
  }

  const taskId = typeof body.task_id === 'string' ? body.task_id : '';
  const itemId = typeof body.article_id === 'string' ? body.article_id : '';
  const statusRaw = typeof body.status === 'string' ? body.status.toLowerCase() : '';

  if (!taskId || !itemId || !statusRaw) {
    return c.json({ error: 'Missing task_id/article_id/status' }, 400);
  }

  const audioStatus = statusRaw === 'done'
    ? 'done'
    : statusRaw === 'failed'
      ? 'error'
      : 'processing';

  const patch: Partial<typeof schema.items.$inferInsert> = {
    audioStatus,
    audioStatusReason: typeof body.failure_detail === 'string'
      ? body.failure_detail
      : typeof body.error === 'string'
        ? body.error
        : audioStatus === 'done'
          ? '音频处理完成'
          : audioStatus === 'error'
            ? '音频处理失败'
            : '音频任务处理中',
    audioTaskId: taskId,
  };

  const isRawMeta = (s: unknown): boolean => {
    if (typeof s !== 'string') return false;
    const t = s.trim();
    return t.startsWith('{') && t.includes('_source_meta');
  };

  if (audioStatus === 'done') {
    if (typeof body.transcript === 'string' && body.transcript.trim() && !isRawMeta(body.transcript)) {
      patch.transcript = body.transcript;
    }
    if (typeof body.knowledge === 'string' && body.knowledge.trim() && !isRawMeta(body.knowledge)) {
      patch.knowledge = body.knowledge;
    }
    const duration = Number(body.duration);
    if (Number.isFinite(duration) && duration > 0) {
      patch.audioDuration = Math.round(duration);
    }
  }

  const updated = await db
    .update(schema.items)
    .set(patch)
    .where(eq(schema.items.id, itemId))
    .returning({ id: schema.items.id });

  if (updated.length === 0) {
    logger.warn({ taskId, itemId }, 'Audio callback item not found');
    return c.json({ error: 'Item not found' }, 404);
  }

  logger.info({ taskId, itemId, audioStatus }, 'Audio callback applied');
  return c.json({ message: 'Audio callback applied', taskId, itemId, audioStatus });
});

// POST /api/hooks/ingest — 外部数据注入（如 Grok 推送结果）
app.post('/ingest', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json();

  if (!body.items || !Array.isArray(body.items)) {
    return c.json({ error: 'Expected { items: [...] }' }, 400);
  }

  const rawItems = body.items as Record<string, unknown>[];
  const isCapturePayload = rawItems.some((item) => hasCaptureMetadata(item));
  const sourceDefaults = resolveIngestSourceDefaults(isCapturePayload);

  // Find or create a source for ingested items.
  let webhookSourceId: number | undefined = body.sourceId;
  if (!webhookSourceId) {
    const existing = await db.select({ id: schema.sources.id })
      .from(schema.sources)
      .where(and(
        eq(schema.sources.collectorType, 'custom'),
        eq(schema.sources.category, sourceDefaults.category),
        eq(schema.sources.userId, authUser.userId)
      ))
      .limit(1);
    if (existing.length > 0) {
      webhookSourceId = existing[0].id;
    } else {
      const created = await db.insert(schema.sources).values({
        userId: authUser.userId,
        name: sourceDefaults.name,
        sourceType: 'custom',
        collectorType: 'custom',
        sourceKind: 'other',
        config: sourceDefaults.config,
        category: sourceDefaults.category,
      }).returning();
      webhookSourceId = created[0].id;
    }
  }

  let ingested = 0;
  for (const raw of rawItems) {
    const item = normalizeCaptureIngestItem(raw);
    if (!item.title || !item.url) continue;
    const rawSourceId = Number(raw.sourceId);
    const sourceId = Number.isInteger(rawSourceId) && rawSourceId > 0 ? rawSourceId : webhookSourceId;
    if (!sourceId) continue;

    try {
      await db.insert(schema.items).values({
        sourceId,
        userId: authUser.userId,
        sourceType: item.sourceType,
        guid: item.guid,
        title: item.title,
        url: item.url,
        author: item.author,
        content: item.content,
        snippet: item.snippet,
        publishedAt: item.publishedAt || new Date(),
        processingStatus: 'raw',
      }).onConflictDoNothing();
      ingested++;
    } catch (err) {
      // skip duplicates
    }
  }

  logger.info({ ingested, total: body.items.length }, 'External data ingested via webhook');
  return c.json({ message: 'Ingested', ingested, total: body.items.length });
});

// GET /api/hooks/highlights — 当日高优条目（供 OpenClaw 等调用）
app.get('/highlights', async (c) => {
  const authUser = requireAuth(c);
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const { desc, gte, eq, and } = await import('drizzle-orm');
  const items = await db
    .select({
      id: schema.items.id,
      title: schema.items.title,
      url: schema.items.url,
      aiScore: schema.items.aiScore,
      aiSummary: schema.items.aiSummary,
      priorityScore: schema.items.priorityScore,
      publishedAt: schema.items.publishedAt,
    })
    .from(schema.items)
    .where(and(
      gte(schema.items.fetchedAt, since),
      eq(schema.items.userId, authUser.userId),
      eq(schema.items.isFiltered, false)
    ))
    .orderBy(desc(schema.items.priorityScore))
    .limit(20);

  return c.json({ data: items, date: since.toISOString().split('T')[0] });
});

// GET /api/hooks/status — 系统健康状态（供 OpenClaw 等调用）
app.get('/status', async (c) => {
  const authUser = requireAuth(c);
  const { count } = await import('drizzle-orm');
  const totalItems = await db.select({ count: count() })
    .from(schema.items)
    .where(eq(schema.items.userId, authUser.userId));
  const totalSources = await db.select({ count: count() })
    .from(schema.sources)
    .where(eq(schema.sources.userId, authUser.userId));

  return c.json({
    status: 'ok',
    service: 'hub-engine',
    timestamp: new Date().toISOString(),
    stats: {
      items: totalItems[0]?.count || 0,
      sources: totalSources[0]?.count || 0,
    },
  });
});

export default app;
