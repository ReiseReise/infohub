import { htmlToReadableMarkdown } from './readable-content.ts';

export function resolveFeedDetailOrderClassName(hasSelectedItem: boolean): string {
  return hasSelectedItem ? 'order-first xl:order-none' : '';
}

export type FeedSortMode = 'latest' | 'priority' | 'score';
export type FeedViewMode = 'recommended' | 'latest';

export function normalizeFeedSortMode(value?: string | null): FeedSortMode {
  if (value === 'latest' || value === 'score') return value;
  return 'priority';
}

export function feedViewForSortMode(sortMode: FeedSortMode): FeedViewMode {
  return sortMode === 'latest' ? 'latest' : 'recommended';
}

export function feedQuerySortValue(sortMode: FeedSortMode): string {
  return sortMode === 'priority' ? '' : sortMode;
}

export function clampFeedListPaneWidth(width: number): number {
  if (!Number.isFinite(width)) return 340;
  return Math.min(460, Math.max(340, Math.round(width)));
}

export const feedWorkbenchGridClassName = 'grid min-h-[620px] grid-cols-1 gap-3 xl:min-h-0 xl:flex-1';

export const feedTopbarClassName = 'mb-1 rounded-xl border border-zinc-200 bg-white/95 px-2 py-1.5 shadow-[0_12px_36px_-34px_rgba(15,23,42,0.5)] xl:shrink-0';

export const feedTopbarToolbarClassName = 'grid gap-2 xl:grid xl:grid-cols-[minmax(160px,auto)_minmax(220px,1fr)_auto_auto] xl:items-center 2xl:grid-cols-[minmax(160px,auto)_minmax(240px,1fr)_auto_auto_auto_auto]';

function hasReadableText(value?: string | null): boolean {
  return Boolean(value && value.trim().length > 12);
}

function looksLikeHtmlFragment(input?: string | null): boolean {
  return Boolean(input && /<\/?(?:p|ul|ol|li|a|h[1-6]|blockquote|br|div|article|section|pre|code)\b/i.test(input));
}

function textLength(value?: string | null): number {
  return (value || '').replace(/\s+/g, ' ').trim().length;
}

function preferredTranslationSourceText(item?: {
  readabilityContent?: string | null;
  content?: string | null;
  snippet?: string | null;
} | null): string {
  if (!item) return '';
  return item.readabilityContent || item.content || item.snippet || '';
}

