import { Hono } from 'hono';
import { eq, and, desc, count, ilike, or, gte, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import {
  buildSnippet,
  cleanArticleBody,
  cleanPreviewText,
  looksLikeBoilerplateText,
  detectLikelyLanguage,
  plainTextLength,
} from '../lib/content-extractor.js';
import { ensureItemContent, resolveItemText } from '../lib/item-enrichment.js';
import { startAudioTaskForItem } from '../services/audio.js';
import { scoreItems, scoreItemsDetailed } from '../processors/ai-scorer.js';
import { summarizeItems, summarizeItemsDetailed, translateItemsDetailed, translateItemsWithOptions } from '../processors/ai-summarizer.js';
import { getEffectiveAiSceneAvailability } from '../lib/ai-configs.js';
import { getItemScoreBreakdowns, getLatestItemFeedback } from '../lib/scoring-skills.js';
import { normalizeGrowthAxes } from '../lib/growth.js';

const app = new Hono();

function deriveContentBasis(item: {
  title?: string | null;
  content?: string | null;
  snippet?: string | null;
}) {
  return resolveItemText({
    title: item.title || '',
    content: item.content,
    snippet: item.snippet,
  }).basis;
}

function mapFeedItemResponse<T extends {
  title?: string | null;
  content?: string | null;
  snippet?: string | null;
  contentStatus?: string | null;
  sourceConfig?: unknown;
  fetchEngine?: string | null;
  renderMode?: string | null;
  blockedReason?: string | null;
}>(row: T) {
  const contentBasis = deriveContentBasis(row);
  const sourceConfig = (row.sourceConfig && typeof row.sourceConfig === 'object')
    ? row.sourceConfig as Record<string, unknown>
    : {};
  return {
    ...row,
    growthAxes: normalizeGrowthAxes((row as { growthAxes?: unknown }).growthAxes, []),
    contentBasis,
    contentStatus: row.contentStatus === 'ready' && contentBasis !== 'content'
      ? 'degraded'
      : row.contentStatus,
    fetchEngine: row.fetchEngine || (typeof sourceConfig.lastFetchEngine === 'string' ? sourceConfig.lastFetchEngine : null),
    renderMode: row.renderMode || (typeof sourceConfig.renderMode === 'string' ? sourceConfig.renderMode : null),
    blockedReason: row.blockedReason || (typeof sourceConfig.lastBlockedReason === 'string' ? sourceConfig.lastBlockedReason : null),
  };
}

function isMostlyChineseText(value?: string | null): boolean {
  const text = (value || '').trim();
  if (!text) return false;
  const hanCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinCount = (text.match(/[A-Za-z]/g) || []).length;
  if (hanCount >= 24) return true;
  if (hanCount >= 10 && hanCount >= latinCount / 2) return true;
  return hanCount > 0 && latinCount <= 12;
}

function looksTruncatedText(value?: string | null): boolean {
  const text = (value || '').trim();
  if (!text) return false;
  if (/[—\-–:：,，、（(]$/.test(text)) return true;
  return /(evidenced|including|such as|for example|例如|比如|包括)$/i.test(text);
}

// GET /api/items — 列表（支持过滤/排序/分页/搜索）
app.get('/', async (c) => {
  const authUser = requireAuth(c);
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const isRead = c.req.query('isRead');
  const isFavorite = c.req.query('isFavorite');
  const sourceType = c.req.query('sourceType');
  const collectorType = c.req.query('collectorType');
  const category = c.req.query('category');
  const monitorOnly = c.req.query('monitorOnly') === 'true';
  const search = c.req.query('search');
  const sortBy = c.req.query('sortBy') || 'publishedAt';
  const sourceId = c.req.query('sourceId');
  const includeFiltered = c.req.query('includeFiltered') === 'true';

  const conditions: SQL<unknown>[] = [eq(schema.items.userId, authUser.userId)];
  if (!includeFiltered) conditions.push(eq(schema.items.isFiltered, false));
  if (isRead !== undefined) conditions.push(eq(schema.items.isRead, isRead === 'true'));
  if (isFavorite !== undefined) conditions.push(eq(schema.items.isFavorite, isFavorite === 'true'));
  if (sourceType) conditions.push(eq(schema.items.sourceType, sourceType));
  if (collectorType) conditions.push(eq(schema.sources.collectorType, collectorType));
  if (category) conditions.push(eq(schema.sources.category, category));
  if (monitorOnly) conditions.push(eq(schema.sources.sourceRole, 'monitor'));
  if (sourceId) conditions.push(eq(schema.items.sourceId, Number(sourceId)));
  if (search) {
    const searchCondition = or(
      ilike(schema.items.title, `%${search}%`),
      ilike(schema.items.snippet, `%${search}%`),
      ilike(schema.items.content, `%${search}%`)
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  const rows = await db
    .select({
      id: schema.items.id,
      sourceId: schema.items.sourceId,
      sourceType: schema.items.sourceType,
      sourceTier: schema.items.sourceTier,
      processingProfile: schema.items.processingProfile,
      growthAxes: schema.items.growthAxes,
      title: schema.items.title,
      url: schema.items.url,
      author: schema.items.author,
      snippet: schema.items.snippet,
      publishedAt: schema.items.publishedAt,
      fetchedAt: schema.items.fetchedAt,
      aiScore: schema.items.aiScore,
      aiSummary: schema.items.aiSummary,
      aiTags: schema.items.aiTags,
      priorityScore: schema.items.priorityScore,
      mediaUrl: schema.items.mediaUrl,
      mediaType: schema.items.mediaType,
      audioStatus: schema.items.audioStatus,
      audioStatusReason: schema.items.audioStatusReason,
      audioTaskId: schema.items.audioTaskId,
      isRead: schema.items.isRead,
      isFavorite: schema.items.isFavorite,
      isLater: schema.items.isLater,
      processingStatus: schema.items.processingStatus,
      isFiltered: schema.items.isFiltered,
      filterReason: schema.items.filterReason,
      contentStatus: schema.items.contentStatus,
      contentError: schema.items.contentError,
      fetchEngine: schema.items.fetchEngine,
      renderMode: schema.items.renderMode,
      blockedReason: schema.items.blockedReason,
      summaryStatus: schema.items.summaryStatus,
      summaryBasis: schema.items.summaryBasis,
      translationStatus: schema.items.translationStatus,
      translationReason: schema.items.translationReason,
      sourceName: schema.sources.name,
      sourceCategory: schema.sources.category,
      sourceCollectorType: schema.sources.collectorType,
      sourceConfig: schema.sources.config,
    })
    .from(schema.items)
    .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
    .where(and(...conditions))
    .orderBy(
      sortBy === 'priority'
        ? desc(schema.items.priorityScore)
        : desc(sql`coalesce(${schema.items.publishedAt}, ${schema.items.fetchedAt})`),
    )
    .limit(limit)
    .offset(offset);

  const totalResult = await db
    .select({ count: count() })
    .from(schema.items)
    .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
    .where(and(...conditions));
  const total = totalResult[0]?.count || 0;

  return c.json({
    data: rows.map((row) => mapFeedItemResponse({
      ...row,
      snippet: cleanPreviewText(row.snippet, 220) ?? null,
    })),
    total,
    hasMore: offset + limit < total,
    nextOffset: offset + limit < total ? offset + limit : null,
  });
});

// GET /api/items/stats — 统计（必须在 /:id 之前）
app.get('/stats', async (c) => {
  const authUser = requireAuth(c);
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const [total, unread, favorites, today] = await Promise.all([
    db.select({ count: count() }).from(schema.items).where(and(eq(schema.items.userId, authUser.userId), eq(schema.items.isFiltered, false))),
    db.select({ count: count() }).from(schema.items).where(and(eq(schema.items.userId, authUser.userId), eq(schema.items.isFiltered, false), eq(schema.items.isRead, false))),
    db.select({ count: count() }).from(schema.items).where(and(eq(schema.items.userId, authUser.userId), eq(schema.items.isFiltered, false), eq(schema.items.isFavorite, true))),
    db.select({ count: count() }).from(schema.items).where(and(eq(schema.items.userId, authUser.userId), eq(schema.items.isFiltered, false), gte(schema.items.fetchedAt, dayStart))),
  ]);
  return c.json({
    total: total[0]?.count || 0,
    unread: unread[0]?.count || 0,
    favorites: favorites[0]?.count || 0,
    today: today[0]?.count || 0,
  });
});

// POST /api/items/mark-all-read — 全部标记已读（必须在 /:id 之前）
app.post('/mark-all-read', async (c) => {
  const authUser = requireAuth(c);
  await db
    .update(schema.items)
    .set({ isRead: true })
    .where(and(eq(schema.items.userId, authUser.userId), eq(schema.items.isRead, false)));
  return c.json({ message: 'All marked as read' });
});

// POST /api/items/:id/reprocess-ai — 单条重跑评分/摘要/翻译
app.post('/:id/reprocess-ai', async (c) => {
  const authUser = requireAuth(c);
  const id = c.req.param('id');

  const rows = await db
    .select({
      id: schema.items.id,
      userId: schema.items.userId,
    })
    .from(schema.items)
    .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Item not found' }, 404);
  }

  const activeConfigs = await getEffectiveAiSceneAvailability(authUser.userId);
  const hasScoring = activeConfigs.has('scoring');
  const hasSummary = activeConfigs.has('summary');
  const hasTranslation = activeConfigs.has('translation');

  if (!hasScoring && !hasSummary && !hasTranslation) {
    return c.json({ error: 'No active AI config found. Please configure in settings first.' }, 400);
  }

  const processingStatus = hasScoring ? 'raw' : hasSummary ? 'scored' : 'summarized';

  await db.update(schema.items).set({
    aiScore: null,
    aiSummary: null,
    aiTags: [],
    aiTranslation: null,
    summaryStatus: 'pending',
    summaryBasis: null,
    translationStatus: 'pending',
    translationReason: null,
    processingStatus,
  }).where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)));

  let scored = 0;
  let summarized = 0;
  let translated = 0;

  if (hasScoring) {
    scored = await scoreItems(authUser.userId, 1, { itemId: id });
  }
  if (hasSummary) {
    summarized = await summarizeItems(authUser.userId, 1, { itemId: id });
  }
  if (hasTranslation) {
    translated = await translateItemsWithOptions(authUser.userId, 1, { itemId: id });
  }

  const refreshed = await db.select()
    .from(schema.items)
    .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)))
    .limit(1);

  return c.json({
    message: 'AI reprocess complete',
    scored,
    summarized,
    translated,
    data: refreshed[0],
  });
});

