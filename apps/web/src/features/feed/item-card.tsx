import { Check, ExternalLink, MoreHorizontal, Star } from 'lucide-react';
import { useState, useCallback } from 'react';
import type { FeedItemRecord } from '../../lib/api';
import { getContentReadinessMeta, getFeedListPreview, getPrimaryTimeLabel, sourceTierBadge } from './presentation';
import { useSwipe } from '../../lib/use-swipe';

type FeedItemCardProps = {
  item: FeedItemRecord;
  selected: boolean;
  onOpen: (item: FeedItemRecord) => void;
  onFilterSource: (item: FeedItemRecord) => void;
  onToggleFavorite: (item: FeedItemRecord) => void;
  onMarkRead?: (item: FeedItemRecord) => void;
};

export function FeedItemCard({
  item,
  selected,
  onOpen,
  onFilterSource,
  onToggleFavorite,
  onMarkRead,
}: FeedItemCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const preview = getFeedListPreview(item);
  const timeLabel = getPrimaryTimeLabel(item);
  // 判断"值不值得读"所需的三个信号，此前只在详情页可见，导致列表必须逐条点开才能筛选
  const tierBadge = sourceTierBadge(item);
  const readiness = getContentReadinessMeta(item);

  const handleSwipeLeft = useCallback(() => {
    onMarkRead?.(item);
  }, [item, onMarkRead]);

  const handleSwipeRight = useCallback(() => {
    onToggleFavorite(item);
  }, [item, onToggleFavorite]);

  const { offsetX, isDragging, triggered, handlers } = useSwipe({
    onSwipeLeft: handleSwipeLeft,
    onSwipeRight: handleSwipeRight,
  });

  return (
    <div className="relative overflow-hidden" {...handlers}>
      {/* Swipe action backgrounds */}
      {(isDragging || triggered) && (
        <>
          {/* Right swipe = favorite (yellow) */}
          <div className="absolute inset-y-0 left-0 flex w-24 items-center justify-center bg-amber-400 text-white">
            <Star size={22} className="fill-white" />
          </div>
          {/* Left swipe = mark read (green) */}
          <div className="absolute inset-y-0 right-0 flex w-24 items-center justify-center bg-emerald-500 text-white">
            <Check size={22} />
          </div>
        </>
      )}
      <div
        data-feed-item-card
        className={`group cursor-pointer px-4 py-3.5 transition-colors ${isDragging ? '' : 'transition-transform duration-200'} ${item.isRead ? 'opacity-70' : ''} ${selected ? 'border-l-2 border-teal-700 bg-teal-50/60' : 'hover:bg-zinc-50'} ${triggered === 'left' ? 'bg-emerald-50' : triggered === 'right' ? 'bg-amber-50' : 'bg-white'}`}
        style={{ transform: offsetX ? `translateX(${offsetX}px)` : undefined }}
        onClick={() => onOpen(item)}
      >
      <div className="flex items-start gap-3">
        <div className="mt-2 shrink-0">
          {!item.isRead
            ? <div className="h-2.5 w-2.5 rounded-full bg-teal-500 shadow-[0_0_0_4px_rgba(20,184,166,0.14)]" />
            : <div className="h-2.5 w-2.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 data-feed-list-card-title className={`line-clamp-2 text-[15px] leading-6 ${item.isRead ? 'font-medium text-zinc-500' : 'font-semibold text-zinc-900'}`}>{item.title}</h3>
          {preview ? <p className={`mt-2 line-clamp-2 text-xs leading-5 ${preview.className}`}>{preview.text}</p> : null}
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
            {tierBadge?.label ? (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${tierBadge.className}`}>{tierBadge.label}</span>
            ) : null}
            {item.aiScore != null ? (
              <span
                title="AI 相关性评分"
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                  item.aiScore >= 80 ? 'bg-teal-100 text-teal-700'
                    : item.aiScore >= 60 ? 'bg-zinc-100 text-zinc-600'
                      : 'bg-zinc-50 text-zinc-400'
                }`}
              >
                {item.aiScore} 分
              </span>
            ) : null}
            {readiness.label ? (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${readiness.className}`}>{readiness.label}</span>
            ) : null}
            <button
              type="button"
              title={`按来源筛选：${item.sourceName || '未知信源'}`}
              onClick={(event) => { event.stopPropagation(); onFilterSource(item); }}
              className="inline-flex min-h-7 max-w-[170px] items-center truncate rounded-full border border-zinc-200 bg-white px-2 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-zinc-500 hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700"
            >
              {item.sourceName || '未知信源'}
            </button>
            {timeLabel ? <span>{timeLabel}</span> : null}
          </div>
        </div>
        {item.mediaUrl && item.mediaType === 'image' ? (
          <img src={item.mediaUrl} alt="" className="mt-1 h-20 w-20 shrink-0 rounded-xl border border-zinc-200 object-cover" />
        ) : null}
        {/* Hover menu: combines favorite, open original, more */}
        <div className="relative flex shrink-0 items-center opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          <button
            type="button"
            aria-label="更多操作"
            title="更多操作"
            onClick={(event) => { event.stopPropagation(); setMenuOpen((v) => !v); }}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 shadow-sm transition-colors hover:bg-zinc-100 md:h-auto md:w-auto md:border-0 md:bg-transparent md:p-1.5 md:shadow-none"
          >
            <MoreHorizontal size={16} className="text-zinc-400" />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-full z-40 mt-1 w-36 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg"
              onClick={(event) => event.stopPropagation()}
              onMouseLeave={() => setMenuOpen(false)}
            >
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); onToggleFavorite(item); setMenuOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50"
              >
                <Star size={13} className={item.isFavorite ? 'fill-amber-400 text-amber-400' : 'text-zinc-400'} />
                {item.isFavorite ? '取消收藏' : '收藏'}
              </button>
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => { event.stopPropagation(); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50"
                >
                  <ExternalLink size={13} className="text-zinc-400" />
                  打开原文
                </a>
              )}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
