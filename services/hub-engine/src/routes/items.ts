import { Hono } from 'hono';
import { eq, and, desc, count, ilike, or, gte, lt, inArray, sql, type SQL } from 'drizzle-orm';
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
import { qualityFilterItemsDetailed } from '../processors/quality-filter.js';
import { summarizeItems, summarizeItemsDetailed, translateItemsDetailed, translateItemsWithOptions } from '../processors/ai-summarizer.js';
import { getEffectiveAiSceneAvailability } from '../lib/ai-configs.js';
import { getItemScoreBreakdowns, getLatestItemFeedback } from '../lib/scoring-skills.js';
import { normalizeGrowthAxes } from '../lib/growth.js';
import { selectEventClusterLead } from '../lib/event-clustering.js';
import {
  buildReprocessResetPatch,
  isHardRuleFiltered,
  normalizeReprocessRequest,
  shouldReprocessItem,
  type ReprocessStage,
} from '../lib/reprocess-planner.js';
import { classifyContentBasisFromLengths } from '../lib/content-status.js';
import { resolveDailyReportWindow } from '../outputs/daily-report-window.js';
import { DEFAULT_DAILY_REPORT_WORKFLOW, normalizeDailyReportWorkflowConfig, prepareDailyReportCandidates } from '../outputs/daily-report-workflow.js';
import {
  buildDailyReportItemDiagnostic,
  buildDailyReportItemDiagnosticFromSnapshot,
  ensureDailyReportDiagnosticTargetRows,
} from '../outputs/daily-report-item-diagnostic.js';

const app = new Hono();

function deriveContentBasis(item: {
  title?: string | null;
  content?: string | null;
  snippet?: string | null;
  contentLength?: number | null;
  snippetLength?: number | null;
}) {
  if (item.contentLength != null || item.snippetLength != null) {
    return classifyContentBasisFromLengths({
      contentLength: item.contentLength,
      snippetLength: item.snippetLength,
    });
  }
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

async function getDailyReportWorkflowForUser(userId: string) {
  const rows = await db
    .select({ dailyReportWorkflow: schema.userSettings.dailyReportWorkflow })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId))
    .limit(1);
  return normalizeDailyReportWorkflowConfig(rows[0]?.dailyReportWorkflow || DEFAULT_DAILY_REPORT_WORKFLOW);
}

const itemDailyReportCandidateSelection = {
  id: schema.items.id,
  title: schema.items.title,
  url: schema.items.url,
  snippet: schema.items.snippet,
  aiScore: schema.items.aiScore,
  aiSummary: schema.items.aiSummary,
  aiTranslation: schema.items.aiTranslation,
  language: schema.items.language,
  translationStatus: schema.items.translationStatus,
  translationReason: schema.items.translationReason,
  aiTags: schema.items.aiTags,
  publishedAt: schema.items.publishedAt,
  fetchedAt: schema.items.fetchedAt,
  sourceName: schema.sources.name,
  category: schema.sources.category,
  sourceType: schema.items.sourceType,
  sourceTier: schema.items.sourceTier,
  sourceKind: schema.sources.sourceKind,
  clusterId: schema.items.clusterId,
  isFiltered: schema.items.isFiltered,
  filterBucket: schema.items.filterBucket,
  filterReason: schema.items.filterReason,
  qualityDecision: schema.items.qualityDecision,
  processingStatus: schema.items.processingStatus,
} as const;

function getSnapshotFromInsightPayload(payload: unknown): unknown {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).snapshot
    : null;
}