// POST /api/items/:id/enrich — 抓正文并补齐评分/摘要/翻译
app.post('/:id/enrich', async (c) => {
  const authUser = requireAuth(c);
  const id = c.req.param('id');

  const contentResult = await ensureItemContent(authUser.userId, id);
  if (!contentResult.item) {
    return c.json({ error: 'Item not found' }, 404);
  }

  const scenes = await getEffectiveAiSceneAvailability(authUser.userId);
  const warnings = contentResult.warning ? [contentResult.warning] : [];

  const currentRows = await db
    .select({
      id: schema.items.id,
      title: schema.items.title,
      content: schema.items.content,
      snippet: schema.items.snippet,
      language: schema.items.language,
      aiScore: schema.items.aiScore,
      aiSummary: schema.items.aiSummary,
      aiTranslation: schema.items.aiTranslation,
      summaryBasis: schema.items.summaryBasis,
      processingStatus: schema.items.processingStatus,
      contentStatus: schema.items.contentStatus,
      fetchEngine: schema.items.fetchEngine,
      renderMode: schema.items.renderMode,
      blockedReason: schema.items.blockedReason,
    })
    .from(schema.items)
    .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)))
    .limit(1);

  const current = currentRows[0];
  if (!current) {
    return c.json({ error: 'Item not found' }, 404);
  }

  const resolvedText = resolveItemText(current);
  const effectiveLanguage = current.language || detectLikelyLanguage(`${current.title}\n${resolvedText.text}`);
  const shouldScore = scenes.has('scoring') && (
    contentResult.contentFetched
    || current.aiScore == null
    || current.processingStatus === 'raw'
    || current.processingStatus === 'score_failed'
  );
  const shouldSummarize = scenes.has('summary') && (
    contentResult.contentFetched
    || !current.aiSummary?.trim()
    || !isMostlyChineseText(current.aiSummary)
    || (current.contentStatus === 'ready' && current.summaryBasis !== 'content')
    || current.processingStatus === 'summary_failed'
  );
  const shouldTranslate = scenes.has('translation') && effectiveLanguage !== 'zh' && (
    contentResult.contentFetched
    || !current.aiTranslation?.trim()
    || looksTruncatedText(current.aiTranslation)
    || current.processingStatus === 'translation_failed'
  );

  if (!scenes.has('scoring')) warnings.push('未启用阅读评分模型');
  if (!scenes.has('summary')) warnings.push('未启用阅读摘要模型');
  if (!scenes.has('translation')) warnings.push('未启用阅读翻译模型');
  if (effectiveLanguage === 'zh') warnings.push('原文已是中文，跳过翻译');

  if (shouldScore) {
    await db.update(schema.items).set({
      aiScore: null,
      processingStatus: 'raw',
      isFiltered: false,
      filterReason: null,
    }).where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)));
  } else if (shouldSummarize) {
    await db.update(schema.items).set({
      aiSummary: null,
      aiTags: [],
      summaryStatus: 'pending',
      summaryBasis: null,
      processingStatus: 'scored',
    }).where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)));
  } else if (shouldTranslate) {
    await db.update(schema.items).set({
      aiTranslation: null,
      translationStatus: 'pending',
      translationReason: null,
      processingStatus: 'summarized',
    }).where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)));
  }

  let scored = 0;
  let summarized = 0;
  let translated = 0;
  let filterDecision = 'unchanged';

  if (shouldScore) {
    const scoring = await scoreItemsDetailed(authUser.userId, 1, { itemId: id });
    scored = scoring.processed;
    if (scoring.errors.length > 0) warnings.push(...scoring.errors);
    filterDecision = scoring.processed > 0 ? 'recomputed' : filterDecision;
  }
  if (shouldSummarize) {
    const summarization = await summarizeItemsDetailed(authUser.userId, 1, { itemId: id });
    summarized = summarization.processed;
    if (summarization.errors.length > 0) warnings.push(...summarization.errors);
  }
  if (shouldTranslate) {
    const translation = await translateItemsDetailed(authUser.userId, 1, { itemId: id });
    translated = translation.processed;
    if (translation.errors.length > 0) warnings.push(...translation.errors);
  }

  const refreshed = await db.select()
    .from(schema.items)
    .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)))
    .limit(1);

  return c.json({
    message: 'Item enrich complete',
    contentFetched: contentResult.contentFetched,
    contentBasis: refreshed[0] ? deriveContentBasis(refreshed[0]) : resolvedText.basis,
    scored,
    summarized,
    translated,
    recomputed: {
      score: shouldScore,
      summary: shouldSummarize,
      translation: shouldTranslate,
    },
    filterDecision,
    warnings: [...new Set(warnings)].filter(Boolean),
    data: refreshed[0] ? mapFeedItemResponse(refreshed[0]) : null,
  });
});

