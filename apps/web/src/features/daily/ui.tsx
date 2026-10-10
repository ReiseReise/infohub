import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  ListChecks,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import type { DailyGenerationJob, DailyReportWorkflowPreview } from '../../lib/api';

export type DailyTone = 'blue' | 'teal' | 'amber' | 'rose' | 'violet' | 'zinc';
export type DailyFunnel = DailyReportWorkflowPreview['funnel'];
type Candidate = DailyReportWorkflowPreview['candidates'][number];

export const dailyToneClasses: Record<DailyTone, { card: string; icon: string; text: string; soft: string }> = {
  blue: {
    card: 'border-blue-100 bg-blue-50/60',
    icon: 'bg-blue-600 text-white',
    text: 'text-blue-700',
    soft: 'bg-blue-50 text-blue-700',
  },
  teal: {
    card: 'border-teal-100 bg-teal-50/60',
    icon: 'bg-teal-600 text-white',
    text: 'text-teal-700',
    soft: 'bg-teal-50 text-teal-700',
  },
  amber: {
    card: 'border-amber-100 bg-amber-50/70',
    icon: 'bg-amber-500 text-white',
    text: 'text-amber-700',
    soft: 'bg-amber-50 text-amber-700',
  },
  rose: {
    card: 'border-rose-100 bg-rose-50/70',
    icon: 'bg-rose-500 text-white',
    text: 'text-rose-700',
    soft: 'bg-rose-50 text-rose-700',
  },
  violet: {
    card: 'border-violet-100 bg-violet-50/60',
    icon: 'bg-violet-600 text-white',
    text: 'text-violet-700',
    soft: 'bg-violet-50 text-violet-700',
  },
  zinc: {
    card: 'border-zinc-200 bg-white',
    icon: 'bg-zinc-900 text-white',
    text: 'text-zinc-700',
    soft: 'bg-zinc-100 text-zinc-600',
  },
};

export const dailyWorkflowSteps = [
  {
    key: 'cleaning',
    title: '内容入口',
    subtitle: '去重、去噪、来源标准化',
    detail: '主流程可见、今日新增、过滤债务在这里观察。',
    tone: 'blue' as DailyTone,
  },
  {
    key: 'decision',
    title: '入报筛选',
    subtitle: '评分、范围、单源上限',
    detail: '决定哪些条目进入候选池，哪些只保留诊断。',
    tone: 'teal' as DailyTone,
  },
  {
    key: 'research',
    title: '中文化与标准化',
    subtitle: '翻译、术语、摘要可读性',
    detail: '英文内容必须中文可读，失败不假装入报。',
    tone: 'violet' as DailyTone,
  },
  {
    key: 'reading',
    title: '子智能体分析',
    subtitle: '信息、数据、运行、洞察',
    detail: '把候选拆给不同 Agent 分析，再融合结论。',
    tone: 'amber' as DailyTone,
  },
  {
    key: 'final',
    title: '高质量日报',
    subtitle: '正式报告、建议、附录',
    detail: '最终输出给阅读者，不混入调试噪音。',
    tone: 'rose' as DailyTone,
  },
];

const funnelLabels: Record<string, string> = {
  todayNew: '今日新增',
  mainVisible: '主流程可见',
  scopeMatched: '范围命中',
  scoredCandidates: '高分候选',
  reviewCandidates: '低分复核',
  fallbackScoredCandidates: '低置信兜底',
  softFilteredRecovered: '软过滤恢复',
  scoreFailedCandidates: '评分失败',
  latestFallbackCandidates: '最新兜底',
  translationPending: '翻译待处理',
  translationFailed: '翻译失败',
  finalCandidates: '最终入报',
  filteredItems: '已过滤',
  filteredBucketItems: '过滤池',
  reviewItems: '质检复核',
  pendingItems: '处理待完成',
};

const readableStatusCopy: Record<string, string> = {
  pending: '待处理',
  success: '已完成',
  completed: '已完成',
  failed: '失败',
  error: '异常',
  translated: '已翻译',
  ready: '可用',
  skipped: '无需处理',
  native: '原文可读',
  cached: '已缓存',
  processing: '处理中',
  retrying: '重试中',
  summary_failed: '摘要失败',
  translation_failed: '翻译失败',
  summary_must_be_chinese: '摘要需中文化',
  uncategorized: '未分类质量问题',
};

