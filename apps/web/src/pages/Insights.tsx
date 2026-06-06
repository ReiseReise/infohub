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
import {
  buildExcludedCandidateRepairPlan,
  resolveRepairProblemActions,
  resolveExcludedCandidateRepairAction,
  summarizeExcludedCandidateRepairRuns,
  type ExcludedCandidateRepairRun,
  type ExcludedCandidateRepairProblemItem,
  type ExcludedCandidateRepairSummary,
} from '../lib/insights-repair-actions';
import { buildDailyReportSnapshotFunnelCards } from '../lib/insights-report-funnel';

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

type DailyReportGenerationMode = 'fast' | 'full';
type NoticeTone = 'success' | 'warning' | 'danger';
type NoticeState = string | { message: string; tone: NoticeTone };
type ReportExcludedCandidate = DailyReportWorkflowPreview['excluded'][number];
type ReportExcludedReason = ReportExcludedCandidate['reason'];

const NOTICE_CLASS_NAMES: Record<NoticeTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-rose-200 bg-rose-50 text-rose-700',
};

const GENERATION_MODE_LABELS: Record<DailyReportGenerationMode, string> = {
  fast: '快速',
  full: '完整',
};

const GENERATION_MODE_DESCRIPTIONS: Record<DailyReportGenerationMode, string> = {
  fast: '只等待最终日报，清洗/决策/研究/阅读模块不阻塞首屏。',
  full: '完整运行清洗、决策、研究、阅读和最终日报，适合复盘与深加工。',
};

const EXCLUDED_REASON_META: Record<string, { label: string; description: string; tone: string }> = {
  translation_failed: {
    label: '翻译失败/未中文化明细',
    description: '英文标题或摘要没有在入报前转成可用中文，因此暂不进入最终日报。',
    tone: 'border-amber-200 bg-amber-50 text-amber-950',
  },
  not_chinese: {
    label: '缺少中文材料',
    description: '条目没有可用中文标题或摘要，入报会降低可读性。',
    tone: 'border-orange-200 bg-orange-50 text-orange-950',
  },
  fallback_scored: {
    label: '低置信兜底待修复',
    description: '这类条目只有确定性兜底评分或模型熔断评分，先回收真实评分后再进入日报。',
    tone: 'border-amber-200 bg-amber-50 text-amber-950',
  },
  business_noise: {
    label: '泛商业噪声',
    description: '偏行情、融资、公告或宽泛商业信息，未命中 AI/科技/头部舆论主线。',
    tone: 'border-zinc-200 bg-zinc-50 text-zinc-800',
  },
  not_selected: {
    label: '未达到入报门槛',
    description: '未匹配日报范围，或分数/兜底策略不足以进入候选池。',
    tone: 'border-slate-200 bg-slate-50 text-slate-800',
  },
};