// POST /api/items/:id/audio-transcribe — 为单条 Feed 启动音频转写
app.post('/:id/audio-transcribe', async (c) => {
  const authUser = requireAuth(c);
  const id = c.req.param('id');

  const rows = await db
    .select({
      id: schema.items.id,
      title: schema.items.title,
      url: schema.items.url,
      mediaUrl: schema.items.mediaUrl,
      mediaType: schema.items.mediaType,
      audioStatus: schema.items.audioStatus,
      audioStatusReason: schema.items.audioStatusReason,
      audioTaskId: schema.items.audioTaskId,
    })
    .from(schema.items)
    .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Item not found' }, 404);
  }

  const item = rows[0];
  if ((item.audioStatus === 'pending' || item.audioStatus === 'processing') && item.audioTaskId) {
    return c.json({ error: 'Audio task already running', taskId: item.audioTaskId }, 409);
  }

  const audioUrl = item.mediaUrl || item.url;
  if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) {
    return c.json({ error: 'No valid audio URL found for this item' }, 400);
  }

  await db
    .update(schema.items)
    .set({
      audioStatus: 'pending',
      audioStatusReason: '手动触发音频转写，准备创建任务',
    })
    .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)));

  try {
    const result = await startAudioTaskForItem({
      audioUrl,
      title: item.title,
      itemId: item.id,
      userId: authUser.userId,
    });
    const nextStatus = result.status === 'queued' ? 'pending' : 'processing';

    await db
      .update(schema.items)
      .set({
        audioStatus: nextStatus,
        audioStatusReason: result.message || (nextStatus === 'pending' ? '任务已入队，等待音频服务处理' : '音频任务已启动'),
        audioTaskId: result.taskId,
      })
      .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)));

    return c.json({
      message: 'Audio transcribe task started',
      taskId: result.taskId,
      status: nextStatus,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.items)
      .set({
        audioStatus: 'error',
        audioStatusReason: detail,
      })
      .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)));

    return c.json({ error: `Failed to start audio task: ${detail}` }, 502);
  }
});

