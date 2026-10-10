import { useEffect, useState } from 'react';
import { ArrowUpRight, BarChart3, BrainCircuit, FileText, Layers3, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, type GrowthDashboardRecord } from '../lib/api';

const AXIS_ACCENTS: Record<string, string> = {
  认知升级: 'border-sky-200 bg-sky-50 text-sky-800',
  技术能力: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  商业判断: 'border-amber-200 bg-amber-50 text-amber-800',
  表达输出: 'border-rose-200 bg-rose-50 text-rose-800',
};

const TIER_LABELS: Record<string, string> = {
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

function cleanGrowthSummary(summary?: string | null) {
  const text = String(summary || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const modelBoilerplatePatterns = [
    /请您?提供.*?(摘要原文|原文|内容)/i,
    /作为\s*AI/i,
    /我无法(根据|访问|浏览|确认)/i,
    /无法完成.*?(改写|摘要|总结)/i,
  ];
  if (modelBoilerplatePatterns.some((pattern) => pattern.test(text))) {
    return '摘要暂不可用，建议打开原文或进入详情重跑摘要后再判断。';
  }
  return text;
}

export function Insights() {
  const [dashboard, setDashboard] = useState<GrowthDashboardRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [axisVisibleCounts, setAxisVisibleCounts] = useState<Record<string, number>>({});

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const response = await api.insights.dashboard({ windowDays: 7, limit: 120 });
      setDashboard(response.data);
    } catch (loadError) {
      setError((loadError as Error).message || '成长仪表板加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  if (loading && !dashboard) {
    return <div className="p-8 text-sm text-zinc-400">加载成长仪表板...</div>;
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#fff_0%,_#f8fafc_100%)] p-4 md:p-6">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-[30px] border border-zinc-200/80 bg-white p-6 shadow-[0_28px_90px_-56px_rgba(15,23,42,0.45)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="text-[11px] tracking-[0.3em] text-sky-700/70">成长控制台</div>
              <h1 className="mt-2 text-3xl font-semibold text-zinc-900">成长仪表板</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                先看四象限精选，再决定读什么、记什么、做什么。当前窗口 {dashboard?.windowDays || 7} 天。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadDashboard()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                刷新
              </button>
              <Link
                to="/daily/workbench"
                className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-800 hover:bg-sky-100"
              >
                <FileText size={14} />
                打开日报
              </Link>
            </div>
          </div>
          {error ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
        </header>

        <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="成长窗口概览">
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
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-2" aria-label="成长四象限">
          {(dashboard?.axes || []).map((axisCard) => {
            const visibleCount = axisVisibleCounts[axisCard.axis] || 4;
            return (
              <article key={axisCard.axis} className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-[0_16px_48px_-40px_rgba(15,23,42,0.35)]">
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
                    <div className="rounded-2xl border border-dashed border-zinc-200 px-4 py-5 text-sm leading-6 text-zinc-500">
                      {axisCard.emptyReason || '当前窗口没有匹配条目。'}
                    </div>
                  ) : axisCard.items.slice(0, visibleCount).map((item) => (
                    <div key={item.id} className="rounded-2xl border border-zinc-100 px-4 py-4 transition-colors hover:border-zinc-200 hover:bg-zinc-50/70">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700">{TIER_LABELS[item.sourceTier] || item.sourceTier}</span>
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5">{PROFILE_LABELS[item.processingProfile] || item.processingProfile}</span>
                        {item.aiScore != null ? <span className="rounded-full bg-zinc-100 px-2 py-0.5">AI {item.aiScore}</span> : null}
                        <span>{item.sourceName || '未知信源'}</span>
                      </div>
                      <div className="mt-2 flex items-start justify-between gap-3">
                        <Link to={`/feed/${item.id}`} className="text-base font-semibold leading-6 text-zinc-900 hover:text-teal-800">
                          {item.title}
                        </Link>
                        <ArrowUpRight size={15} className="mt-1 shrink-0 text-zinc-300" />
                      </div>
                      {cleanGrowthSummary(item.summary) ? (
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-600">{cleanGrowthSummary(item.summary)}</p>
                      ) : null}
                      {(item.secondaryGrowthAxes || []).length > 0 ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                          <span>次级维度</span>
                          {item.secondaryGrowthAxes?.map((secondaryAxis) => (
                            <span key={secondaryAxis} className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">{secondaryAxis}</span>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-3 rounded-2xl bg-zinc-50 px-3 py-2 text-xs text-zinc-600">下一步：{item.actionSuggestion}</div>
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-800">
                          打开原文
                          <ArrowUpRight size={12} />
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>

                {axisCard.sourceExplanation ? (
                  <div className="mt-3 rounded-2xl bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-500">{axisCard.sourceExplanation}</div>
                ) : null}
                {axisCard.items.length > visibleCount ? (
                  <button
                    type="button"
                    onClick={() => setAxisVisibleCounts((current) => ({
                      ...current,
                      [axisCard.axis]: Math.min(axisCard.items.length, visibleCount + 4),
                    }))}
                    className="mt-3 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 hover:bg-zinc-50"
                  >
                    查看更多（已显示 {visibleCount} / {axisCard.items.length}）
                  </button>
                ) : null}
              </article>
            );
          })}
        </section>

        <section className="mt-6 grid gap-5 md:grid-cols-2" aria-label="成长数据口径">
          <div className="rounded-[28px] border border-zinc-200 bg-white p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900"><Layers3 size={16} />信源分层</div>
            <div className="mt-4 space-y-2">
              {(dashboard?.sourceTierStats || []).map((entry) => (
                <div key={entry.tier} className="flex items-center justify-between rounded-2xl bg-zinc-50 px-3 py-2 text-sm">
                  <span className="text-zinc-600">{TIER_LABELS[entry.tier] || entry.tier}</span>
                  <span className="font-medium text-zinc-900">{entry.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[28px] border border-zinc-200 bg-white p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900"><BarChart3 size={16} />处理档位</div>
            <div className="mt-4 space-y-2">
              {(dashboard?.processingProfileStats || []).map((entry) => (
                <div key={entry.profile} className="flex items-center justify-between rounded-2xl bg-zinc-50 px-3 py-2 text-sm">
                  <span className="text-zinc-600">{PROFILE_LABELS[entry.profile] || entry.profile}</span>
                  <span className="font-medium text-zinc-900">{entry.count}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