function looksTruncatedTranslation(value?: string | null): boolean {
  const text = (value || '').trim();
  if (!text) return false;
  if (/[—\-–:：,，、（(]$/.test(text)) return true;
  return /(evidenced|including|such as|for example|例如|比如|包括)$/i.test(text);
}

function isLikelyForeignLongText(item?: {
  language?: string | null;
  readabilityContent?: string | null;
  content?: string | null;
  snippet?: string | null;
} | null): boolean {
  if (!item) return false;
  const language = String(item.language || '').trim().toLowerCase();
  if (language && !language.startsWith('zh') && !language.startsWith('cn')) return true;
  const text = preferredTranslationSourceText(item).replace(/\s+/g, ' ').trim();
  if (text.length < 600) return false;
  const latinCount = (text.match(/[A-Za-z]/g) || []).length;
  const cjkCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  return latinCount > 280 && latinCount > cjkCount * 3;
}

function hasRejectedFeedContentFetch(item?: {
  contentStatus?: string | null;
  contentError?: string | null;
  blockedReason?: string | null;
  readabilityStatus?: string | null;
  readabilityReason?: string | null;
} | null): boolean {
  if (!item) return false;
  if (item.blockedReason === 'content_unavailable' || item.blockedReason === 'fetch_failed') return true;
  const reason = `${item.contentError || ''} ${item.readabilityReason || ''}`;
  if (/正文抓取未命中|当前仅保留摘要片段|补抓失败|原文抓取失败|content_unavailable/i.test(reason)) return true;
  return item.contentStatus === 'degraded' && item.readabilityStatus === 'failed';
}

export function shouldOfferFeedFullTranslation(item?: {
  translationCompleteness?: {
    complete?: boolean | null;
  } | null;
  translationStatus?: string | null;
  translationReason?: string | null;
  aiTranslation?: string | null;
  language?: string | null;
  readabilityContent?: string | null;
  content?: string | null;
  snippet?: string | null;
} | null): boolean {
  if (!item) return false;
  if (item.translationCompleteness && item.translationCompleteness.complete === false) return true;
  const sourceText = preferredTranslationSourceText(item);
  const sourceLength = textLength(sourceText);
  if (sourceLength < 500) return false;
  const skippedBecauseChinese = item.translationStatus === 'skipped'
    && /中文|Chinese/i.test(String(item.translationReason || ''));
  if (skippedBecauseChinese && !isLikelyForeignLongText(item)) return false;
  if (skippedBecauseChinese && isLikelyForeignLongText(item)) return true;
  if (item.translationStatus !== 'ready') return sourceLength >= 500;
  const translatedLength = textLength(item.aiTranslation);
  if (translatedLength <= 0) return true;
  if (looksTruncatedTranslation(item.aiTranslation)) return true;
  if (sourceLength >= 1800 && translatedLength < Math.min(900, sourceLength * 0.22)) return true;
  if (sourceLength >= 600 && translatedLength < 80) return true;
  return false;
}

export function shouldEnrichReadyHtmlWithoutReadability(item?: {
  contentStatus?: string | null;
  content?: string | null;
  readabilityContent?: string | null;
} | null): boolean {
  if (!item) return false;
  return item.contentStatus === 'ready'
    && looksLikeHtmlFragment(item.content)
    && !hasReadableText(item.readabilityContent);
}

export type FeedFreshnessPill = {
  label: string;
  detail: string;
  tone: 'warning' | 'danger';
  actionLabel: string;
};

export function resolveFeedFreshnessPill(status?: {
  freshnessStatus?: string | null;
  staleReason?: string | null;
  lastSuccessfulFetchAt?: string | null;
} | null): FeedFreshnessPill | null {
  if (!status?.freshnessStatus || status.freshnessStatus === 'fresh') return null;
  const lastSuccess = status.lastSuccessfulFetchAt
    ? `最近成功抓取：${new Date(status.lastSuccessfulFetchAt).toLocaleString('zh-CN')}`
    : '';
  const reason = (status.staleReason || '').trim();
  const detail = [reason, lastSuccess].filter(Boolean).join(' · ') || '抓取调度尚未把最新内容补进来。';
  if (status.freshnessStatus === 'stale') {
    return {
      label: '数据已过期',
      detail,
      tone: 'danger',
      actionLabel: '立即补抓',
    };
  }
  return {
    label: '待补抓',
    detail,
    tone: 'warning',
    actionLabel: '立即补抓',
  };
}

/**
 * 宽屏下详情区占了 2/3 版面，未选中条目时整片空白。
 * 桌面端自动选中首条以填满版面；窄屏是"列表 → 详情"的导航模式，自动选中会把用户直接推进详情页，因此不做。
 */
export function shouldAutoSelectFirstFeedItem(params: {
  hasRouteId: boolean;
  hasSelectedItem: boolean;
  itemCount: number;
  viewportWidth?: number;
}): boolean {
  if (params.hasRouteId || params.hasSelectedItem) return false;
  if (params.itemCount <= 0) return false;
  const width = params.viewportWidth ?? (
    typeof window !== 'undefined' && typeof window.innerWidth === 'number'
      ? window.innerWidth
      : 1280
  );
  return width >= 1280;
}

export function resolveFeedDetailId(
  routeId: string | undefined,
  items: Array<{ id: string }>,
  viewportWidth?: number,
  selectedId?: string | null,
): string | null {
  if (routeId) return routeId;
  const width = viewportWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1280);
  if (width < 1280) return null;
  // Default selection fills an empty reader once; list refreshes must not move it.
  return selectedId || items[0]?.id || null;
}

export function shouldAutoScrollFeedDetailIntoView(hasSelectedItem: boolean, viewportWidth?: number): boolean {
  if (!hasSelectedItem) return false;
  const width = viewportWidth ?? (
    typeof window !== 'undefined' && typeof window.innerWidth === 'number'
      ? window.innerWidth
      : 1280
  );
  return width < 1280;
}

export const feedDetailHeaderClassName = 'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between';

export type FeedSourceRailBadge = {
  label: string;
  title?: string;
  className: string;
};

export function resolveFeedSourceRailBadges(source: {
  readingTierLabel?: string | null;
  readingTierReason?: string | null;
  readingTierClassName?: string | null;
}): FeedSourceRailBadge[] {
  const label = String(source.readingTierLabel || '').trim();
  if (!label) return [];
  return [{
    label,
    title: source.readingTierReason || undefined,
    className: source.readingTierClassName || 'border-zinc-200 bg-zinc-50 text-zinc-600',
  }];
}

