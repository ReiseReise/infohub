import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarDays,
  Clock3,
  Database,
  Eye,
  FileCheck2,
  FileText,
  Layers3,
  Loader2,
  RotateCcw,
  SearchCheck,
  Sparkles,
} from 'lucide-react';
import {
  api,
  type DailyGenerationJob,
  type DailyReportWorkflowConfig,
  type DailyWorkbenchPayload,
} from '../lib/api';
import { dailyAgentCopy as agentCopy } from '../features/daily/agent-copy';
import { sanitizeReaderHighlights } from '../features/daily/reader-copy';
import {
  DailyButtonLink as ButtonLink,
  DailyGenerationProgressPanel,
  DailyKpiGroup as KpiGroup,
  DailyMiniMetric as MiniMetric,
  DailyPageShell as PageShell,
  DailyProductNav,
  DailyReportTopItemRow as ReportTopItemRow,
  DailyStateBlock as StateBlock,
  DailyWorkflowStepCard as WorkflowStepCard,
  dailyWorkflowSteps as workflowSteps,
  formatDailyNumber as formatNumber,
  formatDailyTime as formatTime,
  type DailyFunnel as Funnel,
} from '../features/daily/ui';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { PrimaryCard, DataCard } from '../components/ui/cards';


function formatPercent(value?: number | null) {
  if (!Number.isFinite(value || 0)) return '0%';
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatCost(value?: number | null) {
  if (!value) return '未估算';
  return `$${Number(value).toFixed(4)}`;
}

function isDailyJobRunning(job?: DailyGenerationJob | null) {
  if (!job) return false;
  return ['active', 'waiting', 'delayed', 'prioritized'].includes(job.state);
}

function isDailyGenerationJob(value: unknown): value is DailyGenerationJob {
  return Boolean(value && typeof value === 'object' && 'jobId' in value && 'progress' in value);
}

function isDailyJobTerminal(job?: DailyGenerationJob | null) {
  if (!job) return false;
  return ['completed', 'failed'].includes(job.state);
}

function usageStatusLabel(value: string) {
  const labels: Record<string, string> = {
    success: '成功',
    error: '失败',
    skipped: '跳过',
    unknown: '未标注',
  };
  return labels[value] || value;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getFunnelValue(funnel: Funnel | undefined, key: keyof Funnel) {
  return Number(funnel?.[key] || 0);
}

function candidatePoolSize(funnel?: Funnel) {
  return (
    getFunnelValue(funnel, 'scoredCandidates')
    + getFunnelValue(funnel, 'reviewCandidates')
    + getFunnelValue(funnel, 'latestFallbackCandidates')
  );
}

function reportRate(funnel?: Funnel) {
  const denominator = Math.max(1, getFunnelValue(funnel, 'mainVisible'));
  return getFunnelValue(funnel, 'finalCandidates') / denominator;
}


const agentStatusCopy: Record<string, { label: string; className: string }> = {
  completed: { label: '已完成', className: 'bg-emerald-100 text-emerald-700' },
  fallback: { label: '兜底完成', className: 'bg-amber-100 text-amber-700' },
  error: { label: '运行异常', className: 'bg-rose-100 text-rose-700' },
  not_run: { label: '未运行', className: 'bg-zinc-100 text-zinc-500' },
  pending: { label: '待运行', className: 'bg-blue-50 text-blue-700' },
};

const statusSourceCopy: Record<string, string> = {
  report_payload: '来自当日报告快照',
  ai_usage_target: '来自当日模型调用记录',
  no_record: '无当日运行记录',
};

function getAgentStatus(status?: string | null) {
  return agentStatusCopy[status || ''] || { label: status || '未知', className: 'bg-zinc-100 text-zinc-500' };
}

function getObjectString(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return '';
}

export function DailyWorkbench() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sourceId = searchParams.get('sourceId') || '';
  const [date, setDate] = useState(searchParams.get('date') || todayKey());
  const [data, setData] = useState<DailyWorkbenchPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [quickGenerating, setQuickGenerating] = useState(false);
  const [rerunningAgent, setRerunningAgent] = useState<string | null>(null);
  const [generationJob, setGenerationJob] = useState<DailyGenerationJob | null>(null);
  const [updatingSchedule, setUpdatingSchedule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateDate = (nextDate: string) => {
    const safeDate = nextDate || todayKey();
    setDate(safeDate);
    const next = new URLSearchParams(searchParams);
    next.set('date', safeDate);
    if (sourceId) next.set('sourceId', sourceId);
    setSearchParams(next, { replace: true });
  };

  const load = useCallback(async (targetDate = date) => {
    setError(null);
    try {
      const resp = await api.daily.workbench({
        date: targetDate,
        ...(sourceId ? { sourceId } : {}),
      });
      setData(resp.data);
      if (resp.data.activeGenerationJob) {
        setGenerationJob(resp.data.activeGenerationJob);
      }
    } catch (err) {
      setError((err as Error).message || '日报工作台加载失败');
    } finally {
      setLoading(false);
    }
  }, [date, sourceId]);

  useEffect(() => {
    const urlDate = searchParams.get('date') || todayKey();
    setDate((current) => current === urlDate ? current : urlDate);
  }, [searchParams]);

  useEffect(() => { void load(date); }, [date, load]);

  useEffect(() => {
    setGenerationJob(null);
  }, [date]);

  const generationJobId = generationJob?.jobId;
  const generationJobState = generationJob?.state;

  useEffect(() => {
    if (!generationJobId || generationJobState === 'completed' || generationJobState === 'failed') return;
    let cancelled = false;
    const poll = async () => {
      try {
        const resp = await api.daily.generationJob(generationJobId);
        if (cancelled) return;
        setGenerationJob(resp.data);
        if (isDailyJobTerminal(resp.data)) {
          await load(resp.data.date || date);
          if (resp.data.state === 'failed') {
            setError(resp.data.failedReason || resp.data.progress?.message || '日报生成失败');
          }
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message || '日报生成状态查询失败');
      }
    };
    const timer = window.setInterval(() => { void poll(); }, 1600);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [date, generationJobId, generationJobState, load]);

  const generate = async (mode: 'full' | 'fast' = 'full') => {
    if (mode === 'fast') setQuickGenerating(true);
    else setGenerating(true);
    setError(null);
    try {
      const resp = await api.daily.generate({
        date,
        mode,
        preset: 'full',
        async: true,
        ...(sourceId ? { sourceId: Number(sourceId) } : {}),
      });
      if (isDailyGenerationJob(resp.data)) {
        setGenerationJob(resp.data);
      }
      await load(date);
    } catch (err) {
      setError((err as Error).message || '生成日报失败');
    } finally {
      if (mode === 'fast') setQuickGenerating(false);
      else setGenerating(false);
    }
  };

  const rerunAgent = async (scene: string) => {
    setRerunningAgent(scene);
    setGenerating(true);
    setError(null);
    try {
      await api.daily.rerunAgent(scene, { date, ...(sourceId ? { sourceId: Number(sourceId) } : {}) });
      await load(date);
    } catch (err) {
      setError((err as Error).message || '重跑 Agent 失败');
    } finally {
      setRerunningAgent(null);
      setGenerating(false);
    }
  };

  const toggleDailySchedule = async () => {
    if (!data || sourceId) return;
    const nextEnabled = !data.scheduleContext?.dailyReportEnabled;
    setUpdatingSchedule(true);
    setError(null);
    try {
      await api.settings.updateDaily({ dailyReportEnabled: nextEnabled });
      await load(date);
    } catch (err) {
      setError((err as Error).message || '自动日报设置保存失败');
    } finally {
      setUpdatingSchedule(false);
    }
  };

  const funnel = data?.preview?.funnel;
  const workflow = data?.workflow;
  const exceptions = getFunnelValue(funnel, 'latestFallbackCandidates') + getFunnelValue(funnel, 'translationFailed') + getFunnelValue(funnel, 'pendingItems');
  const displayGenerationJob = generationJob || data?.activeGenerationJob || null;
  const generationRunning = isDailyJobRunning(displayGenerationJob);
  const dailyMonitor = data?.dailyUsage || data?.monitor;
  const systemMonitor = data?.systemUsage24h;
  const scopedDailyPath = (path: string, targetDate = date) => {
    const params = new URLSearchParams();
    if (targetDate) params.set('date', targetDate);
    if (sourceId) params.set('sourceId', sourceId);
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  };

  return (
    <PageShell
      title="日报智能工作台"
      eyebrow="Daily V2 Workbench"
      description="运行、观测和配置日报流水线；正式阅读与系统诊断保持分离。"
      actions={(
        <>
          <label className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
            <CalendarDays size={14} />
            <input
              type="date"
              aria-label="日报日期"
              value={date}
              onChange={(event) => updateDate(event.target.value || todayKey())}
              className="bg-transparent outline-none"
            />
          </label>
          {!sourceId && (
            <button
              type="button"
              onClick={() => void toggleDailySchedule()}
              disabled={updatingSchedule || !data}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium disabled:opacity-50 ${
                data?.scheduleContext?.dailyReportEnabled
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
              }`}
              title="控制当前账号是否每天 06:00 自动生成日报"
            >
              {updatingSchedule ? <Loader2 size={14} className="animate-spin" /> : <Clock3 size={14} />}
              自动日报{data?.scheduleContext?.dailyReportEnabled ? '已开' : '已关'}
            </button>
          )}
          <button
            onClick={() => void generate('fast')}
            disabled={quickGenerating || generating || generationRunning}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            title="快速生成会跳过部分深度 Agent，仅适合临时预览。"
          >
            {quickGenerating ? <Loader2 size={14} className="animate-spin" /> : <Clock3 size={14} />} 快速预览
          </button>
          <button
            onClick={() => void generate('full')}
            disabled={generating || quickGenerating || generationRunning}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-50"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} 生成高质量日报
          </button>
        </>
      )}
    >
      <DailyProductNav date={date} sourceId={sourceId} />
      <StateBlock loading={loading} error={error}>
        {data && (
          <Tabs defaultValue="home" className="w-full">
            <TabsList className="mb-5">
              <TabsTrigger value="home">首页</TabsTrigger>
              <TabsTrigger value="diagnostics">诊断</TabsTrigger>
              <TabsTrigger value="workflow">工作流</TabsTrigger>
            </TabsList>

            {/* ═══ 首页 Tab：状态卡片 + 生成操作 + 高质量预览 ═══ */}
            <TabsContent value="home">
              <div className="space-y-5">
                {data.reportScope?.sourceId ? (
                  <section className="rounded-2xl border border-teal-100 bg-teal-50/70 px-5 py-4 text-sm leading-6 text-teal-900">
                    <div className="font-semibold">当前范围：{data.reportScope.label}</div>
                    <div className="mt-1 text-xs text-teal-700">候选预览、生成任务和正式日报只针对这个来源，不再混入全局日报。</div>
                  </section>
                ) : null}

                {/* 今日状态卡片 */}
                <section className="grid gap-3 sm:grid-cols-3">
                  <DataCard
                    label="候选总量"
                    value={formatNumber(candidatePoolSize(funnel))}
                    trend={`高分 ${formatNumber(funnel?.scoredCandidates)}`}
                    trendDirection="neutral"
                  >
                    <span className="text-xs text-zinc-500">今日新增 {formatNumber(funnel?.todayNew)} · 主流程可见 {formatNumber(funnel?.mainVisible)}</span>
                  </DataCard>
                  <DataCard
                    label="预计入报率"
                    value={formatPercent(reportRate(funnel))}
                    trend={`预计 ${formatNumber(funnel?.finalCandidates)} 条`}
                    trendDirection={getFunnelValue(funnel, 'finalCandidates') > 0 ? 'up' : 'neutral'}
                  >
                    <span className="text-xs text-zinc-500">按当前候选池推算 · 复核 {formatNumber(funnel?.reviewCandidates)} · 最低分 {data.workflow?.minScore ?? '-'}</span>
                  </DataCard>
                  <DataCard
                    label="生成状态"
                    value={
                      data.reportState?.status === 'missing' ? '未生成'
                        : data.reportState?.status === 'full' ? '已完成'
                          : data.reportState?.status === 'stale' ? '需刷新'
                            : data.reportState?.status === 'degraded' ? '降级'
                              : '未知'
                    }
                    trend={data.report.generatedAt ? formatTime(data.report.generatedAt) : undefined}
                    trendDirection={data.reportState?.status === 'full' ? 'up' : data.reportState?.status === 'missing' ? 'down' : 'neutral'}
                  >
                    <span className="text-xs text-zinc-500">已入报 {formatNumber(data.report.itemCount)} 条（报告实际保存）</span>
                  </DataCard>
                </section>

                {/* 生成操作区 */}
                <DailyGenerationProgressPanel
                  job={displayGenerationJob}
                  date={date}
                  onRegenerate={() => void generate(displayGenerationJob?.mode === 'fast' ? 'fast' : 'full')}
                />
                <section className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-600 md:flex-row md:items-center md:justify-between">
                  <div>
                    <span className="font-semibold text-zinc-900">运行计划：</span>
                    {data.scheduleContext?.label || '尚未读取自动日报设置。'}
                  </div>
                  <div className="shrink-0 text-zinc-500">
                    下次运行 {formatTime(data.scheduleContext?.nextScheduledAt)}
                    {displayGenerationJob?.trigger ? ` · 当前任务：${displayGenerationJob.trigger === 'startup_catchup' ? '启动补报' : displayGenerationJob.trigger === 'cron' ? '定时生成' : '手动生成'}` : ''}
                  </div>
                </section>

                {/* 高质量预览 */}
                <PrimaryCard className="p-0 overflow-hidden">
                  <div className="px-6 py-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-base font-semibold text-zinc-950">
                        <FileText size={18} />
                        高质量日报预览
                      </div>
                      <ButtonLink to={scopedDailyPath('/daily/reports/latest')} primary>正式阅读 <ArrowRight size={14} /></ButtonLink>
                    </div>
                  </div>
                  <div className="border-t border-zinc-100 bg-[#fffdf8] px-6 py-5">
                    <div className="text-sm font-semibold text-zinc-950">今日核心洞察</div>
                    <div className="mt-3 space-y-2 text-sm leading-6 text-zinc-700">
                      {(() => {
                        const cleaned = sanitizeReaderHighlights(data.report.highlights).slice(0, 5);
                        if (!cleaned.length) {
                          return <p className="text-zinc-500">今天还没有可展示的洞察。先运行日报，或到素材池确认是否有可用内容。</p>;
                        }
                        return cleaned.map((line, index) => <p key={`${line}-${index}`}>{line}</p>);
                      })()}
                    </div>
                  </div>
                  {data.report.topItems?.length ? (
                    <div className="border-t border-zinc-100 px-6 py-5">
                      <div className="text-sm font-semibold text-zinc-950">重点条目 TOP 5</div>
                      <div className="mt-3 space-y-2">
                        {data.report.topItems.slice(0, 5).map((item, index) => (
                          <ReportTopItemRow key={`${getObjectString(item, ['id', 'title'])}-${index}`} item={item} index={index} />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </PrimaryCard>

                {/* 下一步建议 */}
                <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
                  <div className="text-sm font-semibold text-zinc-950">下一步建议</div>
                  <div className="mt-3 space-y-2 text-xs leading-5 text-zinc-500">
                    {getFunnelValue(funnel, 'finalCandidates') > 0 ? (
                      <>
                        <p>日报候选已形成，可以直接进入正式阅读页检查结论、建议和附录条目。</p>
                        {exceptions > 0 ? <p>仍有 {formatNumber(exceptions)} 个异常或兜底信号，建议在候选池复核。</p> : null}
                      </>
                    ) : (
                      <>
                        <p>当前没有最终入报条目。优先检查工作流范围、最低分、中文化失败和泛商业噪声。</p>
                        <p>如果今日内容少，可以先放宽分数或查看候选池中的未入报解释。</p>
                      </>
                    )}
                  </div>
                </section>
              </div>
            </TabsContent>

            {/* ═══ 诊断 Tab：Agent矩阵 + 运行监控 + 处理债务 ═══ */}
            <TabsContent value="diagnostics">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                <main className="min-w-0 space-y-5">
                  {/* 完整KPI运行漏斗 */}
                  <section className="grid gap-3 lg:grid-cols-4">
                    <KpiGroup
                      title="今日收集"
                      tone="blue"
                      icon={<Database size={16} />}
                      sourceLine={data.dataFreshness?.preview?.label || '来自候选预览，非正式日报'}
                      metrics={[
                        { label: '今日新增', value: formatNumber(funnel?.todayNew) },
                        { label: '主流程可见', value: formatNumber(funnel?.mainVisible), hint: `范围命中 ${formatNumber(funnel?.scopeMatched)} 条` },
                      ]}
                    />
                    <KpiGroup
                      title="候选预览"
                      tone="teal"
                      icon={<SearchCheck size={16} />}
                      sourceLine="当前工作流筛出的候选池"
                      metrics={[
                        { label: '候选总量', value: formatNumber(candidatePoolSize(funnel)) },
                        { label: '高分候选', value: formatNumber(funnel?.scoredCandidates), hint: `复核 ${formatNumber(funnel?.reviewCandidates)} 条` },
                      ]}
                    />
                    <KpiGroup
                      title="已生成日报"
                      tone="violet"
                      icon={<FileCheck2 size={16} />}
                      sourceLine={data.dataFreshness?.report?.label || '来自已保存日报'}
                      metrics={[
                        {
                          label: '状态',
                          value: data.reportState?.status === 'missing'
                            ? '未生成'
                            : data.reportState?.status === 'full'
                              ? '已完成'
                              : data.reportState?.status === 'stale'
                                ? '需刷新'
                                : data.reportState?.status === 'degraded'
                                  ? '降级'
                                  : '未知',
                        },
                        { label: '保存条目', value: formatNumber(data.report.itemCount), hint: data.report.generatedAt ? formatTime(data.report.generatedAt) : undefined },
                      ]}
                      footer={data.reportState?.reason || `候选预计最终入报 ${formatNumber(funnel?.finalCandidates)} 条 · 入报率 ${formatPercent(reportRate(funnel))}`}
                    />
                    <KpiGroup
                      title="处理债务"
                      tone={exceptions > 0 ? 'amber' : 'zinc'}
                      icon={<AlertTriangle size={16} />}
                      sourceLine="需要先处理，否则日报质量会受影响"
                      metrics={[
                        { label: '需关注', value: formatNumber(exceptions) },
                        { label: '翻译失败', value: formatNumber(funnel?.translationFailed) },
                      ]}
                      footer={`最新兜底 ${formatNumber(funnel?.latestFallbackCandidates)} 条 · 待处理 ${formatNumber(funnel?.pendingItems)} · 摘要/评分问题请去候选池复核`}
                    />
                  </section>

                  {/* Agent 矩阵 */}
                  <section className="border-y border-zinc-200 bg-white px-5 py-5">
                    <div className="flex items-center gap-2 text-base font-semibold text-zinc-950">
                      <Bot size={18} />
                      子智能体分析矩阵
                    </div>
                    <p className="mt-1 text-sm leading-6 text-zinc-500">这里展示参与日报的 Agent 是否真正运行、消耗多少，以及它负责产出什么。</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {data.agentMatrix.map((agent) => {
                        const copy = agentCopy[agent.key] || { name: agent.label, role: agent.signal || '按需运行', input: '候选内容', output: '分析结果' };
                        const status = getAgentStatus(agent.status);
                        return (
                          <article key={agent.key} className="border-t border-zinc-200 bg-white px-1 py-4 first:border-t-0">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-semibold text-zinc-950">{copy.name}</div>
                                <div className="mt-1 text-xs leading-5 text-zinc-500">{copy.role}</div>
                              </div>
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${status.className}`}>
                                {status.label}
                              </span>
                            </div>
                            <div className="mt-3 border-l-2 border-zinc-200 pl-3 text-xs leading-5 text-zinc-500">
                              <div className="font-medium text-zinc-700">{agent.signal || '暂无当日输出信号'}</div>
                              <div className="mt-1">{statusSourceCopy[agent.statusSource || ''] || '来源未标注'}</div>
                              <div className="mt-1">{agent.provider || '未记录供应商'} / {agent.model || '未记录模型'}</div>
                              {agent.error ? <div className="mt-1 text-rose-600">错误：{agent.error}</div> : null}
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                              <div className="border-t border-zinc-100 pt-2">
                                <div className="text-zinc-400">输入</div>
                                <div className="mt-0.5 text-zinc-700">{copy.input}</div>
                              </div>
                              <div className="border-t border-zinc-100 pt-2">
                                <div className="text-zinc-400">输出</div>
                                <div className="mt-0.5 text-zinc-700">{copy.output}</div>
                              </div>
                            </div>
                            <div className="mt-3 text-[11px] text-zinc-400">
                              {formatNumber(agent.calls)} 次调用 · {formatNumber(agent.tokens)} tokens · {formatCost(agent.cost)}
                              {agent.promptTemplateId ? ` · ${agent.promptTemplateId}` : ''}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <ButtonLink to={`/daily/workflows?agent=${encodeURIComponent(agent.key)}`}>
                                <Eye size={13} /> 查看输出 / 配置
                              </ButtonLink>
                              <button
                                onClick={() => void rerunAgent(agent.key)}
                                disabled={Boolean(rerunningAgent) || generating}
                                className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                              >
                                {rerunningAgent === agent.key ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                                重跑该 Agent
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                </main>

                {/* 侧边栏：运行监控 */}
                <aside className="space-y-4 xl:sticky xl:top-5 xl:self-start">
                  <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
                    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950"><Activity size={16} /> 日报运行监控</div>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{data.dataFreshness?.dailyUsage?.label || '仅统计当前日期日报 Agent'}</p>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <MiniMetric label="调用次数" value={formatNumber(dailyMonitor?.calls)} />
                      <MiniMetric label="成本" value={formatCost(dailyMonitor?.estimatedCost)} />
                      <MiniMetric label="总 tokens" value={formatNumber(dailyMonitor?.totalTokens)} />
                      <MiniMetric label="错误热点" value={formatNumber(dailyMonitor?.hotspotErrors?.length)} />
                    </div>
                    <div className="mt-4 space-y-2 text-xs text-zinc-500">
                      {(dailyMonitor?.byStatus || []).map((status) => (
                        <div key={status.key} className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2">
                          <span>{usageStatusLabel(status.key)}</span>
                          <span className="font-medium text-zinc-900">{formatNumber(status.count)}</span>
                        </div>
                      ))}
                    </div>
                    {systemMonitor ? (
                      <>
                        <div className="mt-4 rounded-xl bg-zinc-50 px-3 py-3 text-xs leading-5 text-zinc-500">
                          全系统 24h：{formatNumber(systemMonitor.calls)} 次调用 · {formatNumber(systemMonitor.totalTokens)} tokens · {formatCost(systemMonitor.estimatedCost)}
                        </div>
                        <Link to="/ai-usage" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:text-teal-800">
                          查看模型用量 <ArrowRight size={14} />
                        </Link>
                      </>
                    ) : null}
                  </div>
                </aside>
              </div>
            </TabsContent>

            {/* ═══ 工作流 Tab ═══ */}
            <TabsContent value="workflow">
              <section className="space-y-5">
                <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-base font-semibold text-zinc-950">
                        <Layers3 size={18} />
                        个性化日报工作流
                      </div>
                      <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-500">
                        当前策略：最低分 {workflow?.minScore ?? '-'}，入报 {workflow?.topN ?? '-'} 条，单源上限 {workflow?.perSourceLimit ?? '-'}。这条链路决定今天哪些内容能进入正式日报。
                      </p>
                    </div>
                    <ButtonLink to="/daily/workflows">查看 / 调整配置 <ArrowRight size={14} /></ButtonLink>
                  </div>
                  <div className="mt-4 grid gap-px overflow-hidden border border-zinc-200 bg-zinc-200 md:grid-cols-2 xl:grid-cols-5">
                    {workflowSteps.map((step, index) => (
                      <WorkflowStepCard
                        key={step.key}
                        step={step}
                        index={index}
                        enabled={Boolean(workflow?.enabledModules?.[step.key as keyof DailyReportWorkflowConfig['enabledModules']])}
                      />
                    ))}
                  </div>
                </div>
              </section>
            </TabsContent>
          </Tabs>
        )}
      </StateBlock>
    </PageShell>
  );
}
