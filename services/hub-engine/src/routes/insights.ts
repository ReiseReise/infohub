import { Hono } from 'hono';
import { and, eq, or, desc, gte, lt, count, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  buildDailyReportCandidateSampleOrder,
  buildDailyReportCoverageIndex,
  generateDailyReport,
  isDailyReportHotSignal,
  type DailyReportGenerationMode,
} from '../outputs/daily-report.js';
import { scheduleDailyReportPush } from '../outputs/push.js';
import { resolveDailyReportDeliveryDecision } from '../lib/daily-report-quality.js';
import { resolveDailyReportWindow } from '../outputs/daily-report-window.js';
import { requireAuth } from '../lib/auth.js';
import {
  GROWTH_AXES,
  normalizeGrowthAxes,
  resolveItemGrowthAxis,
} from '../lib/growth.js';
import { getVisibleAiConfigsForUser } from '../lib/ai-configs.js';
import { resolveSourceReadingTier } from '../lib/source-reading-tier.js';
import {
  DEFAULT_DAILY_REPORT_WORKFLOW,
  normalizeReportSummaryText,
  normalizeDailyReportWorkflowConfig,
  prepareDailyReportCandidates,
  summarizeDailyReportExcludedCandidates,
  type DailyReportWorkflowConfig,
} from '../outputs/daily-report-workflow.js';
import { mainReadingSourceCondition } from '../lib/reference-source-visibility.js';

const app = new Hono();

type DashboardRow = {
  id: string;
  title: string;
  url: string;
  aiScore: number | null;
  priorityScore: number | null;
  aiSummary: string | null;
  aiTags: unknown;
  growthAxes: unknown;
  sourceTier: string;
  processingProfile: string;
  publishedAt: Date | null;
  fetchedAt: Date;
  sourceName: string | null;
  sourceCategory: string | null;
};

function computeImportance(item: Pick<DashboardRow, 'priorityScore' | 'aiScore' | 'sourceTier'>) {
  const score = item.priorityScore ?? ((item.aiScore ?? 50) / 100);
  const tierBoost = item.sourceTier === 'S'
    ? 0.18
    : item.sourceTier === 'A'
      ? 0.08
      : item.sourceTier === 'D'
        ? -0.12
        : 0;
  return Number((score + tierBoost).toFixed(3));
}

function buildActionSuggestion(axis: string, item: Pick<DashboardRow, 'sourceTier' | 'processingProfile' | 'aiScore'>) {
  if (axis === '技术能力') {
    return item.sourceTier === 'S' ? '读原文并记录实现约束' : '摘出 1 个可复用做法';
  }
  if (axis === '商业判断') {
    return item.aiScore != null && item.aiScore >= 75 ? '纳入趋势观察与下注判断' : '先看信号是否持续出现';
  }
  if (axis === '表达输出') {
    return item.processingProfile === 'full' ? '适合转成分享或观点卡' : '先记 1 句表达切口';
  }
  return item.sourceTier === 'S' ? '作为本周认知升级重点材料' : '先抓核心观点，再决定是否深读';
}

function buildAxisSummary(axis: string, items: Array<DashboardRow & { resolvedAxes: string[] }>) {
  if (items.length === 0) return '最近窗口内还没有稳定命中，先补信源映射。';
  const highSignalCount = items.filter((item) => ['S', 'A'].includes(item.sourceTier)).length;
  const highScoreCount = items.filter((item) => (item.aiScore ?? 0) >= 75).length;
  if (axis === '技术能力') {
    return `最近命中 ${items.length} 条，其中 ${highSignalCount} 条来自高信号源，优先筛可部署、可复用、可验证的能力。`;
  }
  if (axis === '商业判断') {
    return `最近命中 ${items.length} 条，其中 ${highScoreCount} 条达到高分，适合观察市场、公司与叙事变化是否形成共振。`;
  }
  if (axis === '表达输出') {
    return `最近命中 ${items.length} 条，适合从高分条目里找“值得讲出去”的观点切口，而不是只做收藏。`;
  }
  return `最近命中 ${items.length} 条，可优先围绕高信号源做认知升级，再决定是否延伸到行动。`;
}

