import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, Clock, RefreshCw, Search } from 'lucide-react';
import { api, type AiUsageEvent, type AiUsageSummary, type AiUsageSummaryBucket } from '../lib/api';

type TimeWindow = '24h' | '7d' | '30d';

const WINDOW_OPTIONS: Array<{ value: TimeWindow; label: string }> = [
  { value: '24h', label: '24小时' },
  { value: '7d', label: '7天' },
  { value: '30d', label: '30天' },
];

function formatNumber(value?: number | null) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function formatCost(value?: number | null) {
  if (!value) return '未估算';
  return `$${Number(value).toFixed(4)}`;
}

function formatLatency(value?: number | null) {
  if (!value) return '—';
  return `${Math.round(value)}ms`;
}

function sceneLabel(value?: string | null) {
  const labels: Record<string, string> = {
    feed_scoring_skill: 'Feed 评分技能',
    feed_scoring: 'Feed 评分',
    feed_summary: 'Feed 摘要',
    feed_translation: 'Feed 翻译',
    quality_filter: '质量过滤',
    daily_report_cleaning: '日报清洗',
    daily_report_decision: '日报决策',
    daily_report_research: '日报研究',
    daily_report_reading: '日报阅读',
    daily_report_final: '最终日报',
  };
  return labels[value || ''] || value || '未知场景';
}

function statusClassName(status?: string | null) {
  if (status === 'success') return 'bg-emerald-50 text-emerald-700';
  if (status === 'error') return 'bg-rose-50 text-rose-700';
  if (status === 'skipped') return 'bg-amber-50 text-amber-700';
  return 'bg-zinc-100 text-zinc-600';
}

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-3xl border border-zinc-200 bg-white p-5">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">{value}</div>
      {detail && <div className="mt-2 text-xs text-zinc-500">{detail}</div>}
    </div>
  );
}

