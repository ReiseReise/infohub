import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BarChart3, BrainCircuit, Copy, FileText, Layers3, RefreshCw, Sparkles } from 'lucide-react';
import { api, type GrowthDashboardRecord, type InsightRecord } from '../lib/api';
import { MarkdownContent } from '../components/MarkdownContent';

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
  const [notice, setNotice] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const [dashboardResp, listResp] = await Promise.all([
        api.insights.dashboard({ windowDays: 7, limit: 120 }),
        api.insights.list({ limit: '12' }),
      ]);
      setDashboard(dashboardResp.data);
      setInsights(listResp.data);
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

  async function handleGenerate() {
    setGenerating(true);
    setNotice(null);
    try {
      await api.insights.generate({
        topN: 18,
        minScore: 55,
        compareWindowDays: 7,
        preset: 'full',
      });
      await loadAll();
      setNotice('日报已生成，并刷新了成长仪表板。');
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
              <div className="text-[11px] uppercase tracking-[0.3em] text-sky-700/70">Growth Console</div>
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
                onClick={() => void handleGenerate()}
                disabled={generating}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                <Sparkles size={14} className={generating ? 'animate-pulse' : ''} />
                {generating ? '生成中...' : '生成日报'}
              </button>
            </div>
          </div>
        </div>

        {notice && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-zinc-200 bg-white p-5">
            <div className="text-xs text-zinc-500">窗口条目</div>
            <div className="mt-2 text-3xl font-semibold text-zinc-900">{dashboard?.summary.totalItems ?? 0}</div>
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
                    暂无条目。优先在信源管理里给来源打上成长维度。
                  </div>
                ) : (
                  axisCard.items.map((item) => (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-2xl border border-zinc-100 px-4 py-4 transition-colors hover:border-zinc-200 hover:bg-zinc-50/70"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700">{TIER_LABELS[item.sourceTier] || item.sourceTier}</span>
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5">{PROFILE_LABELS[item.processingProfile] || item.processingProfile}</span>
                        {item.aiScore != null && <span className="rounded-full bg-zinc-100 px-2 py-0.5">AI {item.aiScore}</span>}
                        <span>{item.sourceName || '未知信源'}</span>
                      </div>
                      <div className="mt-2 flex items-start justify-between gap-3">
                        <h3 className="text-base font-semibold leading-6 text-zinc-900">{item.title}</h3>
                        <ArrowUpRight size={15} className="mt-1 shrink-0 text-zinc-300" />
                      </div>
                      {item.summary && (
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-600">{item.summary}</p>
                      )}
                      <div className="mt-3 rounded-2xl bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                        下一步：{item.actionSuggestion}
                      </div>
                    </a>
                  ))
                )}
              </div>
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