type AxisEmptyDiagnostics = {
  matched: number;
  filtered: number;
  unscored: number;
  secondaryOnly: number;
  sourceMapped: number;
};

function buildAxisEmptyReason(axis: string, diagnostics: AxisEmptyDiagnostics) {
  if (diagnostics.filtered > 0) {
    return `${axis} 有 ${diagnostics.filtered} 条候选被过滤，当前没有可在主视图展示的内容。`;
  }
  if (diagnostics.unscored > 0) {
    return `${axis} 有 ${diagnostics.unscored} 条内容尚未评分，完成评分后再判断是否进入主视图。`;
  }
  if (diagnostics.secondaryOnly > 0) {
    return `${axis} 暂无主归属文章；有 ${diagnostics.secondaryOnly} 条仅作为次级标签，已展示在其主成长维度中。`;
  }
  if (diagnostics.sourceMapped === 0) {
    return `${axis} 尚无信源明确映射，近期内容也未匹配到该维度。`;
  }
  return `${axis} 已有 ${diagnostics.sourceMapped} 个映射信源，但当前时间窗口没有匹配内容。`;
}

export async function getDailyReportWorkflow(userId: string): Promise<DailyReportWorkflowConfig> {
  const rows = await db
    .select({ dailyReportWorkflow: schema.userSettings.dailyReportWorkflow })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId))
    .limit(1);
  return normalizeDailyReportWorkflowConfig(rows[0]?.dailyReportWorkflow || DEFAULT_DAILY_REPORT_WORKFLOW);
}

export async function getDailyWorkflowAiScenes(userId: string, role: string) {
  const configs = await getVisibleAiConfigsForUser(userId, role);
  const sceneTypes = new Set([
    'daily_report_cleaning',
    'daily_report_decision',
    'daily_report_research',
    'daily_report_reading',
    'daily_report_final',
  ]);
  return configs
    .filter((config) => sceneTypes.has(config.type))
    .map((config) => ({
      id: config.id,
      type: config.type,
      name: config.name,
      isActive: config.isActive,
      promptTemplateId: config.promptTemplateId,
      promptTemplate: role === 'admin' ? config.promptTemplate : '',
      modelConfigId: config.modelConfigId,
      model: config.model,
      provider: config.provider,
    }));
}