export type FeedListCardSignal = {
  kind: 'score' | 'tier' | 'readiness' | 'ai' | 'readingTier' | 'assets' | 'growth';
  label: string;
  title?: string;
  className: string;
};

export function resolveFeedEventEvidenceLabel(context?: {
  internalSourceCount?: number | null;
  externalSourceCount?: number | null;
  firstPartyCount?: number | null;
} | null): { label: string; title: string } | null {
  if (!context) return null;
  const internal = Math.max(0, Number(context.internalSourceCount || 0));
  const external = Math.max(0, Number(context.externalSourceCount || 0));
  const firstParty = Math.max(0, Number(context.firstPartyCount || 0));
  if (internal >= 2) {
    const localDetail = firstParty > 0
      ? `本地已抓取 ${internal} 个来源，其中 ${firstParty} 个一手来源`
      : `本地已抓取 ${internal} 个来源`;
    return {
      label: `${internal} 个来源印证`,
      title: external > 0
        ? `${localDetail}；外部雷达另发现 ${external} 个来源。`
        : `${localDetail}。`,
    };
  }
  if (external > 0) {
    return {
      label: `外部雷达 ${external}`,
      title: `外部雷达发现 ${external} 个来源，尚未等同于本地核验。`,
    };
  }
  return null;
}

export function resolveFeedListCardSignals(item: {
  aiScore?: number | string | null;
  sourceTier?: string | null;
  sourceTierLabel?: string | null;
  sourceTierClassName?: string | null;
  aiStatusLabel?: string | null;
  aiStatusClassName?: string | null;
  contentReadinessLabel?: string | null;
  contentReadinessClassName?: string | null;
  readingTierLabel?: string | null;
  readingTierClassName?: string | null;
  growthAxes?: string[] | null;
  assetCount?: number | null;
}): { primary: FeedListCardSignal[]; secondary: FeedListCardSignal[]; tooltip: string } {
  const scoreValue = item.aiScore == null || item.aiScore === '' ? null : Number(item.aiScore);
  const scoreLabel = scoreValue != null && Number.isFinite(scoreValue)
    ? Number.isInteger(scoreValue) ? String(scoreValue) : scoreValue.toFixed(1).replace(/\.0$/, '')
    : '';
  const scoreClassName = scoreValue == null
    ? ''
    : scoreValue >= 70
      ? 'bg-emerald-100 text-emerald-700'
      : scoreValue >= 40
        ? 'bg-amber-100 text-amber-700'
        : 'bg-zinc-100 text-zinc-500';
  const sourceTierLabel = (item.sourceTierLabel || item.sourceTier || '').trim();
  const contentReadinessLabel = (item.contentReadinessLabel || '').trim();
  const aiStatusLabel = (item.aiStatusLabel || '').trim();
  const readingTierLabel = (item.readingTierLabel || '').trim();
  const assetCount = Number(item.assetCount || 0);
  const growthAxes = (item.growthAxes || []).map((axis) => String(axis).trim()).filter(Boolean);

  const primary: FeedListCardSignal[] = [];
  if (scoreLabel) {
    primary.push({
      kind: 'score',
      label: scoreLabel,
      title: `评分 ${scoreLabel}`,
      className: scoreClassName,
    });
  }
  if (sourceTierLabel) {
    primary.push({
      kind: 'tier',
      label: sourceTierLabel,
      title: `资讯等级：${sourceTierLabel}`,
      className: item.sourceTierClassName || 'bg-zinc-100 text-zinc-600',
    });
  }
  if (contentReadinessLabel) {
    primary.push({
      kind: 'readiness',
      label: contentReadinessLabel,
      title: `内容状态：${contentReadinessLabel}`,
      className: item.contentReadinessClassName || 'bg-zinc-100 text-zinc-600',
    });
  }

  const secondary: FeedListCardSignal[] = [];
  if (aiStatusLabel) {
    secondary.push({
      kind: 'ai',
      label: aiStatusLabel,
      title: `AI 状态：${aiStatusLabel}`,
      className: item.aiStatusClassName || 'bg-zinc-100 text-zinc-600',
    });
  }
  if (readingTierLabel) {
    secondary.push({
      kind: 'readingTier',
      label: readingTierLabel,
      title: `阅读层级：${readingTierLabel}`,
      className: item.readingTierClassName || 'bg-zinc-100 text-zinc-600',
    });
  }
  if (assetCount > 0) {
    secondary.push({
      kind: 'assets',
      label: `资产 ${assetCount}`,
      title: `阅读资产 ${assetCount} 个`,
      className: 'bg-teal-50 text-teal-700',
    });
  }
  if (growthAxes.length > 0) {
    secondary.push({
      kind: 'growth',
      label: growthAxes.slice(0, 2).join(' / '),
      title: `成长维度：${growthAxes.join(' / ')}`,
      className: 'bg-sky-50 text-sky-700',
    });
  }

  const tooltip = [...primary, ...secondary]
    .map((signal) => signal.title || signal.label)
    .filter(Boolean)
    .join(' · ');

  return {
    primary: primary.slice(0, 3),
    secondary,
    tooltip,
  };
}

