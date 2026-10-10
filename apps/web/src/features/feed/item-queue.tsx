import { useRef, useMemo, type PointerEventHandler, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FeedItemRecord, ItemsStats } from '../../lib/api';
import type { FeedViewMode } from './FeedContext';
import { FeedItemCard } from './item-card';
import { DenseCard } from './DenseCard';
import { DeepCard } from './DeepCard';

interface FeedItemQueueProps {
  panelRef: RefObject<HTMLDivElement | null>;
  title: string;
  items: FeedItemRecord[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  sourceId: string;
  stats: ItemsStats | null;
  selectedId: string | null;
  nextPageOffset: number | null;
  viewMode: FeedViewMode;
  onResizeStart: PointerEventHandler<HTMLButtonElement>;
  onOpen: (item: FeedItemRecord) => void;
  onFilterSource: (item: FeedItemRecord) => void;
  onToggleFavorite: (item: FeedItemRecord) => void;
  onMarkRead?: (item: FeedItemRecord) => void;
  onLoadMore: (offset: number) => void;
}

export function FeedItemQueue({
  panelRef,
  title,
  items,
  total,
  loading,
  loadingMore,
  sourceId,
  stats,
  selectedId,
  nextPageOffset,
  viewMode,
  onResizeStart,
  onOpen,
  onFilterSource,
  onToggleFavorite,
  onMarkRead,
  onLoadMore,
}: FeedItemQueueProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const hasLoadMore = nextPageOffset !== null;
  const virtualCount = items.length + (hasLoadMore ? 1 : 0);

  const estimateSize = useMemo(() => {
    const sizes: Record<FeedViewMode, number> = { dense: 80, comfortable: 100, deep: 250 };
    return () => sizes[viewMode];
  }, [viewMode]);

  const virtualizer = useVirtualizer({
    count: virtualCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize,
    overscan: 5,
  });

  return (
    <div
      data-feed-list-pane
      id="feed-list-panel"
      ref={panelRef}
      className="relative min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_18px_55px_-48px_rgba(15,23,42,0.45)] [overflow-anchor:none] xl:flex xl:min-h-0 xl:flex-col"
    >
      <div data-feed-queue-header className="shrink-0 border-b border-zinc-100 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-sm font-semibold text-zinc-900">{title}</div>
          <div className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600">
            {items.length}/{total}
          </div>
        </div>
      </div>
      <button
        type="button"
        data-feed-list-resize-handle
        aria-label="调整文章队列宽度"
        aria-orientation="vertical"
        title="拖动调整文章队列宽度"
        onPointerDown={onResizeStart}
        className="absolute right-0 top-0 z-30 hidden h-full w-2 cursor-col-resize touch-none border-r border-transparent bg-transparent transition-colors hover:border-teal-300 hover:bg-teal-50/60 xl:block"
      />
      {loading ? (
        <div className="py-20 text-center text-zinc-400">加载中...</div>
      ) : items.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="text-base font-semibold text-zinc-800">当前筛选下没有可读内容</div>
          <div className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-500">
            {sourceId
              ? '该来源可能暂无主 Feed 可读内容，或内容已进入过滤池。'
              : '当前账号主 Feed 暂无可读内容。请先查看数据漏斗，确认是账号无数据、内容被过滤，还是历史过滤状态尚未回补。'}
          </div>
          {stats?.funnel && (
            <div className="mx-auto mt-5 grid max-w-lg grid-cols-2 gap-2 text-left sm:grid-cols-4">
              <div className="rounded-2xl bg-zinc-50 px-3 py-3"><div className="text-[11px] text-zinc-500">库存</div><div className="mt-1 text-lg font-semibold text-zinc-900">{stats.funnel.allItems}</div></div>
              <div className="rounded-2xl bg-zinc-50 px-3 py-3"><div className="text-[11px] text-zinc-500">可读</div><div className="mt-1 text-lg font-semibold text-teal-700">{stats.funnel.visibleItems}</div></div>
              <div className="rounded-2xl bg-zinc-50 px-3 py-3"><div className="text-[11px] text-zinc-500">过滤池</div><div className="mt-1 text-lg font-semibold text-amber-700">{stats.funnel.filteredBucketItems}</div></div>
              <div className="rounded-2xl bg-zinc-50 px-3 py-3"><div className="text-[11px] text-zinc-500">错位</div><div className="mt-1 text-lg font-semibold text-rose-700">{stats.funnel.mismatchedFilteredMain}</div></div>
            </div>
          )}
          {stats?.funnel?.mismatchedFilteredMain ? (
            <div className="mx-auto mt-4 max-w-md rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs leading-5 text-rose-700">
              仍有 {stats.funnel.mismatchedFilteredMain} 条历史内容处于过滤状态错位，需要执行过滤路由回补后再刷新。
            </div>
          ) : null}
        </div>
      ) : (
        <div
          data-feed-list-scroll
          ref={scrollContainerRef}
          role="feed"
          aria-label="文章列表"
          aria-busy={loading}
          className="max-h-[72vh] overflow-y-auto xl:max-h-none xl:min-h-0 xl:flex-1"
        >
          <div
            style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const isLoadMoreRow = virtualRow.index === items.length;
              if (isLoadMoreRow) {
                return (
                  <div
                    key="load-more"
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                  >
                    <div className="px-4 py-4">
                      <button
                        type="button"
                        disabled={loadingMore}
                        onClick={() => onLoadMore(nextPageOffset!)}
                        className="flex w-full items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50"
                      >
                        {loadingMore ? '加载中...' : `加载更多（已显示 ${items.length} / ${total}）`}
                      </button>
                    </div>
                  </div>
                );
              }
              const item = items[virtualRow.index];
              const cardProps = {
                item,
                selected: selectedId === item.id,
                onOpen,
                onFilterSource,
                onToggleFavorite,
                onMarkRead,
              };
              return (
                <div
                  key={item.id}
                  role="article"
                  aria-selected={selectedId === item.id}
                  aria-label={item.title}
                  tabIndex={selectedId === item.id ? 0 : -1}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className={viewMode === 'dense' ? 'border-b border-zinc-50' : 'border-b border-zinc-100'}
                >
                  {viewMode === 'dense' ? (
                    <DenseCard {...cardProps} />
                  ) : viewMode === 'deep' ? (
                    <DeepCard {...cardProps} />
                  ) : (
                    <FeedItemCard {...cardProps} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
