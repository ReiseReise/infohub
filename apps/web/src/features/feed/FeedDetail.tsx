import { JevPanel } from '../../components/JevPanel';
import { Copy, ExternalLink, FileText, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, type CSSProperties } from 'react';
import type { FeedItemRecord } from '../../lib/api';
import {
  getDetailEmptyState,
  type NoticeTone,
} from '../../lib/feed-diagnostics';
import {
  feedReaderBodyShellClassName,
  feedReaderMainColumnClassName,
  feedTranslationActionLabel,
  resolveFeedDetailOrderClassName,
  resolveFeedEvidenceNotice,
  resolveFeedOriginalDisplayContent,
  resolveFeedReaderTabOrder,
  resolveFeedSecondaryTabOrder,
  resolveFeedSourceMismatchNotice,
  resolveFeedTranslationAction,
  resolveFeedTranslationStatusLabel,
  shouldAutoScrollFeedDetailIntoView,
  shouldDisableFeedTranslationAction,
  shouldSurfaceFeedEvidenceNotice,
} from '../../lib/feed-layout';
import { readerFontFamilyCss } from '../../lib/reader-preferences';
import {
  htmlToReadableMarkdown,
  isUsableDisplaySummary,
  isUsableDisplayTranslation,
  looksLikeHtmlFragment,
  plainTextToReadableMarkdown,
} from '../../lib/readable-content';
import {
  ARTICLE_AGENT_PROMPTS,
  findArticleAgentAsset,
  getVisibleReadingAssets,
} from '../../lib/reading-assets';
import { looksLikeMarkdown, MarkdownContent } from '../../components/MarkdownContent';
import { MobilePullClose } from '../../components/MobilePullClose';
import { normalizeAiSummary, getPreferredReaderSourceText } from './presentation';
import { useFeedContext, type DetailSectionKey } from './FeedContext';
import { FeedReaderHeader } from './FeedReaderHeader';
import { FeedAssetDrawer } from './FeedAssetDrawer';

type FeedItem = FeedItemRecord;

type DetailSection = {
  key: DetailSectionKey;
  label: string;
  content?: string | null;
  emptyState: { title: string; reason: string; action: string; tone: 'neutral' | 'warning' | 'danger' };
  isEmpty?: boolean;
  renderMode?: 'auto' | 'markdown' | 'plain' | 'agent';
};

function hasReadableText(value?: string | null): boolean {
  return Boolean(value && value.trim().length > 12);
}

function joinChineseSentences(first: string, second: string) {
  const left = first.trim().replace(/[。！？；;,.，、]+$/u, '');
  const right = second.trim().replace(/^[。！？；;,.，、]+/u, '');
  return left ? `${left}。${right}` : right;
}

function translationStatusLabel(item?: FeedItem | null) {
  const sourceText = getPreferredReaderSourceText(item);
  const translationUsable = item?.translationUsability
    ? item.translationUsability === 'usable'
    : item?.translationStatus === 'ready'
      ? isUsableDisplayTranslation(item.aiTranslation, sourceText)
      : null;
  return resolveFeedTranslationStatusLabel({
    translationCompleteness: item?.translationCompleteness,
    translationStatus: item?.translationStatus,
    translationReason: item?.translationReason,
    aiTranslation: item?.aiTranslation,
    sourceText,
    translationUsable,
  });
}

const NOTICE_CLASS_NAMES: Record<NoticeTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-rose-200 bg-rose-50 text-rose-700',
};
const DETAIL_EMPTY_STATE_CLASS_NAMES = {
  neutral: 'border-zinc-200 bg-zinc-50 text-zinc-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-rose-200 bg-rose-50 text-rose-800',
} as const;
const FEED_EVIDENCE_NOTICE_CLASS_NAMES = {
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  neutral: 'border-zinc-200 bg-zinc-50 text-zinc-600',
} as const;

