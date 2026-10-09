import { BarChart3, BookOpen, CheckCheck, ChevronDown, Filter, LayoutGrid, List, Loader2, PanelLeftClose, PanelLeftOpen, RefreshCw, Search, SkipForward } from 'lucide-react';
import type { FeedViewMode } from './FeedContext';
import type { FeedItemRecord } from '../../lib/api';
import { feedTopbarClassName, feedTopbarToolbarClassName, resolveFeedFreshnessPill } from '../../lib/feed-layout';
import type { FeedScoreBand, FeedSortMode } from '../../lib/feed-query-state';
import { SOURCE_READING_TIER_OPTIONS } from '../../lib/source-reading-tier';
import { sourceTierBadge } from './presentation';
import { useFeedContext } from './FeedContext';

type FeedItem = FeedItemRecord;

const SOURCE_TIER_FILTERS = ['S', 'A', 'B', 'C', 'D'] as const;
const GROWTH_AXIS_FILTERS = ['认知升级', '技术能力', '商业判断', '表达输出'] as const;
const SCORE_BAND_FILTERS: Array<{ value: FeedScoreBand; label: string }> = [
  { value: 'all', label: '全部评分' },
  { value: '80', label: '80+' },
  { value: '70', label: '70-79' },
  { value: '60', label: '60-69' },
  { value: 'below60', label: '60以下' },
];