function BucketBars({ title, buckets, valueLabel }: { title: string; buckets: AiUsageSummaryBucket[]; valueLabel?: (bucket: AiUsageSummaryBucket) => string }) {
  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);
  return (
    <section className="rounded-[28px] border border-zinc-200 bg-white p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
        <BarChart3 size={16} />
        {title}
      </div>
      <div className="mt-4 space-y-3">
        {buckets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 px-4 py-6 text-sm text-zinc-400">暂无调用记录。</div>
        ) : buckets.slice(0, 8).map((bucket) => (
          <div key={bucket.key}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-zinc-700">{title.includes('场景') ? sceneLabel(bucket.key) : bucket.key}</span>
              <span className="shrink-0 text-zinc-500">{valueLabel ? valueLabel(bucket) : `${formatNumber(bucket.count)} 次`}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
              <div className="h-full rounded-full bg-zinc-900" style={{ width: `${Math.max(6, (bucket.count / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AiUsage() {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('7d');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState<AiUsageSummary | null>(null);
  const [events, setEvents] = useState<AiUsageEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryResp, eventsResp] = await Promise.all([
        api.admin.hubAiUsageSummary({ timeWindow }),
        api.admin.hubAiUsageEvents({
          limit: 80,
          status: statusFilter || undefined,
          search: search.trim() || undefined,
        }),
      ]);
      setSummary(summaryResp.data);
      setEvents(eventsResp.data || []);
    } catch (err) {
      setError((err as Error).message || '模型用量加载失败');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, timeWindow]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusCounts = useMemo(() => {
    const success = summary?.byStatus.find((bucket) => bucket.key === 'success')?.count || 0;
    const errorCount = summary?.byStatus.find((bucket) => bucket.key === 'error')?.count || 0;
    const skipped = summary?.byStatus.find((bucket) => bucket.key === 'skipped')?.count || 0;
    const total = summary?.totalCalls || 0;
    return {
      success,
      errorCount,
      skipped,
      successRate: total ? Math.round((success / total) * 1000) / 10 : 0,
      errorRate: total ? Math.round((errorCount / total) * 1000) / 10 : 0,
    };
  }, [summary]);

  const trendMax = Math.max(...(summary?.trends || []).map((point) => point.calls), 1);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(20,184,166,0.08),_transparent_32%),linear-gradient(180deg,_#fffdf8_0%,_#f8fafc_100%)] p-4 md:p-6">
      <div className="mx-auto w-full max-w-[1480px] 2xl:max-w-none">
        <div className="rounded-[30px] border border-zinc-200/80 bg-white/90 p-6 shadow-[0_28px_90px_-56px_rgba(15,23,42,0.45)] backdrop-blur">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="text-[11px] tracking-[0.3em] text-teal-700/70">MODEL USAGE</div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">模型用量</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                看清每个模型、场景和供应商的调用次数、token、失败与延迟，定位日报和 Feed 质量问题的模型侧原因。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex overflow-hidden rounded-xl border border-zinc-200 bg-white p-0.5 text-sm">
                {WINDOW_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setTimeWindow(option.value)}
                    className={`min-h-9 px-3 py-2 transition-colors ${timeWindow === option.value ? 'rounded-lg bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <select
                id="ai-usage-status-filter"
                aria-label="调用状态"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
              >
                <option value="">全部状态</option>
                <option value="success">成功</option>
                <option value="error">失败</option>
                <option value="skipped">跳过</option>
              </select>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void load();
                }}
                className="relative"
              >
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜场景/模型/错误"
                  className="w-44 rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-700 outline-none focus:border-zinc-400"
                />
              </form>
              <button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                刷新
              </button>
            </div>
          </div>
          {error && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
          )}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard label="调用次数" value={formatNumber(summary?.totalCalls)} detail={`${statusCounts.successRate}% 成功 · ${statusCounts.errorRate}% 失败`} />
          <StatCard label="总 Tokens" value={formatNumber((summary?.totalInputTokens || 0) + (summary?.totalOutputTokens || 0))} detail={`输入 ${formatNumber(summary?.totalInputTokens)} · 输出 ${formatNumber(summary?.totalOutputTokens)}`} />
          <StatCard label="估算成本" value={formatCost(summary?.totalEstimatedCost)} detail="仅统计供应商返回或系统可估算的成本" />
          <StatCard label="失败调用" value={formatNumber(statusCounts.errorCount)} detail={`跳过 ${formatNumber(statusCounts.skipped)} 次`} />
          <StatCard label="平均延迟" value={formatLatency(summary?.byStatus[0]?.avgLatencyMs)} detail="按状态聚合的粗略均值" />
        </div>

        <section className="mt-5 rounded-[28px] border border-zinc-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <Activity size={16} />
            调用趋势
          </div>
          <div className="mt-4 flex h-32 items-stretch gap-2" aria-label="调用趋势图">
            {(summary?.trends || []).map((point) => (
              <div key={point.bucket} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                <div className="flex min-h-0 w-full flex-1 items-end">
                  <div
                    title={`${point.bucket} · ${point.calls} 次 · ${point.totalTokens} tokens`}
                    aria-label={`${point.bucket}，${point.calls} 次调用`}
                    className="min-h-1 w-full rounded-t-lg bg-teal-600 transition-[height]"
                    style={{ height: `${Math.max(6, (point.calls / trendMax) * 100)}%` }}
                  />
                </div>
                <div className="w-full truncate text-center text-[10px] text-zinc-400">{point.bucket.slice(5, 10)}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-3">
          <BucketBars title="按场景" buckets={summary?.byScene || []} valueLabel={(bucket) => `${formatNumber(bucket.count)} 次 · ${formatNumber(bucket.inputTokens + bucket.outputTokens)} tokens`} />
          <BucketBars title="按模型" buckets={summary?.byModel || []} valueLabel={(bucket) => `${formatNumber(bucket.count)} 次 · ${formatCost(bucket.estimatedCost)}`} />
          <BucketBars title="按供应商" buckets={summary?.byProvider || []} valueLabel={(bucket) => `${formatNumber(bucket.count)} 次 · ${formatLatency(bucket.avgLatencyMs)}`} />
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <section className="rounded-[28px] border border-zinc-200 bg-white p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              <AlertTriangle size={16} />
              错误热点
            </div>
            <div className="mt-4 space-y-2">
              {(summary?.hotspots?.errors || []).length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 px-4 py-6 text-sm text-zinc-400">当前窗口没有错误热点。</div>
              ) : summary!.hotspots!.errors.map((item) => (
                <div key={item.key} className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900">
                  <div className="font-medium">{item.key}</div>
                  <div className="mt-1 text-xs opacity-80">{formatNumber(item.count)} 次 · {formatLatency(item.avgLatencyMs)}</div>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-[28px] border border-zinc-200 bg-white p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              <Clock size={16} />
              慢调用场景
            </div>
            <div className="mt-4 space-y-2">
              {(summary?.hotspots?.slow || []).map((item) => (
                <div key={item.key} className="rounded-2xl bg-zinc-50 px-4 py-3 text-sm text-zinc-800">
                  <div className="font-medium">{sceneLabel(item.key)}</div>
                  <div className="mt-1 text-xs text-zinc-500">{formatNumber(item.count)} 次 · 平均 {formatLatency(item.avgLatencyMs)}</div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="mt-5 rounded-[28px] border border-zinc-200 bg-white p-5">
          <div className="text-sm font-semibold text-zinc-900">最近调用</div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-100">
            {events.map((event) => (
              <details key={event.id} className="border-b border-zinc-100 px-4 py-3 last:border-b-0">
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-900">{event.label || sceneLabel(event.sceneType)}</div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-500">
                        <span>{event.provider || 'unknown'} / {event.endpointId || event.modelName || 'unknown'}</span>
                        <span>{formatNumber(event.totalTokens)} tokens</span>
                        <span>{formatLatency(event.latencyMs)}</span>
                        <span>{new Date(event.createdAt).toLocaleString('zh-CN')}</span>
                      </div>
                    </div>
                    <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${statusClassName(event.status)}`}>{event.status}</span>
                  </div>
                </summary>
                <div className="mt-3 grid gap-3 text-xs leading-5 text-zinc-600 md:grid-cols-2">
                  <div className="rounded-xl bg-zinc-50 p-3">
                    <div className="font-semibold text-zinc-800">Prompt 预览</div>
                    <div className="mt-1 whitespace-pre-wrap">{event.promptPreview || '无预览'}</div>
                  </div>
                  <div className="rounded-xl bg-zinc-50 p-3">
                    <div className="font-semibold text-zinc-800">响应/错误</div>
                    <div className="mt-1 whitespace-pre-wrap">{event.errorMessage || event.responsePreview || '无预览'}</div>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
