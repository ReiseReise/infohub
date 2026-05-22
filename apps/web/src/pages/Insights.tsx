import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BarChart3, BrainCircuit, Copy, Eye, FileText, Layers3, Save, RefreshCw, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  api,
  type DailyReportWorkflowConfig,
  type DailyReportWorkflowPayload,
  type DailyReportWorkflowPreview,
  type GrowthDashboardRecord,
  type InsightRecord,
} from '../lib/api';
import { MarkdownContent } from '../components/MarkdownContent';

const AXIS_ACCENTS: Record<string, string> = {
  认知升级: 'border-sky-200 bg-sky-50 text-sky-800',
  技术能力: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  商业判断: 'border-amber-200 bg-amber-50 text-amber-800',
  表达输出: 'border-rose-200 bg-rose-50 text-rose-800',
};

const TIER_LABELS: Record<string, string> = {
  T1: 'T1 一手官方',
  'T1.5': 'T1.5 官方社媒',
  T2: 'T2 观察信源',
  S: 'S级信号',
  A: 'A级分析',
  B: 'B级资讯',
  C: 'C级噪声观察',
  D: 'D级哨兵',
};

const PROFILE_LABELS: Record<string, string> = {
  full: '深加工',
  smart: '智能加工',
  brief: '轻摘要',
  monitor: '仅监控',
};

const REPORT_STATUS_LABELS: Record<string, string> = {
  scored: '高分日报',
  review: '低分复核日报',
  latest_visible: '低分兜底日报',
  empty: '空日报诊断',
};

const DAILY_SCENE_LABELS: Record<string, string> = {
  daily_report_cleaning: '日报清洗',
  daily_report_decision: '决策简报',
  daily_report_research: '研究汇总',
  daily_report_reading: '阅读导航',
  daily_report_final: '最终日报',
  daily_report: '旧版日报',
};

const WORKFLOW_STEPS = [
  { title: '内容入口', description: '读取今日主流程可见条目，并同步统计过滤池与待处理数量。' },
  { title: '入报筛选', description: '按分类、信源等级、关键词和最低精选分形成候选池。' },
  { title: '入报前中文化', description: '英文标题或摘要先走翻译；失败的条目进入诊断，不进入最终候选。' },
  { title: 'Prompt 链路', description: '复用 AI 中心的清洗、决策、研究、阅读和最终日报模板。' },
  { title: '生成与兜底', description: '高分不足时可使用最新可见内容兜底，并显式标注兜底原因。' },
];

function listToText(value?: string[]) {
  return (value || []).join('，');
}