app.post('/:id/feedback', async (c) => {
  const authUser = requireAuth(c);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const feedbackType = String(body.feedbackType || '').trim();
  const reasonTags = Array.isArray(body.reasonTags)
    ? [...new Set(body.reasonTags.map((entry: unknown) => String(entry || '').trim()).filter(Boolean))].slice(0, 3)
    : [];
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : null;
  const targetSkillId = Number.isInteger(body.targetSkillId) ? Number(body.targetSkillId) : null;

  if (!['like', 'dislike', 'must_read', 'not_for_me'].includes(feedbackType)) {
    return c.json({ error: 'Invalid feedback type' }, 400);
  }

  const itemRows = await db
    .select({ id: schema.items.id })
    .from(schema.items)
    .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)))
    .limit(1);
  if (itemRows.length === 0) {
    return c.json({ error: 'Item not found' }, 404);
  }

  const inserted = await db.insert(schema.itemFeedback).values({
    itemId: id,
    userId: authUser.userId,
    feedbackType,
    targetSkillId,
    reasonTags,
    note,
  }).returning();

  return c.json({
    message: 'Feedback recorded',
    data: inserted[0] || null,
  }, 201);
});

app.get('/:id/score-breakdown', async (c) => {
  const authUser = requireAuth(c);
  const id = c.req.param('id');
  const itemRows = await db
    .select({
      id: schema.items.id,
      aiScore: schema.items.aiScore,
      priorityScore: schema.items.priorityScore,
      isFiltered: schema.items.isFiltered,
      filterReason: schema.items.filterReason,
    })
    .from(schema.items)
    .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)))
    .limit(1);
  const item = itemRows[0];
  if (!item) {
    return c.json({ error: 'Item not found' }, 404);
  }

  const [breakdowns, latestFeedback] = await Promise.all([
    getItemScoreBreakdowns(authUser.userId, id),
    getLatestItemFeedback(authUser.userId, id),
  ]);

  return c.json({
    data: {
      itemId: id,
      aiScore: item.aiScore,
      priorityScore: item.priorityScore,
      isFiltered: item.isFiltered,
      filterReason: item.filterReason,
      latestFeedback,
      breakdowns: breakdowns.map((row) => ({
        ...row,
        reasons: Array.isArray(row.reasons) ? row.reasons : [],
        matchedSignals: Array.isArray(row.matchedSignals) ? row.matchedSignals : [],
        riskFlags: Array.isArray(row.riskFlags) ? row.riskFlags : [],
      })),
    },
  });
});

