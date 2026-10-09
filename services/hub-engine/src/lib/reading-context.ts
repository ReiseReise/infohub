import { deriveSourceContentStrategy } from './source-content-strategy.js';
import { plainTextLength } from './content-extractor.js';
import {
  evaluateTranslationArtifact,
  type TranslationQualityReasonCode,
} from './translation-quality.js';

export type ContentReadinessStatus =
  | 'full_text'
  | 'rss_summary'
  | 'snippet_only'
  | 'title_only'
  | 'fetch_failed'
  | 'pending';

export type ContentReadinessBasis = 'content' | 'snippet' | 'title';

export type ContentReadiness = {
  status: ContentReadinessStatus;
  label: string;
  basis: ContentReadinessBasis;
  kind?: 'article' | 'snapshot' | 'curated_summary' | 'index_item' | 'external_link_summary';
  isFullText?: boolean;
  fullTextAvailable: boolean;
  originalTextStatus?: 'ready' | 'pending_fetch' | 'missing_original_url' | 'not_applicable';
  action: string;
};

export type TranslationAction = 'translate' | 'fetch_then_translate' | 'open_original' | 'none';

export type ReadingAssetType =
  | 'summary'
  | 'translation'
  | 'rewrite'
  | 'qa'
  | 'feedback'
  | 'report_reference'
  | 'transcript'
  | 'knowledge';

export type ReadingAssetStatus = 'ready' | 'pending' | 'failed' | 'skipped' | 'missing';

export type ReadingAsset = {
  id?: number | string | null;
  type: ReadingAssetType;
  label: string;
  status: ReadingAssetStatus;
  basis?: ContentReadinessBasis | string | null;
  model?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  preview?: string | null;
  content?: string | null;
  source: 'ai' | 'human' | 'system' | 'report';
  promptKey?: string | null;
  errorReason?: string | null;
};

export type RankContext = {
  strategy: 'feed_recommended_v1' | 'feed_latest_v1';
  version: '2026-06-11';
  generatedAt: string;
  reasons: string[];
  fallback: boolean;
};

export type ReportContext = {
  strategy: 'daily_report_selection_v2';
  version: '2026-06-11';
  window: string | null;
  selectionMode: string;
  reason: string;
  action: string;
  label: string;
};

export type TranslationCompleteness = {
  basisLength: number;
  translatedLength: number;
  chunkCount: number;
  complete: boolean;
  reason: string | null;
  usable: boolean;
  reasonCode: TranslationQualityReasonCode | null;
  formatVersion: 'translation-v2';
};

export type TranslationUsability = 'usable' | 'invalid' | 'pending' | 'failed' | 'skipped';

export type ContentEvidenceLayer =
  | 'readableText'
  | 'rawFeedHtml'
  | 'externalLinkSummary'
  | 'indexSummary'
  | 'curatedSummary'
  | 'snapshotText'
  | 'snippet'
  | 'title'
  | 'none';

export type ContentEvidenceSignal = {
  available: boolean;
  length: number;
  label: string;
  status?: string | null;
  reason?: string | null;
};

export type ContentEvidence = {
  primaryLayer: ContentEvidenceLayer;
  primaryLabel: string;
  rawFeedHtml: ContentEvidenceSignal;
  readableHtml: ContentEvidenceSignal;
  readableText: ContentEvidenceSignal;
  externalLinkSummary: ContentEvidenceSignal;
  indexSummary: ContentEvidenceSignal;
  curatedSummary: ContentEvidenceSignal;
  snapshotText: ContentEvidenceSignal;
  snippet: ContentEvidenceSignal;
  title: ContentEvidenceSignal;
  translationBasis: {
    layer: ContentEvidenceLayer;
    label: string;
    reliableForFullTranslation: boolean;
    reason: string;
  };
};

function textLength(value?: string | null): number {
  return plainTextLength(value);
}

