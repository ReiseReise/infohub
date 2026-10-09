import { Star, Check } from 'lucide-react';
import { useCallback } from 'react';
import type { FeedItemRecord } from '../../lib/api';
import { cleanFeedPreviewText, normalizeAiSummary, getPrimaryTimeLabel, sourceTierBadge } from './presentation';
import { useSwipe } from '../../lib/use-swipe';

type DenseCardProps = {
  item: FeedItemRecord;
  selected: boolean;
  onOpen: (item: FeedItemRecord) => void;
  onFilterSource: (item: FeedItemRecord) => void;
  onToggleFavorite: (item: FeedItemRecord) => void;
  onMarkRead?: (item: FeedItemRecord) => void;
};

export function DenseCard({
  item,
  selected,
  onOpen,
  onFilterSource,
  onToggleFavorite,
  onMarkRead,
}: DenseCardProps) {
  const timeLabel = getPrimaryTimeLabel(item);
  const tier = sourceTierBadge(item);
  const summary = cleanFeedPreviewText(normalizeAiSummary(item.aiSummary)) || cleanFeedPreviewText(item.snippet) || '';

  const handleSwipeLeft = useCallback(() => { onMarkRead?.(item); }, [item, onMarkRead]);
  const handleSwipeRight = useCallback(() => { onToggleFavorite(item); }, [item, onToggleFavorite]);

  const { offsetX, isDragging, triggered, handlers } = useSwipe({
    onSwipeLeft: handleSwipeLeft,
    onSwipeRight: handleSwipeRight,
  });

  return (
    <div className="relative overflow-hidden" {...handlers}>
      {(isDragging || triggered) && (
        <>
          <div className="absolute inset-y-0 left-0 flex w-20 items-center justify-center bg-amber-400 text-white">
            <Star size={18} className="fill-white" />
          </div>
          <div className="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-emerald-500 text-white">
            <Check size={18} />
          </div>
        </>
      )}
      <div
        data-feed-item-card
        className={`group cursor-pointer px-4 py-2 transition-colors ${isDragging ? '' : 'transition-transform duration-200'} ${item.isRead ? 'opacity-60' : ''} ${selected ? 'border-l-2 border-teal-700 bg-teal-50/60' : 'hover:bg-zinc-50'} ${triggered === 'left' ? 'bg-emerald-50' : triggered === 'right' ? 'bg-amber-50' : 'bg-white'}`}
        style={{ transform: offsetX ? `translateX(${offsetX}px)` : undefined }}
        onClick={() => onOpen(item)}
      >
        {/* Row 1: time / source / score */}
        <div className="flex items-center gap-2 text-[10px] text-zinc-400">
          {timeLabel && <span>{timeLabel}</span>}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onFilterSource(item); }}
            className="truncate font-medium uppercase tracking-wide text-zinc-500 hover:text-teal-700"
          >
            {item.sourceName || '未知信源'}
          </button>
          {item.aiScore != null && (
            <span className={`rounded px-1 py-0.5 text-[9px] font-semibold ${item.aiScore >= 80 ? 'bg-teal-100 text-teal-700' : item.aiScore >= 60 ? 'bg-zinc-100 text-zinc-600' : 'bg-zinc-50 text-zinc-400'}`}>
              {item.aiScore}分
            </span>
          )}
          <span className={`rounded px-1 py-0.5 text-[9px] font-medium ${tier.className}`}>{tier.label}</span>
        </div>

        {/* Row 2: title */}
        <h3 className={`mt-0.5 line-clamp-1 text-sm leading-5 ${item.isRead ? 'font-medium text-zinc-500' : 'font-semibold text-zinc-900'}`}>
          {item.title}
        </h3>

        {/* Row 3: summary */}
        {summary && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-zinc-400">{summary}</p>
        )}

        {/* Row 4: tags + recommendation reason */}
        {(item.aiTags?.length || item.rankContext?.reasons?.length) && (
          <div className="mt-1 flex items-center gap-1.5 text-[10px]">
            {item.aiTags?.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-500">{tag}</span>
            ))}
            {item.rankContext?.reasons?.[0] && (
              <>
                <span className="text-zinc-300">|</span>
                <span className="line-clamp-1 italic text-zinc-400">{item.rankContext.reasons[0]}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