async function buildItemDailyReportSnapshotDiagnostic(userId: string, itemId: string, dateKey: string) {
  const rows = await db.select({
    payload: schema.insights.payload,
    generatedAt: schema.insights.generatedAt,
  })
    .from(schema.insights)
    .where(and(
      eq(schema.insights.userId, userId),
      eq(schema.insights.date, dateKey),
      eq(schema.insights.type, 'daily'),
    ))
    .orderBy(desc(schema.insights.generatedAt), desc(schema.insights.id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const diagnostic = buildDailyReportItemDiagnosticFromSnapshot(itemId, getSnapshotFromInsightPayload(row.payload));
  if (!diagnostic) return null;
  return {
    ...diagnostic,
    snapshotGeneratedAt: diagnostic.snapshotGeneratedAt || row.generatedAt?.toISOString?.() || null,
  };
}

async function buildItemDailyReportDiagnostic(userId: string, itemId: string, fetchedAt?: Date | string | null) {
  const { dateKey, dayStart, dayEnd } = resolveDailyReportWindow(fetchedAt || new Date());
  const snapshotDiagnostic = await buildItemDailyReportSnapshotDiagnostic(userId, itemId, dateKey);
  if (snapshotDiagnostic) return snapshotDiagnostic;

  const workflow = await getDailyReportWorkflowForUser(userId);
  const samplingLimit = Math.max(workflow.topN * 4, 120);
  let rows = await db.select(itemDailyReportCandidateSelection)
    .from(schema.items)
    .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
    .where(and(
      eq(schema.items.userId, userId),
      gte(schema.items.fetchedAt, dayStart),
      lt(schema.items.fetchedAt, dayEnd),
      or(
        eq(schema.items.id, itemId),
        and(eq(schema.items.filterBucket, 'main'), eq(schema.items.isFiltered, false)),
        and(
          eq(schema.items.filterBucket, 'filtered'),
          eq(schema.items.isFiltered, true),
          sql`coalesce(${schema.items.filterReason}, '') ~* '^ai score too low:\\s*[0-9]+\\s*<\\s*[0-9]+'`,
        ),
        eq(schema.items.processingStatus, 'score_failed'),
      ),
    ))
    .orderBy(desc(schema.items.priorityScore), desc(schema.items.fetchedAt))
    .limit(samplingLimit);

  if (!rows.some((row) => row.id === itemId)) {
    const targetRows = await db.select(itemDailyReportCandidateSelection)
      .from(schema.items)
      .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
      .where(and(
        eq(schema.items.userId, userId),
        eq(schema.items.id, itemId),
      ))
      .limit(1);
    rows = ensureDailyReportDiagnosticTargetRows(rows, targetRows, itemId);
  }

  const itemIds = rows.map((row) => row.id);
  const scoreRiskRows = itemIds.length > 0
    ? await db
      .select({
        itemId: schema.itemScoreBreakdowns.itemId,
        riskFlags: schema.itemScoreBreakdowns.riskFlags,
      })
      .from(schema.itemScoreBreakdowns)
      .where(and(
        eq(schema.itemScoreBreakdowns.userId, userId),
        inArray(schema.itemScoreBreakdowns.itemId, itemIds),
      ))
    : [];
  const scoreRiskFlagsByItem = new Map<string, string[]>();
  for (const row of scoreRiskRows) {
    const flags = Array.isArray(row.riskFlags) ? row.riskFlags.map((flag) => String(flag)).filter(Boolean) : [];
    if (flags.length === 0) continue;
    scoreRiskFlagsByItem.set(row.itemId, [...(scoreRiskFlagsByItem.get(row.itemId) || []), ...flags]);
  }

  const preparation = await prepareDailyReportCandidates(rows.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    aiScore: row.aiScore,
    aiSummary: row.aiSummary,
    snippet: row.snippet,
    aiTranslation: row.aiTranslation,
    language: row.language,
    translationStatus: row.translationStatus,
    translationReason: row.translationReason,
    sourceName: row.sourceName || 'Unknown',
    category: row.category || 'uncategorized',
    sourceType: row.sourceType || 'article',
    sourceTier: row.sourceTier,
    sourceKind: row.sourceKind,
    clusterId: row.clusterId,
    isFiltered: row.isFiltered,
    filterBucket: row.filterBucket,
    filterReason: row.filterReason,
    qualityDecision: row.qualityDecision,
    processingStatus: row.processingStatus,
    scoreRiskFlags: [...new Set(scoreRiskFlagsByItem.get(row.id) || [])],
    publishedAt: row.publishedAt?.toISOString?.() || null,
    fetchedAt: row.fetchedAt?.toISOString?.() || null,
    aiTags: Array.isArray(row.aiTags) ? row.aiTags.map((tag) => String(tag)) : [],
  })), workflow, { allowPendingTranslationCandidates: true });

  return {
    ...buildDailyReportItemDiagnostic(itemId, preparation),
    diagnosticBasis: 'current_rules' as const,
    diagnosticBasisLabel: '依据：当前日报规则预览',
    snapshotGeneratedAt: null,
  };
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
  const sourceTier = c.req.query('sourceTier');
  const monitorOnly = c.req.query('monitorOnly') === 'true';
  const search = c.req.query('search');
  const sortBy = c.req.query('sortBy') || 'publishedAt';
  const sourceId = c.req.query('sourceId');
  const includeFiltered = c.req.query('includeFiltered') === 'true';
  const bucket = c.req.query('bucket');
  const qualityDecision = c.req.query('qualityDecision');
  const qualityTag = c.req.query('qualityTag');
  const restored = c.req.query('restored');

  const conditions: SQL<unknown>[] = [eq(schema.items.userId, authUser.userId)];
  if (bucket === 'filtered') {
    conditions.push(eq(schema.items.filterBucket, 'filtered'));
  } else {
    conditions.push(eq(schema.items.filterBucket, 'main'));
    if (!includeFiltered) conditions.push(eq(schema.items.isFiltered, false));
  }
  if (isRead !== undefined) conditions.push(eq(schema.items.isRead, isRead === 'true'));
  if (isFavorite !== undefined) conditions.push(eq(schema.items.isFavorite, isFavorite === 'true'));
  if (sourceType) conditions.push(eq(schema.items.sourceType, sourceType));
  if (sourceTier) conditions.push(eq(schema.items.sourceTier, sourceTier));
  if (collectorType) conditions.push(eq(schema.sources.collectorType, collectorType));
  if (category) conditions.push(eq(schema.sources.category, category));
  if (monitorOnly) conditions.push(eq(schema.sources.sourceRole, 'monitor'));
  if (sourceId) conditions.push(eq(schema.items.sourceId, Number(sourceId)));
  if (qualityDecision) conditions.push(eq(schema.items.qualityDecision, qualityDecision));
  if (qualityTag) conditions.push(sql`coalesce(${schema.items.qualityTags}, '[]'::jsonb) ? ${qualityTag}`);
  if (restored !== undefined) conditions.push(eq(schema.items.restoredFromFilter, restored === 'true'));
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
      clusterId: schema.items.clusterId,
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
      qualityDecision: schema.items.qualityDecision,
      qualitySummary: schema.items.qualitySummary,
      qualityReason: schema.items.qualityReason,
      qualityTags: schema.items.qualityTags,
      qualityRiskFlags: schema.items.qualityRiskFlags,
      qualityScore: schema.items.qualityScore,
      qualityConfidence: schema.items.qualityConfidence,
      qualityCheckedAt: schema.items.qualityCheckedAt,
      filterBucket: schema.items.filterBucket,
      restoredAt: schema.items.restoredAt,
      restoredFromFilter: schema.items.restoredFromFilter,
      contentStatus: schema.items.contentStatus,
      contentError: schema.items.contentError,
      fetchEngine: schema.items.fetchEngine,
      renderMode: schema.items.renderMode,
      blockedReason: schema.items.blockedReason,
      summaryStatus: schema.items.summaryStatus,
      summaryBasis: schema.items.summaryBasis,
      summaryReason: schema.items.summaryReason,
      translationStatus: schema.items.translationStatus,
      translationReason: schema.items.translationReason,
      sourceName: schema.sources.name,
      sourceCategory: schema.sources.category,
      sourceCollectorType: schema.sources.collectorType,
      sourceKind: schema.sources.sourceKind,
      authorityWeight: schema.sources.authorityWeight,
      sourceConfig: schema.sources.config,
      contentLength: sql<number>`coalesce(length(trim(${schema.items.content})), 0)`,
      snippetLength: sql<number>`coalesce(length(trim(${schema.items.snippet})), 0)`,
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
  const visibleCondition = and(
    eq(schema.items.userId, authUser.userId),
    eq(schema.items.filterBucket, 'main'),
    eq(schema.items.isFiltered, false),
  );
  const [total, unread, favorites, today, allRows, filteredRows, mismatchedRows] = await Promise.all([
    db.select({ count: count() }).from(schema.items).where(visibleCondition),
    db.select({ count: count() }).from(schema.items).where(and(visibleCondition, eq(schema.items.isRead, false))),
    db.select({ count: count() }).from(schema.items).where(and(visibleCondition, eq(schema.items.isFavorite, true))),
    db.select({ count: count() }).from(schema.items).where(and(visibleCondition, gte(schema.items.fetchedAt, dayStart))),
    db.select({ count: count() }).from(schema.items).where(eq(schema.items.userId, authUser.userId)),
    db.select({ count: count() }).from(schema.items).where(and(eq(schema.items.userId, authUser.userId), eq(schema.items.filterBucket, 'filtered'))),
    db.select({ count: count() }).from(schema.items).where(and(
      eq(schema.items.userId, authUser.userId),
      eq(schema.items.isFiltered, true),
      eq(schema.items.filterBucket, 'main'),
    )),
  ]);
  return c.json({
    total: total[0]?.count || 0,
    unread: unread[0]?.count || 0,
    favorites: favorites[0]?.count || 0,
    today: today[0]?.count || 0,
    funnel: {
      allItems: allRows[0]?.count || 0,
      visibleItems: total[0]?.count || 0,
      filteredBucketItems: filteredRows[0]?.count || 0,
      mismatchedFilteredMain: mismatchedRows[0]?.count || 0,
      todayVisibleItems: today[0]?.count || 0,
    },
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

// POST /api/items/reprocess — 批量重跑正文/质检/评分/摘要/翻译
app.post('/reprocess', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const request = normalizeReprocessRequest({
    ...body,
    stage: body.stage ?? c.req.query('stage'),
    itemId: body.itemId ?? c.req.query('itemId'),
    sourceId: body.sourceId ?? c.req.query('sourceId'),
    date: body.date ?? c.req.query('date'),
    limit: body.limit ?? c.req.query('limit'),
  });

  const conditions: SQL<unknown>[] = [eq(schema.items.userId, authUser.userId)];
  if (request.itemId) conditions.push(eq(schema.items.id, request.itemId));
  if (request.sourceId) conditions.push(eq(schema.items.sourceId, request.sourceId));
  if (request.dateStart) conditions.push(gte(schema.items.fetchedAt, request.dateStart));
  if (request.dateEnd) conditions.push(lt(schema.items.fetchedAt, request.dateEnd));

  const rows = await db
    .select({
      id: schema.items.id,
      sourceId: schema.items.sourceId,
      fetchedAt: schema.items.fetchedAt,
      contentStatus: schema.items.contentStatus,
      contentLength: sql<number>`coalesce(length(trim(${schema.items.content})), 0)`,
      snippetLength: sql<number>`coalesce(length(trim(${schema.items.snippet})), 0)`,
      aiScore: schema.items.aiScore,
      summaryBasis: schema.items.summaryBasis,
      processingStatus: schema.items.processingStatus,
      summaryStatus: schema.items.summaryStatus,
      translationStatus: schema.items.translationStatus,
      isFiltered: schema.items.isFiltered,
      filterBucket: schema.items.filterBucket,
      qualityTags: schema.items.qualityTags,
    })
    .from(schema.items)
    .where(and(...conditions))
    .orderBy(desc(schema.items.fetchedAt))
    .limit(Math.max(request.limit * 5, request.limit));

  const candidates = rows
    .filter((row) => shouldReprocessItem(row, request))
    .slice(0, request.limit);
  const itemIds = candidates.map((row) => row.id);

  if (itemIds.length === 0) {
    return c.json({
      message: 'No matching items to reprocess',
      request,
      matched: 0,
      content: 0,
      quality: 0,
      scored: 0,
      summarized: 0,
      translated: 0,
      skipped: {
        quality: 0,
        scoring: 0,
        summary: 0,
        translation: 0,
      },
      errors: {},
      itemIds: [],
    });
  }

  for (const candidate of candidates) {
    const patch = buildReprocessResetPatch(request.stage, isHardRuleFiltered(candidate));
    if (Object.keys(patch).length > 0) {
      await db.update(schema.items)
        .set(patch)
        .where(and(eq(schema.items.id, candidate.id), eq(schema.items.userId, authUser.userId)));
    }
  }

  const scenes = await getEffectiveAiSceneAvailability(authUser.userId);
  const shouldRun = (stage: ReprocessStage) => request.stage === 'all' || request.stage === stage;
  const errors: Record<string, string[]> = {};
  let content = 0;
  let quality = 0;
  let scored = 0;
  let summarized = 0;
  let translated = 0;
  const skipped = {
    quality: 0,
    scoring: 0,
    summary: 0,
    translation: 0,
  };

  if (shouldRun('content')) {
    for (const itemId of itemIds) {
      const result = await ensureItemContent(authUser.userId, itemId, { force: true });
      if (result.contentFetched) content++;
      if (result.warning) errors.content = [...(errors.content || []), result.warning];
    }
  }
  if (shouldRun('quality') && scenes.has('quality_filter')) {
    const result = await qualityFilterItemsDetailed(authUser.userId, itemIds.length, { itemIds });
    quality = result.processed;
    skipped.quality = result.skipped || 0;
    if (result.errors.length > 0) errors.quality = result.errors;
  }
  if (shouldRun('scoring') && scenes.has('scoring')) {
    const result = await scoreItemsDetailed(authUser.userId, itemIds.length, { itemIds });
    scored = result.processed;
    skipped.scoring = result.skipped || 0;
    if (result.errors.length > 0) errors.scoring = result.errors;
  }
  if (shouldRun('summary') && scenes.has('summary')) {
    const result = await summarizeItemsDetailed(authUser.userId, itemIds.length, { itemIds });
    summarized = result.processed;
    skipped.summary = result.skipped || 0;
    if (result.errors.length > 0) errors.summary = result.errors;
  }
  if (shouldRun('translation') && scenes.has('translation')) {
    const result = await translateItemsDetailed(authUser.userId, itemIds.length, { itemIds });
    translated = result.processed;
    skipped.translation = result.skipped || 0;
    if (result.errors.length > 0) errors.translation = result.errors;
  }

  return c.json({
    message: 'Batch reprocess complete',
    request,
    matched: itemIds.length,
    content,
    quality,
    scored,
    summarized,
    translated,
    skipped,
    errors,
    itemIds,
  });
});

// POST /api/items/:id/reprocess-ai — 单条重跑评分/摘要/翻译
app.post('/:id/reprocess-ai', async (c) => {
  const authUser = requireAuth(c);
  const id = c.req.param('id');

  const rows = await db
    .select({
      id: schema.items.id,
      userId: schema.items.userId,
      isFiltered: schema.items.isFiltered,
      filterReason: schema.items.filterReason,
      qualityTags: schema.items.qualityTags,
    })
    .from(schema.items)
    .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Item not found' }, 404);
  }

  const activeConfigs = await getEffectiveAiSceneAvailability(authUser.userId);
  const hasQuality = activeConfigs.has('quality_filter');
  const hasScoring = activeConfigs.has('scoring');
  const hasSummary = activeConfigs.has('summary');
  const hasTranslation = activeConfigs.has('translation');

  if (!hasQuality && !hasScoring && !hasSummary && !hasTranslation) {
    return c.json({ error: 'No active AI config found. Please configure in settings first.' }, 400);
  }

  const processingStatus = hasScoring ? 'raw' : hasSummary ? 'scored' : 'summarized';
  const current = rows[0];
  const hardRuleFiltered = Array.isArray(current.qualityTags) && current.qualityTags.includes('硬规则过滤');
  const resetUpdate: Record<string, unknown> = {
    aiScore: null,
    aiSummary: null,
    aiTags: [],
    aiTranslation: null,
    summaryStatus: 'pending',
    summaryBasis: null,
    summaryReason: null,
    translationStatus: 'pending',
    translationReason: null,
    processingStatus,
  };
  if (hasQuality) {
    resetUpdate.qualityDecision = null;
    resetUpdate.qualitySummary = null;
    resetUpdate.qualityReason = null;
    resetUpdate.qualityTags = [];
    resetUpdate.qualityRiskFlags = [];
    resetUpdate.qualityScore = null;
    resetUpdate.qualityConfidence = null;
    resetUpdate.qualityCheckedAt = null;
    if (!hardRuleFiltered) {
      resetUpdate.filterBucket = 'main';
      resetUpdate.isFiltered = false;
      resetUpdate.filterReason = null;
    }
  }

  await db.update(schema.items)
    .set(resetUpdate)
    .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)));

  let filtered = 0;
  let scored = 0;
  let summarized = 0;
  let translated = 0;

  if (hasQuality) {
    filtered = (await qualityFilterItemsDetailed(authUser.userId, 1, { itemId: id })).processed;
  }
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
    filtered,
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
      summaryReason: schema.items.summaryReason,
      processingStatus: schema.items.processingStatus,
      contentStatus: schema.items.contentStatus,
      isFiltered: schema.items.isFiltered,
      qualityDecision: schema.items.qualityDecision,
      qualityCheckedAt: schema.items.qualityCheckedAt,
      qualityTags: schema.items.qualityTags,
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
  const hardRuleFiltered = Array.isArray(current.qualityTags) && current.qualityTags.includes('硬规则过滤');
  const shouldQuality = scenes.has('quality_filter') && (
    contentResult.contentFetched
    || current.qualityCheckedAt == null
    || current.qualityDecision === 'review'
  );
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
  if (!scenes.has('quality_filter')) warnings.push('未启用阅读质检模型');
  if (effectiveLanguage === 'zh') warnings.push('原文已是中文，跳过翻译');

  if (shouldQuality) {
    const resetUpdate: Record<string, unknown> = {
      qualityDecision: null,
      qualitySummary: null,
      qualityReason: null,
      qualityTags: [],
      qualityRiskFlags: [],
      qualityScore: null,
      qualityConfidence: null,
      qualityCheckedAt: null,
      processingStatus: 'raw',
    };
    if (!hardRuleFiltered) {
      resetUpdate.isFiltered = false;
      resetUpdate.filterReason = null;
      resetUpdate.filterBucket = 'main';
    }
    await db.update(schema.items).set(resetUpdate)
      .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)));
  } else if (shouldScore) {
    await db.update(schema.items).set({
      aiScore: null,
      processingStatus: 'raw',
      isFiltered: false,
      filterReason: null,
      summaryReason: null,
    }).where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)));
  } else if (shouldSummarize) {
    await db.update(schema.items).set({
      aiSummary: null,
      aiTags: [],
      summaryStatus: 'pending',
      summaryBasis: null,
      summaryReason: null,
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

  if (shouldQuality) {
    const quality = await qualityFilterItemsDetailed(authUser.userId, 1, { itemId: id });
    if (quality.errors.length > 0) warnings.push(...quality.errors);
    filterDecision = quality.processed > 0 ? 'recomputed' : filterDecision;
  }
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

app.get('/:id/quality-check', async (c) => {
  const authUser = requireAuth(c);
  const id = c.req.param('id');
  const itemRows = await db
    .select({
      id: schema.items.id,
      sourceId: schema.items.sourceId,
      sourceTier: schema.items.sourceTier,
      isFiltered: schema.items.isFiltered,
      filterBucket: schema.items.filterBucket,
      filterReason: schema.items.filterReason,
      qualityDecision: schema.items.qualityDecision,
      qualitySummary: schema.items.qualitySummary,
      qualityReason: schema.items.qualityReason,
      qualityTags: schema.items.qualityTags,
      qualityRiskFlags: schema.items.qualityRiskFlags,
      qualityScore: schema.items.qualityScore,
      qualityConfidence: schema.items.qualityConfidence,
      qualityCheckedAt: schema.items.qualityCheckedAt,
      restoredAt: schema.items.restoredAt,
      restoredFromFilter: schema.items.restoredFromFilter,
    })
    .from(schema.items)
    .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)))
    .limit(1);
  const item = itemRows[0];
  if (!item) {
    return c.json({ error: 'Item not found' }, 404);
  }

  const auditRows = await db
    .select()
    .from(schema.itemQualityChecks)
    .where(and(eq(schema.itemQualityChecks.itemId, id), eq(schema.itemQualityChecks.userId, authUser.userId)))
    .orderBy(desc(schema.itemQualityChecks.createdAt), desc(schema.itemQualityChecks.id))
    .limit(1);

  return c.json({
    data: {
      itemId: id,
      sourceId: item.sourceId,
      sourceTier: item.sourceTier,
      isFiltered: item.isFiltered,
      filterBucket: item.filterBucket,
      filterReason: item.filterReason,
      qualityDecision: item.qualityDecision,
      qualitySummary: item.qualitySummary,
      qualityReason: item.qualityReason,
      qualityTags: Array.isArray(item.qualityTags) ? item.qualityTags : [],
      qualityRiskFlags: Array.isArray(item.qualityRiskFlags) ? item.qualityRiskFlags : [],
      qualityScore: item.qualityScore,
      qualityConfidence: item.qualityConfidence,
      qualityCheckedAt: item.qualityCheckedAt,
      restoredAt: item.restoredAt,
      restoredFromFilter: item.restoredFromFilter,
      latestCheck: auditRows[0] ? {
        ...auditRows[0],
        tags: Array.isArray(auditRows[0].tags) ? auditRows[0].tags : [],
        riskFlags: Array.isArray(auditRows[0].riskFlags) ? auditRows[0].riskFlags : [],
      } : null,
    },
  });
});

