import { generateTrustedDaily, trustedDailyJob, rerunTrustedDaily, latestTrustedDaily } from '../research/daily-adapter.js';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ResearchError } from '../research/store.js';
import { ZodError } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { getAiUsageSummary } from '../lib/ai-usage.js';
import { buildDailyReportState, canViewSystemAiUsage, summarizeDailyUsageRows } from '../lib/daily-workbench-metrics.js';
import {
  buildDailyReportPublicationNavigation,
  resolveDailyReportDeliveryDecision,
  resolveDailyReportPublicationStatus,
  resolvePersistedDailyReportQuality,
  summarizeDailyReportQualityReasons,
} from '../lib/daily-report-quality.js';
import { buildReportContext } from '../lib/reading-context.js';
import { findEquivalentSourceScope, getSourceScopeUrl } from '../lib/source-scope.js';
import {
  buildDailyInsightType,
  buildDegradedDailyReportPresentation,
  buildDailyReportEditorialDigest,
  buildDailyReportModuleSections,
  buildDailyReportPriorityArticles,
  buildDailyReportSupplementalArticles,
  buildDailyReportTrendSummary,
  buildStructuredOutput,
  generateDailyReport,
  humanizeDailyReportExcludedDetail,
  humanizeDailyReportSelectionReason,
  type DailyReportGenerationMode,
  type DailyReportPriorityArticle,
} from '../outputs/daily-report.js';
import { normalizeDailyReportWorkflowConfig, summarizeDailyReportExcludedCandidates } from '../outputs/daily-report-workflow.js';
import { loadDailyReportEventMetrics } from '../outputs/daily-report-event-metrics-store.js';
import { resolveDailyReportWindow } from '../outputs/daily-report-window.js';
import { scheduleDailyReportPush } from '../outputs/push.js';
import {
  buildDailyWorkflowPreview,
  getDailyReportWorkflow,
  getDailyWorkflowAiScenes,
} from './insights.js';
import { dailyReportQueue } from '../scheduler/queue.js';
import {
  enqueueDailyGenerationJob,
  DEFAULT_DAILY_CATCH_UP_DAYS,
  findActiveDailyGenerationJob,
  getNextDailyScheduleAt,
  serializeDailyGenerationJob,
} from '../scheduler/daily-report-scheduler.js';
import { getUserDailyReportSettings } from '../lib/daily-report-settings.js';

const app = new Hono();
app.onError((err,c)=>{if(err instanceof ResearchError)return c.json({error:err.code},err.status as 400);if(err instanceof HTTPException)return err.getResponse();if(err instanceof ZodError)return c.json({error:'invalid_request'},400);return c.json({error:'Daily request failed'},500);});

type InsightPayload = Record<string, any>;

function normalizeInsight(row?: typeof schema.insights.$inferSelect | null) {
  if (!row) return null;
  const payload = (row.payload || {}) as InsightPayload;
  return {
    id: row.id,
    date: row.date,
    type: row.type,
    summary: row.summary || '',
    markdown: typeof payload.markdown === 'string' ? payload.markdown : row.summary || '',
    itemCount: row.itemCount || 0,
    generatedAt: row.generatedAt,
    payload,
  };
}

async function getLatestReport(userId: string, reportType: string, date?: string | null) {
  const where = date
    ? and(eq(schema.insights.userId, userId), eq(schema.insights.type, reportType), eq(schema.insights.date, date))
    : and(eq(schema.insights.userId, userId), eq(schema.insights.type, reportType));
  const rows = await db
    .select()
    .from(schema.insights)
    .where(where)
    .orderBy(desc(schema.insights.date), desc(schema.insights.generatedAt), desc(schema.insights.id))
    .limit(1);
  return rows[0] || null;
}

async function buildDateNavigation(userId: string, reportType: string, currentDate?: string | null) {
  const rows = await db
    .select({ date: schema.insights.date, generatedAt: schema.insights.generatedAt, payload: schema.insights.payload })
    .from(schema.insights)
    .where(and(eq(schema.insights.userId, userId), eq(schema.insights.type, reportType)))
    .orderBy(desc(schema.insights.date), desc(schema.insights.generatedAt))
    .limit(30);
  return buildDailyReportPublicationNavigation(
    rows.map((row) => ({
      date: row.date,
      payload: (row.payload || {}) as InsightPayload,
    })),
    currentDate,
  );
}