function preview(value?: string | null, max = 120): string | null {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function normalizeBasis(value?: string | null): ContentReadinessBasis | null {
  if (value === 'content' || value === 'snippet' || value === 'title') return value;
  return null;
}

function looksLikeIndexSummaryContent(value?: string | null): boolean {
  const text = value || '';
  return /原文待补抓|榜单摘要|##\s*BestBlogs Daily Brief|##\s*Anthropic Newsroom/i.test(text);
}

function normalizeHostname(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split(':')[0]
    .trim();
}

function hostnameFromUrl(value?: string | null): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return normalizeHostname(new URL(raw).hostname);
  } catch {
    return '';
  }
}

function hostnameFromSourceName(value?: string | null): string {
  const host = normalizeHostname(value);
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? host : '';
}

function hostsDiffer(sourceHost: string, itemHost: string): boolean {
  if (!sourceHost || !itemHost || sourceHost === itemHost) return false;
  return !itemHost.endsWith(`.${sourceHost}`) && !sourceHost.endsWith(`.${itemHost}`);
}

function isCrossSiteRssEntry(input: {
  sourceName?: string | null;
  url?: string | null;
  sourceType?: string | null;
  sourceCollectorType?: string | null;
  readabilityContent?: string | null;
  readabilityStatus?: string | null;
}): boolean {
  const sourceType = String(input.sourceType || '').toLowerCase();
  const collectorType = String(input.sourceCollectorType || '').toLowerCase();
  const isRss = sourceType === 'rss' || collectorType === 'rss' || collectorType === 'rsshub';
  if (!isRss) return false;
  if (input.readabilityStatus === 'ready' && textLength(input.readabilityContent) >= 180) return false;
  return hostsDiffer(hostnameFromSourceName(input.sourceName), hostnameFromUrl(input.url));
}

function looksLikeHtmlContent(value?: string | null): boolean {
  return /<\/?(?:p|div|article|main|section|h[1-6]|ul|ol|li|pre|code|blockquote|img|a)\b/i.test(value || '');
}

function hasRejectedContentFetch(input: {
  contentStatus?: string | null;
  contentError?: string | null;
  blockedReason?: string | null;
  readabilityStatus?: string | null;
  readabilityReason?: string | null;
}): boolean {
  const blockedReason = String(input.blockedReason || '').trim();
  if (blockedReason === 'content_unavailable' || blockedReason === 'fetch_failed') return true;
  const reason = `${input.contentError || ''} ${input.readabilityReason || ''}`;
  if (/正文抓取未命中|当前仅保留摘要片段|补抓失败|原文抓取失败|content_unavailable/i.test(reason)) return true;
  return input.contentStatus === 'degraded' && input.readabilityStatus === 'failed';
}

function looksLikeForeignLongText(input: {
  language?: string | null;
  readabilityContent?: string | null;
  readabilityStatus?: string | null;
  content?: string | null;
  snippet?: string | null;
}): boolean {
  const language = String(input.language || '').trim().toLowerCase();
  if (language && !language.startsWith('zh') && !language.startsWith('cn')) return true;
  const text = (input.readabilityStatus === 'ready' && textLength(input.readabilityContent) >= 180
    ? input.readabilityContent
    : input.content || input.snippet || ''
  ) || '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length < 600) return false;
  const latinCount = (normalized.match(/[A-Za-z]/g) || []).length;
  const cjkCount = (normalized.match(/[\u3400-\u9fff]/g) || []).length;
  return latinCount > 280 && latinCount > cjkCount * 3;
}

function evidenceSignal(input: {
  available: boolean;
  length: number;
  label: string;
  status?: string | null;
  reason?: string | null;
}): ContentEvidenceSignal {
  return {
    available: input.available,
    length: Math.max(0, Math.round(Number(input.length || 0))),
    label: input.label,
    status: input.status ?? null,
    reason: input.reason ?? null,
  };
}