// GET /api/items/:id — 详情
app.get('/:id', async (c) => {
  const authUser = requireAuth(c);
  const id = c.req.param('id');
  const rows = await db
    .select()
    .from(schema.items)
    .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Item not found' }, 404);
  }

  const item = rows[0];
  let content = item.content;
  let snippet = item.snippet;

  if (looksLikeBoilerplateText(content)) {
    content = cleanArticleBody(content, 50000) ?? content;
  }
  if (looksLikeBoilerplateText(snippet) && content) {
    snippet = buildSnippet(content, 220) ?? snippet;
  }

  const sourceRows = await db
    .select({
      sourceName: schema.sources.name,
      sourceCategory: schema.sources.category,
      sourceCollectorType: schema.sources.collectorType,
      sourceConfig: schema.sources.config,
    })
    .from(schema.sources)
    .where(and(eq(schema.sources.id, item.sourceId), eq(schema.sources.userId, authUser.userId)))
    .limit(1);

  const latestFeedback = await getLatestItemFeedback(authUser.userId, id);

  return c.json({
    data: {
      ...mapFeedItemResponse(item),
      content: content ?? null,
      snippet: cleanPreviewText(snippet || content, 220) ?? null,
      contentBasis: plainTextLength(content) >= 80 ? 'content' : plainTextLength(snippet) >= 24 ? 'snippet' : 'title',
      sourceName: sourceRows[0]?.sourceName || null,
      sourceCategory: sourceRows[0]?.sourceCategory || null,
      sourceCollectorType: sourceRows[0]?.sourceCollectorType || null,
      sourceConfig: sourceRows[0]?.sourceConfig || null,
      growthAxes: normalizeGrowthAxes(item.growthAxes, []),
      latestFeedbackType: latestFeedback?.feedbackType || null,
    },
  });
});

// PUT /api/items/:id/read — 标记已读
app.put('/:id/read', async (c) => {
  const authUser = requireAuth(c);
  const id = c.req.param('id');
  await db.update(schema.items)
    .set({ isRead: true })
    .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)));
  return c.json({ message: 'Marked as read' });
});

// PUT /api/items/:id/favorite — 切换收藏
app.put('/:id/favorite', async (c) => {
  const authUser = requireAuth(c);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const isFavorite = body.isFavorite !== undefined ? body.isFavorite : true;
  await db.update(schema.items)
    .set({ isFavorite })
    .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)));
  return c.json({ message: isFavorite ? 'Favorited' : 'Unfavorited' });
});

// PUT /api/items/:id/later — 切换稍后阅读
app.put('/:id/later', async (c) => {
  const authUser = requireAuth(c);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const isLater = body.isLater !== undefined ? body.isLater : true;
  await db.update(schema.items)
    .set({ isLater })
    .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)));
  return c.json({ message: isLater ? 'Saved for later' : 'Removed from later' });
});

export default app;