export const feedReaderBodyShellClassName = 'mx-auto mt-5 grid w-full max-w-none gap-5 2xl:grid-cols-[minmax(0,1fr)_280px]';

export const feedReaderMainColumnClassName = 'mx-auto w-full min-w-0 max-w-[var(--reader-width)] rounded-[20px] bg-[#fffdfa] px-5 py-6 sm:px-7 sm:py-8 2xl:mx-0 2xl:max-w-none';

export const feedReaderSideRailClassName = 'mx-auto w-full min-w-0 max-w-[var(--reader-width)] space-y-2 2xl:mx-0 2xl:max-w-none';

export function resolveFeedSourceMismatchNotice(input: {
  querySourceId?: string | number | null;
  itemSourceId?: string | number | null;
  itemSourceName?: string | null;
  filterSourceName?: string | null;
}): { tone: 'warning'; message: string } | null {
  const querySourceId = String(input.querySourceId || '').trim();
  const itemSourceId = String(input.itemSourceId || '').trim();
  if (!querySourceId || !itemSourceId || querySourceId === itemSourceId) return null;
  const itemSourceName = input.itemSourceName || `source-${itemSourceId}`;
  const filterSourceName = input.filterSourceName || `source-${querySourceId}`;
  return {
    tone: 'warning',
    message: `当前文章真实来源是 ${itemSourceName}；URL 里保留的是 ${filterSourceName} 的列表过滤上下文。可清除来源过滤，避免误以为正文抓错来源。`,
  };
}

export function resolveFeedDetailSourceContext(input: {
  selectedIdFromRoute?: string | null;
  querySourceId?: string | number | null;
  itemSourceId?: string | number | null;
}): { shouldClearSourceFilter: boolean } {
  const selectedIdFromRoute = String(input.selectedIdFromRoute || '').trim();
  const querySourceId = String(input.querySourceId || '').trim();
  const itemSourceId = String(input.itemSourceId || '').trim();
  return {
    shouldClearSourceFilter: Boolean(
      selectedIdFromRoute
      && querySourceId
      && itemSourceId
      && querySourceId !== itemSourceId,
    ),
  };
}

export type FeedDetailActionKey =
  | 'open_original'
  | 'open_curation'
  | 'transcribe_audio'
  | 'open_audio_task'
  | 'full_translation'
  | 'reprocess_ai'
  | 'enrich_content';

export type FeedDetailActionInput = {
  hasUrl?: boolean;
  hasOriginalUrl?: boolean;
  hasCurationUrl?: boolean;
  hasAudio?: boolean;
  hasAudioTask?: boolean;
  needsFullTranslation?: boolean;
  canReprocessAi?: boolean;
  canEnrichContent?: boolean;
};

export function resolveFeedDetailHeaderActions(input: FeedDetailActionInput): FeedDetailActionKey[] {
  const actions: FeedDetailActionKey[] = [];
  if (input.hasUrl || input.hasOriginalUrl) actions.push('open_original');
  if (input.needsFullTranslation) actions.push('full_translation');
  return actions;
}

export function resolveFeedDetailToolActions(input: FeedDetailActionInput): FeedDetailActionKey[] {
  const actions: FeedDetailActionKey[] = [];
  if (input.hasCurationUrl) actions.push('open_curation');
  if (input.hasAudio) actions.push('transcribe_audio');
  if (input.hasAudioTask) actions.push('open_audio_task');
  if (input.canReprocessAi) actions.push('reprocess_ai');
  if (input.canEnrichContent) actions.push('enrich_content');
  return actions;
}

export type FeedReaderTabKey = 'original' | 'rewrite' | 'translation' | 'qa' | 'summary' | 'transcript' | 'knowledge';
export type FeedTranslationAction = 'translate' | 'fetch_then_translate' | 'open_original' | 'none';
export type FeedContentEvidenceLayer =
  | 'readableText'
  | 'rawFeedHtml'
  | 'externalLinkSummary'
  | 'indexSummary'
  | 'curatedSummary'
  | 'snapshotText'
  | 'snippet'
  | 'title'
  | 'none'
  | string;