export function FeedToolbar() {
  const ctx = useFeedContext();
  const {
    stats, searchInput, setSearchInput, filter, setFilter, sortMode, setSortMode,
    sourceId, sourceTierFilter, setSourceTierFilter, readingTierFilter, setReadingTierFilter,
    growthAxisFilter, setGrowthAxisFilter, scoreBand, setScoreBand, category, setCategory,
    categories, sourcePaneCollapsed, setSourcePaneCollapsed, setMobileSourceOpen,
    advancedFiltersOpen, setAdvancedFiltersOpen, fetching, dueRefreshing, fetchStatus,
    setOffset, updateListQuery, handleSearch, handleTriggerFetch, handleNextUnread, handleMarkAllRead,
    triggerDueSources, sourceRail,
  } = ctx;

  const freshnessPill = resolveFeedFreshnessPill(fetchStatus);
  const selectedSource = sourceRail.find((s) => String(s.id) === sourceId) || null;

  const activeFilterChips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (sourceId) {
    activeFilterChips.push({ key: 'source', label: selectedSource ? `来源：${selectedSource.name}` : '来源筛选', clear: () => { ctx.setSourceId(''); setOffset(0); updateListQuery({ sourceId: '' }); } });
  }
  if (scoreBand !== 'all') {
    activeFilterChips.push({ key: 'score', label: `评分：${SCORE_BAND_FILTERS.find((e) => e.value === scoreBand)?.label || scoreBand}`, clear: () => { setScoreBand('all'); setOffset(0); updateListQuery({ score: 'all' }); } });
  }
  if (sourceTierFilter) {
    activeFilterChips.push({ key: 'tier', label: `等级：${sourceTierBadge({ sourceTier: sourceTierFilter } as FeedItem).label}`, clear: () => { setSourceTierFilter(''); setOffset(0); updateListQuery({ sourceTier: '' }); } });
  }
  if (readingTierFilter) {
    activeFilterChips.push({ key: 'reading-tier', label: `分层：${SOURCE_READING_TIER_OPTIONS.find((o) => o.value === readingTierFilter)?.label || readingTierFilter}`, clear: () => { setReadingTierFilter(''); setOffset(0); updateListQuery({ readingTier: '' }); } });
  }
  if (growthAxisFilter) {
    activeFilterChips.push({ key: 'growth', label: `成长：${growthAxisFilter}`, clear: () => { setGrowthAxisFilter(''); setOffset(0); updateListQuery({ growthAxis: '' }); } });
  }
  if (category) {
    activeFilterChips.push({ key: 'category', label: `分类：${category}`, clear: () => { setCategory(''); setOffset(0); updateListQuery({ category: '' }); } });
  }

  return (
    <div data-feed-topbar className={feedTopbarClassName}>
      <div className={feedTopbarToolbarClassName}>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="shrink-0 text-base font-semibold tracking-tight text-zinc-950">信息流</h1>
            {stats && (
              <p className="min-w-0 truncate text-xs text-zinc-500">
                <span className="font-medium text-teal-700">{stats.unread.toLocaleString()} 未读</span>
                <span className="mx-1 text-zinc-300">/</span>
                <span>{stats.today.toLocaleString()} 今日</span>
              </p>
            )}
            {freshnessPill ? (
              <button
                type="button"
                onClick={() => void triggerDueSources()}
                disabled={dueRefreshing}
                className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-5 ${freshnessPill.tone === 'danger' ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'} disabled:opacity-50`}
                title={freshnessPill.detail}
              >
                <span className="shrink-0 font-semibold">{dueRefreshing ? '补抓中...' : freshnessPill.label}</span>
              </button>
            ) : null}
          </div>
        </div>

        <form onSubmit={handleSearch} className="relative min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            data-feed-search-input
            aria-label="搜索标题或内容"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索标题或内容..."
            className="h-9 w-full rounded-xl border border-zinc-200 bg-white py-2 pl-10 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600/10"
          />
          <button type="submit" data-feed-search-submit className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700" aria-label="执行搜索" title="执行搜索">
            <Search size={14} />
          </button>
        </form>

        <div className="flex min-w-0 shrink-0 overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-50 p-1">
          {(['all', 'unread', 'favorites'] as const).map((f) => (
            <button key={f} onClick={() => { setFilter(f); setOffset(0); updateListQuery({ filter: f }); }} className={`min-h-9 shrink-0 rounded-lg px-3 py-1.5 text-xs transition-colors ${filter === f ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
              {f === 'all' ? '全部' : f === 'unread' ? `未读${stats ? ` (${stats.unread})` : ''}` : '收藏'}
            </button>
          ))}
        </div>

        <div className="flex min-w-0 shrink-0 overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-50 p-1">
          {([{ value: 'priority', label: '推荐' }, { value: 'latest', label: '最新' }] as Array<{ value: FeedSortMode; label: string }>).map((option) => (
            <button key={option.value} onClick={() => { setSortMode(option.value); setOffset(0); updateListQuery({ sort: option.value }); }} className={`min-h-9 shrink-0 rounded-lg px-3 py-1.5 text-xs transition-colors ${sortMode === option.value ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex shrink-0 items-center rounded-xl border border-zinc-200 bg-zinc-50 p-1" title="视图模式">
          {([
            { mode: 'dense' as FeedViewMode, icon: List, tip: '高密度' },
            { mode: 'comfortable' as FeedViewMode, icon: LayoutGrid, tip: '舒适阅读' },
            { mode: 'deep' as FeedViewMode, icon: BookOpen, tip: '深度阅读' },
          ] as const).map(({ mode, icon: Icon, tip }) => (
            <button
              key={mode}
              type="button"
              title={tip}
              onClick={() => ctx.setViewMode(mode)}
              className={`inline-flex min-h-8 shrink-0 items-center justify-center rounded-lg px-2 py-1.5 transition-colors ${
                ctx.viewMode === mode
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2">
          <button type="button" data-feed-filters-toggle onClick={() => setAdvancedFiltersOpen((v) => !v)} className={`inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition-colors ${advancedFiltersOpen ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'}`}>
            <Filter size={14} /> 筛选
            {activeFilterChips.length > 0 ? <span className="rounded-full bg-white/20 px-1.5">{activeFilterChips.length}</span> : null}
          </button>
          <details className="relative shrink-0">
            <summary className="inline-flex min-h-9 cursor-pointer list-none items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50">
              <ChevronDown size={14} /> 工具
            </summary>
            <div className="absolute right-0 z-30 mt-2 w-44 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl">
              <button type="button" onClick={() => { const nextTier = readingTierFilter === 'high_value' ? '' : 'high_value'; setReadingTierFilter(nextTier); setOffset(0); updateListQuery({ readingTier: nextTier }); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-50">
                <BookOpen size={14} /> {readingTierFilter === 'high_value' ? '退出核心精读' : '只看核心精读'}
              </button>
              <button type="button" onClick={() => { setSortMode('score'); setOffset(0); updateListQuery({ sort: 'score' }); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-50">
                <BarChart3 size={14} /> 按评分排序
              </button>
              <button type="button" data-feed-mobile-filter-toggle onClick={() => setMobileSourceOpen((v) => !v)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-50 xl:hidden">
                <PanelLeftOpen size={14} /> 来源/筛选
              </button>
              <button type="button" onClick={() => setSourcePaneCollapsed((v) => !v)} className="hidden w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-50 xl:flex">
                {sourcePaneCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
                {sourcePaneCollapsed ? '显示来源' : '收起来源'}
              </button>
              <button onClick={() => { void handleTriggerFetch(); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-teal-800 hover:bg-teal-50">
                {fetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} 采集
              </button>
              <button onClick={handleNextUnread} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-50">
                <SkipForward size={14} /> 下一条
              </button>
              <button onClick={() => { void handleMarkAllRead(); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-50">
                <CheckCheck size={14} /> 全部已读
              </button>
            </div>
          </details>
        </div>
      </div>

      {activeFilterChips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-2">
          {activeFilterChips.map((chip) => (
            <button key={chip.key} type="button" onClick={chip.clear} className="rounded-full border border-teal-100 bg-teal-50 px-2.5 py-1 text-xs text-teal-800 hover:bg-teal-100">
              {chip.label} ×
            </button>
          ))}
          <button type="button" onClick={() => { ctx.setSourceId(''); setSourceTierFilter(''); setReadingTierFilter(''); setGrowthAxisFilter(''); setScoreBand('all'); setCategory(''); setOffset(0); updateListQuery({ sourceId: '', sourceTier: '', readingTier: '', growthAxis: '', score: 'all', category: '' }); }} className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500 hover:bg-zinc-50">
            清除全部
          </button>
        </div>
      )}

      {advancedFiltersOpen && (
        <div data-feed-advanced-filters className="mt-3 grid gap-2 border-t border-zinc-100 pt-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="relative">
            <select aria-label="阅读分层" data-feed-reading-tier-select value={readingTierFilter} onChange={(e) => { setReadingTierFilter(e.target.value); setOffset(0); updateListQuery({ readingTier: e.target.value }); }} className="w-full appearance-none rounded-xl border border-zinc-200 bg-white py-2.5 pl-3 pr-7 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-teal-600/10">
              <option value="">全部阅读分层</option>
              {SOURCE_READING_TIER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400" />
          </div>
          <div className="relative">
            <select aria-label="评分区间" data-feed-score-select value={scoreBand} onChange={(e) => { const v = e.target.value as FeedScoreBand; setScoreBand(v); setOffset(0); updateListQuery({ score: v }); }} className="w-full appearance-none rounded-xl border border-zinc-200 bg-white py-2.5 pl-3 pr-7 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-teal-600/10">
              {SCORE_BAND_FILTERS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
            <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400" />
          </div>
          <div className="relative">
            <select aria-label="信源等级" value={sourceTierFilter} onChange={(e) => { setSourceTierFilter(e.target.value); setOffset(0); updateListQuery({ sourceTier: e.target.value }); }} className="w-full appearance-none rounded-xl border border-zinc-200 bg-white py-2.5 pl-3 pr-7 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-teal-600/10">
              <option value="">全部等级</option>
              {SOURCE_TIER_FILTERS.map((tier) => <option key={tier} value={tier}>{sourceTierBadge({ sourceTier: tier } as FeedItem).label}</option>)}
            </select>
            <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400" />
          </div>
          <div className="relative">
            <select aria-label="成长维度" value={growthAxisFilter} onChange={(e) => { setGrowthAxisFilter(e.target.value); setOffset(0); updateListQuery({ growthAxis: e.target.value }); }} className="w-full appearance-none rounded-xl border border-zinc-200 bg-white py-2.5 pl-3 pr-7 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-teal-600/10">
              <option value="">全部成长维度</option>
              {GROWTH_AXIS_FILTERS.map((axis) => <option key={axis} value={axis}>{axis}</option>)}
            </select>
            <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400" />
          </div>
          {categories.length > 0 && (
            <div className="relative">
              <select aria-label="内容分类" value={category} onChange={(e) => { setCategory(e.target.value); setOffset(0); updateListQuery({ category: e.target.value }); }} className="w-full appearance-none rounded-xl border border-zinc-200 bg-white py-2.5 pl-3 pr-7 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-teal-600/10">
                <option value="">全部分类</option>
                {categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </select>
              <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