function buildTranslationCompleteness(input: {
  content?: string | null;
  readabilityContent?: string | null;
  readabilityStatus?: string | null;
  snippet?: string | null;
  contentLength?: number | null;
  snippetLength?: number | null;
  aiTranslation?: string | null;
  translationStatus?: string | null;
}): TranslationCompleteness | null {
  if (!input.aiTranslation && input.translationStatus !== 'ready') return null;
  const readabilityLength = input.readabilityStatus === 'ready' ? textLength(input.readabilityContent) : 0;
  const basisLength = Math.max(
    readabilityLength,
    Number(input.contentLength || 0),
    textLength(input.content),
    Number(input.snippetLength || 0),
    textLength(input.snippet),
  );
  const translationBasis = readabilityLength > 0 ? input.readabilityContent : (input.content || input.snippet || '');
  return evaluateTranslationArtifact(input.aiTranslation, translationBasis, { basisLength });
}

function buildTranslationUsability(input: {
  aiTranslation?: string | null;
  translationStatus?: string | null;
}, completeness: TranslationCompleteness | null): TranslationUsability {
  if (completeness?.usable) return 'usable';
  if (input.aiTranslation?.trim() || input.translationStatus === 'ready') return 'invalid';
  if (input.translationStatus === 'failed') return 'failed';
  if (input.translationStatus === 'skipped') return 'skipped';
  return 'pending';
}