const REPORT_FUNNEL_CARD_TONES = {
  ok: 'border-emerald-100 bg-emerald-50 text-emerald-950',
  warning: 'border-amber-100 bg-amber-50 text-amber-950',
  neutral: 'border-zinc-100 bg-zinc-50 text-zinc-800',
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

const REPORT_SECTION_HEADINGS = new Set([
  '生成口径',
  '今日结论',
  '关键进展',
  '头部舆论/新闻焦点',
  '阅读建议',
  '下一步行动',
  '低分复核',
  '泛商业噪声',
  '候选漏斗',
  '入报理由',
  '未入报诊断',
]);

function normalizeReportMarkdownForDisplay(value: string) {
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return '';
  if (/^#{1,6}\s+\S/m.test(normalized)) {
    return normalized;
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const out: string[] = [];
  let currentSection = '';

  lines.forEach((line, index) => {
    if (index === 0 && /日报/.test(line)) {
      out.push(`# ${line}`, '');
      return;
    }
    if (REPORT_SECTION_HEADINGS.has(line)) {
      currentSection = line;
      out.push('', `## ${line}`, '');
      return;
    }
    if (currentSection === '生成口径' && /[:：]/.test(line)) {
      out.push(`- ${line}`);
      return;
    }
    if ((currentSection === '关键进展' || currentSection === '头部舆论/新闻焦点') && /[:：].*(AI|入报原因|摘要|来源|标签)/i.test(line)) {
      out.push(`- ${line}`);
      return;
    }
    out.push(line, '');
  });

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractReportMarkdown(report?: InsightRecord | null) {
  if (!report) return '';
  return normalizeReportMarkdownForDisplay(report.payload?.final?.markdown || report.summary || '');
}

function getReportModuleStatuses(report?: InsightRecord | null) {
  if (!report?.payload) return [];
  const modules = report.payload.modules || {};
  return [
    { key: 'cleaning', label: '清洗', meta: report.payload.cleaning?.meta },
    { key: 'decision', label: '决策', meta: modules.decision?.meta },
    { key: 'research', label: '研究', meta: modules.research?.meta },
    { key: 'reading', label: '阅读', meta: modules.reading?.meta },
    { key: 'final', label: '最终', meta: report.payload.final?.meta },
  ].filter((item) => item.meta);
}

function getReportGenerationMode(report?: InsightRecord | null): DailyReportGenerationMode | null {
  const mode = report?.payload?.generationMode;
  if (mode === 'fast' || mode === 'full') return mode;
  const cleaningError = report?.payload?.cleaning?.meta?.error;
  if (cleaningError === 'fast_generation_mode') return 'fast';
  if (report?.payload?.cleaning || report?.payload?.modules?.decision || report?.payload?.modules?.research || report?.payload?.modules?.reading) return 'full';
  return null;
}

function getReportTopItems(report?: InsightRecord | null) {
  return report?.payload?.snapshot?.topItems?.slice(0, 6) || [];
}

function getReportExclusionSummary(report?: InsightRecord | null) {
  const summary = report?.payload?.snapshot?.excludedCandidateSummary;
  if (summary?.byReason?.length) {
    return summary.byReason.filter((group) => group.count > 0);
  }
  const grouped = new Map<ReportExcludedReason, ReportExcludedCandidate[]>();
  for (const item of report?.payload?.snapshot?.excludedCandidates || []) {
    const items = grouped.get(item.reason) || [];
    items.push(item);
    grouped.set(item.reason, items);
  }
  return [...grouped.entries()].map(([reason, items]) => ({
    reason,
    count: items.length,
    samples: items.slice(0, 4),
  }));
}

function moduleStatusLabel(meta: NonNullable<ReturnType<typeof getReportModuleStatuses>[number]['meta']>) {
  if (meta.error === 'fast_generation_mode') return '快速跳过';
  if (meta.repaired) return '已修复';
  return meta.status === 'ai' ? 'AI' : '兜底';
}

function moduleStatusTone(meta: NonNullable<ReturnType<typeof getReportModuleStatuses>[number]['meta']>) {
  if (meta.error === 'fast_generation_mode') return 'border-sky-200 bg-sky-50 text-sky-800';
  if (meta.repaired) return 'border-amber-200 bg-amber-50 text-amber-800';
  return meta.status === 'ai'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-zinc-200 bg-white text-zinc-600';
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  const [repairingExcludedItemId, setRepairingExcludedItemId] = useState<string | null>(null);
  const [repairingExcludedGroup, setRepairingExcludedGroup] = useState<string | null>(null);
  const [repairResult, setRepairResult] = useState<ExcludedCandidateRepairSummary | null>(null);
  const [generationMode, setGenerationMode] = useState<DailyReportGenerationMode>('fast');
  const [notice, setNotice] = useState<string | null>(null);
  const [generationNotice, setGenerationNotice] = useState<NoticeState | null>(null);
  const [workflowNotice, setWorkflowNotice] = useState<NoticeState | null>(null);
  const [repairGenerating, setRepairGenerating] = useState(false);

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
  const generationNoticeMessage = typeof generationNotice === 'string' ? generationNotice : generationNotice?.message;
  const generationNoticeTone: NoticeTone = typeof generationNotice === 'string' || !generationNotice ? 'success' : generationNotice.tone;
  const workflowNoticeMessage = typeof workflowNotice === 'string' ? workflowNotice : workflowNotice?.message;
  const workflowNoticeTone: NoticeTone = typeof workflowNotice === 'string' || !workflowNotice ? 'success' : workflowNotice.tone;

  function handleJumpToLatestReport() {
    document.getElementById('daily-report-section')?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

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
    setWorkflowNotice(null);
    try {
      const resp = await api.insights.previewWorkflow(workflowDraft);
      setWorkflowPreview(resp.data.preview);
      setWorkflowDraft(cloneWorkflow(resp.data.workflow));
      setWorkflowNotice('日报候选池预览已刷新，预览不会写入日报。');
    } catch (err) {
      setWorkflowNotice({
        message: (err as Error).message || '日报候选池预览失败',
        tone: 'danger',
      });
    } finally {
      setWorkflowPreviewing(false);
    }
  }

  async function handleWorkflowSave() {
    if (!workflowDraft) return;
    setWorkflowSaving(true);
    setNotice(null);
    setWorkflowNotice(null);
    try {
      const resp = await api.insights.updateWorkflow(workflowDraft);
      const saved = cloneWorkflow(resp.data.workflow);
      setWorkflowDraft(saved);
      setWorkflowPayload((current) => current ? { ...current, workflow: saved } : current);
      const preview = await api.insights.previewWorkflow(saved);
      setWorkflowPreview(preview.data.preview);
      setWorkflowNotice('日报工作流已保存；下一次生成日报会使用这套口径。');
    } catch (err) {
      setWorkflowNotice({
        message: (err as Error).message || '日报工作流保存失败',
        tone: 'danger',
      });
    } finally {
      setWorkflowSaving(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setNotice(null);
    setGenerationNotice(null);
    try {
      const resp = await api.insights.generate({
        date: selectedInsight?.date,
        compareWindowDays: 7,
        preset: 'full',
        generationMode,
      });
      await loadAll();
      await refreshWorkflowPreview();
      const mode = resp.data?.snapshot?.selectionMode || resp.data?.payload?.snapshot?.selectionMode || 'scored';
      const generatedMode = resp.data?.payload?.generationMode || resp.data?.generationMode || resp.data?.options?.generationMode || generationMode;
      setGenerationNotice(`日报已生成：${REPORT_STATUS_LABELS[mode] || '已生成'} · ${GENERATION_MODE_LABELS[generatedMode === 'full' ? 'full' : 'fast']}模式，并刷新了成长仪表板和候选池。`);
    } catch (err) {
      setGenerationNotice({
        message: (err as Error).message || '日报生成失败',
        tone: 'danger',
      });
    } finally {
      setGenerating(false);
    }
  }

  async function handleRepairAndGenerate() {
    const date = selectedInsight?.date || localDateKey();
    setRepairGenerating(true);
    setNotice(null);
    setGenerationNotice(null);
    try {
      const repair = await api.items.reprocessBatch({ date, stage: 'all', limit: 60 });
      const resp = await api.insights.generate({
        date,
        compareWindowDays: 7,
        preset: 'full',
        generationMode,
      });
      await loadAll();
      await refreshWorkflowPreview();
      const mode = resp.data?.snapshot?.selectionMode || resp.data?.payload?.snapshot?.selectionMode || 'scored';
      const generatedMode = resp.data?.payload?.generationMode || resp.data?.generationMode || resp.data?.options?.generationMode || generationMode;
      setGenerationNotice(`已先修复再生成：修复 ${repair.matched} 条，日报状态 ${REPORT_STATUS_LABELS[mode] || '已生成'} · ${GENERATION_MODE_LABELS[generatedMode === 'full' ? 'full' : 'fast']}模式，并刷新了候选池。`);
    } catch (err) {
      setGenerationNotice({
        message: (err as Error).message || '修复后生成日报失败',
        tone: 'danger',
      });
    } finally {
      setRepairGenerating(false);
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

  async function refreshWorkflowPreview() {
    if (!workflowDraft) return;
    const resp = await api.insights.previewWorkflow(workflowDraft);
    setWorkflowPreview(resp.data.preview);
  }

  async function refreshWorkflowPreviewAfterRepair() {
    try {
      await refreshWorkflowPreview();
      return null;
    } catch (err) {
      const message = (err as Error).message || '候选池刷新失败';
      setWorkflowNotice({
        message: `修复已完成，但候选池暂未刷新：${message}`,
        tone: 'warning',
      });
      return message;
    }
  }

  async function handleRepairExcludedCandidate(item: ReportExcludedCandidate) {
    const action = resolveExcludedCandidateRepairAction(item.reason, item.detail);
    if (!action.canRun || !action.stage) {
      setNotice(action.hint);
      return;
    }
    setRepairingExcludedItemId(item.id);
    setNotice(null);
    setWorkflowNotice(null);
    setRepairResult(null);
    try {
      const resp = await api.items.reprocessBatch({ itemId: item.id, stage: action.stage, limit: 1 });
      const summary = summarizeExcludedCandidateRepairRuns([{
        itemId: item.id,
        title: item.title,
        stage: action.stage,
        label: action.label,
        response: resp,
      }]);
      setRepairResult(summary);
      const refreshError = await refreshWorkflowPreviewAfterRepair();
      setNotice(`${action.label}完成：命中 ${summary.matched} 条，成功 ${summary.successfulRuns} 条，需复核 ${summary.warningRuns} 条${refreshError ? '；候选池暂未刷新，请稍后重试预览。' : '。'}`);
    } catch (err) {
      setNotice((err as Error).message || `${action.label}失败`);
    } finally {
      setRepairingExcludedItemId(null);
    }
  }

  async function handleRepairExcludedGroup(reason: ReportExcludedReason, samples: ReportExcludedCandidate[]) {
    const plan = buildExcludedCandidateRepairPlan(samples, 10);
    if (plan.length === 0) {
      setNotice('这个分组没有可自动修复的样例，建议先人工查看 Feed 详情。');
      return;
    }
    setRepairingExcludedGroup(reason);
    setNotice(null);
    setWorkflowNotice(null);
    setRepairResult(null);
    const runs: ExcludedCandidateRepairRun[] = [];
    const sampleById = new Map(samples.map((sample) => [sample.id, sample]));
    try {
      for (const job of plan) {
        const resp = await api.items.reprocessBatch({ itemId: job.itemId, stage: job.stage, limit: 1 });
        runs.push({
          ...job,
          title: sampleById.get(job.itemId)?.title,
          response: resp,
        });
      }
      const summary = summarizeExcludedCandidateRepairRuns(runs);
      setRepairResult(summary);
      const refreshError = await refreshWorkflowPreviewAfterRepair();
      const uniqueStages = [...new Set(plan.map((job) => job.label))].join('/');
      setNotice(`已修复本组样例 ${plan.length} 条（${uniqueStages}）：成功 ${summary.successfulRuns} 条，需复核 ${summary.warningRuns} 条${refreshError ? '；候选池暂未刷新，请稍后重试预览。' : '。'}`);
    } catch (err) {
      setNotice((err as Error).message || '修复本组样例失败');
    } finally {
      setRepairingExcludedGroup(null);
    }
  }

  async function handleRetryRepairProblem(problem: ExcludedCandidateRepairProblemItem) {
    setRepairingExcludedItemId(problem.itemId);
    setNotice(null);
    setWorkflowNotice(null);
    try {
      const resp = await api.items.reprocessBatch({ itemId: problem.itemId, stage: problem.stage, limit: 1 });
      const summary = summarizeExcludedCandidateRepairRuns([{
        itemId: problem.itemId,
        title: problem.title,
        stage: problem.stage,
        label: problem.label,
        response: resp,
      }]);
      setRepairResult(summary);
      const refreshError = await refreshWorkflowPreviewAfterRepair();
      setNotice(`${problem.label}完成：命中 ${summary.matched} 条，成功 ${summary.successfulRuns} 条，需复核 ${summary.warningRuns} 条${refreshError ? '；候选池暂未刷新，请稍后重试预览。' : '。'}`);
    } catch (err) {
      setNotice((err as Error).message || `${problem.label}失败`);
    } finally {
      setRepairingExcludedItemId(null);
    }
  }

  function renderRepairResultPanel() {
    if (!repairResult) return null;
    const stageText = Object.entries(repairResult.stageCounts)
      .map(([stage, count]) => `${stage} ${count}`)
      .join(' / ');
    return (
      <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-amber-950">修复结果</div>
            <div className="mt-1 text-xs leading-5 text-amber-800">
              重新生成日报前，先看这里判断哪些条目已经处理，哪些还需要人工复核。
            </div>
          </div>
          <div className="text-xs text-amber-800">{stageText}</div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['执行', repairResult.totalRuns],
            ['命中', repairResult.matched],
            ['成功', repairResult.successfulRuns],
            ['需复核', repairResult.warningRuns],
            ['正文', repairResult.content],
            ['质检', repairResult.quality],
            ['评分', repairResult.scored],
            ['策略跳过', repairResult.skippedTotal],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-white/80 px-3 py-2">
              <div className="text-[11px] text-amber-700">{label}</div>
              <div className="mt-1 text-base font-semibold text-zinc-900">{value}</div>
            </div>
          ))}
        </div>
        {repairResult.problemItems.length > 0 ? (
          <div className="mt-3 space-y-2">
            {repairResult.problemItems.slice(0, 6).map((item) => (
              <div key={`${item.itemId}-${item.stage}`} className="rounded-xl border border-amber-100 bg-white/80 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-amber-800">
                  <span className="rounded-full bg-amber-50 px-2 py-0.5">{item.label}</span>
                  <span>{item.stage}</span>
                </div>
                <div className="mt-1 line-clamp-2 text-sm font-semibold text-zinc-900">{item.title || item.itemId}</div>
                <div className="mt-1 text-xs leading-5 text-amber-900">{item.messages.join('；')}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {resolveRepairProblemActions(item).map((action) => (
                    action.kind === 'retry' ? (
                      <button
                        key={`${item.itemId}-${action.kind}-${action.stage}`}
                        type="button"
                        onClick={() => void handleRetryRepairProblem(item)}
                        disabled={repairingExcludedItemId === item.itemId}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-900 bg-amber-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
                      >
                        <RefreshCw size={12} className={repairingExcludedItemId === item.itemId ? 'animate-spin' : ''} />
                        {repairingExcludedItemId === item.itemId ? '重试中' : action.label}
                      </button>
                    ) : (
                      <Link
                        key={`${item.itemId}-${action.kind}-${action.href}`}
                        to={action.href}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-50"
                      >
                        {action.label === 'Feed 详情' ? <Eye size={12} /> : <SlidersHorizontal size={12} />}
                        {action.label}
                      </Link>
                    )
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-emerald-100 bg-white/80 px-3 py-2 text-sm text-emerald-700">
            本次修复没有 warning 或错误。
          </div>
        )}
      </section>
    );
  }

  function renderExcludedCandidateCard(item: ReportExcludedCandidate) {
    const action = resolveExcludedCandidateRepairAction(item.reason, item.detail);
    const repairing = repairingExcludedItemId === item.id;
    return (
      <div key={item.id} className="rounded-xl border border-black/5 bg-white/80 px-3 py-3 text-left text-zinc-800 transition-colors hover:border-black/10 hover:bg-white">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
          {item.aiScore != null && <span className="rounded-full bg-zinc-100 px-2 py-0.5">AI {item.aiScore}</span>}
          {item.translationStatus && <span className="rounded-full bg-zinc-100 px-2 py-0.5">{item.translationStatus}</span>}
          <span>{item.sourceName || '未知来源'}</span>
          <span>{item.category || '未分类'}</span>
        </div>
        <div className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-zinc-900">{item.title}</div>
        <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-600">{item.detail || '未记录具体原因'}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleRepairExcludedCandidate(item)}
            disabled={repairing || !action.canRun}
            title={action.hint}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
          >
            <RefreshCw size={12} className={repairing ? 'animate-spin' : ''} />
            {repairing ? '修复中' : action.label}
          </button>
          <Link
            to={`/feed/${item.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <Eye size={12} />
            Feed 详情
          </Link>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <ArrowUpRight size={12} />
              原文
            </a>
          )}
        </div>
        <div className="mt-2 text-[11px] leading-4 text-zinc-500">{action.hint}</div>
      </div>
    );
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
            <div className="flex flex-wrap items-center gap-2">
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
                type="button"
                onClick={handleJumpToLatestReport}
                disabled={!selectedInsight}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                <FileText size={14} />
                查看最新日报
              </button>
              <div className="inline-flex overflow-hidden rounded-xl border border-zinc-200 bg-white p-0.5 text-sm">
                {(['fast', 'full'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setGenerationMode(mode)}
                    title={GENERATION_MODE_DESCRIPTIONS[mode]}
                    className={`px-3 py-1.5 transition-colors ${
                      generationMode === mode
                        ? 'rounded-lg bg-zinc-900 text-white'
                        : 'text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    {GENERATION_MODE_LABELS[mode]}
                  </button>
                ))}
              </div>
              <button
                onClick={() => void handleGenerate()}
                disabled={generating || repairGenerating}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                <Sparkles size={14} className={generating ? 'animate-pulse' : ''} />
                {generating ? '生成中...' : `${GENERATION_MODE_LABELS[generationMode]}生成日报`}
              </button>
              <button
                onClick={() => void handleRepairAndGenerate()}
                disabled={generating || repairGenerating}
                className="inline-flex items-center gap-1.5 rounded-xl border border-teal-700 bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800 disabled:opacity-50"
              >
                <RefreshCw size={14} className={repairGenerating ? 'animate-spin' : ''} />
                {repairGenerating ? '修复生成中...' : `修复后${GENERATION_MODE_LABELS[generationMode]}生成`}
              </button>
              <div className="basis-full text-xs leading-5 text-zinc-500 xl:basis-auto xl:max-w-xs">
                {GENERATION_MODE_DESCRIPTIONS[generationMode]}
              </div>
            </div>
          </div>
          {generationNoticeMessage && (
            <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${NOTICE_CLASS_NAMES[generationNoticeTone]}`}>
              {generationNoticeMessage}
            </div>
          )}
        </div>

        {notice && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        )}
        {renderRepairResultPanel()}

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
            {workflowNoticeMessage && (
              <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${NOTICE_CLASS_NAMES[workflowNoticeTone]}`}>
                {workflowNoticeMessage}
              </div>
            )}

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
                          ['低置信兜底', workflowPreview.funnel.fallbackScoredCandidates ?? 0],
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
                    {(workflowPreview.excludedSummary?.byReason.flatMap((group) => group.samples) || workflowPreview.excluded).length > 0 ? (
                      (workflowPreview.excludedSummary?.byReason.flatMap((group) => group.samples) || workflowPreview.excluded)
                        .slice(0, 6)
                        .map((item) => renderExcludedCandidateCard(item))
                    ) : (
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

          <section id="daily-report-section" className="scroll-mt-4 rounded-[28px] border border-zinc-200 bg-white p-5 shadow-[0_16px_48px_-40px_rgba(15,23,42,0.35)]">
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
                {selectedInsight?.payload?.snapshot && (
                  <div className="mb-4 rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-xs text-zinc-600">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2">
                        模式
                        <div className="mt-1 font-semibold text-zinc-900">
                          {(() => {
                            const mode = getReportGenerationMode(selectedInsight);
                            return mode ? GENERATION_MODE_LABELS[mode] : '未知';
                          })()}
                        </div>
                      </div>
                      <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2">
                        状态
                        <div className="mt-1 font-semibold text-zinc-900">
                          {REPORT_STATUS_LABELS[selectedInsight.payload.snapshot.selectionMode || ''] || selectedInsight.payload.snapshot.selectionMode || '未知'}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
                      {buildDailyReportSnapshotFunnelCards(selectedInsight.payload.snapshot, selectedInsight.itemCount ?? 0).map((card) => (
                        <div key={card.key} title={card.description} className={`rounded-xl border px-3 py-2 ${REPORT_FUNNEL_CARD_TONES[card.tone]}`}>
                          <div className="text-[11px] opacity-75">{card.label}</div>
                          <div className="mt-1 text-lg font-semibold">{card.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2 leading-5 text-zinc-500">
                      日报详情口径来自本次生成快照；候选处理可采样，主流程可见按全天审计集统计。
                    </div>
                  </div>
                )}
                {getReportModuleStatuses(selectedInsight).length > 0 && (
                  <div className="mb-4 flex flex-wrap gap-2 text-xs">
                    {getReportModuleStatuses(selectedInsight).map((item) => {
                      const meta = item.meta!;
                      const label = moduleStatusLabel(meta);
                      const tone = moduleStatusTone(meta);
                      return (
                        <span key={item.key} title={meta.repairReason || meta.error || meta.sceneType} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${tone}`}>
                          <span className="font-medium">{item.label}</span>
                          <span>{label}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
                {selectedInsight?.payload && (
                  <div className="mb-4 rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-xs leading-5 text-zinc-600">
                    {(() => {
                      const mode = getReportGenerationMode(selectedInsight);
                      if (mode === 'fast') {
                        return '当前日报为快速模式：只等待最终日报，清洗/决策/研究/阅读模块为非阻塞链路；需要深加工复盘时可切换“完整”后重新生成。';
                      }
                      if (mode === 'full') {
                        return '当前日报为完整模式：已运行多代理链路，适合复盘候选、研究脉络和阅读路线。';
                      }
                      return '当前日报缺少生成模式元数据；建议重新生成一次以补齐链路说明。';
                    })()}
                  </div>
                )}
                {getReportExclusionSummary(selectedInsight).length > 0 && (
                  <div className="mb-4 rounded-2xl border border-zinc-200 bg-white p-4">
                    <div className="text-sm font-semibold text-zinc-900">未入报解释</div>
                    <div className="mt-1 text-xs leading-5 text-zinc-600">
                      这些条目没有进入最终日报；这里按原因保留计数和样例，用来判断是噪声、中文化问题，还是筛选门槛问题。
                    </div>
                    <div className="mt-3 grid gap-3">
                      {getReportExclusionSummary(selectedInsight).map((group) => {
                        const meta = EXCLUDED_REASON_META[group.reason] || {
                          label: group.reason,
                          description: '系统记录的其他未入报原因。',
                          tone: 'border-zinc-200 bg-zinc-50 text-zinc-800',
                        };
                        const groupPlan = buildExcludedCandidateRepairPlan(group.samples, 10);
                        const repairingGroup = repairingExcludedGroup === group.reason;
                        return (
                          <section key={group.reason} className={`rounded-2xl border p-3 ${meta.tone}`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-sm font-semibold">{meta.label}</div>
                                <div className="mt-1 text-xs leading-5 opacity-80">{meta.description}</div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {groupPlan.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => void handleRepairExcludedGroup(group.reason, group.samples)}
                                    disabled={Boolean(repairingExcludedGroup)}
                                    title={`按每条诊断选择修复阶段，最多处理 ${groupPlan.length} 条样例。`}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-zinc-900 bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
                                  >
                                    <RefreshCw size={12} className={repairingGroup ? 'animate-spin' : ''} />
                                    {repairingGroup ? '本组修复中' : `修复本组样例 ${groupPlan.length}`}
                                  </button>
                                )}
                                <div className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold">{group.count} 条</div>
                              </div>
                            </div>
                            {group.samples.length > 0 && (
                              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                                {group.samples.slice(0, 4).map((item) => renderExcludedCandidateCard(item))}
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  </div>
                )}
                {getReportTopItems(selectedInsight).length > 0 && (
                  <div className="mb-4 rounded-2xl border border-zinc-200 bg-white p-4">
                    <div className="text-sm font-semibold text-zinc-900">TOP 入报理由</div>
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      {getReportTopItems(selectedInsight).map((item, index) => (
                        <a
                          key={item.id}
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-2xl border border-zinc-100 bg-zinc-50/70 px-3 py-3 text-left transition-colors hover:border-zinc-200 hover:bg-white"
                        >
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                            <span className="rounded-full bg-white px-2 py-0.5 text-zinc-700">#{index + 1}</span>
                            {item.aiScore != null && <span className="rounded-full bg-white px-2 py-0.5">AI {item.aiScore}</span>}
                            {item.selectionMode && <span className="rounded-full bg-white px-2 py-0.5">{REPORT_STATUS_LABELS[item.selectionMode] || item.selectionMode}</span>}
                            <span>{item.sourceName}</span>
                          </div>
                          <div className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-zinc-900">
                            {item.displayTitle || item.title}
                          </div>
                          <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-600">
                            {item.selectionReason || item.reportSummary || item.aiSummary || '按日报规则入选。'}
                          </p>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                <MarkdownContent content={extractReportMarkdown(selectedInsight)} empty="还没有日报内容。" className="min-w-0" mode="markdown" variant="report" />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