export function FeedDetail() {
  const ctx = useFeedContext();
  const {
    selectedItem, detailLoading, detailError, detailActionNotice, activeDetailTab, setActiveDetailTab,
    readerPreferences, stageReprocessing, sourceId, sourceRail,
    detailPanelRef, handleTranslationPrimaryAction, handleReturnToList,
    copiedAgentPrompt, generatingAgentPrompt, agentPromptErrors,
    handleCopyArticleAgentPrompt, handleGenerateArticleAsset,
    setSourceId, setOffset, updateListQuery,
  } = ctx;

  const detailActionNoticeMessage = typeof detailActionNotice === 'string' ? detailActionNotice : detailActionNotice?.message;
  const detailActionNoticeTone: NoticeTone = typeof detailActionNotice === 'string' || !detailActionNotice ? 'success' : detailActionNotice.tone;

  const selectedSource = useMemo(() => sourceRail.find((s) => String(s.id) === sourceId) || null, [sourceId, sourceRail]);
  const sourceMismatchNotice = useMemo(() => resolveFeedSourceMismatchNotice({ querySourceId: sourceId, itemSourceId: selectedItem?.sourceId, itemSourceName: selectedItem?.sourceName, filterSourceName: selectedSource?.name }), [selectedItem?.sourceId, selectedItem?.sourceName, selectedSource?.name, sourceId]);
  const feedEvidenceNotice = resolveFeedEvidenceNotice(selectedItem);

  // Auto-scroll on mobile
  useEffect(() => {
    if (!shouldAutoScrollFeedDetailIntoView(Boolean(selectedItem))) return;
    const scrollToDetail = () => { detailPanelRef.current?.scrollIntoView({ block: 'start' }); };
    window.requestAnimationFrame(scrollToDetail);
    const settledTimer = window.setTimeout(scrollToDetail, 450);
    return () => window.clearTimeout(settledTimer);
  }, [detailLoading, detailPanelRef, selectedItem, selectedItem?.id]);

  // Focus management: move focus into detail panel when item is selected
  useEffect(() => {
    if (!selectedItem || detailLoading) return;
    const timer = window.setTimeout(() => {
      const heading = detailPanelRef.current?.querySelector<HTMLElement>('[data-feed-detail-title]');
      if (heading) { heading.focus(); }
    }, 100);
    return () => window.clearTimeout(timer);
  }, [detailLoading, detailPanelRef, selectedItem, selectedItem?.id]);

  // Build detail sections
  const allDetailSections = useMemo(() => {
    if (!selectedItem) return [];
    const summaryText = normalizeAiSummary(selectedItem.aiSummary);
    const displaySummary = isUsableDisplaySummary(summaryText) ? summaryText : '';
    const rewriteAsset = getVisibleReadingAssets(selectedItem.readingAssets).find((a) => a.type === 'rewrite' && a.status === 'ready' && (a.content || a.preview));
    const displayRewrite = (rewriteAsset?.content || rewriteAsset?.preview || '').trim();
    const originalDisplay = resolveFeedOriginalDisplayContent(selectedItem);
    const originalRaw = originalDisplay.content;
    const originalLooksHtml = !originalDisplay.cleaned && looksLikeHtmlFragment(originalRaw);
    const displayOriginal = originalDisplay.cleaned ? originalRaw : originalLooksHtml ? htmlToReadableMarkdown(originalRaw) : plainTextToReadableMarkdown(originalRaw);
    const originalShouldRenderMarkdown = originalDisplay.renderMode === 'markdown' || originalLooksHtml || looksLikeMarkdown(displayOriginal);
    const displayTranslation = selectedItem.translationUsability
      ? selectedItem.translationUsability === 'usable' ? selectedItem.aiTranslation : ''
      : isUsableDisplayTranslation(selectedItem.aiTranslation, displayOriginal || originalRaw) ? selectedItem.aiTranslation : '';
    const sectionsByKey: Partial<Record<DetailSectionKey, DetailSection>> = {
      original: { key: 'original', label: '原文', content: displayOriginal, emptyState: getDetailEmptyState('original', selectedItem), isEmpty: !hasReadableText(displayOriginal), renderMode: originalShouldRenderMarkdown ? 'markdown' : 'plain' },
      rewrite: { key: 'rewrite', label: '中文改写', content: displayRewrite, emptyState: { title: '中文改写待生成', reason: displaySummary ? '当前只有摘要级导读，还没有保存的中文改写资产。' : '当前没有可用中文导读或重写资产。', action: '可在"问文章"中生成选题角度、行动建议，后续沉淀为改写素材。', tone: 'neutral' }, isEmpty: !hasReadableText(displayRewrite), renderMode: 'auto' },
      translation: { key: 'translation', label: '翻译', content: displayTranslation, emptyState: getDetailEmptyState('translation', selectedItem), isEmpty: !hasReadableText(displayTranslation), renderMode: 'markdown' },
      qa: { key: 'qa', label: '问文章', content: '', emptyState: { title: '暂无文章问答', reason: '当前先提供固定问题模板，复制后可用于生成可保存的问答资产。', action: '选择一个问题模板，基于当前文章摘要或正文继续追问。', tone: 'neutral' }, isEmpty: false, renderMode: 'agent' },
      transcript: { key: 'transcript', label: '转写', content: selectedItem.transcript, emptyState: getDetailEmptyState('transcript', selectedItem), isEmpty: !hasReadableText(selectedItem.transcript), renderMode: 'plain' },
      knowledge: { key: 'knowledge', label: '知识', content: selectedItem.knowledge, emptyState: getDetailEmptyState('knowledge', selectedItem), isEmpty: !hasReadableText(selectedItem.knowledge), renderMode: 'markdown' },
    };
    return [...resolveFeedReaderTabOrder(['original', 'translation']), ...resolveFeedSecondaryTabOrder(['rewrite', 'qa', 'transcript', 'knowledge'])].map((key) => sectionsByKey[key]).filter((s): s is DetailSection => Boolean(s));
  }, [selectedItem]);

  const primaryDetailSections = useMemo(() => allDetailSections.filter((s) => s.key === 'original' || s.key === 'translation'), [allDetailSections]);

  useEffect(() => {
    if (!allDetailSections.length) return;
    if (!allDetailSections.some((s) => s.key === activeDetailTab)) setActiveDetailTab(primaryDetailSections[0]?.key || allDetailSections[0].key);
  }, [activeDetailTab, allDetailSections, primaryDetailSections, setActiveDetailTab]);

  const activeDetail = allDetailSections.find((s) => s.key === activeDetailTab) || primaryDetailSections[0] || allDetailSections[0];
  const selectedDisplaySummary = selectedItem ? (() => { const n = normalizeAiSummary(selectedItem.aiSummary); return selectedItem.summaryStatus !== 'failed' && isUsableDisplaySummary(n) ? n : ''; })() : '';
  const translationAction = resolveFeedTranslationAction(selectedItem);
  const translationLabel = feedTranslationActionLabel(translationAction);
  const shouldShowTranslationAction = translationAction === 'translate' || translationAction === 'fetch_then_translate' || translationAction === 'open_original';
  const translationActionDisabled = selectedItem ? shouldDisableFeedTranslationAction(stageReprocessing, selectedItem.id) : false;
  const translationBasisReason = selectedItem?.contentEvidence?.translationBasis?.reason;
  const translationActionTitle = translationAction === 'fetch_then_translate' ? '先补抓原文' : translationAction === 'open_original' ? '原文需要手动查看' : '生成中文译文';
  const translationActionDescription = translationAction === 'fetch_then_translate' ? translationBasisReason || '当前只有索引摘要或片段，点击后会先抓原站正文，再基于正文翻译。' : translationAction === 'open_original' ? translationBasisReason || '当前没有可翻译正文，先打开原文确认内容来源。' : selectedItem?.translationCompleteness?.reason || (selectedItem?.translationUsability === 'invalid' ? '现有译文未通过完整性校验，因此没有作为正文展示。' : '当前没有可展示的中文译文。');

  return (
    <div data-feed-detail-pane ref={detailPanelRef} className={`min-w-0 rounded-2xl border border-zinc-200 bg-white shadow-[0_18px_60px_-48px_rgba(15,23,42,0.45)] xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden ${resolveFeedDetailOrderClassName(Boolean(selectedItem))}`}>
      {detailLoading ? (
        <div className="p-5 text-center py-20 text-zinc-400">加载详情...</div>
      ) : selectedItem ? (
        <MobilePullClose onClose={handleReturnToList}>
          {detailError && <div className="mx-5 mt-5 px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">{detailError}</div>}
          <FeedReaderHeader />
          <JevPanel target={selectedItem.id} />
          <div data-feed-detail-reader className="min-w-0 overflow-x-hidden px-5 pb-[calc(8rem+env(safe-area-inset-bottom))] xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overflow-x-hidden xl:overscroll-contain xl:pr-4 xl:[scroll-padding-bottom:10rem]">
            {detailActionNoticeMessage && <div className={`mt-4 rounded-xl border px-3 py-2 text-xs leading-5 ${NOTICE_CLASS_NAMES[detailActionNoticeTone]}`}>{detailActionNoticeMessage}</div>}
            {sourceMismatchNotice && (
              <div className="mt-4 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs leading-5 text-amber-900 sm:flex-row sm:items-center sm:justify-between">
                <span>{sourceMismatchNotice.message}</span>
                <button type="button" onClick={() => { setSourceId(''); setOffset(0); updateListQuery({ sourceId: '' }); }} className="inline-flex min-h-8 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-900 hover:bg-amber-100">清除来源过滤</button>
              </div>
            )}
            {feedEvidenceNotice && shouldSurfaceFeedEvidenceNotice(feedEvidenceNotice) && (
              <div className={`mt-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-3 py-2 text-xs leading-5 ${FEED_EVIDENCE_NOTICE_CLASS_NAMES[feedEvidenceNotice.tone]}`}><span className="font-medium text-zinc-900">{feedEvidenceNotice.label}</span><span>{feedEvidenceNotice.message}</span></div>
            )}
            <div data-feed-detail-tabs className="sticky top-0 z-20 mt-5 flex min-w-0 flex-wrap gap-2 border-y border-zinc-100 bg-white/95 px-0 py-3 backdrop-blur">
              {primaryDetailSections.map((section) => (
                <button key={section.key} onClick={() => setActiveDetailTab(section.key)} className={`rounded-full px-3 py-1.5 text-xs transition-colors ${activeDetail?.key === section.key ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>{section.label}{section.isEmpty ? ' · 待补全' : ''}</button>
              ))}
            </div>
            <div data-feed-reader-body className={feedReaderBodyShellClassName}>
              <div data-feed-detail-content-card className={feedReaderMainColumnClassName} style={{ '--reader-width': `${readerPreferences.width}px`, '--reader-font-size': `${readerPreferences.fontSize}px`, '--reader-line-height': String(readerPreferences.lineHeight), '--reader-font-family': readerFontFamilyCss(readerPreferences.fontFamily) } as CSSProperties}>
                <div data-feed-reader-content className="mx-auto w-full max-w-[var(--reader-width)] 2xl:mx-0">
                  {selectedDisplaySummary && (activeDetail?.key === 'original' || activeDetail?.key === 'translation') && (
                    <section data-feed-summary-lead className="mb-7 border-l-2 border-teal-500 bg-teal-50/45 px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-700">AI 导读</div>
                      <p className="mt-2 whitespace-pre-line text-[15px] leading-7 text-zinc-700">{selectedDisplaySummary}</p>
                    </section>
                  )}
                  {activeDetail?.renderMode === 'agent' ? (
                    <div data-feed-article-agent className="space-y-3">
                      <div className="rounded-2xl border border-teal-100 bg-teal-50/70 px-4 py-3 text-sm leading-6 text-teal-900">Article Agent 会基于当前文章的摘要、翻译或正文生成可保存资产。结果会回到阅读资产，并可被日报重点文章引用。</div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {ARTICLE_AGENT_PROMPTS.map((prompt) => {
                          const asset = findArticleAgentAsset(selectedItem.readingAssets, prompt.key);
                          const busy = generatingAgentPrompt === prompt.key;
                          const error = agentPromptErrors[prompt.key] || asset?.errorReason || null;
                          return (
                            <div key={prompt.key} className="rounded-2xl border border-zinc-100 bg-white px-4 py-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0"><div className="text-sm font-semibold text-zinc-900">{prompt.title}</div><div className="mt-1 text-xs leading-5 text-zinc-500">{prompt.description}</div></div>
                                {asset?.status === 'ready' && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">已保存</span>}
                                {asset?.status === 'failed' && <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700">失败</span>}
                              </div>
                              {asset?.content ? <div className="mt-3 max-h-48 overflow-auto rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-3 text-xs leading-5 text-zinc-700"><MarkdownContent content={asset.content} mode="auto" variant="reader" /></div> : asset?.preview ? <div className="mt-3 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-3 text-xs leading-5 text-zinc-600">{asset.preview}</div> : null}
                              {error && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{error}</div>}
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button type="button" onClick={() => { void handleGenerateArticleAsset(prompt.key, Boolean(asset?.content)); }} disabled={Boolean(generatingAgentPrompt)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-2 text-xs text-white transition-colors hover:bg-zinc-800 disabled:opacity-50">{busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}{asset?.content ? '重新生成' : '生成资产'}</button>
                                <button type="button" onClick={() => { void handleCopyArticleAgentPrompt(prompt.key); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-2 text-xs text-zinc-700 transition-colors hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700"><Copy size={12} />{copiedAgentPrompt === prompt.key ? '已复制问题' : '复制问题'}</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <>
                      {activeDetail?.key === 'translation' && selectedItem && shouldShowTranslationAction && (
                        <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/75 px-4 py-3 text-sm leading-6 text-amber-900 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0"><div className="font-semibold">{translationActionTitle}</div><div className="mt-1 text-xs leading-5">{joinChineseSentences(translationStatusLabel(selectedItem), translationActionDescription)}</div></div>
                          <button type="button" onClick={() => { handleTranslationPrimaryAction(selectedItem); }} disabled={translationActionDisabled} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-50">{stageReprocessing?.itemId === selectedItem.id && stageReprocessing.stage === 'translation' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}{translationLabel || '一键翻译全文'}</button>
                        </div>
                      )}
                      <MarkdownContent content={activeDetail?.content} empty={activeDetail?.emptyState ? (<div className={`rounded-2xl border px-4 py-4 text-sm leading-6 ${DETAIL_EMPTY_STATE_CLASS_NAMES[activeDetail.emptyState.tone]}`}><div className="font-semibold">{activeDetail.emptyState.title}</div><div className="mt-1">{activeDetail.emptyState.reason}</div><div className="mt-2 text-xs opacity-90">建议动作：{activeDetail.emptyState.action}</div></div>) : '暂无内容'} mode={activeDetail?.renderMode || 'auto'} variant="reader" className="min-w-0" />
                    </>
                  )}
                  {activeDetail?.key === 'original' && (selectedItem.originalUrl || selectedItem.url) && (
                    <a href={selectedItem.originalUrl || selectedItem.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-800">{selectedItem.originalUrl ? '打开原站' : '打开原文'} <ExternalLink size={14} /></a>
                  )}
                </div>
              </div>
              <FeedAssetDrawer />
            </div>
            <div data-feed-bottom-spacer className="h-28 shrink-0" aria-hidden="true" />
          </div>
        </MobilePullClose>
      ) : (
        <div className="text-zinc-400 h-full flex flex-col items-center justify-center p-5 text-center">
          <FileText size={28} />
          <p className="mt-2 text-sm">从左侧选择一篇文章查看详情与预览</p>
        </div>
      )}
    </div>
  );
}