app.post('/:id/restore', async (c) => {
  const authUser = requireAuth(c);
  const id = c.req.param('id');

  const rows = await db
    .select({
      id: schema.items.id,
      isFiltered: schema.items.isFiltered,
      filterBucket: schema.items.filterBucket,
    })
    .from(schema.items)
    .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)))
    .limit(1);
  if (rows.length === 0) {
    return c.json({ error: 'Item not found' }, 404);
  }

  await db.update(schema.items).set({
    isFiltered: false,
    filterBucket: 'main',
    restoredAt: new Date(),
    restoredFromFilter: true,
  }).where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)));

  const refreshed = await db.select()
    .from(schema.items)
    .where(and(eq(schema.items.id, id), eq(schema.items.userId, authUser.userId)))
    .limit(1);

  return c.json({
    message: 'Item restored to main feed',
    data: refreshed[0] ? mapFeedItemResponse(refreshed[0]) : null,
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
      sourceKind: schema.sources.sourceKind,
      authorityWeight: schema.sources.authorityWeight,
      sourceConfig: schema.sources.config,
    })
    .from(schema.sources)
    .where(and(eq(schema.sources.id, item.sourceId), eq(schema.sources.userId, authUser.userId)))
    .limit(1);

  const [latestFeedback, dailyReportDiagnostic] = await Promise.all([
    getLatestItemFeedback(authUser.userId, id),
    buildItemDailyReportDiagnostic(authUser.userId, id, item.fetchedAt),
  ]);
  const relatedRows = item.clusterId
    ? await db
      .select({
        id: schema.items.id,
        title: schema.items.title,
        url: schema.items.url,
        aiScore: schema.items.aiScore,
        priorityScore: schema.items.priorityScore,
        publishedAt: schema.items.publishedAt,
        fetchedAt: schema.items.fetchedAt,
        sourceName: schema.sources.name,
        sourceTier: schema.items.sourceTier,
        sourceKind: schema.sources.sourceKind,
        authorityWeight: schema.sources.authorityWeight,
      })
      .from(schema.items)
      .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
      .where(and(
        eq(schema.items.userId, authUser.userId),
        eq(schema.items.clusterId, item.clusterId),
        eq(schema.items.isFiltered, false),
      ))
      .orderBy(desc(schema.items.priorityScore), desc(sql`coalesce(${schema.items.publishedAt}, ${schema.items.fetchedAt})`))
      .limit(10)
    : [];
  const clusterLead = selectEventClusterLead(relatedRows.map((row) => ({
    id: row.id,
    sourceTier: row.sourceTier,
    sourceKind: row.sourceKind,
    authorityWeight: row.authorityWeight,
    aiScore: row.aiScore,
    priorityScore: row.priorityScore,
    publishedAt: row.publishedAt || row.fetchedAt,
  })));

  return c.json({
    data: {
      ...mapFeedItemResponse(item),
      content: content ?? null,
      snippet: cleanPreviewText(snippet || content, 220) ?? null,
      contentBasis: classifyContentBasisFromLengths({
        contentLength: plainTextLength(content),
        snippetLength: plainTextLength(snippet),
      }),
      sourceName: sourceRows[0]?.sourceName || null,
      sourceCategory: sourceRows[0]?.sourceCategory || null,
      sourceCollectorType: sourceRows[0]?.sourceCollectorType || null,
      sourceKind: sourceRows[0]?.sourceKind || null,
      authorityWeight: sourceRows[0]?.authorityWeight || null,
      sourceConfig: sourceRows[0]?.sourceConfig || null,
      growthAxes: normalizeGrowthAxes(item.growthAxes, []),
      latestFeedbackType: latestFeedback?.feedbackType || null,
      dailyReportDiagnostic,
      eventCluster: item.clusterId ? {
        clusterId: item.clusterId,
        leadItemId: clusterLead?.id || item.id,
        relatedCount: Math.max(0, relatedRows.length - 1),
        recommendationReason: relatedRows.length > 1
          ? '同一事件已折叠为事件簇，官方/一手信源优先作为主条，KOL、媒体与二手讨论保留为关联讨论。'
          : '当前事件暂未发现其他关联讨论。',
        relatedItems: relatedRows
          .filter((row) => row.id !== item.id)
          .map((row) => ({
            id: row.id,
            title: row.title,
            url: row.url,
            sourceName: row.sourceName,
            sourceTier: row.sourceTier,
            sourceKind: row.sourceKind,
            aiScore: row.aiScore,
            priorityScore: row.priorityScore,
            publishedAt: row.publishedAt,
            fetchedAt: row.fetchedAt,
          })),
      } : null,
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
