import { observeJev } from '../jev/queue.js';
import { Hono, type Context } from 'hono';
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
import { normalizeEmailIngestItems, parseEmlMessages, redactEmailIngestLog } from '../lib/email-ingest.js';

const app = new Hono();

// POST /api/hooks/email-ingest — 安全邮件投递入口（手动/半手动导入）
export function createEmailIngestHandler(database = db, authenticate = requireAuth) {
 return async (c: Context) => {
  const authUser = authenticate(c);
  const contentType = c.req.header('content-type') || '';
  let body: Record<string, unknown> = {};
  let rawItems: Record<string, unknown>[] = [];

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const sourceLabel = typeof formData.get('sourceLabel') === 'string'
      ? String(formData.get('sourceLabel')).trim()
      : undefined;
    const sourceIdRaw = formData.get('sourceId');
    if (typeof sourceIdRaw === 'string') body.sourceId = sourceIdRaw;
    if (sourceLabel) body.sourceLabel = sourceLabel;

    const files = [...formData.getAll('file'), ...formData.getAll('files')]
      .filter((file): file is File => file instanceof File);
    if (files.length === 0) {
      return c.json({ error: 'No .eml file provided' }, 400);
    }
    const emlInputs = await Promise.all(files.map(async (file) => ({
      filename: file.name,
      content: await file.text(),
    })));
    rawItems = parseEmlMessages(emlInputs, sourceLabel);
  } else {
    const parsed = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!parsed) {
      return c.json({ error: 'Invalid payload' }, 400);
    }
    body = parsed;
    rawItems = Array.isArray(body.items)
      ? body.items.filter((item): item is Record<string, unknown> => item && typeof item === 'object' && !Array.isArray(item))
      : [body].filter((item): item is Record<string, unknown> => item && typeof item === 'object' && !Array.isArray(item));
  }

  if (rawItems.length === 0) {
    return c.json({ error: 'Expected email payload or { items: [...] }' }, 400);
  }

  const items = normalizeEmailIngestItems(rawItems);
  if (items.length === 0) {
    return c.json({ error: 'No readable email content found' }, 400);
  }

  let sourceId = Number(body.sourceId);
  if (body.sourceId != null && (!Number.isSafeInteger(sourceId) || sourceId <= 0)) {
    return c.json({ error: 'Invalid email source ID' }, 400);
  }
  if (Number.isSafeInteger(sourceId) && sourceId > 0) {
    const owned = await database.select({ id: schema.sources.id }).from(schema.sources)
      .where(and(eq(schema.sources.id, sourceId), eq(schema.sources.userId, authUser.userId)))
      .limit(1);
    if (!owned.length) return c.json({ error: 'Email source not found for current user' }, 404);
  }
  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    const existing = await database.select({ id: schema.sources.id })
      .from(schema.sources)
      .where(and(
        eq(schema.sources.userId, authUser.userId),
        eq(schema.sources.sourceType, 'email'),
        eq(schema.sources.collectorType, 'custom')
      ))
      .limit(1);
    if (existing.length > 0) {
      sourceId = existing[0].id;
    } else {
      const created = await database.insert(schema.sources).values({
        userId: authUser.userId,
        name: 'Email Inbox',
        sourceType: 'email',
        collectorType: 'custom',
        sourceKind: 'email',
        sourceRole: 'inbox',
        sourceTier: 'B',
        authorityWeight: 0.9,
        processingProfile: 'smart',
        trustScore: 65,
        noiseScore: 35,
        growthAxes: ['认知升级'],
        config: {
          inboxKind: 'email',
          privacy: 'manual_ingest',
          sourceLabel: typeof body.sourceLabel === 'string' ? body.sourceLabel : undefined,
        },
        category: '邮箱',
        tags: ['email', 'manual-ingest'],
        priority: 3,
        fetchInterval: 1440,
        autoFetchEnabled: false,
        lastOutcome: 'manual_ingest_ready',
      }).returning({ id: schema.sources.id });
      sourceId = created[0].id;
    }
  }

  let inserted = 0;
  let duplicates = rawItems.length - items.length;
  let failed = 0;
  for (const item of items) {
    try {
      const contentLength = item.content.trim().length;
      const contentStatus = contentLength >= 180 ? 'ready' : contentLength >= 24 ? 'degraded' : 'missing';
      const result = await database.insert(schema.items).values({
        sourceId,
        userId: authUser.userId,
        sourceType: 'email',
        sourceTier: 'B',
        processingProfile: 'smart',
        growthAxes: ['认知升级'],
        guid: item.guid,
        title: item.title,
        url: item.url,
        author: item.author,
        content: item.content,
        snippet: item.snippet,
        publishedAt: item.publishedAt || new Date(),
        processingStatus: 'raw',
        contentStatus,
        contentError: contentStatus === 'missing' ? '邮件正文为空或过短' : undefined,
        fetchEngine: 'email-ingest',
        renderMode: 'manual',
        summaryStatus: 'pending',
        translationStatus: 'pending',
      }).onConflictDoNothing().returning({ id: schema.items.id });
      if (result.length > 0) inserted++;
      else duplicates++;
    } catch {
      // ON CONFLICT handles duplicates. Other database failures must remain visible.
      failed++;
    }
  }

  const redactedItems = items.map(redactEmailIngestLog);
  logger.info({ ingested: inserted, duplicates, failed, total: rawItems.length, sourceId, items: redactedItems }, 'Email content ingested');
  return c.json({
    ...(failed ? { error: 'Some emails could not be saved; retry the import.' } : {}),
    message: failed ? 'Email import incomplete' : 'Email ingested',
    sourceId,
    ingested: inserted,
    duplicates,
    failed,
    total: rawItems.length,
    items: redactedItems,
  }, failed ? 503 : 200);
 };
}
app.post('/email-ingest', createEmailIngestHandler());

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

  if (patch.transcript) observeJev('transcript', itemId);
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
      const insertedCapture = await db.insert(schema.items).values({
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
      }).onConflictDoNothing().returning({ id: schema.items.id });
      if (insertedCapture[0]) observeJev('capture', insertedCapture[0].id);
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