export function formatDailyNumber(value?: number | null) {
  return Number(value || 0).toLocaleString('zh-CN');
}

export function formatDailyTime(value?: string | null) {
  if (!value) return '暂无';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('zh-CN', { hour12: false });
}

export function readableDailyStatus(value?: string | null) {
  if (!value) return '';
  return readableStatusCopy[value] || value;
}

function getObjectNumber(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && Number.isFinite(Number(raw))) return Number(raw);
  }
  return null;
}

function getObjectString(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return '';
}

export function DailyPageShell({ title, eyebrow, description, actions, children, compact = false, hideHeader = false }: {
  title: string;
  eyebrow: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  compact?: boolean;
  hideHeader?: boolean;
}) {
  return (
    <div className={`min-h-screen overflow-x-hidden bg-[#f5f6f3] px-4 text-zinc-900 md:px-6 ${compact ? 'py-3' : 'py-5'}`}>
      <div className={`mx-auto flex w-full max-w-[1480px] flex-col 2xl:max-w-none ${compact ? 'gap-3' : 'gap-5'}`}>
        {!hideHeader ? (
          <header className={`flex flex-col gap-3 border-b border-zinc-300 lg:flex-row lg:items-end lg:justify-between ${compact ? 'pb-3' : 'pb-5'}`}>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase text-teal-700/80">{eyebrow}</div>
              <h1 className={`${compact ? 'mt-0.5 text-xl' : 'mt-1 text-2xl'} font-semibold text-zinc-950`}>{title}</h1>
              {description ? <p className={`${compact ? 'mt-1 text-xs leading-5' : 'mt-2 text-sm leading-6'} max-w-3xl text-zinc-500`}>{description}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
          </header>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export function DailyStateBlock({ loading, error, children }: { loading: boolean; error?: string | null; children: ReactNode }) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-16 text-center text-sm text-zinc-500">
        加载中...
      </div>
    );
  }
  if (error) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div>;
  }
  return <>{children}</>;
}

export function DailyButtonLink({ to, children, primary = false }: { to: string; children: ReactNode; primary?: boolean }) {
  return (
    <Link
      to={to}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
        primary
          ? 'border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100'
          : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
      }`}
    >
      {children}
    </Link>
  );
}

export function DailyProductNav({ date, sourceId }: { date?: string; sourceId?: string | number | null }) {
  const location = useLocation();
  const buildPath = (pathname: string) => {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (sourceId) params.set('sourceId', String(sourceId));
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  };
  const items = [
    { path: '/daily/reports/latest', label: '正式日报', shortLabel: '日报', icon: <FileText size={15} /> },
    { path: '/daily/workbench', label: '运行工作台', shortLabel: '运行', icon: <Activity size={15} /> },
    { path: '/daily/candidates', label: '候选与覆盖', shortLabel: '候选', icon: <ListChecks size={15} /> },
    { path: '/daily/workflows', label: '节点与配置', shortLabel: '配置', icon: <SlidersHorizontal size={15} /> },
  ];
  return (
    <nav aria-label="日报模块导航" className="flex min-h-12 items-center gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-2 sm:px-3">
      {items.map((item) => {
        const active = location.pathname === item.path;
        return (
          <Link
            key={item.path}
            to={buildPath(item.path)}
            className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 border-b-2 px-2 text-xs font-medium transition-colors sm:px-3 ${active ? 'border-zinc-950 text-zinc-950' : 'border-transparent text-zinc-500 hover:text-zinc-900'}`}
          >
            {item.icon}
            <span className="sm:hidden">{item.shortLabel}</span>
            <span className="hidden sm:inline">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function DailyKpiGroup({ title, icon, tone, metrics, footer, sourceLine }: {
  title: string;
  icon: ReactNode;
  tone: DailyTone;
  metrics: Array<{ label: string; value: string | number; hint?: string }>;
  footer?: string;
  sourceLine?: string;
}) {
  const palette = dailyToneClasses[tone];
  return (
    <section className={`rounded-2xl border px-4 py-4 ${palette.card}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-flex size-8 items-center justify-center rounded-xl ${palette.icon}`}>{icon}</span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-950">{title}</h2>
          {sourceLine ? <div className="mt-0.5 text-[11px] leading-4 text-zinc-500">{sourceLine}</div> : null}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {metrics.map((metric) => {
          const renderedValue = String(metric.value ?? '');
          const isStatusText = typeof metric.value === 'string' && renderedValue.length > 6;
          return (
            <div key={metric.label} className="min-w-0">
              <div className="text-xs text-zinc-500">{metric.label}</div>
              <div className={`mt-1 break-words font-semibold text-zinc-950 ${isStatusText ? 'text-sm leading-6' : 'text-2xl leading-8'}`}>{metric.value}</div>
              {metric.hint ? <div className={`mt-1 break-words text-xs leading-5 ${palette.text}`}>{metric.hint}</div> : null}
            </div>
          );
        })}
      </div>
      {footer ? <div className="mt-3 text-xs leading-5 text-zinc-500">{footer}</div> : null}
    </section>
  );
}

export function DailyGenerationProgressPanel({ job, date, onRegenerate }: {
  job?: DailyGenerationJob | null;
  date: string;
  onRegenerate: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!job) return null;
  const progress = job.progress || { label: job.label || '处理中', percent: job.percent || 0, message: job.message || '日报生成中。', stage: job.stage || 'queued' };
  const failed = job.state === 'failed';
  const completed = job.state === 'completed';
  const degraded = completed && job.result?.qualityStatus === 'degraded';
  const queuedAt = job.timestamp || null;
  const startedAt = job.processedOn || null;
  const elapsed = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : null;
  const queuedFor = !startedAt && queuedAt ? Math.max(0, Math.round((now - queuedAt) / 1000)) : null;
  return (
    <section className={`rounded-2xl border px-5 py-4 ${failed ? 'border-rose-200 bg-rose-50' : degraded ? 'border-amber-200 bg-amber-50/70' : completed ? 'border-emerald-200 bg-emerald-50/60' : 'border-teal-200 bg-teal-50/70'}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
            {failed || degraded ? <AlertTriangle size={16} /> : completed ? <CheckCircle2 size={16} /> : <Loader2 size={16} className="animate-spin" />}
            日报生成进度
            <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-zinc-500">{job.mode === 'fast' ? '快速预览' : '高质量日报'}</span>
            {degraded ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">降级完成</span> : null}
          </div>
          <div className="mt-2 text-sm leading-6 text-zinc-700">
            <span className="font-medium text-zinc-950">{progress.label}</span>
            <span className="mx-2 text-zinc-300">/</span>
            {progress.message}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-zinc-500">
            <span>任务：{job.jobId}</span>
            {queuedAt ? <span>排队：{formatDailyTime(new Date(queuedAt).toISOString())}</span> : null}
            {startedAt ? <span>开始：{formatDailyTime(new Date(startedAt).toISOString())}</span> : null}
            {elapsed != null && !completed ? <span>已运行约 {elapsed}s</span> : null}
            {queuedFor != null && !completed ? <span>已排队约 {queuedFor}s</span> : null}
            {job.finishedOn ? <span>结束：{formatDailyTime(new Date(job.finishedOn).toISOString())}</span> : null}
            {job.failedReason ? <span className="text-rose-700">失败原因：{job.failedReason}</span> : null}
            {degraded ? <span className="text-amber-800">未通过完整质量门禁，可查看日报中的质量说明。</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {completed ? <DailyButtonLink to={job.result?.reportUrl || `/daily/reports/latest?date=${encodeURIComponent(job.result?.date || date)}`} primary>查看日报 <ArrowRight size={14} /></DailyButtonLink> : null}
          {failed || completed ? (
            <button
              onClick={onRegenerate}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <RotateCcw size={13} /> 重新生成
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/70">
        <div
          className={`h-full transition-all ${failed ? 'bg-rose-500' : completed ? 'bg-emerald-500' : 'bg-teal-600'}`}
          style={{ width: `${Math.max(3, Math.min(100, Number(progress.percent || 0)))}%` }}
        />
      </div>
    </section>
  );
}

export function DailyMiniMetric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-zinc-950">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-zinc-400">{hint}</div> : null}
    </div>
  );
}

export function DailyCompactTrendMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-l-2 border-zinc-200 px-3 py-1">
      <div className="text-[11px] leading-4 text-zinc-500">{label}</div>
      <div className="mt-0.5 text-base font-semibold leading-6 text-zinc-950">{value}</div>
    </div>
  );
}

export function DailyWorkflowStepCard({ step, index, enabled }: { step: typeof dailyWorkflowSteps[number]; index: number; enabled: boolean }) {
  const palette = dailyToneClasses[step.tone];
  return (
    <article className={`relative border-t-2 bg-white px-3 py-4 ${enabled ? 'border-teal-500' : 'border-zinc-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold ${palette.icon}`}>{index + 1}</span>
          <div>
            <div className="text-sm font-semibold text-zinc-950">{step.title}</div>
            <div className="mt-0.5 text-xs text-zinc-500">{step.subtitle}</div>
          </div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] ${enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>
          {enabled ? '已启用' : '未启用'}
        </span>
      </div>
      <p className="mt-3 line-clamp-2 text-xs leading-5 text-zinc-500">{step.detail}</p>
    </article>
  );
}

export function DailyCandidateCard({ item, rank, onFilter }: { item: Candidate; rank?: number; onFilter?: (key: string, value: string) => void }) {
  const valueLabel = item.aiScore == null
    ? ''
    : item.aiScore >= 80
      ? '高价值'
      : item.aiScore >= 65
        ? '重点'
        : '可复核';
  return (
    <article className="rounded-2xl border border-zinc-200 bg-white px-4 py-4">
      <div className="flex min-w-0 items-center gap-2 text-[11px] text-zinc-500">
        {rank ? <span className="inline-flex size-5 items-center justify-center rounded-full bg-zinc-900 text-white">{rank}</span> : null}
        <button type="button" onClick={() => item.sourceName && onFilter?.('source', item.sourceName)} className="truncate hover:text-teal-700">{item.sourceName || '未知来源'}</button>
        <button type="button" onClick={() => item.category && onFilter?.('category', item.category)} className="truncate hover:text-teal-700">{item.category || '未分类'}</button>
        {valueLabel ? <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-teal-700">{valueLabel}</span> : null}
        {item.translationStatus ? (
          <button type="button" onClick={() => onFilter?.('translationStatus', item.translationStatus || '')} className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600 hover:bg-teal-50 hover:text-teal-700">
            {readableDailyStatus(item.translationStatus)}
          </button>
        ) : null}
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-zinc-950">{item.title}</h3>
      <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-500">{item.reportSummary || item.selectionReason || '暂无入报摘要。'}</p>
      {item.selectionReason ? <div className="mt-3 rounded-xl bg-zinc-50 px-3 py-2 text-[11px] leading-5 text-zinc-500">为什么先读：{item.selectionReason}</div> : null}
    </article>
  );
}

export function DailyReportTopItemRow({ item, index }: { item: Record<string, unknown>; index: number }) {
  const title = getObjectString(item, ['displayTitle', 'title', 'name']) || `重点条目 ${index + 1}`;
  const source = getObjectString(item, ['sourceName', 'source', 'sourceTitle']);
  const category = getObjectString(item, ['category', 'tag']);
  const score = getObjectNumber(item, ['aiScore', 'score', 'finalScore']);
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-xl bg-zinc-50 px-3 py-3">
      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold text-white">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-sm font-medium leading-6 text-zinc-900">{title}</div>
        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-zinc-500">
          {source ? <span>{source}</span> : null}
          {category ? <span>{category}</span> : null}
        </div>
      </div>
      {score != null ? <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] text-teal-700">{score}</span> : null}
    </div>
  );
}

export function DailyFunnelRows({ funnel, limit }: { funnel?: DailyFunnel; limit?: number }) {
  const entries = Object.entries(funnel || {}).filter(([, value]) => typeof value === 'number');
  const visible = limit ? entries.slice(0, limit) : entries;
  return (
    <div className="space-y-2 text-sm text-zinc-600">
      {visible.map(([key, value]) => (
        <div key={key} className="flex justify-between gap-3 rounded-xl bg-zinc-50 px-3 py-2">
          <span>{funnelLabels[key] || key}</span>
          <span className="font-medium text-zinc-900">{formatDailyNumber(Number(value))}</span>
        </div>
      ))}
    </div>
  );
}
