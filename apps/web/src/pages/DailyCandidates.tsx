import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, Filter, X } from 'lucide-react';
import {
  api,
  type DailyCandidatesPayload,
  type DailyReportWorkflowPreview,
} from '../lib/api';
import {
  DailyButtonLink as ButtonLink,
  DailyCandidateCard as CandidateCard,
  DailyFunnelRows as FunnelRows,
  DailyPageShell as PageShell,
  DailyProductNav,
  DailyStateBlock as StateBlock,
  dailyToneClasses as toneClasses,
  formatDailyNumber as formatNumber,
  readableDailyStatus as readableStatus,
  type DailyFunnel as Funnel,
  type DailyTone as Tone,
} from '../features/daily/ui';

type ExcludedCandidate = DailyReportWorkflowPreview['excluded'][number];

const reasonLabels: Record<string, { label: string; detail: string; tone: Tone }> = {
  translation_failed: {
    label: '中文化失败',
    detail: '英文或外文内容没有产出可用中文，不进入正式日报。',
    tone: 'rose',
  },
  not_chinese: {
    label: '缺少可用中文',
    detail: '标题、摘要或翻译不足以支撑中文日报阅读。',
    tone: 'amber',
  },
  not_selected: {
    label: '未达到入报门槛',
    detail: '当前分数、范围或单源上限不足以进入日报。',
    tone: 'zinc',
  },
  business_noise: {
    label: '泛商业噪声',
    detail: '行情、融资、公告或宽泛商业信息不属于本日报主线。',
    tone: 'amber',
  },
  fallback_scored: {
    label: '低置信评分',
    detail: '兜底评分只做复核诊断，先重跑评分再考虑入报。',
    tone: 'rose',
  },
  webpage_snapshot: {
    label: '网页监控快照',
    detail: '这是页面变化监控，不等同于单篇文章，需改成索引或正文源后再入报。',
    tone: 'zinc',
  },
  uncategorized: {
    label: '未分类质量问题',
    detail: '条目还没有可靠分类，先归类或降权，避免进入正式日报主线。',
    tone: 'amber',
  },
};