export function resolveFeedReaderTabOrder(keys: string[]): FeedReaderTabKey[] {
  const available = new Set(keys);
  const order: FeedReaderTabKey[] = ['original', 'translation'];
  return order.filter((key) => available.has(key));
}

export function resolveFeedDisplayTitle(item?: {
  title?: string | null;
  translatedTitle?: string | null;
} | null): { title: string; originalTitle: string | null } {
  const originalTitle = (item?.title || '').trim();
  const translatedTitle = (item?.translatedTitle || '').trim();
  if (translatedTitle && translatedTitle !== originalTitle) {
    return { title: translatedTitle, originalTitle: originalTitle || null };
  }
  return { title: originalTitle, originalTitle: null };
}

export function resolveFeedSecondaryTabOrder(keys: string[]): FeedReaderTabKey[] {
  const available = new Set(keys);
  const order: FeedReaderTabKey[] = ['rewrite', 'qa', 'transcript', 'knowledge'];
  return order.filter((key) => available.has(key));
}

export function resolveFeedTranslationAction(item?: {
  contentReadiness?: {
    fullTextAvailable?: boolean;
    originalTextStatus?: string | null;
  } | null;
  contentEvidence?: {
    primaryLayer?: FeedContentEvidenceLayer | null;
    translationBasis?: {
      reliableForFullTranslation?: boolean | null;
      reason?: string | null;
    } | null;
  } | null;
  url?: string | null;
  originalUrl?: string | null;
  translationAction?: FeedTranslationAction | string | null;
  contentStatus?: string | null;
  contentError?: string | null;
  blockedReason?: string | null;
  readabilityStatus?: string | null;
  readabilityReason?: string | null;
  translationStatus?: string | null;
  translationReason?: string | null;
  translationCompleteness?: {
    complete?: boolean | null;
    reason?: string | null;
  } | null;
  aiTranslation?: string | null;
  language?: string | null;
  readabilityContent?: string | null;
  content?: string | null;
  snippet?: string | null;
} | null): FeedTranslationAction {
  if (!item) return 'none';
  const targetUrl = String(item.originalUrl || item.url || '');
  const hasOriginalUrl = /^https?:\/\//i.test(targetUrl);
  if (hasRejectedFeedContentFetch(item) && !item.contentReadiness?.fullTextAvailable) {
    return hasOriginalUrl ? 'open_original' : 'none';
  }
  if (item.translationAction === 'translate' || item.translationAction === 'fetch_then_translate' || item.translationAction === 'open_original') {
    return item.translationAction;
  }
  const skippedBecauseChinese = item.translationStatus === 'skipped'
    && /中文|Chinese/i.test(String(item.translationReason || ''));
  const shouldOverrideChineseSkip = skippedBecauseChinese && shouldOfferFeedFullTranslation(item);
  if (item.contentReadiness?.originalTextStatus === 'missing_original_url') {
    return hasOriginalUrl ? 'open_original' : 'none';
  }
  if (item.contentEvidence?.translationBasis?.reliableForFullTranslation === false) {
    if (hasOriginalUrl && (
      item.contentEvidence.primaryLayer === 'indexSummary'
      || item.contentEvidence.primaryLayer === 'curatedSummary'
      || item.contentEvidence.primaryLayer === 'externalLinkSummary'
    )) {
      return 'fetch_then_translate';
    }
    if (hasOriginalUrl) return 'open_original';
    return 'none';
  }
  if (item.contentReadiness?.originalTextStatus === 'pending_fetch' && hasOriginalUrl) return 'fetch_then_translate';
  if (skippedBecauseChinese && !shouldOverrideChineseSkip) return 'none';
  if (shouldOverrideChineseSkip) return 'translate';
  if (item.contentReadiness?.fullTextAvailable && item.translationCompleteness && item.translationCompleteness.complete === false) {
    return 'translate';
  }
  if (item.contentReadiness?.fullTextAvailable && shouldOfferFeedFullTranslation(item)) return 'translate';
  if (item.contentReadiness?.fullTextAvailable && item.translationStatus !== 'ready') return 'translate';
  if (item.contentReadiness?.fullTextAvailable && !item.aiTranslation?.trim()) return 'translate';
  if (!item.contentReadiness?.fullTextAvailable && hasOriginalUrl) return 'open_original';
  return 'none';
}