function textToList(value: string) {
  return value
    .split(/[，,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cloneWorkflow(workflow: DailyReportWorkflowConfig): DailyReportWorkflowConfig {
  return JSON.parse(JSON.stringify(workflow));
}

function extractReportMarkdown(report?: InsightRecord | null) {
  if (!report) return '';
  return report.payload?.final?.markdown || report.summary || '';
}

export function Insights() {
  const [dashboard, setDashboard] = useState<GrowthDashboardRecord | null>(null);
  const [insights, setInsights] = useState<InsightRecord[]>([]);
  const [selectedInsightId, setSelectedInsightId] = useState<string | number | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowPayload, setWorkflowPayload] = useState<DailyReportWorkflowPayload | null>(null);
  const [workflowDraft, setWorkflowDraft] = useState<DailyReportWorkflowConfig | null>(null);
  const [workflowPreview, setWorkflowPreview] = useState<DailyReportWorkflowPreview | null>(null);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [workflowPreviewing, setWorkflowPreviewing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const [dashboardResp, listResp, workflowResp] = await Promise.all([
        api.insights.dashboard({ windowDays: 7, limit: 120 }),
        api.insights.list({ limit: '12' }),
        api.insights.workflow(),
      ]);
      setDashboard(dashboardResp.data);
      setInsights(listResp.data);
      setWorkflowPayload(workflowResp.data);
      setWorkflowDraft((current) => current || cloneWorkflow(workflowResp.data.workflow));
      setSelectedInsightId((current) => current || listResp.data[0]?.id || null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  const selectedInsight = useMemo(
    () => insights.find((item) => String(item.id) === String(selectedInsightId)) || insights[0] || null,
    [insights, selectedInsightId],
  );

  function updateWorkflow(patch: Partial<DailyReportWorkflowConfig>) {
    setWorkflowDraft((current) => current ? { ...current, ...patch } : current);
  }

  function updateWorkflowScope(key: keyof DailyReportWorkflowConfig['scope'], value: string[]) {
    setWorkflowDraft((current) => current
      ? { ...current, scope: { ...current.scope, [key]: value } }
      : current);
  }

  function toggleWorkflowModule(key: keyof DailyReportWorkflowConfig['enabledModules']) {
    setWorkflowDraft((current) => current
      ? { ...current, enabledModules: { ...current.enabledModules, [key]: !current.enabledModules[key] } }
      : current);
  }

  async function handleWorkflowPreview() {
    if (!workflowDraft) return;
    setWorkflowPreviewing(true);
    setNotice(null);
    try {
      const resp = await api.insights.previewWorkflow(workflowDraft);
      setWorkflowPreview(resp.data.preview);
      setWorkflowDraft(cloneWorkflow(resp.data.workflow));
      setNotice('日报候选池预览已刷新，预览不会写入日报。');
    } finally {
      setWorkflowPreviewing(false);
    }
  }

  async function handleWorkflowSave() {
    if (!workflowDraft) return;
    setWorkflowSaving(true);
    setNotice(null);
    try {
      const resp = await api.insights.updateWorkflow(workflowDraft);
      const saved = cloneWorkflow(resp.data.workflow);
      setWorkflowDraft(saved);
      setWorkflowPayload((current) => current ? { ...current, workflow: saved } : current);
      const preview = await api.insights.previewWorkflow(saved);
      setWorkflowPreview(preview.data.preview);
      setNotice('日报工作流已保存；下一次生成日报会使用这套口径。');
    } finally {
      setWorkflowSaving(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setNotice(null);
    try {
      const resp = await api.insights.generate({
        date: selectedInsight?.date,
        compareWindowDays: 7,
        preset: 'full',
      });
      await loadAll();
      const mode = resp.data?.snapshot?.selectionMode || resp.data?.payload?.snapshot?.selectionMode || 'scored';
      setNotice(`日报已生成：${REPORT_STATUS_LABELS[mode] || '已生成'}，并刷新了成长仪表板。`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopyReport() {
    const markdown = extractReportMarkdown(selectedInsight).trim();
    if (!markdown) {
      setNotice('当前没有可复制的日报内容。');
      return;
    }
    try {
      await navigator.clipboard.writeText(markdown);
      setNotice('当前日报已复制到剪贴板。');
    } catch {
      setNotice('复制失败，请检查浏览器剪贴板权限。');
    }
  }

  if (loading) {
    return <div className="p-8 text-sm text-zinc-400">加载成长仪表板...</div>;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.08),_transparent_30%),linear-gradient(180deg,_#fffdf8_0%,_#f8fafc_100%)] p-4 md:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[30px] border border-zinc-200/80 bg-white/90 p-6 shadow-[0_28px_90px_-56px_rgba(15,23,42,0.45)] backdrop-blur">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="text-[11px] tracking-[0.3em] text-sky-700/70">成长控制台</div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">成长仪表板</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                先看四象限精选，再决定读什么、记什么、做什么。当前窗口 {dashboard?.windowDays || 7} 天。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void loadAll()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                <RefreshCw size={14} />
                刷新
              </button>
              <button
                onClick={() => setWorkflowOpen((value) => !value)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                <SlidersHorizontal size={14} />
                日报工作流
              </button>
              <button
                onClick={() => void handleGenerate()}
                disabled={generating}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                <Sparkles size={14} className={generating ? 'animate-pulse' : ''} />
                {generating ? '生成中...' : '重新生成当前日期日报'}
              </button>
            </div>
          </div>
        </div>

        {notice && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        {workflowOpen && workflowDraft && (
          <section className="mt-5 rounded-[28px] border border-zinc-200 bg-white p-5 shadow-[0_18px_56px_-44px_rgba(15,23,42,0.4)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800">
                  <SlidersHorizontal size={14} />
                  日报工作流
                </div>
                <h2 className="mt-3 text-xl font-semibold text-zinc-900">从今日内容到中文日报的可解释链路</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
                  这里控制入报范围、评分阈值、最新兜底、中文化门禁和 Prompt 链路。生成日报时会读取已保存配置。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void handleWorkflowPreview()}
                  disabled={workflowPreviewing}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  <Eye size={14} />
                  {workflowPreviewing ? '预览中...' : '预览候选池'}
                </button>
                <button
                  onClick={() => void handleWorkflowSave()}
                  disabled={workflowSaving}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  <Save size={14} />
                  {workflowSaving ? '保存中...' : '保存工作流'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-5">
              {WORKFLOW_STEPS.map((step, index) => (
                <div key={step.title} className="rounded-2xl border border-zinc-100 bg-zinc-50/70 p-4">
                  <div className="text-[11px] font-medium text-zinc-400">步骤 {index + 1}</div>
                  <div className="mt-2 text-sm font-semibold text-zinc-900">{step.title}</div>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">{step.description}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
              <div className="rounded-2xl border border-zinc-100 p-4">
                <div className="text-sm font-semibold text-zinc-900">关键参数</div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <label className="text-xs text-zinc-500">
                    最低精选分
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={workflowDraft.minScore}
                      onChange={(event) => updateWorkflow({ minScore: Number(event.target.value) })}
                      className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                    />
                  </label>
                  <label className="text-xs text-zinc-500">
                    入报条数
                    <input
                      type="number"
                      min={1}
                      max={40}
                      value={workflowDraft.topN}
                      onChange={(event) => updateWorkflow({ topN: Number(event.target.value) })}
                      className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                    />
                  </label>
                  <label className="text-xs text-zinc-500">
                    每信源上限
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={workflowDraft.perSourceLimit}
                      onChange={(event) => updateWorkflow({ perSourceLimit: Number(event.target.value) })}
                      className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="flex items-center justify-between gap-3 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                    <span>允许最新可见内容兜底</span>
                    <input
                      type="checkbox"
                      checked={workflowDraft.enableLatestFallback}
                      onChange={(event) => updateWorkflow({ enableLatestFallback: event.target.checked })}
                      className="h-4 w-4"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                    <span>入报前必须中文化</span>
                    <input
                      type="checkbox"
                      checked={workflowDraft.requireChinese}
                      onChange={(event) => updateWorkflow({ requireChinese: event.target.checked })}
                      className="h-4 w-4"
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-3">
                  <label className="text-xs text-zinc-500">
                    入报分类
                    <textarea
                      value={listToText(workflowDraft.scope.categories)}
                      onChange={(event) => updateWorkflowScope('categories', textToList(event.target.value))}
                      className="mt-1 min-h-20 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm leading-6 text-zinc-900 outline-none focus:border-zinc-400"
                    />
                  </label>
                  <label className="text-xs text-zinc-500">
                    关键词范围
                    <textarea
                      value={listToText(workflowDraft.scope.keywords)}
                      onChange={(event) => updateWorkflowScope('keywords', textToList(event.target.value))}
                      className="mt-1 min-h-20 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm leading-6 text-zinc-900 outline-none focus:border-zinc-400"
                    />
                  </label>
                  <label className="text-xs text-zinc-500">
                    信源等级
                    <input
                      value={listToText(workflowDraft.scope.sourceTiers)}
                      onChange={(event) => updateWorkflowScope('sourceTiers', textToList(event.target.value))}
                      className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                    />
                  </label>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-zinc-100 p-4">
                  <div className="text-sm font-semibold text-zinc-900">Prompt 链路</div>
                  <div className="mt-3 space-y-2">
                    {(['cleaning', 'decision', 'research', 'reading', 'final'] as const).map((key) => {
                      const sceneType = key === 'cleaning'
                        ? 'daily_report_cleaning'
                        : key === 'final'
                          ? 'daily_report_final'
                          : `daily_report_${key}`;
                      const scene = workflowPayload?.aiScenes?.find((item) => item.type === sceneType);
                      return (
                        <div key={key} className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2">
                          <label className="flex items-center justify-between gap-3 text-sm text-zinc-700">
                            <span>{DAILY_SCENE_LABELS[sceneType] || sceneType}</span>
                            <input
                              type="checkbox"
                              checked={workflowDraft.enabledModules[key]}
                              onChange={() => toggleWorkflowModule(key)}
                              className="h-4 w-4"
                            />
                          </label>
                          <div className="mt-1 text-xs leading-5 text-zinc-500">
                            {scene
                              ? `${scene.isActive ? '已启用' : '未启用'} · ${scene.provider || '未绑定供应商'} / ${scene.model || '未绑定模型'}`
                              : '未找到绑定模板，可到 AI 中心配置。'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Link to="/settings" className="mt-3 inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-800">
                    前往 AI 中心查看模板
                    <ArrowUpRight size={12} />
                  </Link>
                </div>

                <div className="rounded-2xl border border-zinc-100 p-4">
                  <div className="text-sm font-semibold text-zinc-900">预览漏斗</div>
                  {workflowPreview ? (
                    <>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        {[
                          ['今日新增', workflowPreview.funnel.todayNew],
                          ['主流程可见', workflowPreview.funnel.mainVisible],
                          ['匹配范围', workflowPreview.funnel.scopeMatched],
                          ['高分候选', workflowPreview.funnel.scoredCandidates],
                          ['低分复核', workflowPreview.funnel.reviewCandidates ?? 0],
                          ['软过滤恢复', workflowPreview.funnel.softFilteredRecovered ?? 0],
                          ['评分失败', workflowPreview.funnel.scoreFailedCandidates ?? 0],
                          ['最新兜底', workflowPreview.funnel.latestFallbackCandidates],
                          ['翻译失败', workflowPreview.funnel.translationFailed],
                          ['最终入报', workflowPreview.funnel.finalCandidates],
                          ['被过滤', workflowPreview.funnel.filteredItems ?? 0],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-xl bg-zinc-50 px-3 py-2">
                            <div className="text-[11px] text-zinc-500">{label}</div>
                            <div className="mt-1 text-lg font-semibold text-zinc-900">{value}</div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                        预览结果：{REPORT_STATUS_LABELS[workflowPreview.selectionMode] || workflowPreview.selectionMode}
                      </div>
                    </>
                  ) : (
                    <div className="mt-3 rounded-xl border border-dashed border-zinc-200 px-3 py-5 text-sm text-zinc-400">
                      点击“预览候选池”后，这里会展示今日内容如何通过筛选、中文化和兜底。
                    </div>
                  )}
                </div>
              </div>
            </div>

            {workflowPreview && (
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-zinc-100 p-4">
                  <div className="text-sm font-semibold text-zinc-900">最终候选</div>
                  <div className="mt-3 space-y-2">
                    {workflowPreview.candidates.length > 0 ? workflowPreview.candidates.slice(0, 6).map((item) => (
                      <div key={item.id} className="rounded-xl bg-zinc-50 px-3 py-2">
                        <div className="text-sm font-medium text-zinc-900">{item.title}</div>
                        <div className="mt-1 text-xs text-zinc-500">{item.sourceName} · {item.category} · {REPORT_STATUS_LABELS[item.selectionMode] || item.selectionMode}</div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-600">{item.selectionReason}</p>
                      </div>
                    )) : (
                      <div className="rounded-xl border border-dashed border-zinc-200 px-3 py-5 text-sm text-zinc-400">当前没有可入报候选。</div>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-zinc-100 p-4">
                  <div className="text-sm font-semibold text-zinc-900">未入报诊断</div>
                  <div className="mt-3 space-y-2">
                    {workflowPreview.excluded.length > 0 ? workflowPreview.excluded.slice(0, 6).map((item) => (
                      <div key={item.id} className="rounded-xl bg-zinc-50 px-3 py-2">
                        <div className="text-sm font-medium text-zinc-900">{item.title}</div>
                        <div className="mt-1 text-xs text-zinc-500">{item.reason} · {item.detail || '无补充说明'}</div>
                      </div>
                    )) : (
                      <div className="rounded-xl border border-dashed border-zinc-200 px-3 py-5 text-sm text-zinc-400">暂无未入报诊断。</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-zinc-200 bg-white p-5">
            <div className="text-xs text-zinc-500">窗口条目</div>
            <div className="mt-2 text-3xl font-semibold text-zinc-900">{dashboard?.summary.totalItems ?? 0}</div>
            <div className="mt-2 text-xs text-zinc-500">可见 {dashboard?.summary.visibleItems ?? 0} · 过滤 {dashboard?.summary.filteredBucketItems ?? 0}</div>
          </div>
          <div className="rounded-3xl border border-zinc-200 bg-white p-5">
            <div className="text-xs text-zinc-500">活跃信源</div>
            <div className="mt-2 text-3xl font-semibold text-zinc-900">{dashboard?.summary.activeSources ?? 0}</div>
          </div>
          <div className="rounded-3xl border border-zinc-200 bg-white p-5">
            <div className="text-xs text-zinc-500">高信号源</div>
            <div className="mt-2 text-3xl font-semibold text-zinc-900">{dashboard?.summary.signalSources ?? 0}</div>
          </div>
          <div className="rounded-3xl border border-zinc-200 bg-white p-5">
            <div className="text-xs text-zinc-500">必须复看</div>
            <div className="mt-2 text-3xl font-semibold text-zinc-900">{dashboard?.summary.mustReview ?? 0}</div>
            <div className="mt-2 text-xs text-zinc-500">错位 {dashboard?.summary.mismatchedFilteredMain ?? 0} · 待分流 {dashboard?.summary.unmappedItems ?? 0}</div>
          </div>
        </div>

        <div className="mt-6 grid gap-5 xl:grid-cols-2">
          {(dashboard?.axes || []).map((axisCard) => (
            <section key={axisCard.axis} className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-[0_16px_48px_-40px_rgba(15,23,42,0.35)]">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${AXIS_ACCENTS[axisCard.axis] || 'border-zinc-200 bg-zinc-50 text-zinc-700'}`}>
                    <BrainCircuit size={14} />
                    {axisCard.axis}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-zinc-600">{axisCard.summary}</p>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-2 text-right">
                  <div className="rounded-2xl bg-zinc-50 px-3 py-2">
                    <div className="text-[11px] text-zinc-500">命中条数</div>
                    <div className="mt-1 text-xl font-semibold text-zinc-900">{axisCard.count}</div>
                  </div>
                  <div className="rounded-2xl bg-zinc-50 px-3 py-2">
                    <div className="text-[11px] text-zinc-500">平均评分</div>
                    <div className="mt-1 text-xl font-semibold text-zinc-900">{axisCard.averageScore ?? '—'}</div>
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {axisCard.items.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-200 px-4 py-5 text-sm text-zinc-400">
                    {axisCard.emptyReason || '暂无条目。优先在信源管理里给来源打上成长维度。'}
                  </div>
                ) : (
                  axisCard.items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-zinc-100 px-4 py-4 transition-colors hover:border-zinc-200 hover:bg-zinc-50/70"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700">{TIER_LABELS[item.sourceTier] || item.sourceTier}</span>
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5">{PROFILE_LABELS[item.processingProfile] || item.processingProfile}</span>
                        {item.aiScore != null && <span className="rounded-full bg-zinc-100 px-2 py-0.5">AI {item.aiScore}</span>}
                        <span>{item.sourceName || '未知信源'}</span>
                      </div>
                      <div className="mt-2 flex items-start justify-between gap-3">
                        <Link to={`/feed/${item.id}`} className="text-base font-semibold leading-6 text-zinc-900 hover:text-teal-800">
                          {item.title}
                        </Link>
                        <ArrowUpRight size={15} className="mt-1 shrink-0 text-zinc-300" />
                      </div>
                      {item.summary && (
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-600">{item.summary}</p>
                      )}
                      <div className="mt-3 rounded-2xl bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                        下一步：{item.actionSuggestion}
                      </div>
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="mt-2 inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-800"
                        >
                          打开原文
                          <ArrowUpRight size={12} />
                        </a>
                      )}
                    </div>
                  ))
                )}
              </div>
              {axisCard.sourceExplanation && (
                <div className="mt-3 rounded-2xl bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-500">
                  {axisCard.sourceExplanation}
                </div>
              )}
            </section>
          ))}
        </div>

        <div className="mt-6 grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <section className="rounded-[28px] border border-zinc-200 bg-white p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              <Layers3 size={16} />
              信源分层
            </div>
            <div className="mt-4 space-y-2">
              {(dashboard?.sourceTierStats || []).map((entry) => (
                <div key={entry.tier} className="flex items-center justify-between rounded-2xl bg-zinc-50 px-3 py-2 text-sm">
                  <span className="text-zinc-600">{TIER_LABELS[entry.tier] || entry.tier}</span>
                  <span className="font-medium text-zinc-900">{entry.count}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-zinc-900">
              <BarChart3 size={16} />
              处理档位
            </div>
            <div className="mt-4 space-y-2">
              {(dashboard?.processingProfileStats || []).map((entry) => (
                <div key={entry.profile} className="flex items-center justify-between rounded-2xl bg-zinc-50 px-3 py-2 text-sm">
                  <span className="text-zinc-600">{PROFILE_LABELS[entry.profile] || entry.profile}</span>
                  <span className="font-medium text-zinc-900">{entry.count}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-[0_16px_48px_-40px_rgba(15,23,42,0.35)]">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-zinc-900">日报档案</div>
                <div className="mt-1 text-xs text-zinc-500">保留日常总结能力，但首页优先展示成长四象限。</div>
              </div>
              <button
                onClick={() => void handleCopyReport()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                <Copy size={14} />
                复制当前日报
              </button>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
              <aside className="space-y-2">
                {insights.map((insight) => (
                  <button
                    key={String(insight.id)}
                    onClick={() => setSelectedInsightId(insight.id)}
                    className={`w-full rounded-2xl border px-3 py-3 text-left text-sm transition-colors ${
                      String(selectedInsight?.id) === String(insight.id)
                        ? 'border-zinc-900 bg-zinc-900 text-white'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                    }`}
                  >
                    <div className="font-medium">{insight.date}</div>
                    <div className={`mt-1 text-xs ${String(selectedInsight?.id) === String(insight.id) ? 'text-zinc-300' : 'text-zinc-400'}`}>
                      {insight.itemCount || 0} 条新增
                    </div>
                  </button>
                ))}
              </aside>

              <div className="min-w-0 rounded-2xl border border-zinc-100 bg-zinc-50/60 p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-900">
                  <FileText size={16} />
                  {selectedInsight ? `${selectedInsight.date} 日报` : '暂无日报'}
                </div>
                <MarkdownContent content={extractReportMarkdown(selectedInsight)} empty="还没有日报内容。" className="min-w-0" />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