export async function buildDailyWorkflowPreview(userId: string, workflowInput?: unknown, dateInput?: string | Date | null) {
  const workflow = normalizeDailyReportWorkflowConfig(workflowInput || await getDailyReportWorkflow(userId));
  const { dayStart, dayEnd } = resolveDailyReportWindow(dateInput);
  const samplingLimit = Math.max(workflow.topN * 4, 60);
  const candidatePoolLimit = Math.max(workflow.topN * 20, 500);
  const hotSignalSql = sql<number>`
    case
      when concat_ws(
        ' ',
        ${schema.items.title},
        coalesce(${schema.items.snippet}, ''),
        coalesce(${schema.items.aiSummary}, ''),
        coalesce(${schema.items.aiTranslation}, ''),
        coalesce(${schema.sources.name}, ''),
        coalesce(${schema.sources.category}, '')
      ) ~* '(claude|anthropic|openai|gpt-?5|gemini|deepmind|fable\\s*5|mythos|opus|sonnet|haiku|agent|智能体|新模型|模型发布|大模型|推理模型|多模态模型|api|codex|cursor)'
      then 1
      else 0
    end
  `;

  const [newRows, todayRows, auditRows] = await Promise.all([
    db.select({ count: count() })
      .from(schema.items)
      .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
      .where(and(
        eq(schema.items.userId, userId),
        mainReadingSourceCondition(),
        gte(schema.items.fetchedAt, dayStart),
        lt(schema.items.fetchedAt, dayEnd),
      )),
    db.select({
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
      priorityScore: schema.items.priorityScore,
      contentStatus: schema.items.contentStatus,
      summaryStatus: schema.items.summaryStatus,
      aiTags: schema.items.aiTags,
      publishedAt: schema.items.publishedAt,
      fetchedAt: schema.items.fetchedAt,
      sourceName: schema.sources.name,
      category: schema.sources.category,
      sourceType: schema.items.sourceType,
      sourceTier: schema.items.sourceTier,
      sourceKind: schema.sources.sourceKind,
      sourceRole: schema.sources.sourceRole,
      sourceCollectorType: schema.sources.collectorType,
      sourceConfig: schema.sources.config,
      sourceStatus: schema.sources.status,
      sourceAutoFetchEnabled: schema.sources.autoFetchEnabled,
      sourceTags: schema.sources.tags,
      clusterId: schema.items.clusterId,
      isFiltered: schema.items.isFiltered,
      filterBucket: schema.items.filterBucket,
      filterReason: schema.items.filterReason,
      qualityDecision: schema.items.qualityDecision,
      processingStatus: schema.items.processingStatus,
    })
      .from(schema.items)
      .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
      .where(and(
        eq(schema.items.userId, userId),
        mainReadingSourceCondition(),
        gte(schema.items.fetchedAt, dayStart),
        lt(schema.items.fetchedAt, dayEnd),
        or(
          and(eq(schema.items.filterBucket, 'main'), eq(schema.items.isFiltered, false)),
          and(
            eq(schema.items.filterBucket, 'filtered'),
            eq(schema.items.isFiltered, true),
            sql`coalesce(${schema.items.filterReason}, '') ~* '^ai score too low:\\s*[0-9]+\\s*<\\s*[0-9]+'`,
          ),
          eq(schema.items.processingStatus, 'score_failed'),
        ),
      ))
      .orderBy(desc(hotSignalSql), desc(schema.items.priorityScore), desc(schema.items.fetchedAt))
      .limit(candidatePoolLimit),
    db.select({
      id: schema.items.id,
      title: schema.items.title,
      snippet: schema.items.snippet,
      aiSummary: schema.items.aiSummary,
      aiTranslation: schema.items.aiTranslation,
      aiScore: schema.items.aiScore,
      priorityScore: schema.items.priorityScore,
      processingStatus: schema.items.processingStatus,
      summaryStatus: schema.items.summaryStatus,
      isFiltered: schema.items.isFiltered,
      filterBucket: schema.items.filterBucket,
      qualityDecision: schema.items.qualityDecision,
      contentStatus: schema.items.contentStatus,
      sourceName: schema.sources.name,
      category: schema.sources.category,
    })
      .from(schema.items)
      .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
      .where(and(
        eq(schema.items.userId, userId),
        mainReadingSourceCondition(),
        gte(schema.items.fetchedAt, dayStart),
        lt(schema.items.fetchedAt, dayEnd),
      )),
  ]);

  const sampledRows = buildDailyReportCandidateSampleOrder(todayRows.map((row) => ({
    ...row,
    sourceName: row.sourceName || 'Unknown',
    category: row.category || 'uncategorized',
    sourceReadingTier: resolveSourceReadingTier({
      name: row.sourceName,
      sourceTier: row.sourceTier,
      collectorType: row.sourceCollectorType,
      sourceType: row.sourceType,
      sourceKind: row.sourceKind,
      category: row.category,
      status: row.sourceStatus,
      autoFetchEnabled: row.sourceAutoFetchEnabled,
      tags: row.sourceTags,
      config: row.sourceConfig,
    }).value,
  })), samplingLimit);

  const todayItemIds = sampledRows.map((row) => row.id);
  const scoreRiskRows = todayItemIds.length > 0
    ? await db
      .select({
        itemId: schema.itemScoreBreakdowns.itemId,
        riskFlags: schema.itemScoreBreakdowns.riskFlags,
      })
      .from(schema.itemScoreBreakdowns)
      .where(and(
        eq(schema.itemScoreBreakdowns.userId, userId),
        inArray(schema.itemScoreBreakdowns.itemId, todayItemIds),
      ))
    : [];
  const scoreRiskFlagsByItem = new Map<string, string[]>();
  for (const row of scoreRiskRows) {
    const flags = Array.isArray(row.riskFlags) ? row.riskFlags.map((flag) => String(flag)).filter(Boolean) : [];
    if (flags.length === 0) continue;
    scoreRiskFlagsByItem.set(row.itemId, [...(scoreRiskFlagsByItem.get(row.itemId) || []), ...flags]);
  }

  const preparation = await prepareDailyReportCandidates(sampledRows.map((row) => ({
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
    readingTier: resolveSourceReadingTier({
      name: row.sourceName,
      sourceTier: row.sourceTier,
      collectorType: row.sourceCollectorType,
      sourceType: row.sourceType,
      sourceKind: row.sourceKind,
      category: row.category,
      status: row.sourceStatus,
      autoFetchEnabled: row.sourceAutoFetchEnabled,
      tags: row.sourceTags,
      config: row.sourceConfig,
    }).value,
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

  const coverage = buildDailyReportCoverageIndex(preparation);
  const candidateDataUpdatedAt = todayRows.reduce<Date | null>((latest, row) => {
    if (!row.fetchedAt) return latest;
    const value = row.fetchedAt instanceof Date ? row.fetchedAt : new Date(row.fetchedAt);
    if (Number.isNaN(value.getTime())) return latest;
    return !latest || value.getTime() > latest.getTime() ? value : latest;
  }, null);
  const finalCandidateIds = new Set(preparation.finalCandidates.map((item) => item.id));
  const sampledIds = new Set(sampledRows.map((item) => item.id));
  const hotRows = auditRows.filter((row) => isDailyReportHotSignal({
    id: row.id,
    title: row.title,
    sourceName: row.sourceName || 'Unknown',
    category: row.category || 'uncategorized',
    aiScore: row.aiScore,
    priorityScore: row.priorityScore,
    processingStatus: row.processingStatus,
    summaryStatus: row.summaryStatus,
    contentStatus: row.contentStatus,
    aiSummary: row.aiSummary,
    aiTranslation: row.aiTranslation,
    snippet: row.snippet,
  }));

  return {
    workflow,
    preview: {
      generatedAt: new Date().toISOString(),
      dataUpdatedAt: candidateDataUpdatedAt?.toISOString() || null,
      selectionMode: preparation.selectionMode,
      funnel: {
        ...preparation.funnel,
        todayNew: newRows[0]?.count || 0,
        sampledCandidates: sampledRows.length,
        filteredItems: auditRows.filter((item) => item.isFiltered).length,
        filteredBucketItems: auditRows.filter((item) => item.filterBucket === 'filtered').length,
        reviewItems: auditRows.filter((item) => item.qualityDecision === 'review').length,
        pendingItems: auditRows.filter((item) => item.contentStatus && item.contentStatus !== 'ready').length,
      },
      coverageDiagnostics: {
        totalFetched: newRows[0]?.count || 0,
        sampledCandidates: sampledRows.length,
        mainVisible: auditRows.filter((item) => item.isFiltered === false && item.filterBucket === 'main').length,
        scored: auditRows.filter((item) => item.aiScore != null).length,
        unscored: auditRows.filter((item) => item.aiScore == null).length,
        raw: auditRows.filter((item) => item.processingStatus === 'raw').length,
        summaryReady: auditRows.filter((item) => item.summaryStatus === 'ready').length,
        summaryFailed: auditRows.filter((item) => item.summaryStatus === 'failed').length,
        hotSignals: hotRows.length,
        hotUnscored: hotRows.filter((item) => item.aiScore == null).length,
        hotNotSampled: hotRows.filter((item) => !sampledIds.has(item.id)).length,
        hotNotSelected: hotRows.filter((item) => !finalCandidateIds.has(item.id)).length,
        finalCandidates: preparation.finalCandidates.length,
      },
      coverageSummary: coverage.summary,
      coverageItems: coverage.items,
      coverageMarkdown: coverage.markdown,
      candidates: preparation.finalCandidates.slice(0, workflow.topN).map((item) => ({
        id: item.id,
        title: item.displayTitle,
        sourceName: item.sourceName,
        category: item.category,
        aiScore: item.aiScore,
        selectionMode: item.selectionMode,
        selectionReason: item.selectionReason,
        reportSummary: item.reportSummary,
        translationStatus: item.translationStatus,
        readingTier: item.readingTier || null,
        chineseReady: item.chineseReady,
      })),
      excluded: preparation.excluded.slice(0, 20),
      excludedSummary: summarizeDailyReportExcludedCandidates(preparation.excluded),
    },
  };
}

// GET /api/insights — 日报列表
app.get('/', async (c) => {
  const authUser = requireAuth(c);
  const limit = parseInt(c.req.query('limit') || '10', 10);
  const rows = await db
    .select()
    .from(schema.insights)
    .where(eq(schema.insights.userId, authUser.userId))
    .orderBy(desc(schema.insights.date), desc(schema.insights.generatedAt), desc(schema.insights.id))
    .limit(limit);

  return c.json({ data: rows });
});

// GET /api/insights/workflow — 日报工作流配置与当前 Prompt 绑定
app.get('/workflow', async (c) => {
  const authUser = requireAuth(c);
  const [workflow, aiScenes] = await Promise.all([
    getDailyReportWorkflow(authUser.userId),
    getDailyWorkflowAiScenes(authUser.userId, authUser.role),
  ]);
  return c.json({ data: { workflow, aiScenes } });
});

// PUT /api/insights/workflow — 保存日报工作流配置
app.put('/workflow', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const workflow = normalizeDailyReportWorkflowConfig(body.workflow || body);
  const rows = await db.insert(schema.userSettings).values({
    userId: authUser.userId,
    dailyReportWorkflow: workflow,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: schema.userSettings.userId,
    set: {
      dailyReportWorkflow: workflow,
      updatedAt: new Date(),
    },
  }).returning({ dailyReportWorkflow: schema.userSettings.dailyReportWorkflow });
  return c.json({ data: { workflow: normalizeDailyReportWorkflowConfig(rows[0]?.dailyReportWorkflow) } });
});

// POST /api/insights/workflow/preview — 预览日报候选池，不写入日报
app.post('/workflow/preview', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const result = await buildDailyWorkflowPreview(authUser.userId, body.workflow || body);
  return c.json({ data: result });
});

// GET /api/insights/dashboard — 成长仪表板
app.get('/dashboard', async (c) => {
  const authUser = requireAuth(c);
  const windowDays = Math.max(3, Math.min(parseInt(c.req.query('windowDays') || '7', 10), 30));
  const itemLimit = Math.max(20, Math.min(parseInt(c.req.query('limit') || '120', 10), 240));
  const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);

  const [itemRows, windowAuditRows, sourceRows, recentReports] = await Promise.all([
    db
      .select({
        id: schema.items.id,
        title: schema.items.title,
        url: schema.items.url,
        aiScore: schema.items.aiScore,
        priorityScore: schema.items.priorityScore,
        aiSummary: schema.items.aiSummary,
        aiTags: schema.items.aiTags,
        growthAxes: schema.items.growthAxes,
        sourceTier: schema.items.sourceTier,
        processingProfile: schema.items.processingProfile,
        publishedAt: schema.items.publishedAt,
        fetchedAt: schema.items.fetchedAt,
        sourceName: schema.sources.name,
        sourceCategory: schema.sources.category,
      })
      .from(schema.items)
      .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
      .where(and(
        eq(schema.items.userId, authUser.userId),
        mainReadingSourceCondition(),
        eq(schema.items.filterBucket, 'main'),
        eq(schema.items.isFiltered, false),
        gte(schema.items.fetchedAt, since),
      ))
      .orderBy(desc(schema.items.priorityScore), desc(schema.items.fetchedAt))
      .limit(itemLimit),
    db
      .select({
        title: schema.items.title,
        aiScore: schema.items.aiScore,
        aiSummary: schema.items.aiSummary,
        aiTags: schema.items.aiTags,
        isFiltered: schema.items.isFiltered,
        filterBucket: schema.items.filterBucket,
        growthAxes: schema.items.growthAxes,
        sourceCategory: schema.sources.category,
      })
      .from(schema.items)
      .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
      .where(and(
        eq(schema.items.userId, authUser.userId),
        mainReadingSourceCondition(),
        gte(schema.items.fetchedAt, since),
      )),
    db
      .select({
        sourceTier: schema.sources.sourceTier,
        processingProfile: schema.sources.processingProfile,
        status: schema.sources.status,
        autoFetchEnabled: schema.sources.autoFetchEnabled,
        growthAxes: schema.sources.growthAxes,
      })
      .from(schema.sources)
      .where(and(eq(schema.sources.userId, authUser.userId), mainReadingSourceCondition())),
    db
      .select()
      .from(schema.insights)
      .where(eq(schema.insights.userId, authUser.userId))
      .orderBy(desc(schema.insights.date), desc(schema.insights.generatedAt), desc(schema.insights.id))
      .limit(6),
  ]);

  const normalizedItems = itemRows.map((item) => {
    const cleanSummary = normalizeReportSummaryText(item.aiSummary) || null;
    const growthResolution = resolveItemGrowthAxis({
      growthAxes: item.growthAxes,
      title: item.title,
      aiSummary: cleanSummary,
      aiTags: item.aiTags,
      sourceCategory: item.sourceCategory,
    });
    return {
      ...item,
      aiSummary: cleanSummary,
      resolvedAxes: growthResolution.allAxes,
      primaryGrowthAxis: growthResolution.primaryAxis,
      secondaryGrowthAxes: growthResolution.secondaryAxes,
      growthMappingSource: growthResolution.mappingSource,
      importance: computeImportance(item),
    };
  });

  const auditedItems = windowAuditRows.map((item) => ({
    ...item,
    growthResolution: resolveItemGrowthAxis({
      growthAxes: item.growthAxes,
      title: item.title,
      aiSummary: normalizeReportSummaryText(item.aiSummary) || null,
      aiTags: item.aiTags,
      sourceCategory: item.sourceCategory,
    }),
  }));

  const axisCards = GROWTH_AXES.map((axis) => {
    const axisItems = normalizedItems
      .filter((item) => item.primaryGrowthAxis === axis)
      .sort((left, right) => right.importance - left.importance);
    const auditedMatches = auditedItems.filter((item) => item.growthResolution.primaryAxis === axis);
    const emptyDiagnostics: AxisEmptyDiagnostics = {
      matched: auditedMatches.length,
      filtered: auditedMatches.filter((item) => item.isFiltered || item.filterBucket !== 'main').length,
      unscored: auditedMatches.filter((item) => item.aiScore == null).length,
      secondaryOnly: normalizedItems.filter((item) => item.secondaryGrowthAxes.includes(axis)).length,
      sourceMapped: sourceRows.filter((source) => normalizeGrowthAxes(source.growthAxes, []).includes(axis)).length,
    };
    const averageScore = axisItems.length > 0
      ? Number((axisItems.reduce((sum, item) => sum + (item.aiScore ?? 0), 0) / axisItems.length).toFixed(1))
      : null;

    return {
      axis,
      count: axisItems.length,
      averageScore,
      summary: buildAxisSummary(axis, axisItems),
      emptyReason: axisItems.length === 0 ? buildAxisEmptyReason(axis, emptyDiagnostics) : null,
      emptyDiagnostics,
      sourceExplanation: '每篇文章只进入一个主成长维度；其他命中维度作为次级标签，过滤内容不进入主视图。',
      items: axisItems.slice(0, 12).map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        sourceName: item.sourceName,
        sourceCategory: item.sourceCategory,
        sourceTier: item.sourceTier,
        processingProfile: item.processingProfile,
        aiScore: item.aiScore,
        priorityScore: item.priorityScore,
        publishedAt: item.publishedAt,
        fetchedAt: item.fetchedAt,
        summary: item.aiSummary || null,
        growthAxes: item.resolvedAxes,
        primaryGrowthAxis: item.primaryGrowthAxis,
        secondaryGrowthAxes: item.secondaryGrowthAxes,
        actionSuggestion: buildActionSuggestion(axis, item),
      })),
    };
  });

  const sourceTierStats = ['S', 'A', 'B', 'C', 'D'].map((tier) => ({
    tier,
    count: sourceRows.filter((source) => source.sourceTier === tier).length,
  }));
  const processingProfileStats = ['full', 'smart', 'brief', 'monitor'].map((profile) => ({
    profile,
    count: sourceRows.filter((source) => source.processingProfile === profile).length,
  }));
  const mustReview = normalizedItems.filter((item) => (item.aiScore ?? 0) >= 75 || item.sourceTier === 'S').length;
  const activeSources = sourceRows.filter((source) => source.status === 'active' && source.autoFetchEnabled !== false).length;
  const signalSources = sourceRows.filter((source) => ['S', 'A'].includes(source.sourceTier)).length;
  const unmappedItems = normalizedItems.filter((item) => item.growthMappingSource === 'fallback').length;

  return c.json({
    data: {
      windowDays,
      summary: {
        totalItems: windowAuditRows.length,
        visibleItems: normalizedItems.length,
        filteredItems: windowAuditRows.filter((item) => item.isFiltered).length,
        filteredBucketItems: windowAuditRows.filter((item) => item.filterBucket === 'filtered').length,
        mismatchedFilteredMain: windowAuditRows.filter((item) => item.isFiltered && item.filterBucket === 'main').length,
        unmappedItems,
        activeSources,
        signalSources,
        mustReview,
        generatedAt: new Date().toISOString(),
      },
      axes: axisCards,
      sourceTierStats,
      processingProfileStats,
      recentReports,
    },
  });
});