export function feedTranslationActionLabel(action: FeedTranslationAction): string {
  if (action === 'fetch_then_translate') return '补抓原文并翻译';
  if (action === 'translate') return '一键翻译全文';
  if (action === 'open_original') return '打开原文';
  return '';
}

export function shouldDisableFeedTranslationAction(
  activeStage: { itemId?: string | null; stage?: string | null } | null | undefined,
  itemId?: string | null,
): boolean {
  if (!activeStage || !itemId) return false;
  return activeStage.itemId === itemId && activeStage.stage === 'translation';
}

export function resolveFeedTranslationStatusLabel(item?: {
  translationCompleteness?: {
    complete?: boolean | null;
    reason?: string | null;
  } | null;
  translationStatus?: string | null;
  translationReason?: string | null;
  aiTranslation?: string | null;
  sourceText?: string | null;
  translationUsable?: boolean | null;
} | null): string {
  if (item?.translationCompleteness && !item.translationCompleteness.complete) {
    return item.translationCompleteness.reason || '译文不完整，建议补全';
  }
  if (item?.translationStatus === 'ready' && item.translationUsable === false) {
    return '译文不完整，建议补全';
  }
  if (item?.translationStatus === 'ready') {
    const sourceLength = textLength(item.sourceText);
    const translatedLength = textLength(item.aiTranslation);
    if (sourceLength >= 1800 && translatedLength > 0 && translatedLength < Math.min(900, sourceLength * 0.22)) {
      return '译文不完整，建议补全';
    }
    if (sourceLength >= 600 && translatedLength > 0 && translatedLength < 80) {
      return '译文不完整，建议补全';
    }
  }
  switch (item?.translationStatus) {
    case 'ready':
      return '翻译已完成';
    case 'failed':
      return item?.translationReason || '翻译失败';
    case 'skipped':
      return item?.translationReason || '翻译已跳过';
    default:
      return '等待翻译';
  }
}

function isIndexLikeReaderItem(item?: {
  sourceType?: string | null;
  contentReadiness?: {
    fullTextAvailable?: boolean | null;
    originalTextStatus?: string | null;
  } | null;
  contentEvidence?: {
    primaryLayer?: FeedContentEvidenceLayer | null;
  } | null;
} | null): boolean {
  if (!item) return false;
  const sourceType = String(item.sourceType || '');
  const layer = item.contentEvidence?.primaryLayer;
  if (sourceType === 'curated_index' || sourceType === 'webpage_index') return true;
  return layer === 'curatedSummary' || layer === 'indexSummary' || layer === 'externalLinkSummary' || item.contentReadiness?.originalTextStatus === 'missing_original_url';
}

function extractMarkdownSection(raw: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|\\n)#{1,6}\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n#{1,6}\\s|$)`, 'i');
  return (raw.match(pattern)?.[2] || '').trim();
}