export function buildContentReadiness(input: {
  title?: string | null;
  content?: string | null;
  snippet?: string | null;
  contentLength?: number | null;
  snippetLength?: number | null;
  contentStatus?: string | null;
  contentBasis?: string | null;
  contentError?: string | null;
  blockedReason?: string | null;
  sourceType?: string | null;
  sourceCollectorType?: string | null;
  sourceName?: string | null;
  url?: string | null;
  originalUrl?: string | null;
  curationSource?: string | null;
  fetchEngine?: string | null;
  renderMode?: string | null;
  readabilityContent?: string | null;
  readabilityStatus?: string | null;
  readabilityReason?: string | null;
}): ContentReadiness {
  const contentLen = input.contentLength != null ? Number(input.contentLength || 0) : textLength(input.content);
  const snippetLen = input.snippetLength != null ? Number(input.snippetLength || 0) : textLength(input.snippet);
  const explicitBasis = normalizeBasis(input.contentBasis);
  const basis: ContentReadinessBasis = explicitBasis
    || (contentLen >= 180 ? 'content' : snippetLen >= 24 ? 'snippet' : 'title');
  const sourceType = String(input.sourceType || '').toLowerCase();
  const collectorType = String(input.sourceCollectorType || '').toLowerCase();
  const isSnapshotSource = sourceType === 'webpage';
  const isCuratedIndex = sourceType === 'curated_index'
    || (!isSnapshotSource && collectorType === 'webpage_index');
  const hasOriginalUrl = /^https?:\/\//i.test(String(input.originalUrl || '').trim());
  const readabilityReady = input.readabilityStatus === 'ready' && textLength(input.readabilityContent) >= 180;
  const isIndexExtractedContent = looksLikeIndexSummaryContent(input.content)
    || String(input.fetchEngine || '').toLowerCase() === 'webpage-index'
    || String(input.renderMode || '').toLowerCase() === 'index';
  const rejectedContentFetch = hasRejectedContentFetch(input);

  if (isCuratedIndex && !hasOriginalUrl) {
    return {
      status: 'rss_summary',
      label: '榜单摘要可读',
      basis,
      kind: 'curated_summary',
      isFullText: false,
      fullTextAvailable: false,
      originalTextStatus: 'missing_original_url',
      action: '可以先读榜单摘要；如需深读，需要先解析原站链接并补抓正文。',
    };
  }

  if (isCuratedIndex && hasOriginalUrl && !readabilityReady && (basis !== 'content' || isIndexExtractedContent)) {
    return {
      status: 'rss_summary',
      label: '索引摘要可读',
      basis,
      kind: 'index_item',
      isFullText: false,
      fullTextAvailable: false,
      originalTextStatus: 'pending_fetch',
      action: '已解析原站链接；建议补抓原文后再做深读、翻译或日报精选。',
    };
  }

  if (input.contentStatus === 'failed' || input.contentStatus === 'unavailable') {
    return {
      status: 'fetch_failed',
      label: '补抓失败',
      basis,
      fullTextAvailable: false,
      action: '重新补抓正文，或检查来源是否需要登录、渲染或反爬处理。',
    };
  }

  if (isSnapshotSource) {
    return {
      status: contentLen >= 24 || snippetLen >= 24 ? 'rss_summary' : 'title_only',
      label: contentLen >= 24 || snippetLen >= 24 ? '网页监控快照' : '网页监控线索',
      basis,
      kind: 'snapshot',
      isFullText: false,
      fullTextAvailable: false,
      originalTextStatus: 'not_applicable',
      action: '这是网页变化监控快照，不等同于单篇文章；如需进入深读，应改成索引源或单篇正文源。',
    };
  }

  if (readabilityReady) {
    return {
      status: 'full_text',
      label: '全文可读',
      basis: 'content',
      kind: 'article',
      isFullText: true,
      fullTextAvailable: true,
      originalTextStatus: 'ready',
      action: '可以直接阅读正文，并基于全文生成摘要、翻译和日报判断。',
    };
  }

  if (basis === 'content' && contentLen >= 180 && input.contentStatus !== 'missing' && isCrossSiteRssEntry(input)) {
    return {
      status: 'rss_summary',
      label: '外链摘要可读',
      basis: 'content',
      kind: 'external_link_summary',
      isFullText: false,
      fullTextAvailable: false,
      originalTextStatus: 'pending_fetch',
      action: '这是来源站转引、摘录或评论的 RSS 正文，不等同于目标网页全文；如需深读，应补抓目标网页正文。',
    };
  }

  if (basis === 'content' && contentLen >= 180 && input.contentStatus !== 'missing') {
    return {
      status: 'full_text',
      label: '全文可读',
      basis: 'content',
      kind: 'article',
      isFullText: true,
      fullTextAvailable: true,
      originalTextStatus: 'ready',
      action: '可以直接阅读正文，并基于全文生成摘要、翻译和日报判断。',
    };
  }

  if (basis === 'snippet' && rejectedContentFetch) {
    return {
      status: 'rss_summary',
      label: '摘要片段可读',
      basis: 'snippet',
      fullTextAvailable: false,
      originalTextStatus: hasOriginalUrl ? 'ready' : 'missing_original_url',
      action: '正文补抓未命中，当前只适合快扫；如需完整上下文，请打开原文。',
    };
  }

  if (basis === 'snippet' && (snippetLen >= 60 || input.contentStatus === 'degraded')) {
    return {
      status: 'rss_summary',
      label: '摘要可读',
      basis: 'snippet',
      fullTextAvailable: false,
      action: '可以先扫读摘要；重要内容建议补抓原文。',
    };
  }

  if (basis === 'snippet' && snippetLen >= 24) {
    return {
      status: 'snippet_only',
      label: '仅有片段',
      basis: 'snippet',
      fullTextAvailable: false,
      action: '当前只适合快扫，建议补正文后再做深读或日报精选。',
    };
  }

  if (input.contentStatus === 'fetching' || input.contentStatus === 'pending' || input.contentStatus === 'missing') {
    return {
      status: 'pending',
      label: '待补抓',
      basis: 'title',
      fullTextAvailable: false,
      action: '等待正文补抓；如长期没有变化，可手动重试正文。',
    };
  }

  return {
    status: 'title_only',
    label: '仅有标题',
    basis: 'title',
    fullTextAvailable: false,
    action: '信息不足，只能作为线索；建议补正文或检查来源质量。',
  };
}

