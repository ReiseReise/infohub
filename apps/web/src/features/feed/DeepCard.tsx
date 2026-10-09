import { Star, Check, Bookmark, MessageSquare, Highlighter } from 'lucide-react';
import { useCallback } from 'react';
import type { FeedItemRecord } from '../../lib/api';
import { getPrimaryTimeLabel, getPreferredReaderSourceText, normalizeAiSummary } from './presentation';
import { useSwipe } from '../../lib/use-swipe';

type DeepCardProps = {
  item: FeedItemRecord;
  selected: boolean;
  onOpen: (item: FeedItemRecord) => void;
  onFilterSource: (item: FeedItemRecord) => void;
  onToggleFavorite: (item: FeedItemRecord) => void;
  onMarkRead?: (item: FeedItemRecord) => void;
};

function estimateReadingTime(text: string): string {
  const charCount = text.replace(/\s+/g, '').length;
  const minutes = Math.max(1, Math.round(charCount / 500));
  return `${minutes} 分钟阅读`;
}

function getContentPreview(item: FeedItemRecord): string {
  const raw = getPreferredReaderSourceText(item) || normalizeAiSummary(item.aiSummary) || item.snippet || '';
  const cleaned = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= 300) return cleaned;
  // Don't cut mid-word: find the last space before 300
  const truncated = cleaned.slice(0, 300);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 200 ? truncated.slice(0, lastSpace) : truncated) + '…';
}

export function DeepCard({
  item,
  selected,
  onOpen,
  onFilterSource,
  onToggleFavorite,
  onMarkRead,
}: DeepCardProps) {
  const timeLabel = getPrimaryTimeLabel(item);
  const contentPreview = getContentPreview(item);
  const readTime = contentPreview ? estimateReadingTime(contentPreview) : '';

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
            <Star size={20} className="fill-white" />
          </div>
          <div className="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-emerald-500 text-white">
            <Check size={20} />
          </div>
        </>
      )}
      <div
        data-feed-item-card
        className={`group cursor-pointer px-5 py-4 transition-colors ${isDragging ? '' : 'transition-transform duration-200'} ${item.isRead ? 'opacity-65' : ''} ${selected ? 'border-l-2 border-teal-700 bg-teal-50/60' : 'hover:bg-zinc-50'} ${triggered === 'left' ? 'bg-emerald-50' : triggered === 'right' ? 'bg-amber-50' : 'bg-white'}`}
        style={{ transform: offsetX ? `translateX(${offsetX}px)` : undefined }}
        onClick={() => onOpen(item)}
      >
        {/* Title */}
        <h3 className={`text-base leading-7 ${item.isRead ? 'font-semibold text-zinc-500' : 'font-bold text-zinc-900'}`}>
          {item.title}
        </h3>

        {/* Meta: source + time + reading time */}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onFilterSource(item); }}
            className="font-medium text-zinc-500 hover:text-teal-700"
          >
            {item.sourceName || '未知信源'}
          </button>
          {timeLabel && <span>· {timeLabel}</span>}
          {readTime && <span>· {readTime}</span>}
        </div>

        {/* Content preview (prose style) */}
        {contentPreview && (
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            {contentPreview}
          </p>
        )}

        {/* Tags */}
        {item.aiTags && item.aiTags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.aiTags.map((tag) => (
              <span key={tag} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Action bar */}
        <div className="mt-3 flex items-center gap-3 border-t border-zinc-100 pt-2.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(item); }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            title={item.isFavorite ? '取消收藏' : '收藏'}
          >
            <Bookmark size={13} className={item.isFavorite ? 'fill-amber-400 text-amber-400' : ''} />
            收藏
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen(item); }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            title="划线"
          >
            <Highlighter size={13} />
            划线
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen(item); }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            title="点评"
          >
            <MessageSquare size={13} />
            点评
          </button>
        </div>
      </div>
    </div>
  );
}