function stripIndexProvenanceLines(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => !/^\s*-\s*(榜单日期|来源站点|榜单评分|榜单详情|榜单页|原文链接|来源页|来源索引|source|score|url)\s*[:：]/i.test(line))
    .filter((line) => !/^#{1,6}\s*(BestBlogs Daily Brief|Anthropic Newsroom|来源信息|榜单信息)\s*$/i.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function removeNakedUrls(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => !/^\s*https?:\/\/\S+\s*$/.test(line.trim()))
    .map((line) => line.replace(/\((https?:\/\/\S+)\)/g, '').replace(/\s+https?:\/\/\S+/g, ''))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export function resolveFeedOriginalDisplayContent(item?: {
  sourceType?: string | null;
  sourceName?: string | null;
  readabilityContent?: string | null;
  content?: string | null;
  snippet?: string | null;
  contentReadiness?: {
    fullTextAvailable?: boolean | null;
    label?: string | null;
    originalTextStatus?: string | null;
  } | null;
  contentEvidence?: {
    primaryLayer?: FeedContentEvidenceLayer | null;
  } | null;
} | null): { content: string; renderMode: 'auto' | 'markdown' | 'plain'; cleaned: boolean } {
  const raw = item?.readabilityContent || item?.content || item?.snippet || '';
  const trimmed = raw.trim();
  if (!trimmed) return { content: '', renderMode: 'plain', cleaned: false };

  if (item?.contentEvidence?.primaryLayer === 'externalLinkSummary' && !item?.contentReadiness?.fullTextAvailable) {
    const summary = looksLikeHtmlFragment(trimmed) ? htmlToReadableMarkdown(trimmed) : removeNakedUrls(trimmed);
    const cleaned = [
      '## 外链摘要',
      '',
      removeNakedUrls(summary),
      '',
      '## 目标正文待补抓',
      '',
      '当前内容来自来源站的转引、摘录或评论，不等同于目标网页全文。需要深读或翻译时，先补抓目标网页正文。',
    ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { content: cleaned, renderMode: 'markdown', cleaned: true };
  }

  if (isIndexLikeReaderItem(item) && !item?.contentReadiness?.fullTextAvailable) {
    const summary = extractMarkdownSection(trimmed, '榜单摘要')
      || extractMarkdownSection(trimmed, '摘要')
      || stripIndexProvenanceLines(trimmed);
    const originalPending = extractMarkdownSection(trimmed, '原文待补抓')
      || extractMarkdownSection(trimmed, '原文补抓')
      || (item?.contentEvidence?.primaryLayer === 'curatedSummary'
        ? '当前条目来自精选榜单，已保留榜单摘要；原站正文尚未补齐，需要深读时请打开原站或等待原文补抓。'
        : '当前条目来自索引页，已保留索引摘要；原站正文尚未补齐，需要深读时请先补抓原文。');
    const cleaned = [
      '## 榜单摘要',
      '',
      removeNakedUrls(summary),
      '',
      '## 原文待补抓',
      '',
      removeNakedUrls(originalPending),
    ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { content: cleaned, renderMode: 'markdown', cleaned: true };
  }

  return {
    content: trimmed,
    renderMode: looksLikeHtmlFragment(trimmed) || /```|(?:^|\n)#{1,6}\s/m.test(trimmed) ? 'markdown' : 'plain',
    cleaned: false,
  };
}

export function shouldShowFeedContentReadinessBanner(readiness?: {
  status?: string | null;
  fullTextAvailable?: boolean;
  action?: string | null;
} | null): boolean {
  if (!readiness) return false;
  if (readiness.fullTextAvailable && readiness.status === 'full_text') return false;
  return Boolean(readiness.action || readiness.status);
}

export function resolveFeedEvidenceNotice(item?: {
  contentEvidence?: {
    primaryLayer?: FeedContentEvidenceLayer | null;
    primaryLabel?: string | null;
    translationBasis?: {
      reliableForFullTranslation?: boolean | null;
      reason?: string | null;
    } | null;
  } | null;
  contentReadiness?: {
    label?: string | null;
    action?: string | null;
    fullTextAvailable?: boolean | null;
    status?: string | null;
  } | null;
} | null): { label: string; message: string; tone: 'neutral' | 'warning' } | null {
  const evidence = item?.contentEvidence;
  const layer = evidence?.primaryLayer;
  if (layer === 'readableText' || layer === 'rawFeedHtml') return null;

  if (layer === 'indexSummary') {
    return {
      label: evidence?.primaryLabel || '索引摘要',
      message: evidence?.translationBasis?.reason || '当前只有索引摘要；先补抓原站正文，再做深读、翻译或日报引用。',
      tone: 'warning',
    };
  }
  if (layer === 'externalLinkSummary') {
    return {
      label: evidence?.primaryLabel || '外链摘要',
      message: evidence?.translationBasis?.reason || '当前是来源站转引、摘录或评论的 RSS 正文；先补抓目标网页正文，再做全文翻译。',
      tone: 'warning',
    };
  }
  if (layer === 'curatedSummary') {
    return {
      label: evidence?.primaryLabel || '榜单摘要',
      message: evidence?.translationBasis?.reason || '当前只有榜单摘要；原站正文待解析，不能当作全文阅读。',
      tone: 'warning',
    };
  }
  if (layer === 'snapshotText') {
    return {
      label: evidence?.primaryLabel || '网页监控快照',
      message: evidence?.translationBasis?.reason || '当前是网页监控快照；只适合看变化线索，不适合作为文章全文。',
      tone: 'warning',
    };
  }
  if (layer === 'snippet' || layer === 'title') {
    return {
      label: evidence?.primaryLabel || (layer === 'title' ? '标题线索' : '摘要片段'),
      message: evidence?.translationBasis?.reason || '当前内容不足；需要先补正文。',
      tone: 'neutral',
    };
  }

  const readiness = item?.contentReadiness;
  if (!readiness || (readiness.fullTextAvailable && readiness.status === 'full_text')) return null;
  if (!readiness.action && !readiness.label) return null;
  return {
    label: readiness.label || '内容待确认',
    message: readiness.action || '当前内容依据不足，建议先确认原文。',
    tone: readiness.status === 'fetch_failed' ? 'warning' : 'neutral',
  };
}

export function shouldSurfaceFeedEvidenceNotice(notice?: {
  tone?: 'neutral' | 'warning' | null;
} | null): boolean {
  return notice?.tone === 'warning';
}

function normalizeErrorMessages(errors: unknown): string[] {
  if (!errors) return [];
  if (Array.isArray(errors)) {
    return errors.flatMap((entry) => normalizeErrorMessages(entry));
  }
  if (typeof errors === 'string') {
    return errors.trim() ? [errors.trim()] : [];
  }
  if (typeof errors === 'object') {
    return Object.values(errors as Record<string, unknown>).flatMap((entry) => normalizeErrorMessages(entry));
  }
  return [String(errors)];
}

export function resolveFullTranslationNotice(input: {
  stage?: string | null;
  contentFetched?: boolean | null;
  translated?: number | null;
  skipped?: number | null;
  errors?: unknown;
  errorReason?: string | null;
  message?: string | null;
}): { message: string; tone: 'success' | 'warning' | 'danger' } {
  const errors = normalizeErrorMessages(input.errors);
  const errorReason = (input.errorReason || '').trim();
  if (input.stage === 'content' && (errorReason || errors.length > 0)) {
    return {
      message: `补抓原文失败：${errorReason || errors.join('；')}`,
      tone: 'danger',
    };
  }
  if (errors.length > 0) {
    const prefix = input.stage === 'content' ? '补抓原文失败' : '精译全文失败';
    return { message: `${prefix}：${errors.join('；')}`, tone: 'danger' };
  }
  if ((input.translated || 0) > 0) {
    if (input.contentFetched && !input.message) {
      return { message: '已补抓原文并完成精译，译文已刷新。', tone: 'success' };
    }
    return { message: input.message || '精译全文完成，译文已刷新。', tone: 'success' };
  }
  if ((input.skipped || 0) > 0 && input.message) {
    return { message: input.message, tone: 'warning' };
  }
  if (input.message && /content|正文|原文|fetch/i.test(input.message)) {
    return { message: input.message, tone: 'warning' };
  }
  if ((input.skipped || 0) > 0) {
    return { message: '精译全文被跳过：通常是原文已识别为中文，或当前内容缺少可翻译正文。', tone: 'warning' };
  }
  return {
    message: input.message || '精译全文没有执行：可能缺少翻译模型配置，或后端没有命中这条文章。',
    tone: 'warning',
  };
}

export function resolveCompletedFullTranslationNotice(input: {
  jobState?: string | null;
  message?: string | null;
  contentFetched?: boolean | null;
  translated?: number | null;
  skipped?: number | null;
  errorReason?: string | null;
  item?: {
    aiTranslation?: string | null;
    translationStatus?: string | null;
    translationReason?: string | null;
    translationCompleteness?: {
      complete?: boolean | null;
      reason?: string | null;
    } | null;
  } | null;
}): { message: string; tone: 'success' | 'warning' | 'danger' } {
  const itemReady = input.item?.translationStatus === 'ready'
    && Boolean(input.item.aiTranslation?.trim())
    && input.item.translationCompleteness?.complete !== false;
  const itemFailed = input.item?.translationStatus === 'failed';
  const itemSkipped = input.item?.translationStatus === 'skipped';
  const translated = Math.max(Number(input.translated || 0), itemReady ? 1 : 0);
  const skipped = Math.max(Number(input.skipped || 0), itemSkipped ? 1 : 0);
  const errorReason = input.errorReason
    || (input.item?.translationCompleteness?.complete === false
      ? input.item.translationCompleteness.reason || '译文不完整，系统没有将其作为可读译文展示。'
      : null)
    || (itemFailed ? input.item?.translationReason || '翻译模型没有返回可用结果。' : null);

  if (errorReason) {
    return {
      message: `精译全文失败：${errorReason}`,
      tone: 'danger',
    };
  }

  if (translated > 0) {
    return {
      message: input.contentFetched
        ? '已补抓原文并完成全文翻译，译文已刷新。'
        : '全文翻译完成，译文已刷新。',
      tone: 'success',
    };
  }

  return resolveFullTranslationNotice({
    message: input.jobState === 'completed' && !input.message
      ? '全文翻译任务已完成，但尚未检测到可用译文。'
      : input.message,
    stage: input.jobState === 'completed' ? 'done' : 'translation',
    contentFetched: input.contentFetched,
    translated,
    skipped,
    errorReason,
  });
}