export function buildContentEvidence(input: Parameters<typeof buildContentReadiness>[0] & {
  contentReadiness?: ContentReadiness;
}): ContentEvidence {
  const readiness = input.contentReadiness || buildContentReadiness(input);
  const contentLen = input.contentLength != null ? Number(input.contentLength || 0) : textLength(input.content);
  const snippetLen = input.snippetLength != null ? Number(input.snippetLength || 0) : textLength(input.snippet);
  const readabilityLen = textLength(input.readabilityContent);
  const sourceType = String(input.sourceType || '').toLowerCase();
  const collectorType = String(input.sourceCollectorType || '').toLowerCase();
  const isRss = sourceType === 'rss' || collectorType === 'rss' || collectorType === 'rsshub';
  const hasRawFeedHtml = isRss && contentLen >= 180 && looksLikeHtmlContent(input.content);
  const hasReadableText = input.readabilityStatus === 'ready' && readabilityLen >= 180;
  const hasExternalLinkSummary = readiness.kind === 'external_link_summary';
  const hasIndexSummary = readiness.kind === 'index_item';
  const hasCuratedSummary = readiness.kind === 'curated_summary';
  const hasSnapshotText = readiness.kind === 'snapshot';
  const hasSnippet = snippetLen >= 24;
  const hasTitle = textLength(input.title) > 0;

  let primaryLayer: ContentEvidenceLayer = 'none';
  if (hasSnapshotText) primaryLayer = 'snapshotText';
  else if (hasCuratedSummary) primaryLayer = 'curatedSummary';
  else if (hasIndexSummary) primaryLayer = 'indexSummary';
  else if (hasExternalLinkSummary) primaryLayer = 'externalLinkSummary';
  else if (hasReadableText) primaryLayer = 'readableText';
  else if (readiness.fullTextAvailable && contentLen >= 180) primaryLayer = hasRawFeedHtml ? 'rawFeedHtml' : 'readableText';
  else if (hasSnippet) primaryLayer = 'snippet';
  else if (hasTitle) primaryLayer = 'title';

  const primaryLabels: Record<ContentEvidenceLayer, string> = {
    readableText: '可读正文',
    rawFeedHtml: 'RSS 原文',
    externalLinkSummary: '外链摘要',
    indexSummary: '索引摘要',
    curatedSummary: '榜单摘要',
    snapshotText: '网页快照',
    snippet: '摘要片段',
    title: '标题线索',
    none: '无可用内容',
  };
  const reliableForFullTranslation = primaryLayer === 'readableText' || primaryLayer === 'rawFeedHtml';
  const translationReason = reliableForFullTranslation
    ? '当前翻译可基于完整正文执行。'
    : primaryLayer === 'externalLinkSummary'
      ? '当前是来源站转引、摘录或评论的 RSS 正文；应先补抓目标网页正文再做全文翻译。'
      : primaryLayer === 'indexSummary'
      ? '当前只有索引摘要；应先补抓原站正文再做全文翻译。'
      : primaryLayer === 'curatedSummary'
        ? '当前只有榜单摘要；没有原站正文时不应伪装成全文翻译。'
        : primaryLayer === 'snapshotText'
          ? '当前是网页监控快照；不适合作为文章全文翻译依据。'
          : '当前内容不足；需要先补正文。';

  return {
    primaryLayer,
    primaryLabel: primaryLabels[primaryLayer],
    rawFeedHtml: evidenceSignal({
      available: hasRawFeedHtml,
      length: hasRawFeedHtml ? contentLen : 0,
      label: 'RSS 原始 HTML',
      status: hasRawFeedHtml ? 'ready' : 'missing',
    }),
    readableHtml: evidenceSignal({
      available: hasReadableText,
      length: hasReadableText ? readabilityLen : 0,
      label: 'Readability 正文',
      status: hasReadableText ? 'ready' : 'missing',
      reason: hasReadableText ? input.readabilityReason : (input.readabilityReason || (input.readabilityStatus === 'ready' ? 'readability_too_short' : null)),
    }),
    readableText: evidenceSignal({
      available: hasReadableText || (readiness.fullTextAvailable && contentLen >= 180),
      length: hasReadableText ? readabilityLen : readiness.fullTextAvailable ? contentLen : 0,
      label: '可读正文文本',
      status: hasReadableText || readiness.fullTextAvailable ? 'ready' : 'missing',
      reason: hasReadableText ? null : input.contentError,
    }),
    externalLinkSummary: evidenceSignal({
      available: hasExternalLinkSummary,
      length: hasExternalLinkSummary ? contentLen : 0,
      label: '外链 RSS 摘要',
      status: hasExternalLinkSummary ? 'ready' : 'missing',
      reason: hasExternalLinkSummary ? readiness.action : null,
    }),
    indexSummary: evidenceSignal({
      available: hasIndexSummary,
      length: hasIndexSummary ? contentLen : 0,
      label: '索引摘要',
      status: hasIndexSummary ? 'ready' : 'missing',
      reason: hasIndexSummary ? readiness.action : null,
    }),
    curatedSummary: evidenceSignal({
      available: hasCuratedSummary,
      length: hasCuratedSummary ? contentLen : 0,
      label: '榜单摘要',
      status: hasCuratedSummary ? 'ready' : 'missing',
      reason: hasCuratedSummary ? readiness.action : null,
    }),
    snapshotText: evidenceSignal({
      available: hasSnapshotText,
      length: hasSnapshotText ? contentLen : 0,
      label: '网页监控快照',
      status: hasSnapshotText ? 'ready' : 'missing',
      reason: hasSnapshotText ? readiness.action : null,
    }),
    snippet: evidenceSignal({
      available: hasSnippet,
      length: hasSnippet ? snippetLen : 0,
      label: '摘要片段',
      status: hasSnippet ? 'ready' : 'missing',
    }),
    title: evidenceSignal({
      available: hasTitle,
      length: textLength(input.title),
      label: '标题',
      status: hasTitle ? 'ready' : 'missing',
    }),
    translationBasis: {
      layer: primaryLayer,
      label: primaryLabels[primaryLayer],
      reliableForFullTranslation,
      reason: translationReason,
    },
  };
}

