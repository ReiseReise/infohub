import { Hono } from 'hono';
import { and, eq, desc, gte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { generateDailyReport } from '../outputs/daily-report.js';
import { pushDailyReport } from '../outputs/push.js';
import { requireAuth } from '../lib/auth.js';
import { GROWTH_AXES, resolveItemGrowthAxes } from '../lib/growth.js';

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
  const tierBoost = item.sourceTier === 'S' ? 0.18 : item.sourceTier === 'A' ? 0.08 : item.sourceTier === 'D' ? -0.12 : 0;
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
  const highSignalCount = items.filter((item) => item.sourceTier === 'S' || item.sourceTier === 'A').length;
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

// GET /api/insights/dashboard — 成长仪表板
app.get('/dashboard', async (c) => {
  const authUser = requireAuth(c);
  const windowDays = Math.max(3, Math.min(parseInt(c.req.query('windowDays') || '7', 10), 30));
  const itemLimit = Math.max(20, Math.min(parseInt(c.req.query('limit') || '120', 10), 240));
  const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);

  const [itemRows, sourceRows, recentReports] = await Promise.all([
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
        eq(schema.items.isFiltered, false),
        gte(schema.items.fetchedAt, since),
      ))
      .orderBy(desc(schema.items.priorityScore), desc(schema.items.fetchedAt))
      .limit(itemLimit),
    db
      .select({
        sourceTier: schema.sources.sourceTier,
        processingProfile: schema.sources.processingProfile,
        status: schema.sources.status,
        autoFetchEnabled: schema.sources.autoFetchEnabled,
      })
      .from(schema.sources)
      .where(eq(schema.sources.userId, authUser.userId)),
    db
      .select()
      .from(schema.insights)
      .where(eq(schema.insights.userId, authUser.userId))
      .orderBy(desc(schema.insights.date), desc(schema.insights.generatedAt), desc(schema.insights.id))
      .limit(6),
  ]);

  const normalizedItems = itemRows.map((item) => ({
    ...item,
    resolvedAxes: resolveItemGrowthAxes({
      growthAxes: item.growthAxes,
      title: item.title,
      aiSummary: item.aiSummary,
      aiTags: item.aiTags,
      sourceCategory: item.sourceCategory,
    }),
    importance: computeImportance(item),
  }));

  const axisCards = GROWTH_AXES.map((axis) => {
    const axisItems = normalizedItems
      .filter((item) => item.resolvedAxes.includes(axis))
      .sort((left, right) => right.importance - left.importance);
    const averageScore = axisItems.length > 0
      ? Number((axisItems.reduce((sum, item) => sum + (item.aiScore ?? 0), 0) / axisItems.length).toFixed(1))
      : null;

    return {
      axis,
      count: axisItems.length,
      averageScore,
      summary: buildAxisSummary(axis, axisItems),
      items: axisItems.slice(0, 4).map((item) => ({
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

  return c.json({
    data: {
      windowDays,
      summary: {
        totalItems: normalizedItems.length,
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
  const compareWindowDays = c.req.query('compareWindowDays')
    ? parseInt(c.req.query('compareWindowDays')!, 10)
    : undefined;
  const opts = (topN !== undefined || minScore !== undefined || preset !== undefined || compareWindowDays !== undefined)
    ? { topN, minScore, preset, compareWindowDays }
    : undefined;

  try {
    const report = await generateDailyReport(authUser.userId, undefined, opts);
    await pushDailyReport(`信息中枢日报 — ${report.date}`, report.markdown);

    return c.json({
      data: report,
      markdown: report.markdown,
      message: 'Daily report generated and pushed',
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default app;
