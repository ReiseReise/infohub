import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useMemo } from 'react';
import {
  feedDetailHeaderClassName,
  feedTranslationActionLabel,
  resolveFeedDetailHeaderActions,
  resolveFeedDisplayTitle,
  resolveFeedTranslationAction,
  shouldDisableFeedTranslationAction,
  shouldOfferFeedFullTranslation,
} from '../../lib/feed-layout';
import { formatAbsoluteTime, getPrimaryTimeLabel, sourceTierBadge, timeAgo } from './presentation';
import { useFeedContext } from './FeedContext';

function getCollectorLabel(item?: { sourceCollectorType?: string | null; mediaType?: string | null; sourceType?: string | null } | null) {
  if (item?.sourceCollectorType === 'changedetection') return '网页变更';
  if (item?.sourceCollectorType === 'webpage') return '网页快照';
  if (item?.mediaType === 'audio') return '播客';
  return item?.sourceType || '条目';
}

export function FeedReaderHeader() {
  const { selectedItem, stageReprocessing, handleTranslationPrimaryAction, handleReturnToList } = useFeedContext();

  const selectedHost = useMemo(() => {
    const displayUrl = selectedItem?.originalUrl || selectedItem?.url;
    if (!displayUrl) return '';
    try { return new URL(displayUrl).hostname.replace(/^www\./, ''); } catch { return ''; }
  }, [selectedItem?.originalUrl, selectedItem?.url]);

  if (!selectedItem) return null;

  const displayTitle = resolveFeedDisplayTitle(selectedItem);
  const translationAction = resolveFeedTranslationAction(selectedItem);
  const translationLabel = feedTranslationActionLabel(translationAction);
  const translationDisabled = shouldDisableFeedTranslationAction(stageReprocessing, selectedItem.id);
  const feedDetailActionInput = {
    hasUrl: Boolean(selectedItem.url),
    hasOriginalUrl: Boolean(selectedItem.originalUrl),
    hasCurationUrl: Boolean(selectedItem.curationUrl && selectedItem.curationUrl !== (selectedItem.originalUrl || selectedItem.url)),
    hasAudio: selectedItem.mediaType === 'audio' || Boolean(selectedItem.mediaUrl),
    hasAudioTask: Boolean(selectedItem.audioTaskId),
    needsFullTranslation: translationAction === 'translate' || translationAction === 'fetch_then_translate' || shouldOfferFeedFullTranslation(selectedItem),
    canReprocessAi: true,
    canEnrichContent: true,
  };
  const headerActionKeys = resolveFeedDetailHeaderActions(feedDetailActionInput);
  const tierMeta = sourceTierBadge(selectedItem);

  return (
    <div data-feed-detail-header className="sticky top-0 z-30 border-b border-zinc-100 bg-white/95 px-5 py-4 backdrop-blur xl:shrink-0">
      <button type="button" onClick={handleReturnToList} className="mb-3 inline-flex min-h-9 items-center rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm md:hidden">
        返回列表
      </button>
      <div className={feedDetailHeaderClassName}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.24em] text-teal-700/70">{getCollectorLabel(selectedItem)}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${tierMeta.className}`}>{tierMeta.label}</span>
            {selectedItem.aiScore != null && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700">评分 {selectedItem.aiScore}</span>
            )}
          </div>
          <h2 data-feed-detail-title tabIndex={-1} className="mt-2 text-2xl font-semibold leading-9 tracking-tight text-zinc-950 outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:rounded">{displayTitle.title}</h2>
          {displayTitle.originalTitle && (
            <div className="mt-1 text-sm leading-6 text-zinc-500">原题：{displayTitle.originalTitle}</div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>{selectedItem.sourceName || '未知信源'}{selectedHost ? ` / ${selectedHost}` : ''}</span>
            {selectedItem.publishedAt && (
              <span>发布时间 {formatAbsoluteTime(selectedItem.publishedAt)}{getPrimaryTimeLabel(selectedItem) ? ` · ${timeAgo(selectedItem.publishedAt)}` : ''}</span>
            )}
            {selectedItem.fetchedAt && (
              <span>抓取时间 {formatAbsoluteTime(selectedItem.fetchedAt)}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {headerActionKeys.includes('open_original') && (
            <a href={selectedItem.originalUrl || selectedItem.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950">
              打开{selectedItem.originalUrl ? '原站' : '原文'} <ExternalLink size={13} />
            </a>
          )}
          {headerActionKeys.includes('full_translation') && (
            <button type="button" onClick={() => { handleTranslationPrimaryAction(selectedItem); }} disabled={translationDisabled} className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-50">
              {stageReprocessing?.itemId === selectedItem.id && stageReprocessing.stage === 'translation' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {translationLabel || '翻译全文'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