function buildTranslationAction(input: {
  contentReadiness: ContentReadiness;
  url?: string | null;
  originalUrl?: string | null;
  sourceType?: string | null;
  sourceCollectorType?: string | null;
  sourceRole?: string | null;
  processingProfile?: string | null;
  sourceContentStrategy?: string | null;
  content?: string | null;
  contentStatus?: string | null;
  contentError?: string | null;
  blockedReason?: string | null;
  readabilityContent?: string | null;
  readabilityStatus?: string | null;
  readabilityReason?: string | null;
  snippet?: string | null;
  contentLength?: number | null;
  snippetLength?: number | null;
  language?: string | null;
  translationStatus?: string | null;
  translationReason?: string | null;
  aiTranslation?: string | null;
}): TranslationAction {
  const strategy = deriveSourceContentStrategy({
    contentStrategy: input.sourceContentStrategy,
    collectorType: input.sourceCollectorType,
    sourceType: input.sourceType,
    sourceRole: input.sourceRole,
    processingProfile: input.processingProfile,
  });
  const fetchUrl = String(input.originalUrl || input.url || '').trim();
  const canFetchOriginal = /^https?:\/\//i.test(fetchUrl);
  const completeness = buildTranslationCompleteness(input);
  const skippedBecauseChinese = input.translationStatus === 'skipped'
    && /中文|Chinese/i.test(String(input.translationReason || ''));
  const skipLooksWrong = skippedBecauseChinese
    && input.contentReadiness.fullTextAvailable
    && looksLikeForeignLongText(input);
  if (strategy === 'monitor_only') return 'none';
  if (hasRejectedContentFetch(input) && !input.contentReadiness.fullTextAvailable) {
    return canFetchOriginal ? 'open_original' : 'none';
  }
  if (input.contentReadiness.originalTextStatus === 'missing_original_url') {
    return canFetchOriginal ? 'open_original' : 'none';
  }
  if (strategy === 'feed_only') {
    if (skippedBecauseChinese && !skipLooksWrong) return 'none';
    if (skipLooksWrong) return 'translate';
    if (input.contentReadiness.fullTextAvailable && completeness && !completeness.complete) return 'translate';
    if (input.contentReadiness.fullTextAvailable && input.translationStatus !== 'ready') return 'translate';
    if (input.contentReadiness.fullTextAvailable && !input.aiTranslation?.trim()) return 'translate';
    return canFetchOriginal ? 'open_original' : 'none';
  }
  if (input.contentReadiness.originalTextStatus === 'pending_fetch' && canFetchOriginal) {
    return 'fetch_then_translate';
  }
  if (!input.contentReadiness.fullTextAvailable && canFetchOriginal && input.contentReadiness.status !== 'fetch_failed') {
    return 'fetch_then_translate';
  }
  if (skippedBecauseChinese && !skipLooksWrong) return 'none';
  if (skipLooksWrong) return 'translate';
  if (input.contentReadiness.fullTextAvailable && completeness && !completeness.complete) return 'translate';
  if (input.contentReadiness.fullTextAvailable && input.translationStatus !== 'ready') return 'translate';
  if (input.contentReadiness.fullTextAvailable && !input.aiTranslation?.trim()) return 'translate';
  if (!input.contentReadiness.fullTextAvailable && canFetchOriginal) return 'open_original';
  return 'none';
}

