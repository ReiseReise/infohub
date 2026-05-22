import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArchiveRestore, ArrowLeft, ArrowRight, Filter, Loader2, Search, ShieldAlert } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type FeedItemRecord, type ItemQualityCheckPayload } from '../lib/api';

const TIER_OPTIONS = ['all', 'T1', 'T1.5', 'T2', 'S', 'A', 'B', 'C', 'D'] as const;

function tierLabel(tier?: string | null) {
  const labels: Record<string, string> = {
    T1: 'T1 一手官方',
    'T1.5': 'T1.5 官方社媒',
    T2: 'T2 观察信源',
    S: 'S 质量策略',
    A: 'A 质量策略',
    B: 'B 质量策略',
    C: 'C 质量策略',
    D: 'D 质量策略',
  };
  return tier ? labels[tier] || tier : '未分级';
}

function formatDateLabel(value?: string | null) {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function toneForTag(tag: string) {
  if (/导流|营销|风险|半对半错/i.test(tag)) return 'bg-rose-100 text-rose-700 border-rose-200';
  if (/密度|搬运|弱相关|复核|失败/i.test(tag)) return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-zinc-100 text-zinc-700 border-zinc-200';
}

export function Filtered() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTier = searchParams.get('tier');
  const initialTag = searchParams.get('tag');
  const initialSourceId = searchParams.get('sourceId');
  const [items, setItems] = useState<FeedItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalItems, setTotalItems] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [tierFilter, setTierFilter] = useState<(typeof TIER_OPTIONS)[number]>(
    TIER_OPTIONS.includes(initialTier as (typeof TIER_OPTIONS)[number]) ? initialTier as (typeof TIER_OPTIONS)[number] : 'all',
  );
  const [tagFilter, setTagFilter] = useState(initialTag || 'all');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('item'));
  const [sourceIdFilter, setSourceIdFilter] = useState(
    Number.isInteger(Number(initialSourceId)) && Number(initialSourceId) > 0 ? String(Number(initialSourceId)) : '',
  );
  const [selectedItem, setSelectedItem] = useState<FeedItemRecord | null>(null);
  const [qualityDetail, setQualityDetail] = useState<ItemQualityCheckPayload | null>(null);
  const deferredSearch = useDeferredValue(search);

  const loadItems = useCallback(async (options: { append?: boolean; offset?: number } = {}) => {
    const append = options.append === true;
    const offset = options.offset ?? 0;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {
        bucket: 'filtered',
        includeFiltered: 'true',
        limit: '80',
      };
      if (offset > 0) params.offset = String(offset);
      if (deferredSearch.trim()) params.search = deferredSearch.trim();
      if (tierFilter !== 'all') params.sourceTier = tierFilter;
      if (tagFilter !== 'all') params.qualityTag = tagFilter;
      if (sourceIdFilter) params.sourceId = sourceIdFilter;
      const res = await api.items.list(params);
      const rows = res.data || [];
      setItems((current) => {
        if (!append) return rows;
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...rows.filter((item) => !seen.has(item.id))];
      });
      setTotalItems(res.total || rows.length);
      setHasMore(Boolean(res.hasMore));
      setNextOffset(res.nextOffset ?? null);
      setSelectedId((current) => {
        if (append) return current || rows[0]?.id || null;
        if (current && rows.some((item) => item.id === current)) return current;
        return rows[0]?.id || null;
      });
    } catch (err) {
      setError((err as Error).message || '过滤池加载失败');
      if (!append) {
        setItems([]);
        setTotalItems(0);
        setHasMore(false);
        setNextOffset(null);
        setSelectedId(null);
      }
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, [deferredSearch, sourceIdFilter, tagFilter, tierFilter]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedItem(null);
      setQualityDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void Promise.all([
      api.items.get(selectedId),
      api.items.qualityCheck(selectedId),
    ]).then(([itemRes, detailRes]) => {
      if (cancelled) return;
      setSelectedItem(itemRes.data);
      setQualityDetail(detailRes.data);
    }).catch((err) => {
      if (cancelled) return;
      setError((err as Error).message || '条目详情加载失败');
      setSelectedItem(null);
      setQualityDetail(null);
    }).finally(() => {
      if (!cancelled) setDetailLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    const nextSearch = searchParams.get('q') || '';
    const nextTier = TIER_OPTIONS.includes(searchParams.get('tier') as (typeof TIER_OPTIONS)[number])
      ? searchParams.get('tier') as (typeof TIER_OPTIONS)[number]
      : 'all';
    const nextTag = searchParams.get('tag') || 'all';
    const nextItem = searchParams.get('item');
    const nextSourceId = Number.isInteger(Number(searchParams.get('sourceId'))) && Number(searchParams.get('sourceId')) > 0
      ? String(Number(searchParams.get('sourceId')))
      : '';

    if (search !== nextSearch) setSearch(nextSearch);
    if (tierFilter !== nextTier) setTierFilter(nextTier);
    if (tagFilter !== nextTag) setTagFilter(nextTag);
    if (selectedId !== nextItem) setSelectedId(nextItem);
    if (sourceIdFilter !== nextSourceId) setSourceIdFilter(nextSourceId);
  }, [searchParams]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (search.trim()) next.set('q', search.trim());
    else next.delete('q');
    if (tierFilter !== 'all') next.set('tier', tierFilter);
    else next.delete('tier');
    if (tagFilter !== 'all') next.set('tag', tagFilter);
    else next.delete('tag');
    if (selectedId) next.set('item', selectedId);
    else next.delete('item');
    if (sourceIdFilter) next.set('sourceId', sourceIdFilter);
    else next.delete('sourceId');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [search, searchParams, selectedId, setSearchParams, sourceIdFilter, tagFilter, tierFilter]);

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    for (const item of items) {
      for (const tag of item.qualityTags || []) tags.add(tag);
    }
    return ['all', ...Array.from(tags)];
  }, [items]);

  const stats = useMemo(() => ({
    total: totalItems || items.length,
    loaded: items.length,
    byTierHighRisk: items.filter((item) => item.sourceTier === 'C' || item.sourceTier === 'D').length,
    restored: items.filter((item) => item.restoredFromFilter).length,
  }), [items, totalItems]);

  const selectedIndex = useMemo(
    () => (selectedId ? items.findIndex((item) => item.id === selectedId) : -1),
    [items, selectedId],
  );

  const selectedPositionLabel = selectedIndex >= 0 ? `${selectedIndex + 1} / ${items.length}` : '--';

  const focusSibling = useCallback((direction: 'prev' | 'next') => {
    if (selectedIndex < 0) return;
    const nextIndex = direction === 'next' ? selectedIndex + 1 : selectedIndex - 1;
    const nextItem = items[nextIndex];
    if (nextItem) setSelectedId(nextItem.id);
  }, [items, selectedIndex]);

  const handleRestore = async () => {
    if (!selectedId) return;
    setRestoring(true);
    setError(null);
    setNotice(null);
    try {
      await api.items.restore(selectedId);
      setNotice('条目已恢复到主 Feed，原过滤原因已保留。');
      await loadItems();
    } catch (err) {
      setError((err as Error).message || '恢复条目失败');
    } finally {
      setRestoring(false);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setTierFilter('all');
    setTagFilter('all');
    setSourceIdFilter('');
  };

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,_rgba(15,118,110,0.08),_transparent_42%),linear-gradient(180deg,_#f5f5f4_0%,_#ffffff_48%,_#fafaf9_100%)] p-6">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-[0_32px_80px_-52px_rgba(15,23,42,0.42)]">
          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.6fr_1fr] lg:px-8">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-teal-700">
                <Filter size={12} />
                过滤池
              </div>
              <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-zinc-950">把被挡掉的内容留在可复盘的地方，而不是消失在黑箱里。</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-600">
                所有被 AI 质检或硬规则分流的条目都会正常入库，并在这里保留概要、过滤原因、命中标签与恢复入口。
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-[22px] border border-zinc-200 bg-zinc-50/90 p-4">
                <div className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">过滤池总量</div>
                <div className="mt-2 text-3xl font-semibold text-zinc-950">{stats.total}</div>
                <div className="mt-1 text-xs text-zinc-500">已加载 {stats.loaded} 条，等待查看或人工恢复</div>
              </div>
              <div className="rounded-[22px] border border-rose-200 bg-rose-50/80 p-4">
                <div className="text-[10px] uppercase tracking-[0.24em] text-rose-700">高噪音层级</div>
                <div className="mt-2 text-3xl font-semibold text-zinc-950">{stats.byTierHighRisk}</div>
                <div className="mt-1 text-xs text-zinc-500">来自 C / D 档的过滤条目</div>
              </div>
              <div className="rounded-[22px] border border-amber-200 bg-amber-50/80 p-4">
                <div className="text-[10px] uppercase tracking-[0.24em] text-amber-700">已恢复</div>
                <div className="mt-2 text-3xl font-semibold text-zinc-950">{stats.restored}</div>
                <div className="mt-1 text-xs text-zinc-500">当前列表中曾被恢复的条目</div>
              </div>
            </div>
          </div>
        </section>

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}
        {sourceIdFilter && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
            <div>当前过滤池已按单一信源收窄，适合回看某个来源为什么频繁被挡。</div>
            <button
              type="button"
              onClick={() => setSourceIdFilter('')}
              className="rounded-full border border-teal-200 bg-white px-3 py-1 text-xs text-teal-700 hover:bg-teal-100"
            >
              取消单源锁定
            </button>
          </div>
        )}

        <section className="grid gap-5 xl:h-[calc(100vh-22rem)] xl:min-h-[620px] xl:grid-cols-[380px_minmax(0,1fr)]">
          <div className="rounded-[28px] border border-zinc-200 bg-white p-4 shadow-[0_24px_64px_-52px_rgba(15,23,42,0.48)] xl:flex xl:min-h-0 xl:flex-col">
            <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3">
              <Search size={15} className="text-zinc-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索标题、概要、原因"
                className="w-full bg-transparent text-sm text-zinc-700 outline-none"
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <select
                value={tierFilter}
                onChange={(e) => setTierFilter(e.target.value as (typeof TIER_OPTIONS)[number])}
                className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700"
              >
                {TIER_OPTIONS.map((tier) => (
                  <option key={tier} value={tier}>{tier === 'all' ? '全部分级' : tierLabel(tier)}</option>
                ))}
              </select>
              <select
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700"
              >
                {availableTags.map((tag) => (
                  <option key={tag} value={tag}>{tag === 'all' ? '全部标签' : tag}</option>
                ))}
              </select>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
              <div className="flex flex-wrap items-center gap-2">
                <span>{deferredSearch !== search ? '正在更新结果...' : `已加载 ${items.length} / ${totalItems || items.length} 条`}</span>
                {sourceIdFilter && (
                  <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] text-zinc-600">
                    已锁定单一信源
                  </span>
                )}
              </div>
              {(search || tierFilter !== 'all' || tagFilter !== 'all' || sourceIdFilter) && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100"
                >
                  清空筛选
                </button>
              )}
            </div>

            <div className="mt-4 space-y-2 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
              {loading ? (
                <div className="flex items-center justify-center py-16 text-sm text-zinc-400"><Loader2 size={16} className="mr-2 animate-spin" />加载过滤池...</div>
              ) : items.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-zinc-200 bg-zinc-50 px-4 py-14 text-center text-sm text-zinc-500">
                  当前筛选条件下没有过滤条目。
                </div>
              ) : (
                <>
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={`w-full rounded-[22px] border px-4 py-4 text-left transition-colors ${
                        selectedId === item.id
                          ? 'border-zinc-900 bg-zinc-900 text-white shadow-[0_16px_44px_-28px_rgba(15,23,42,0.7)]'
                          : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.22em]">
                        <span className={selectedId === item.id ? 'text-white/70' : 'text-zinc-500'}>{tierLabel(item.sourceTier)}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${selectedId === item.id ? 'border-white/20 bg-white/10 text-white' : 'border-zinc-200 bg-zinc-100 text-zinc-600'}`}>
                          {item.sourceName || '未知来源'}
                        </span>
                      </div>
                      <div className="mt-3 text-sm font-medium leading-6">{item.title}</div>
                      <div className={`mt-2 text-xs leading-6 ${selectedId === item.id ? 'text-white/80' : 'text-zinc-600'}`}>
                        {item.qualitySummary || item.qualityReason || item.filterReason || item.snippet || '暂无概要'}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(item.qualityTags || []).slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className={`rounded-full border px-2 py-0.5 text-[10px] ${selectedId === item.id ? 'border-white/15 bg-white/10 text-white' : toneForTag(tag)}`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className={`mt-3 text-[11px] ${selectedId === item.id ? 'text-white/60' : 'text-zinc-400'}`}>
                        {formatDateLabel(item.qualityCheckedAt || item.fetchedAt)}
                      </div>
                    </button>
                  ))}
                  {hasMore && nextOffset !== null && (
                    <button
                      type="button"
                      onClick={() => void loadItems({ append: true, offset: nextOffset })}
                      disabled={loadingMore}
                      className="w-full rounded-[18px] border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-60"
                    >
                      {loadingMore ? '加载中...' : `加载更多（已显示 ${items.length} / ${totalItems}）`}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="rounded-[30px] border border-zinc-200 bg-white p-5 shadow-[0_28px_72px_-56px_rgba(15,23,42,0.5)] xl:min-h-0 xl:overflow-y-auto">
            {detailLoading ? (
              <div className="flex min-h-[520px] items-center justify-center text-sm text-zinc-400"><Loader2 size={18} className="mr-2 animate-spin" />加载条目详情...</div>
            ) : !selectedItem ? (
              <div className="flex min-h-[520px] items-center justify-center rounded-[26px] border border-dashed border-zinc-200 bg-zinc-50 text-sm text-zinc-500">
                从左侧选择一条过滤内容查看详情。
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                      <span>{tierLabel(selectedItem.sourceTier)}</span>
                      <span>{selectedItem.sourceName || '未知来源'}</span>
                      <span>{formatDateLabel(selectedItem.qualityCheckedAt || selectedItem.fetchedAt)}</span>
                      <span>条目 {selectedPositionLabel}</span>
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold tracking-[-0.035em] text-zinc-950">{selectedItem.title}</h2>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(qualityDetail?.qualityTags || selectedItem.qualityTags || []).map((tag) => (
                        <span key={tag} className={`rounded-full border px-2.5 py-1 text-[11px] ${toneForTag(tag)}`}>{tag}</span>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => focusSibling('prev')}
                      disabled={selectedIndex <= 0}
                      className="inline-flex items-center rounded-2xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ArrowLeft size={14} className="mr-1" />
                      上一条
                    </button>
                    <button
                      type="button"
                      onClick={() => focusSibling('next')}
                      disabled={selectedIndex < 0 || selectedIndex >= items.length - 1}
                      className="inline-flex items-center rounded-2xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      下一条
                      <ArrowRight size={14} className="ml-1" />
                    </button>
                    {selectedItem.sourceId && (
                      <Link
                        to={`/rules?source=${selectedItem.sourceId}`}
                        className="inline-flex items-center rounded-2xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                      >
                        查看策略
                      </Link>
                    )}
                    {selectedItem.url && (
                      <a
                        href={selectedItem.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-2xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                      >
                        打开原文
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleRestore()}
                      disabled={restoring}
                      className="inline-flex items-center rounded-2xl bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-60"
                    >
                      {restoring ? <Loader2 size={14} className="mr-2 animate-spin" /> : <ArchiveRestore size={14} className="mr-2" />}
                      恢复到主 Feed
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-[24px] border border-zinc-200 bg-zinc-50/80 p-5">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">概要</div>
                    <div className="mt-3 text-sm leading-7 text-zinc-700">
                      {qualityDetail?.qualitySummary || selectedItem.qualitySummary || selectedItem.snippet || '暂无概要'}
                    </div>

                    <div className="mt-5 text-[10px] uppercase tracking-[0.22em] text-zinc-500">过滤原因</div>
                    <div className="mt-3 rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-4 text-sm leading-7 text-rose-800">
                      {qualityDetail?.qualityReason || selectedItem.qualityReason || selectedItem.filterReason || '未记录过滤原因'}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-[24px] border border-zinc-200 bg-white p-5">
                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                        <ShieldAlert size={13} />
                        质检指标
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3">
                          <div className="text-[10px] tracking-[0.22em] text-zinc-500">处理结论</div>
                          <div className="mt-2 text-lg font-semibold text-zinc-950">{qualityDetail?.qualityDecision || selectedItem.qualityDecision || '未知'}</div>
                        </div>
                        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3">
                          <div className="text-[10px] tracking-[0.22em] text-zinc-500">置信度</div>
                          <div className="mt-2 text-lg font-semibold text-zinc-950">
                            {typeof qualityDetail?.qualityConfidence === 'number'
                              ? `${Math.round(qualityDetail.qualityConfidence * 100)}%`
                              : typeof selectedItem.qualityConfidence === 'number'
                                ? `${Math.round(selectedItem.qualityConfidence * 100)}%`
                                : 'N/A'}
                          </div>
                        </div>
                      </div>
                      {(qualityDetail?.qualityRiskFlags || selectedItem.qualityRiskFlags || []).length > 0 && (
                        <div className="mt-4">
                          <div className="text-[10px] tracking-[0.22em] text-zinc-500">风险标签</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(qualityDetail?.qualityRiskFlags || selectedItem.qualityRiskFlags || []).map((tag) => (
                              <span key={tag} className={`rounded-full border px-2 py-0.5 text-[10px] ${toneForTag(tag)}`}>{tag}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="rounded-[24px] border border-zinc-200 bg-white p-5">
                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                        <AlertTriangle size={13} />
                        审计痕迹
                      </div>
                      <div className="mt-3 space-y-3 text-xs leading-6 text-zinc-600">
                        <div>过滤桶：{qualityDetail?.filterBucket || selectedItem.filterBucket || 'filtered'}</div>
                        <div>已质检：{formatDateLabel(qualityDetail?.qualityCheckedAt || selectedItem.qualityCheckedAt)}</div>
                        <div>恢复状态：{qualityDetail?.restoredFromFilter || selectedItem.restoredFromFilter ? '已恢复过' : '未恢复'}</div>
                        {qualityDetail?.latestCheck?.modelConfigId && <div>模型配置：{qualityDetail.latestCheck.modelConfigId}</div>}
                        {qualityDetail?.latestCheck?.promptTemplateId && <div>提示词模板：{qualityDetail.latestCheck.promptTemplateId}</div>}
                        {qualityDetail?.latestCheck?.responsePreview && (
                          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-[11px] leading-6 text-zinc-500">
                            {qualityDetail.latestCheck.responsePreview}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {(selectedItem.content || selectedItem.snippet) && (
                  <div className="rounded-[24px] border border-zinc-200 bg-white p-5">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">原始预览</div>
                    <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-zinc-700">
                      {selectedItem.content || selectedItem.snippet}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