const candidateFilterLabels: Record<string, string> = {
  q: '关键词',
  reason: '未入报原因',
  source: '来源',
  category: '分类',
  sourceTier: '来源等级',
  translationStatus: '中文化状态',
  minScore: '最低分',
  maxScore: '最高分',
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getFunnelValue(funnel: Funnel | undefined, key: keyof Funnel) {
  return Number(funnel?.[key] || 0);
}

function getExcludedReason(reason: string) {
  return reasonLabels[reason] || {
    label: reason || '未入报',
    detail: '未满足当前日报工作流策略。',
    tone: 'zinc' as Tone,
  };
}

export function DailyCandidates() {
  const [searchParams, setSearchParams] = useSearchParams();
  const date = searchParams.get('date') || todayKey();
  const sourceId = searchParams.get('sourceId') || '';
  const filters = {
    status: searchParams.get('status') || 'all',
    reason: searchParams.get('reason') || '',
    source: searchParams.get('source') || '',
    sourceId,
    category: searchParams.get('category') || '',
    sourceTier: searchParams.get('sourceTier') || '',
    translationStatus: searchParams.get('translationStatus') || '',
    q: searchParams.get('q') || '',
    minScore: searchParams.get('minScore') || '',
    maxScore: searchParams.get('maxScore') || '',
  };
  const [data, setData] = useState<DailyCandidatesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { status, reason, source, category, sourceTier, translationStatus, q, minScore, maxScore } = filters;

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.daily.candidates({ date, status, reason, source, sourceId, category, sourceTier, translationStatus, q, minScore, maxScore });
      setData(resp.data);
    } catch (err) {
      setError((err as Error).message || '候选池加载失败');
    } finally {
      setLoading(false);
    }
  }, [date, status, reason, source, sourceId, category, sourceTier, translationStatus, q, minScore, maxScore]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (!next.get('date')) next.set('date', date);
    setSearchParams(next);
  };

  const clearFilters = () => {
    const next = new URLSearchParams();
    next.set('date', date);
    if (sourceId) next.set('sourceId', sourceId);
    setSearchParams(next);
  };

  const excludedGroups = data?.excludedSummary?.byReason || [];
  const activeFilters = Object.entries(filters).filter(([key, value]) => key !== 'status' && key !== 'sourceId' && Boolean(value));
  const scopedCandidatePath = (path: string) => {
    const params = new URLSearchParams();
    params.set('date', date);
    if (sourceId) params.set('sourceId', sourceId);
    return `${path}?${params.toString()}`;
  };

  return (
    <PageShell
      title="日报候选池"
      eyebrow="Candidates Funnel"
      description="候选池只回答两件事：哪些内容入报，哪些内容没有入报以及原因。正式阅读请去高质量日报页。"
      actions={(
        <>
          <ButtonLink to={scopedCandidatePath('/daily/workbench')}>返回工作台</ButtonLink>
          <ButtonLink to={scopedCandidatePath('/daily/reports/latest')} primary>正式日报 <ArrowRight size={14} /></ButtonLink>
        </>
      )}
    >
      <DailyProductNav date={date} sourceId={sourceId} />
      <StateBlock loading={loading} error={error}>
        {data && (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <main className="min-w-0 space-y-4">
              {data.reportScope?.sourceId ? (
                <section className="rounded-2xl border border-teal-100 bg-teal-50/70 px-5 py-4 text-sm leading-6 text-teal-900">
                  <div className="font-semibold">当前范围：{data.reportScope.label}</div>
                  <div className="mt-1 text-xs text-teal-700">候选、未入报解释和覆盖索引只针对这个来源。</div>
                </section>
              ) : null}
              <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
                    <Filter size={16} /> 候选筛选
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      ['all', '全部'],
                      ['selected', '已入报'],
                      ['excluded', '未入报'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => updateFilter('status', value === 'all' ? '' : value)}
                        className={`min-h-8 rounded-xl border px-3 py-1.5 text-xs ${filters.status === value || (value === 'all' && filters.status === 'all') ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_120px_120px_140px]">
                  <input
                    value={filters.q}
                    onChange={(event) => updateFilter('q', event.target.value)}
                    placeholder="搜标题、来源、分类、入报理由..."
                    className="min-h-9 rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-teal-300"
                  />
                  <input
                    value={filters.minScore}
                    onChange={(event) => updateFilter('minScore', event.target.value)}
                    placeholder="最低分"
                    type="number"
                    className="min-h-9 rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-teal-300"
                  />
                  <input
                    value={filters.maxScore}
                    onChange={(event) => updateFilter('maxScore', event.target.value)}
                    placeholder="最高分"
                    type="number"
                    className="min-h-9 rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-teal-300"
                  />
                  <select
                    value={filters.sourceTier}
                    onChange={(event) => updateFilter('sourceTier', event.target.value)}
                    className="min-h-9 rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-teal-300"
                  >
                    <option value="">全部等级</option>
                    {['S', 'A', 'B', 'C', 'D'].map((tier) => <option key={tier} value={tier}>{tier} 级来源</option>)}
                  </select>
                </div>
                {activeFilters.length || filters.status !== 'all' ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {filters.status !== 'all' ? (
                      <button onClick={() => updateFilter('status', '')} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600">
                        状态：{filters.status === 'selected' ? '已入报' : '未入报'} <X size={12} />
                      </button>
                    ) : null}
                    {activeFilters.map(([key, value]) => (
                      <button key={key} onClick={() => updateFilter(key, '')} className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-3 py-1 text-xs text-teal-700">
                        {candidateFilterLabels[key] || key}: {key === 'translationStatus' ? readableStatus(value) : value} <X size={12} />
                      </button>
                    ))}
                    <button onClick={clearFilters} className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-white">清空筛选</button>
                  </div>
                ) : null}
              </section>
              <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-950">入报候选</h2>
                    <p className="mt-1 text-sm leading-6 text-zinc-500">这些条目已经通过当前工作流，后续会被 Agent 融合成正式日报。</p>
                  </div>
                  <span className="rounded-full bg-teal-50 px-3 py-1 text-xs text-teal-700">{formatNumber(data.candidates.length)} 条</span>
                </div>
                {data.candidates.length ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {data.candidates.map((item, index) => <CandidateCard key={item.id} item={item} rank={index + 1} onFilter={updateFilter} />)}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-sm leading-6 text-zinc-500">
                    当前没有最终入报候选。请优先查看右侧漏斗中的范围命中、翻译失败和评分失败数量，再决定是否放宽工作流。
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
                <h2 className="text-base font-semibold text-zinc-950">未入报解释</h2>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {excludedGroups.length ? excludedGroups.map((group) => {
                    const reason = getExcludedReason(group.reason);
                    return (
                      <article key={group.reason} className="rounded-2xl border border-zinc-200 bg-zinc-50/70 px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-semibold text-zinc-950">{reason.label}</div>
                            <div className="mt-1 text-xs leading-5 text-zinc-500">{reason.detail}</div>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-xs ${toneClasses[reason.tone].soft}`}>{formatNumber(group.count)} 条</span>
                        </div>
                        <div className="mt-3 space-y-2">
                          {group.samples.slice(0, 3).map((item: ExcludedCandidate) => (
                            <div key={item.id} className="rounded-xl bg-white px-3 py-2 text-xs leading-5">
                              <div className="line-clamp-2 font-medium text-zinc-800">{item.title}</div>
                              <div className="mt-1 text-zinc-500">{item.detail || '未满足当前日报策略'}</div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {item.sourceName ? <button onClick={() => updateFilter('source', item.sourceName || '')} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-teal-50 hover:text-teal-700">{item.sourceName}</button> : null}
                                {item.category ? <button onClick={() => updateFilter('category', item.category || '')} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-teal-50 hover:text-teal-700">{item.category}</button> : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </article>
                    );
                  }) : (
                    <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
                      暂无未入报解释，可能是当前窗口内容不足或候选预览尚未生成。
                    </div>
                  )}
                </div>
              </section>
            </main>
            <aside className="space-y-4 xl:sticky xl:top-5 xl:self-start">
              <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
                <h2 className="text-base font-semibold text-zinc-950">候选漏斗</h2>
                <div className="mt-3"><FunnelRows funnel={data.funnel} /></div>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
                <h2 className="text-base font-semibold text-zinc-950">复核建议</h2>
                <div className="mt-3 space-y-2 text-xs leading-5 text-zinc-500">
                  {excludedGroups.some((group) => group.reason === 'uncategorized' || group.samples.some((item: ExcludedCandidate) => item.category === 'uncategorized')) ? (
                    <p>存在未分类条目。先批量归类或降权，避免“uncategorized”进入正式日报。</p>
                  ) : null}
                  {getFunnelValue(data.funnel, 'translationFailed') > 0 ? <p>存在翻译失败，优先重跑中文化，否则外文条目不会进入正式日报。</p> : null}
                  {getFunnelValue(data.funnel, 'scoreFailedCandidates') > 0 ? <p>存在评分失败，建议重跑评分后再生成日报。</p> : null}
                  {getFunnelValue(data.funnel, 'finalCandidates') === 0 ? <p>没有最终候选时，不要直接生成日报；先调工作流或修复处理链路。</p> : null}
                  {getFunnelValue(data.funnel, 'finalCandidates') > 0 ? <p>候选池可用。生成日报后重点检查正式报告中的结论、建议和附录是否一致。</p> : null}
                </div>
              </div>
            </aside>
          </div>
        )}
      </StateBlock>
    </PageShell>
  );
}