function statusFromStage(stage?: string | null, content?: string | null): ReadingAssetStatus {
  if (textLength(content) > 0) return 'ready';
  if (stage === 'ready') return 'ready';
  if (stage === 'failed') return 'failed';
  if (stage === 'skipped') return 'skipped';
  if (stage === 'pending') return 'pending';
  return 'missing';
}

const feedbackLabels: Record<string, string> = {
  must_read: '值得重点关注',
  like: '更想看',
  dislike: '少给我看',
  not_for_me: '不符合口味',
};

export function buildReadingAssets(input: {
  aiSummary?: string | null;
  summaryStatus?: string | null;
  summaryBasis?: string | null;
  summaryReason?: string | null;
  aiTranslation?: string | null;
  translationStatus?: string | null;
  translationReason?: string | null;
  transcript?: string | null;
  knowledge?: string | null;
  latestFeedbackType?: string | null;
  dailyReportDiagnostic?: {
    status?: string | null;
    label?: string | null;
    reason?: string | null;
    action?: string | null;
    tone?: string | null;
  } | null;
}): ReadingAsset[] {
  const assets: ReadingAsset[] = [
    {
      type: 'summary',
      label: '摘要',
      status: statusFromStage(input.summaryStatus, input.aiSummary),
      basis: normalizeBasis(input.summaryBasis) || input.summaryBasis || null,
      preview: preview(input.aiSummary || input.summaryReason || null),
      content: input.aiSummary || null,
      source: 'ai',
    },
    {
      type: 'translation',
      label: '翻译',
      status: statusFromStage(input.translationStatus, input.aiTranslation),
      basis: null,
      preview: preview(input.aiTranslation || input.translationReason || null),
      content: input.aiTranslation || null,
      source: 'ai',
    },
    {
      type: 'transcript',
      label: '转写',
      status: textLength(input.transcript) > 0 ? 'ready' : 'missing',
      preview: preview(input.transcript),
      content: input.transcript || null,
      source: 'ai',
    },
    {
      type: 'knowledge',
      label: '知识',
      status: textLength(input.knowledge) > 0 ? 'ready' : 'missing',
      preview: preview(input.knowledge),
      content: input.knowledge || null,
      source: 'system',
    },
  ];

  if (input.latestFeedbackType) {
    assets.push({
      type: 'feedback',
      label: '人类反馈',
      status: 'ready',
      preview: `已标记：${feedbackLabels[input.latestFeedbackType] || input.latestFeedbackType}`,
      content: null,
      source: 'human',
    });
  }

  if (input.dailyReportDiagnostic) {
    const label = input.dailyReportDiagnostic.label || '日报引用';
    const reason = input.dailyReportDiagnostic.reason || input.dailyReportDiagnostic.action || '';
    assets.push({
      type: 'report_reference',
      label: '日报引用',
      status: input.dailyReportDiagnostic.status && input.dailyReportDiagnostic.status !== 'not_generated' ? 'ready' : 'pending',
      preview: reason ? `${label}：${reason}` : label,
      content: reason || null,
      source: 'report',
    });
  }

  return assets;
}