function stripOperationalSections(markdown: string) {
  return markdown
    .replace(/## 生成口径[\s\S]*?(?=\n## (?!生成口径)|$)/, '')
    .replace(/## 运行分析[\s\S]*?(?=\n## (?!运行分析)|$)/, '')
    .trim();
}

function buildReportPreview(report: ReturnType<typeof normalizeInsight>) {
  const markdown = report?.markdown || '';
  const readableMarkdown = stripOperationalSections(markdown);
  const finalPayload = report?.payload?.final || {};
  const finalBullets = Array.isArray(finalPayload.bullets) ? finalPayload.bullets.filter((line: unknown) => typeof line === 'string' && line.trim()) : [];
  const lines = (finalBullets.length ? finalBullets : readableMarkdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('- 生成模式') && !line.includes('候选'))
  ).slice(0, 6);
  const payload = report?.payload || {};
  const quality = report ? resolvePersistedDailyReportQuality(payload) : null;
  const topItems = Array.isArray(payload.topItems)
    ? payload.topItems
    : Array.isArray(payload.snapshot?.topItems)
      ? payload.snapshot.topItems
      : [];
  return {
    title: report ? String(payload.reportScope?.label || `${report.date} 日报`) : '暂无日报',
    generatedAt: report?.generatedAt || null,
    itemCount: report?.itemCount || 0,
    highlights: lines,
    topItems: topItems.slice(0, 6),
    source: report ? 'final_report' : 'none',
    qualityStatus: quality?.status || null,
    qualityReasons: quality?.reasons || [],
    qualityWarnings: quality?.warnings || [],
    qualityReasonLabel: quality ? summarizeDailyReportQualityReasons(quality.reasons) : null,
  };
}

function buildPriorityArticleFromCoverageItem(item: any): DailyReportPriorityArticle {
  return {
    id: String(item.id || item.url || item.title || ''),
    title: String(item.title || '未命名条目'),
    url: String(item.url || ''),
    sourceName: String(item.sourceName || '未知来源'),
    category: String(item.category || '未分类'),
    reason: String(item.reason || item.statusLabel || '补全日报覆盖'),
    summary: String(item.digest || item.summary || item.title || ''),
  };
}

function isDeepReadCoverageItem(item: any) {
  return /(blog|博客|newsletter|周刊|weekly|长文|研究|论文|深读|观点|方法论|工程师|bestblogs|simon|paul graham|aigc weekly)/i
    .test(`${item.title || ''} ${item.sourceName || ''} ${item.category || ''} ${item.digest || ''}`);
}

function deriveReportDynamicsFromCoverageItems(coverageItems: any[], selectedIds: Set<string>) {
  return coverageItems
    .filter((item) => item?.id && !selectedIds.has(String(item.id)))
    .map(buildPriorityArticleFromCoverageItem)
    .slice(0, 20);
}

function deriveReportDeepReadsFromCoverageItems(coverageItems: any[]) {
  return coverageItems
    .filter(isDeepReadCoverageItem)
    .map(buildPriorityArticleFromCoverageItem)
    .slice(0, 10);
}

function normalizeReportCoverageDiagnostics(diagnostics: any, coverageSummary: any) {
  if (!diagnostics || typeof diagnostics !== 'object') return null;
  if (!coverageSummary || typeof coverageSummary.selected !== 'number') return diagnostics;
  return {
    ...diagnostics,
    finalCandidates: coverageSummary.selected,
  };
}

const DAILY_AGENT_SCENES = [
  'daily_report_cleaning',
  'daily_report_decision',
  'daily_report_research',
  'daily_report_reading',
  'daily_report_final',
] as const;

function parseSourceId(input: unknown): number | null {
  const numeric = typeof input === 'number' ? input : Number(input);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

async function resolveDailyReportSourceScope(userId: string, sourceIdInput: unknown, role = 'user') {
  const sourceId = parseSourceId(sourceIdInput);
  if (!sourceId) return null;
  const rows = await db
    .select({
      id: schema.sources.id,
      ownerUserId: schema.sources.userId,
      name: schema.sources.name,
      category: schema.sources.category,
      sourceTier: schema.sources.sourceTier,
      config: schema.sources.config,
    })
    .from(schema.sources)
    .where(and(eq(schema.sources.userId, userId), eq(schema.sources.id, sourceId)))
    .limit(1);
  if (rows[0]) return rows[0];

  const requestedRows = await db
    .select({
      id: schema.sources.id,
      ownerUserId: schema.sources.userId,
      name: schema.sources.name,
      category: schema.sources.category,
      sourceTier: schema.sources.sourceTier,
      config: schema.sources.config,
    })
    .from(schema.sources)
    .where(eq(schema.sources.id, sourceId))
    .limit(1);
  const requested = requestedRows[0];
  if (!requested) return null;

  const requestedUrl = getSourceScopeUrl(requested);
  const candidateConditions = [
    eq(schema.sources.userId, userId),
    requestedUrl
      ? sql`${schema.sources.config}->>'url' = ${requestedUrl}`
      : eq(schema.sources.name, requested.name),
  ];
  const candidates = await db
    .select({
      id: schema.sources.id,
      ownerUserId: schema.sources.userId,
      name: schema.sources.name,
      category: schema.sources.category,
      sourceTier: schema.sources.sourceTier,
      config: schema.sources.config,
    })
    .from(schema.sources)
    .where(and(...candidateConditions))
    .limit(10);

  const equivalent = findEquivalentSourceScope(requested, candidates);
  if (equivalent) return equivalent;
  if (role === 'admin') return requested;
  return null;
}

function flattenDailySceneUsage(usageByScene: Map<string, any[]>) {
  return [...usageByScene.values()].flat();
}

function latestDailyUsageAt(rows: any[]) {
  return rows
    .map((row) => row.latestAt ? new Date(row.latestAt).getTime() : 0)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a)[0] || null;
}

async function getDailySceneUsage(userId: string, dateKey: string) {
  const targetIds = DAILY_AGENT_SCENES.map((scene) => `${dateKey}:${scene.replace('daily_report_', '')}`);
  const rows = await db
    .select({
      sceneType: schema.aiUsageLogs.sceneType,
      targetId: schema.aiUsageLogs.targetId,
      status: schema.aiUsageLogs.status,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${schema.aiUsageLogs.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${schema.aiUsageLogs.outputTokens}), 0)::int`,
      estimatedCost: sql<number>`coalesce(sum(${schema.aiUsageLogs.estimatedCost}), 0)::float`,
      avgLatencyMs: sql<number>`coalesce(avg(${schema.aiUsageLogs.latencyMs}), 0)::float`,
      latestAt: sql<string>`max(${schema.aiUsageLogs.createdAt})::text`,
      errorMessage: sql<string>`max(${schema.aiUsageLogs.errorMessage})`,
    })
    .from(schema.aiUsageLogs)
    .where(and(
      eq(schema.aiUsageLogs.userId, userId),
      inArray(schema.aiUsageLogs.targetId, targetIds),
    ))
    .groupBy(schema.aiUsageLogs.sceneType, schema.aiUsageLogs.targetId, schema.aiUsageLogs.status);
  const usageByScene = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = String(row.sceneType || '');
    usageByScene.set(key, [...(usageByScene.get(key) || []), row]);
  }
  return usageByScene;
}

function moduleMetaForScene(report: ReturnType<typeof normalizeInsight>, scene: string) {
  const payload = report?.payload || {};
  if (scene === 'daily_report_cleaning') return payload.cleaning?.meta || null;
  if (scene === 'daily_report_decision') return payload.modules?.decision?.meta || null;
  if (scene === 'daily_report_research') return payload.modules?.research?.meta || null;
  if (scene === 'daily_report_reading') return payload.modules?.reading?.meta || null;
  if (scene === 'daily_report_final') return payload.final?.meta || null;
  return null;
}

function buildAgentMatrix(preview: any, report: ReturnType<typeof normalizeInsight>, usageByScene: Map<string, any[]>) {
  const funnel = preview?.preview?.funnel || {};
  const labels: Record<string, string> = {
    daily_report_cleaning: '清洗',
    daily_report_decision: '决策',
    daily_report_research: '研究',
    daily_report_reading: '阅读',
    daily_report_final: '最终日报',
  };
  return DAILY_AGENT_SCENES.map((scene) => {
    const meta = moduleMetaForScene(report, scene);
    const usageRows = usageByScene.get(scene) || [];
    const successRows = usageRows.filter((row) => row.status === 'success');
    const errorRows = usageRows.filter((row) => row.status === 'error');
    const calls = usageRows.reduce((sum, row) => sum + Number(row.calls || 0), 0);
    const inputTokens = usageRows.reduce((sum, row) => sum + Number(row.inputTokens || 0), 0);
    const outputTokens = usageRows.reduce((sum, row) => sum + Number(row.outputTokens || 0), 0);
    const estimatedCost = usageRows.reduce((sum, row) => sum + Number(row.estimatedCost || 0), 0);
    const status = meta?.status === 'ai' || successRows.length > 0
      ? 'completed'
      : errorRows.length > 0
        ? 'error'
        : meta?.status === 'fallback'
          ? 'fallback'
          : report
            ? 'not_run'
            : 'pending';
    return {
      key: scene,
      label: labels[scene],
      status,
      statusSource: meta ? 'report_payload' : usageRows.length > 0 ? 'ai_usage_target' : 'no_record',
      calls,
      tokens: inputTokens + outputTokens,
      cost: estimatedCost || meta?.estimatedCost || null,
      provider: meta?.provider || null,
      model: meta?.model || null,
      promptTemplateId: meta?.promptTemplateId || null,
      modelConfigId: meta?.modelConfigId || null,
      error: meta?.error || errorRows[0]?.errorMessage || null,
      repaired: Boolean(meta?.repaired),
      signal: scene === 'daily_report_cleaning'
        ? `${funnel.todayNew || 0} 条新增`
        : scene === 'daily_report_decision'
          ? `${funnel.finalCandidates || 0} 条入报`
          : scene === 'daily_report_final'
            ? report ? '已生成' : '未生成'
            : '按需运行',
    };
  });
}

app.get('/workbench', async (c) => {
  const authUser = requireAuth(c);
  const requestedDate = c.req.query('date') || undefined;
  const { dateKey } = resolveDailyReportWindow(requestedDate);
  const sourceScope = await resolveDailyReportSourceScope(authUser.userId, c.req.query('sourceId'), authUser.role);
  if (c.req.query('sourceId') != null && !sourceScope) {
    return c.json({ error: 'Source not found for current user' }, 404);
  }
  const reportUserId = sourceScope?.ownerUserId || authUser.userId;
  const reportType = buildDailyInsightType(sourceScope?.id || null);
  const baseWorkflow = await getDailyReportWorkflow(reportUserId);
  const workflow = sourceScope
    ? {
      ...baseWorkflow,
      scope: {
        ...(baseWorkflow.scope || {}),
        sourceIds: [sourceScope.id],
        sourceNames: [sourceScope.name],
      },
    }
    : baseWorkflow;
  const includeSystemUsage = canViewSystemAiUsage(authUser.role);
  const [preview, latestReport, systemUsage24h, sceneUsage, activeGenerationJob, dailyReportSettings] = await Promise.all([
    buildDailyWorkflowPreview(reportUserId, workflow, dateKey),
    getLatestReport(reportUserId, reportType, dateKey),
    includeSystemUsage
      ? getAiUsageSummary({ from: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), to: new Date().toISOString() })
      : Promise.resolve(null),
    getDailySceneUsage(reportUserId, dateKey),
    findActiveDailyGenerationJob(reportUserId, dateKey, sourceScope?.id || null),
    getUserDailyReportSettings(reportUserId),
  ]);
  const report = normalizeInsight(latestReport);
  const dailyUsageRows = flattenDailySceneUsage(sceneUsage);
  const dailyUsage = summarizeDailyUsageRows(dailyUsageRows);
  const previewGeneratedAt = preview.preview?.generatedAt || new Date().toISOString();
  const candidateDataUpdatedAt = preview.preview?.dataUpdatedAt || null;
  const persistedQuality = report ? resolvePersistedDailyReportQuality(report.payload) : null;
  const reportState = buildDailyReportState({
    generatedAt: report?.generatedAt || null,
    previewGeneratedAt,
    candidateDataUpdatedAt,
    itemCount: report?.itemCount || 0,
    qualityStatus: persistedQuality?.status || null,
    qualityReason: persistedQuality ? summarizeDailyReportQualityReasons(persistedQuality.reasons) : null,
  });
  return c.json({
    data: {
      date: dateKey,
      reportScope: {
        reportType,
        sourceId: sourceScope?.id || null,
        sourceName: sourceScope?.name || null,
        label: sourceScope?.name ? `${sourceScope.name} 独立日报` : '信息中枢日报',
      },
      workflow,
      preview: preview.preview,
      report: buildReportPreview(report),
      reportState,
      dataFreshness: {
        preview: {
          source: 'candidate_preview',
          asOf: candidateDataUpdatedAt || previewGeneratedAt,
          dateScope: dateKey,
          label: sourceScope ? `来自「${sourceScope.name}」候选预览，非正式日报` : '来自候选预览，非正式日报',
        },
        report: {
          source: report ? 'final_report' : 'none',
          asOf: report?.generatedAt || null,
          dateScope: dateKey,
          label: report ? (sourceScope ? `来自「${sourceScope.name}」已保存日报` : '来自已保存日报') : (sourceScope ? `当前日期尚未生成「${sourceScope.name}」独立日报` : '当前日期尚未生成正式日报'),
        },
        dailyUsage: {
          source: 'ai_usage_target_id',
          asOf: latestDailyUsageAt(dailyUsageRows) ? new Date(latestDailyUsageAt(dailyUsageRows) as number).toISOString() : null,
          dateScope: dateKey,
          label: sourceScope ? '按日期统计日报 Agent；当前模型日志暂未完全按来源拆分' : '仅统计当前日期日报 Agent',
        },
        ...(systemUsage24h ? {
          systemUsage24h: {
            source: 'ai_usage_24h',
            asOf: new Date().toISOString(),
            dateScope: 'last_24h',
            label: '全系统最近 24 小时模型用量',
          },
        } : {}),
      },
      agentMatrix: buildAgentMatrix(preview, report, sceneUsage),
      dailyUsage,
      ...(systemUsage24h ? {
        systemUsage24h: {
          calls: systemUsage24h.totalCalls,
          inputTokens: systemUsage24h.totalInputTokens,
          outputTokens: systemUsage24h.totalOutputTokens,
          totalTokens: systemUsage24h.totalInputTokens + systemUsage24h.totalOutputTokens,
          estimatedCost: systemUsage24h.totalEstimatedCost,
          byStatus: systemUsage24h.byStatus,
          hotspotErrors: systemUsage24h.hotspots.errors,
        },
      } : {}),
      scheduleContext: {
        dailyReportEnabled: dailyReportSettings.dailyReportEnabled,
        nextScheduledAt: getNextDailyScheduleAt().toISOString(),
        catchUpDays: DEFAULT_DAILY_CATCH_UP_DAYS,
        sourceScoped: Boolean(sourceScope?.id),
        label: dailyReportSettings.dailyReportEnabled
          ? '每日 06:00 自动生成；服务重启会检查最近 7 天缺报。'
          : '自动日报已关闭；仍可手动生成或开启来源独立日报。',
      },
      activeGenerationJob,
      monitor: {
        calls: dailyUsage.calls,
        inputTokens: dailyUsage.inputTokens,
        outputTokens: dailyUsage.outputTokens,
        totalTokens: dailyUsage.totalTokens,
        estimatedCost: dailyUsage.estimatedCost,
        byStatus: dailyUsage.byStatus,
        hotspotErrors: dailyUsage.hotspotErrors,
      },
    },
  });
});

app.get('/workflow', async (c) => {
  const authUser = requireAuth(c);
  const [workflow, aiScenes] = await Promise.all([
    getDailyReportWorkflow(authUser.userId),
    getDailyWorkflowAiScenes(authUser.userId, authUser.role),
  ]);
  return c.json({ data: { workflow, aiScenes } });
});

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
    set: { dailyReportWorkflow: workflow, updatedAt: new Date() },
  }).returning({ dailyReportWorkflow: schema.userSettings.dailyReportWorkflow });
  return c.json({ data: { workflow: normalizeDailyReportWorkflowConfig(rows[0]?.dailyReportWorkflow) } });
});

app.post('/workflow/preview', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const data = await buildDailyWorkflowPreview(authUser.userId, body.workflow || body, body.date || null);
  return c.json({ data });
});

app.get('/candidates', async (c) => {
  const authUser = requireAuth(c);
  const { dateKey } = resolveDailyReportWindow(c.req.query('date') || undefined);
  const sourceScope = await resolveDailyReportSourceScope(authUser.userId, c.req.query('sourceId'), authUser.role);
  if (c.req.query('sourceId') != null && !sourceScope) {
    return c.json({ error: 'Source not found for current user' }, 404);
  }
  const reportUserId = sourceScope?.ownerUserId || authUser.userId;
  const baseWorkflow = await getDailyReportWorkflow(reportUserId);
  const workflow = sourceScope
    ? {
      ...baseWorkflow,
      scope: {
        ...(baseWorkflow.scope || {}),
        sourceIds: [sourceScope.id],
        sourceNames: [sourceScope.name],
      },
    }
    : baseWorkflow;
  const preview = await buildDailyWorkflowPreview(reportUserId, workflow, dateKey);
  const status = c.req.query('status') || 'all';
  const reason = c.req.query('reason') || '';
  const source = c.req.query('source') || '';
  const category = c.req.query('category') || '';
  const tier = c.req.query('sourceTier') || '';
  const translationStatus = c.req.query('translationStatus') || '';
  const q = (c.req.query('q') || '').trim().toLowerCase();
  const minScore = Number(c.req.query('minScore'));
  const maxScore = Number(c.req.query('maxScore'));
  const scorePass = (score?: number | null) => {
    if (Number.isFinite(minScore) && (score == null || score < minScore)) return false;
    if (Number.isFinite(maxScore) && (score == null || score > maxScore)) return false;
    return true;
  };
  const textPass = (item: any) => {
    if (!q) return true;
    return [item.title, item.sourceName, item.category, item.reportSummary, item.selectionReason, item.detail]
      .join('\n')
      .toLowerCase()
      .includes(q);
  };
  const filterItem = (item: any) => {
    if (source && item.sourceName !== source) return false;
    if (category && item.category !== category) return false;
    if (tier && item.sourceTier !== tier) return false;
    if (translationStatus && item.translationStatus !== translationStatus) return false;
    if (!scorePass(item.aiScore)) return false;
    return textPass(item);
  };
  const coverageById = new Map((preview.preview.coverageItems || []).map((item: any) => [item.id, item]));
  const candidates = preview.preview.candidates
    .filter((item: any) => status === 'excluded' ? false : filterItem(item))
    .map((item: any) => {
      const coverage = coverageById.get(item.id) as any;
      return {
        ...item,
        reportSummary: coverage?.digest || item.reportSummary,
        selectionReason: coverage?.reason || humanizeDailyReportSelectionReason(item.selectionReason, item),
        action: coverage?.action || null,
      };
    });
  const excluded = preview.preview.excluded
    .filter((item: any) => {
      if (status === 'selected') return false;
      if (reason && item.reason !== reason) return false;
      return filterItem(item);
    })
    .map((item: any) => ({
      ...item,
      detail: (coverageById.get(item.id) as any)?.reason || humanizeDailyReportExcludedDetail(item.detail, item.reason, item),
      action: (coverageById.get(item.id) as any)?.action || null,
    }));
  return c.json({
    data: {
      date: dateKey,
      reportScope: {
        reportType: buildDailyInsightType(sourceScope?.id || null),
        sourceId: sourceScope?.id || null,
        sourceName: sourceScope?.name || null,
        label: sourceScope?.name ? `${sourceScope.name} 独立日报` : '信息中枢日报',
      },
      workflow: preview.workflow,
      funnel: preview.preview.funnel,
      candidates,
      excluded,
      excludedSummary: summarizeDailyReportExcludedCandidates(excluded),
      coverageSummary: preview.preview.coverageSummary || null,
      coverageItems: preview.preview.coverageItems || [],
      coverageMarkdown: preview.preview.coverageMarkdown || '',
      coverageDiagnostics: preview.preview.coverageDiagnostics || null,
      filters: { status, reason, source, category, sourceTier: tier, translationStatus, q, sourceId: sourceScope?.id || null, minScore: Number.isFinite(minScore) ? minScore : null, maxScore: Number.isFinite(maxScore) ? maxScore : null },
    },
  });
});

app.get('/generate/jobs/:jobId', async (c) => {
  const authUser = requireAuth(c);
  const jobId = c.req.param('jobId');
  if(jobId.startsWith('research-'))return trustedDailyJob(c,authUser.userId,jobId);
  const job = await dailyReportQueue.getJob(jobId);
  if (!job || (job.data?.userId !== authUser.userId && authUser.role !== 'admin')) {
    return c.json({ error: 'Daily report job not found', jobId }, 404);
  }
  return c.json({ data: await serializeDailyGenerationJob(job) });
});

app.post('/generate', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  if(body.engine==='trusted')return generateTrustedDaily(c,authUser.userId,body);
  const mode: DailyReportGenerationMode = body.mode === 'fast' || body.generationMode === 'fast' ? 'fast' : 'full';
  const presetInput = String(body.preset || 'full');
  const preset = ['full', 'decision', 'research', 'reading'].includes(presetInput)
    ? presetInput as 'full' | 'decision' | 'research' | 'reading'
    : 'full';
  try {
    const { dateKey, dayStart } = resolveDailyReportWindow(body.date ? String(body.date) : undefined);
    const sourceScope = await resolveDailyReportSourceScope(authUser.userId, body.sourceId, authUser.role);
    if (body.sourceId != null && !sourceScope) {
      return c.json({ error: 'Source not found for current user' }, 404);
    }
    const reportUserId = sourceScope?.ownerUserId || authUser.userId;
    const reportType = buildDailyInsightType(sourceScope?.id || null);
    const workflow = await getDailyReportWorkflow(reportUserId);
    const workflowOverride = sourceScope
      ? {
        ...workflow,
        scope: {
          ...(workflow.scope || {}),
          sourceIds: [sourceScope.id],
          sourceNames: [sourceScope.name],
        },
      }
      : workflow;
    if (body.async === true) {
      const queued = await enqueueDailyGenerationJob({
        userId: reportUserId,
        date: dateKey,
        mode,
        preset,
        sourceId: sourceScope?.id || null,
        sourceName: sourceScope?.name || null,
        trigger: 'manual',
        scheduledFor: null,
        requestedAt: new Date().toISOString(),
      });
      const status = await serializeDailyGenerationJob(queued.job);
      return c.json({
        data: status,
        jobId: status?.jobId || String(queued.job.id || ''),
        pollUrl: `/api/daily/generate/jobs/${encodeURIComponent(String(queued.job.id || ''))}`,
        enqueued: queued.enqueued,
        status: status?.state || 'waiting',
        message: queued.enqueued ? 'Daily report generation enqueued' : 'Daily report generation already running',
      });
    }
    const report = await generateDailyReport(reportUserId, body.date ? dayStart : undefined, {
      generationMode: mode,
      workflow: workflowOverride,
      preset,
      sourceId: sourceScope?.id || null,
      sourceName: sourceScope?.name || null,
      reportType,
    });
    const delivery = resolveDailyReportDeliveryDecision(report.payload);
    if (delivery.allowExternalPush) {
      scheduleDailyReportPush(`${sourceScope?.name || '信息中枢日报'} — ${report.date}`, report.markdown);
    }
    return c.json({ data: report, markdown: report.markdown, message: delivery.message });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.post('/agents/:scene/rerun', async (c) => {
  const authUser = requireAuth(c);
  const scene = c.req.param('scene');
  const body = await c.req.json().catch(() => ({}));
  if(body.engine==='trusted')return rerunTrustedDaily(c,authUser.userId,scene,body);
  const presetByScene: Record<string, 'full' | 'decision' | 'research' | 'reading'> = {
    daily_report_cleaning: 'full',
    daily_report_decision: 'decision',
    daily_report_research: 'research',
    daily_report_reading: 'reading',
    daily_report_final: 'full',
    cleaning: 'full',
    decision: 'decision',
    research: 'research',
    reading: 'reading',
    final: 'full',
  };
  const preset = presetByScene[scene];
  if (!preset) return c.json({ error: 'Unknown daily report agent scene' }, 400);
  try {
    const sourceScope = await resolveDailyReportSourceScope(authUser.userId, body.sourceId, authUser.role);
    if (body.sourceId != null && !sourceScope) return c.json({ error: 'Source not found for current user' }, 404);
    const reportUserId = sourceScope?.ownerUserId || authUser.userId;
    const workflow = await getDailyReportWorkflow(reportUserId);
    const reportDate = body.date ? resolveDailyReportWindow(String(body.date)).dayStart : undefined;
    const report = await generateDailyReport(reportUserId, reportDate, {
      generationMode: 'full',
      workflow: sourceScope ? { ...workflow, scope: { ...(workflow.scope || {}), sourceIds: [sourceScope.id], sourceNames: [sourceScope.name] } } : workflow,
      preset,
      sourceId: sourceScope?.id || null,
      sourceName: sourceScope?.name || null,
      reportType: buildDailyInsightType(sourceScope?.id || null),
    });
    const delivery = resolveDailyReportDeliveryDecision(report.payload);
    if (delivery.allowExternalPush) {
      scheduleDailyReportPush(`${sourceScope?.name || '信息中枢日报'} — ${report.date}`, report.markdown);
    }
    return c.json({
      data: report,
      markdown: report.markdown,
      message: delivery.allowExternalPush
        ? (preset === 'full' ? '已重跑完整日报链路；推送已排队' : `已重跑 ${preset} Agent 并刷新最终日报；推送已排队`)
        : delivery.message,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.get('/reports/latest', async (c) => {
  const authUser = requireAuth(c);
  if(c.req.query('engine')==='trusted')return latestTrustedDaily(c,authUser.userId);
  const requestedDate = c.req.query('date') || null;
  const sourceScope = await resolveDailyReportSourceScope(authUser.userId, c.req.query('sourceId'), authUser.role);
  if (c.req.query('sourceId') != null && !sourceScope) {
    return c.json({ error: 'Source not found for current user' }, 404);
  }
  const reportUserId = sourceScope?.ownerUserId || authUser.userId;
  const reportType = buildDailyInsightType(sourceScope?.id || null);
  const [rawReport, dateNavigation] = await Promise.all([
    getLatestReport(reportUserId, reportType, requestedDate),
    buildDateNavigation(reportUserId, reportType, requestedDate),
  ]);
  const report = normalizeInsight(rawReport);
  if (!report) {
    return c.json({
      data: {
        id: '',
        date: requestedDate || dateNavigation.latestDate || '',
        type: 'daily_report',
        summary: '',
        markdown: '',
        itemCount: 0,
        generatedAt: null,
        payload: {},
        preview: buildReportPreview(null),
        dateNavigation,
        trendSummary: null,
        eventMetrics: null,
        priorityArticles: [],
        moduleSections: [],
        editorialDigest: null,
        editorialMaterials: [],
        coverJudgement: null,
        radarOverview: null,
        moduleNarratives: [],
        moreDynamics: [],
        deepReads: [],
        tableOfContents: [],
        readingOrder: null,
        nextActions: null,
        coverageSummary: null,
        coverageItems: [],
        coverageMarkdown: '',
        coverageDiagnostics: null,
        reportContext: buildReportContext({ date: requestedDate || dateNavigation.latestDate || null }),
        publicationStatus: 'missing',
        publishable: false,
        draft: null,
        qualityStatus: null,
        qualityReasons: [],
        qualityWarnings: [],
        qualityReasonLabel: null,
        reportScope: {
          reportType,
          sourceId: sourceScope?.id || null,
          sourceName: sourceScope?.name || null,
          label: sourceScope?.name ? `${sourceScope.name} 独立日报` : '信息中枢日报',
        },
        missing: true,
      },
    });
  }
  const snapshot = report.payload?.snapshot;
  const eventMetrics = snapshot?.eventMetrics
    || report.payload?.eventMetrics
    || await loadDailyReportEventMetrics({
      userId: reportUserId,
      date: report.date,
      sourceId: sourceScope?.id || null,
    });
  const snapshotWithEventMetrics = snapshot ? { ...snapshot, eventMetrics } : null;
  const rebuiltModuleSections = snapshot ? buildDailyReportModuleSections(snapshot) : [];
  const savedModuleSections = report.payload?.moduleSections?.length
    ? report.payload.moduleSections
    : snapshot?.moduleSections || [];
  const moduleSections = savedModuleSections.length
    ? savedModuleSections.map((section: any) => {
      if (section.evidence?.length) return section;
      const rebuilt = rebuiltModuleSections.find((candidate) => candidate.key === section.key);
      return rebuilt
        ? { ...section, evidence: rebuilt.evidence, narrativeMarkdown: rebuilt.narrativeMarkdown }
        : section;
    })
    : rebuiltModuleSections;
  const coveragePreview = sourceScope ? null : await buildDailyWorkflowPreview(reportUserId, undefined, report.date);
  const coverageSummary = report.payload?.coverageSummary || coveragePreview?.preview.coverageSummary || null;
  const coverageItems = report.payload?.coverageItems || coveragePreview?.preview.coverageItems || [];
  const coverageMarkdown = report.payload?.coverageMarkdown || coveragePreview?.preview.coverageMarkdown || '';
  const snapshotWithEditorialCoverage = snapshotWithEventMetrics
    ? {
      ...snapshotWithEventMetrics,
      moduleSections,
      editorialSupplementArticles: snapshotWithEventMetrics.editorialSupplementArticles?.length
        ? snapshotWithEventMetrics.editorialSupplementArticles
        : buildDailyReportSupplementalArticles({ ...snapshotWithEventMetrics, moduleSections }, coverageItems),
    }
    : null;
  const rebuiltEditorialDigest = snapshotWithEditorialCoverage
    ? buildDailyReportEditorialDigest(snapshotWithEditorialCoverage)
    : null;
  const savedEditorialDigest = report.payload?.editorialDigest || null;
  const editorialDigest = rebuiltEditorialDigest
    ? {
      ...rebuiltEditorialDigest,
      ...(savedEditorialDigest || {}),
      moduleNarratives: moduleSections,
      moreDynamics: (rebuiltEditorialDigest.moreDynamics?.length || 0) > (savedEditorialDigest?.moreDynamics?.length || 0)
        ? rebuiltEditorialDigest.moreDynamics
        : savedEditorialDigest?.moreDynamics || rebuiltEditorialDigest.moreDynamics,
      deepReads: (rebuiltEditorialDigest.deepReads?.length || 0) > (savedEditorialDigest?.deepReads?.length || 0)
        ? rebuiltEditorialDigest.deepReads
        : savedEditorialDigest?.deepReads || rebuiltEditorialDigest.deepReads,
      materials: (rebuiltEditorialDigest.materials?.length || 0) > (savedEditorialDigest?.materials?.length || 0)
        ? rebuiltEditorialDigest.materials
        : savedEditorialDigest?.materials || rebuiltEditorialDigest.materials,
    }
    : null;
  const coverageCount = coverageSummary?.total || 0;
  const priorityArticles = snapshot ? buildDailyReportPriorityArticles(snapshot) : [];
  const selectedIds = new Set(priorityArticles.map((item) => String(item.id)));
  const moreDynamics = editorialDigest?.moreDynamics?.length
    ? editorialDigest.moreDynamics
    : report.payload?.moreDynamics?.length
      ? report.payload.moreDynamics
      : deriveReportDynamicsFromCoverageItems(coverageItems, selectedIds);
  const deepReads = editorialDigest?.deepReads?.length
    ? editorialDigest.deepReads
    : report.payload?.deepReads?.length
      ? report.payload.deepReads
      : deriveReportDeepReadsFromCoverageItems(coverageItems);
  const coverageDiagnostics = normalizeReportCoverageDiagnostics(
    coveragePreview?.preview.coverageDiagnostics || report.payload?.coverageDiagnostics || null,
    coverageSummary,
  );
  const tableOfContents = [
    ...(report.payload?.tableOfContents || editorialDigest?.tableOfContents || []),
  ];
  if (coverageItems.length > 0 && !tableOfContents.includes('附录：全池摘要索引')) {
    tableOfContents.push('附录：全池摘要索引');
  }
  const reportQuality = resolvePersistedDailyReportQuality(report.payload);
  const publicationStatus = resolveDailyReportPublicationStatus(true, reportQuality);
  const degradedPresentation = reportQuality.status === 'degraded' && snapshotWithEditorialCoverage
    ? report.payload?.degradedPresentation
      || buildDegradedDailyReportPresentation(snapshotWithEditorialCoverage, moduleSections, report.payload?.reportScope?.label || '信息中枢日报')
    : null;
  const publishable = publicationStatus === 'published';
  const draftMarkdown = publicationStatus === 'draft'
    ? String(degradedPresentation?.markdown || report.markdown || '').trim()
    : '';
  const responseReport = publicationStatus === 'published'
    ? report
    : { ...report, summary: '', markdown: '' };
  const structured = publishable && snapshot
    ? buildStructuredOutput(snapshot, editorialDigest, moduleSections, snapshot.topItems || [])
    : null;
  return c.json({
    data: {
      ...responseReport,
      reportScope: report.payload?.reportScope || {
        reportType,
        sourceId: sourceScope?.id || null,
        sourceName: sourceScope?.name || null,
        label: sourceScope?.name ? `${sourceScope.name} 独立日报` : '信息中枢日报',
      },
      preview: buildReportPreview(responseReport),
      dateNavigation: {
        ...dateNavigation,
        currentDate: report.date,
      },
      trendSummary: snapshotWithEventMetrics ? buildDailyReportTrendSummary(snapshotWithEventMetrics) : null,
      eventMetrics,
      priorityArticles: publishable ? priorityArticles : [],
      moduleSections: publishable ? moduleSections : [],
      editorialDigest: publishable ? editorialDigest : null,
      editorialMaterials: editorialDigest?.materials || report.payload?.editorialMaterials || [],
      coverJudgement: publishable ? report.payload?.coverJudgement || editorialDigest?.coverJudgement || null : null,
      radarOverview: publishable ? report.payload?.radarOverview || editorialDigest?.radarOverview || null : null,
      moduleNarratives: publishable ? moduleSections : [],
      moreDynamics: publishable ? moreDynamics : [],
      deepReads: publishable ? deepReads : [],
      tableOfContents: publishable ? tableOfContents : [],
      readingOrder: publishable ? report.payload?.readingOrder || editorialDigest?.readingOrder || null : null,
      nextActions: publishable ? report.payload?.nextActions || editorialDigest?.nextActions || null : null,
      coverageSummary,
      coverageItems,
      coverageMarkdown,
      coverageDiagnostics,
      reportContext: buildReportContext({
        date: report.date,
        dailyReportDiagnostic: {
          status: publishable ? 'selected' : 'quality_gate_failed',
          label: publishable ? '正式日报已发布' : '本次生成未通过质量门禁',
          reason: publishable
            ? `当前正式日报覆盖 ${coverageCount} 条候选。`
            : summarizeDailyReportQualityReasons(reportQuality.reasons),
          action: publishable
            ? '在趋势、重点文章和全池摘要索引之间交叉检查正文质量。'
            : '进入工作台查看失败阶段，调整候选素材或模型配置后重新生成。',
          selectionMode: coveragePreview?.preview.selectionMode || report.payload?.snapshot?.selectionMode || 'generated',
        },
      }),
      publicationStatus,
      publishable,
      draft: publicationStatus === 'draft'
        ? {
          markdown: draftMarkdown,
          generatedAt: report.generatedAt,
          qualityReasons: reportQuality.reasons,
          qualityReasonLabel: summarizeDailyReportQualityReasons(reportQuality.reasons),
        }
        : null,
      qualityStatus: reportQuality.status,
      qualityReasons: reportQuality.reasons,
      qualityWarnings: reportQuality.warnings,
      qualityReasonLabel: summarizeDailyReportQualityReasons(reportQuality.reasons),
      structured,
    },
  });
});

export default app;