// GET /api/insights/:date — 某日日报
app.get('/:date', async (c) => {
  const authUser = requireAuth(c);
  const date = c.req.param('date');
  const rows = await db
    .select()
    .from(schema.insights)
    .where(and(eq(schema.insights.date, date), eq(schema.insights.userId, authUser.userId)))
    .orderBy(desc(schema.insights.generatedAt), desc(schema.insights.id))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'No report for this date' }, 404);
  }

  return c.json({ data: rows[0] });
});

// POST /api/insights/generate — 手动生成日报（支持 topN/minScore/preset/compareWindowDays）
app.post('/generate', async (c) => {
  const authUser = requireAuth(c);
  const topN = c.req.query('topN') ? parseInt(c.req.query('topN')!, 10) : undefined;
  const minScore = c.req.query('minScore') ? parseInt(c.req.query('minScore')!, 10) : undefined;
  const preset = (c.req.query('preset') || undefined) as 'full' | 'decision' | 'research' | 'reading' | undefined;
  const generationModeQuery = c.req.query('mode') || c.req.query('generationMode') || 'fast';
  const generationMode: DailyReportGenerationMode = generationModeQuery === 'full' ? 'full' : 'fast';
  const dateParam = c.req.query('date') || undefined;
  const compareWindowDays = c.req.query('compareWindowDays')
    ? parseInt(c.req.query('compareWindowDays')!, 10)
    : undefined;
  const opts = (topN !== undefined || minScore !== undefined || preset !== undefined || compareWindowDays !== undefined || generationMode !== 'full')
    ? { topN, minScore, preset, compareWindowDays, generationMode }
    : {};

  try {
    let targetDate: Date | undefined;
    if (dateParam) {
      try {
        targetDate = resolveDailyReportWindow(dateParam).dayStart;
      } catch {
        return c.json({ error: 'Invalid date' }, 400);
      }
    }
    if (targetDate && Number.isNaN(targetDate.getTime())) {
      return c.json({ error: 'Invalid date' }, 400);
    }
    const workflow = await getDailyReportWorkflow(authUser.userId);
    const report = await generateDailyReport(authUser.userId, targetDate, {
      ...opts,
      workflow: {
        ...workflow,
        topN: topN ?? workflow.topN,
        minScore: minScore ?? workflow.minScore,
      },
    });
    const delivery = resolveDailyReportDeliveryDecision(report.payload);
    if (delivery.allowExternalPush) {
      scheduleDailyReportPush(`信息中枢日报 — ${report.date}`, report.markdown);
    }

    return c.json({
      data: report,
      markdown: report.markdown,
      message: delivery.message,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default app;