export function buildRankContext(input: {
  view?: string | null;
  sortBy?: string | null;
  aiScore?: number | null;
  priorityScore?: number | null;
  sourceTier?: string | null;
  qualityDecision?: string | null;
  latestFeedbackType?: string | null;
  contentReadiness: ContentReadiness;
}): RankContext {
  const recommended = input.view === 'recommended' || input.sortBy === 'priority' || input.sortBy === 'score';
  const reasons: string[] = [];
  const score = Number(input.aiScore ?? input.priorityScore ?? 0);
  if (score >= 80) reasons.push('高分内容，值得优先阅读');
  else if (score >= 60) reasons.push('分数中上，可先扫读判断');
  else if (score > 0) reasons.push('分数较低，建议作为背景线索');
  else reasons.push('尚未完成评分，先按时间和来源兜底');

  if (['S', 'A'].includes(String(input.sourceTier || ''))) reasons.push('来源等级较高');
  if (input.contentReadiness.fullTextAvailable) reasons.push('已有全文，可支撑深读');
  else reasons.push(input.contentReadiness.action);
  if (input.latestFeedbackType === 'must_read') reasons.push('你标记过值得重点关注');
  else if (input.latestFeedbackType === 'like') reasons.push('符合你近期偏好');
  else if (input.latestFeedbackType === 'dislike' || input.latestFeedbackType === 'not_for_me') reasons.push('你曾给过负反馈，已降低优先级');
  if (input.qualityDecision === 'review') reasons.push('质检建议复核后再深读');
  if (input.qualityDecision === 'filter') reasons.push('质检认为噪声较高');

  return {
    strategy: recommended ? 'feed_recommended_v1' : 'feed_latest_v1',
    version: '2026-06-11',
    generatedAt: new Date().toISOString(),
    reasons: [...new Set(reasons)].slice(0, 5),
    fallback: !recommended || score <= 0 || !input.contentReadiness.fullTextAvailable,
  };
}

export function buildReportContext(input: {
  date?: string | null;
  dailyReportDiagnostic?: {
    status?: string | null;
    label?: string | null;
    reason?: string | null;
    action?: string | null;
    selectionMode?: string | null;
    tone?: string | null;
  } | null;
}): ReportContext {
  const diagnostic = input.dailyReportDiagnostic;
  return {
    strategy: 'daily_report_selection_v2',
    version: '2026-06-11',
    window: input.date || null,
    selectionMode: diagnostic?.selectionMode || diagnostic?.status || 'not_generated',
    label: diagnostic?.label || '尚无日报判断',
    reason: diagnostic?.reason || '当前日期还没有可追溯的日报候选判断。',
    action: diagnostic?.action || '先生成或预览日报，再查看这条内容的入报去向。',
  };
}

export function buildReadingItemContext(input: Parameters<typeof buildContentReadiness>[0] & Parameters<typeof buildReadingAssets>[0] & {
  url?: string | null;
  sourceCollectorType?: string | null;
  sourceRole?: string | null;
  processingProfile?: string | null;
  sourceContentStrategy?: string | null;
  view?: string | null;
  sortBy?: string | null;
  aiScore?: number | null;
  priorityScore?: number | null;
  sourceTier?: string | null;
  qualityDecision?: string | null;
  language?: string | null;
  date?: string | null;
}) {
  const contentReadiness = buildContentReadiness(input);
  const contentEvidence = buildContentEvidence({ ...input, contentReadiness });
  const readingAssets = buildReadingAssets(input);
  const translationCompleteness = buildTranslationCompleteness(input);
  return {
    contentReadiness,
    contentEvidence,
    fullTextReady: contentReadiness.fullTextAvailable,
    translationAction: buildTranslationAction({ ...input, contentReadiness }),
    translationCompleteness,
    translationUsability: buildTranslationUsability(input, translationCompleteness),
    readingAssets,
    rankContext: buildRankContext({ ...input, contentReadiness }),
    reportContext: buildReportContext(input),
  };
}
