import { observeJev } from '../jev/queue.js';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  buildSnippet,
  cleanArticleBody,
  detectLikelyLanguage,
  fetchArticleResult,
  plainTextLength,
  trimMalformedFeedContinuation,
} from './content-extractor.js';
import { deriveSourceContentStrategy } from './source-content-strategy.js';

type ItemForEnrichment = {
  id: string;
  userId: string;
  title: string;
  url: string;
  originalUrl: string | null;
  sourceType: string | null;
  sourceCollectorType: string | null;
  sourceRole: string | null;
  sourceProcessingProfile: string | null;
  sourceConfig: Record<string, unknown> | null;
  content: string | null;
  readabilityContent: string | null;
  readabilityStatus: string | null;
  readabilityReason: string | null;
  snippet: string | null;
  language: string | null;
  contentStatus: string | null;
  contentError: string | null;
  fetchEngine: string | null;
  renderMode: string | null;
  blockedReason: string | null;
};

export type ContentBasis = 'title' | 'snippet' | 'content';

function resolveReadableLayerText(input?: string | null): string {
  const raw = (input || '').trim();
  if (!raw) return '';
  const cleaned = (cleanArticleBody(raw, 50000) || raw).trim();
  const rawLength = plainTextLength(raw);
  const cleanedLength = plainTextLength(cleaned);

  if (
    rawLength >= 1200
    && cleanedLength >= 180
    && cleanedLength < rawLength * 0.55
    && !/<(?:script|style|nav|footer|header|aside|div|p|li|a)\b/i.test(raw)
  ) {
    return raw;
  }

  return cleaned;
}

export function resolveItemText(item: {
  title: string;
  content?: string | null;
  contentStatus?: string | null;
  readabilityContent?: string | null;
  readabilityStatus?: string | null;
  snippet?: string | null;
}): { text: string; basis: ContentBasis } {
  const readability = item.readabilityStatus === 'ready'
    ? resolveReadableLayerText(item.readabilityContent)
    : '';
  if (plainTextLength(readability) >= 180) {
    return { text: readability, basis: 'content' };
  }

  const content = (cleanArticleBody(item.content, 50000) || item.content || '').trim();
  if (plainTextLength(content) >= 180) {
    return { text: content, basis: 'content' };
  }

  const snippet = (cleanArticleBody(item.snippet, 2000)
    || trimMalformedFeedContinuation(item.snippet || '')
    || item.snippet
    || '').trim();
  if (plainTextLength(snippet) >= 24) {
    return { text: snippet, basis: 'snippet' };
  }

  return { text: item.title.trim(), basis: 'title' };
}

type ContentFetchTarget = {
  url: string | null;
  kind: 'url' | 'original' | 'curated_index_missing_original';
};

type ContentFetchTargetInput = {
  url: string;
  originalUrl?: string | null;
  sourceType?: string | null;
  sourceCollectorType?: string | null;
};

function asHttpUrl(value?: string | null): string | null {
  const normalized = String(value || '').trim();
  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

export function resolveContentFetchCandidates(item: ContentFetchTargetInput): ContentFetchTarget[] {
  const sourceType = String(item.sourceType || '').toLowerCase();
  const collectorType = String(item.sourceCollectorType || '').toLowerCase();
  const isCuratedIndex = sourceType === 'curated_index' || collectorType === 'webpage_index';
  const originalUrl = asHttpUrl(item.originalUrl);
  if (isCuratedIndex) {
    if (originalUrl) {
      return [{ url: originalUrl, kind: 'original' }];
    }
    return [{ url: null, kind: 'curated_index_missing_original' }];
  }

  const itemUrl = asHttpUrl(item.url);
  const candidates: ContentFetchTarget[] = [];
  if (originalUrl) candidates.push({ url: originalUrl, kind: 'original' });
  if (itemUrl && itemUrl !== originalUrl) candidates.push({ url: itemUrl, kind: 'url' });
  return candidates.length > 0 ? candidates : [{ url: item.url || null, kind: 'url' }];
}

export function resolveContentFetchTarget(item: ContentFetchTargetInput): ContentFetchTarget {
  return resolveContentFetchCandidates(item)[0];
}

export function buildContentRefetchAiResetPatch(
  fetchTargetKind: ReturnType<typeof resolveContentFetchTarget>['kind'],
  contentChanged = false,
) {
  if (fetchTargetKind !== 'original' && !contentChanged) return {};
  const reason = fetchTargetKind === 'original' ? 'original_content_refetched' : 'content_refetched';
  return {
    processingStatus: 'raw',
    aiSummary: null,
    summaryStatus: 'pending',
    summaryReason: reason,
    aiTranslation: null,
    translatedTitle: null,
    translationStatus: 'pending',
    translationReason: reason,
    priorityScore: null,
  };
}

function isPromotionalShell(value?: string | null) {
  return /(?:Sponsored by|\bsponsor(?:ed|ship)?\b|赞助方|赞助内容|Atlassian|Jira)/i
    .test(String(value || ''));
}

export function shouldAcceptFetchedContent(input: {
  currentContent?: string | null;
  snippet?: string | null;
  extractedContent?: string | null;
}) {
  const currentLen = plainTextLength(input.currentContent || '');
  const snippetLen = plainTextLength(input.snippet || '');
  const extractedLen = plainTextLength(input.extractedContent || '');
  const replacingPromotionalShell = isPromotionalShell(input.currentContent)
    && !isPromotionalShell(input.extractedContent);
  if (replacingPromotionalShell) return extractedLen >= 60;
  const minimumAcceptedLength = currentLen > 0
    ? Math.max(Math.min(currentLen + 24, 140), 60)
    : 60;
  return extractedLen >= minimumAcceptedLength && extractedLen > snippetLen;
}

export function buildRejectedContentFetchPatch(input: {
  fallbackStatus: 'degraded' | 'failed';
  warning: string;
  extractedReadabilityContent?: string | null;
  extractedFetchEngine?: string | null;
  extractedRenderMode?: string | null;
  extractedBlockedReason?: string | null;
}): {
  contentStatus: 'degraded' | 'failed';
  contentError: string;
  readabilityStatus: 'ready' | 'failed';
  readabilityReason: string | null;
  fetchEngine: string | null;
  renderMode: string | null;
  blockedReason: string;
} {
  return {
    contentStatus: input.fallbackStatus,
    contentError: input.warning,
    readabilityStatus: 'failed',
    readabilityReason: input.warning,
    fetchEngine: input.extractedFetchEngine || null,
    renderMode: input.extractedRenderMode || null,
    blockedReason: input.extractedBlockedReason || 'content_unavailable',
  };
}

export function shouldFetchContentBeforeFullTranslation(item: {
  url?: string | null;
  contentStatus?: string | null;
  content?: string | null;
  readabilityContent?: string | null;
  readabilityStatus?: string | null;
  snippet?: string | null;
  originalUrl?: string | null;
  sourceType?: string | null;
  sourceCollectorType?: string | null;
  sourceRole?: string | null;
  sourceProcessingProfile?: string | null;
  sourceContentStrategy?: string | null;
  fetchEngine?: string | null;
  renderMode?: string | null;
}): boolean {
  const strategy = deriveSourceContentStrategy({
    contentStrategy: item.sourceContentStrategy,
    collectorType: item.sourceCollectorType,
    sourceType: item.sourceType,
    sourceRole: item.sourceRole,
    processingProfile: item.sourceProcessingProfile,
  });
  if (strategy === 'monitor_only' || strategy === 'feed_only') return false;

  const fetchTarget = resolveContentFetchTarget({
    url: item.url || item.originalUrl || '',
    originalUrl: item.originalUrl,
    sourceType: item.sourceType,
    sourceCollectorType: item.sourceCollectorType,
  });
  if (!fetchTarget.url) return false;

  const sourceType = String(item.sourceType || '').toLowerCase();
  const collectorType = String(item.sourceCollectorType || '').toLowerCase();
  const isIndexSource = sourceType === 'curated_index' || collectorType === 'webpage_index';
  const isIndexContent = String(item.fetchEngine || '').toLowerCase() === 'webpage-index'
    || String(item.renderMode || '').toLowerCase() === 'index'
    || /原文待补抓|榜单摘要|##\s*Anthropic Newsroom|##\s*BestBlogs Daily Brief/i.test(item.content || '');

  if (isIndexSource && isIndexContent) return true;
  if (plainTextLength(item.content || '') >= 180 && (item.readabilityStatus !== 'ready' || plainTextLength(item.readabilityContent || '') < 180)) {
    return true;
  }
  if (strategy === 'full') {
    return plainTextLength(item.content || '') < 1800;
  }
  if (item.contentStatus === 'degraded' || item.contentStatus === 'failed' || item.contentStatus === 'missing') return true;
  return plainTextLength(item.content || '') < 500 && plainTextLength(item.snippet || '') >= 24;
}

export async function getItemForEnrichment(userId: string, itemId: string): Promise<ItemForEnrichment | null> {
  const rows = await db
    .select({
      id: schema.items.id,
      userId: schema.items.userId,
      title: schema.items.title,
      url: schema.items.url,
      originalUrl: schema.items.originalUrl,
      sourceType: schema.items.sourceType,
      sourceCollectorType: schema.sources.collectorType,
      sourceRole: schema.sources.sourceRole,
      sourceProcessingProfile: schema.sources.processingProfile,
      sourceConfig: schema.sources.config,
      content: schema.items.content,
      readabilityContent: schema.items.readabilityContent,
      readabilityStatus: schema.items.readabilityStatus,
      readabilityReason: schema.items.readabilityReason,
      snippet: schema.items.snippet,
      language: schema.items.language,
      contentStatus: schema.items.contentStatus,
      contentError: schema.items.contentError,
      fetchEngine: schema.items.fetchEngine,
      renderMode: schema.items.renderMode,
      blockedReason: schema.items.blockedReason,
    })
    .from(schema.items)
    .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
    .where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    ...row,
    sourceConfig: row.sourceConfig && typeof row.sourceConfig === 'object'
      ? row.sourceConfig as Record<string, unknown>
      : null,
  };
}

export async function ensureItemContent(
  userId: string,
  itemId: string,
  options: { force?: boolean } = {},
): Promise<{
  item: ItemForEnrichment | null;
  contentFetched: boolean;
  warning?: string;
}> {
  const item = await getItemForEnrichment(userId, itemId);
  if (!item) {
    return { item: null, contentFetched: false, warning: 'item not found' };
  }

  const currentLen = plainTextLength(item.content || '');
  const sourceContentStrategy = item.sourceConfig && typeof item.sourceConfig.contentStrategy === 'string'
    ? item.sourceConfig.contentStrategy
    : null;
  const shouldRepairReadableLayer = shouldFetchContentBeforeFullTranslation({
    url: item.url,
    contentStatus: item.contentStatus,
    content: item.content,
    readabilityContent: item.readabilityContent,
    readabilityStatus: item.readabilityStatus,
    snippet: item.snippet,
    originalUrl: item.originalUrl,
    sourceType: item.sourceType,
    sourceCollectorType: item.sourceCollectorType,
    sourceRole: item.sourceRole,
    sourceProcessingProfile: item.sourceProcessingProfile,
    sourceContentStrategy,
    fetchEngine: item.fetchEngine,
    renderMode: item.renderMode,
  });
  if (!options.force && currentLen >= 180 && !shouldRepairReadableLayer) {
    return { item, contentFetched: false };
  }

  const fetchTargets = resolveContentFetchCandidates(item);
  const fetchTarget = fetchTargets[0];
  if (!fetchTarget.url) {
    const warning = fetchTarget.kind === 'curated_index_missing_original'
      ? '榜单摘要可读，原文链接未解析'
      : '当前条目没有可抓取的网页链接';
    await db.update(schema.items).set({
      contentStatus: fetchTarget.kind === 'curated_index_missing_original' ? 'degraded' : 'unavailable',
      contentError: warning,
      blockedReason: fetchTarget.kind === 'curated_index_missing_original' ? 'original_url_missing' : 'invalid_url',
    }).where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)));
    return {
      item: {
        ...item,
        contentStatus: fetchTarget.kind === 'curated_index_missing_original' ? 'degraded' : 'unavailable',
        contentError: warning,
        blockedReason: fetchTarget.kind === 'curated_index_missing_original' ? 'original_url_missing' : 'invalid_url',
      },
      contentFetched: false,
      warning,
    };
  }

  if (!/^https?:\/\//i.test(fetchTarget.url)) {
    await db.update(schema.items).set({
      contentStatus: 'unavailable',
      contentError: '当前条目没有可抓取的网页链接',
      blockedReason: 'invalid_url',
    }).where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)));
    return {
      item: {
        ...item,
        contentStatus: 'unavailable',
        contentError: '当前条目没有可抓取的网页链接',
        blockedReason: 'invalid_url',
      },
      contentFetched: false,
      warning: '当前条目没有可抓取的网页链接',
    };
  }

  await db.update(schema.items).set({
      contentStatus: 'fetching',
      contentError: null,
      readabilityStatus: 'pending',
      readabilityReason: null,
      blockedReason: null,
  }).where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)));

  let acceptedTarget: ContentFetchTarget | null = null;
  let extracted: Awaited<ReturnType<typeof fetchArticleResult>> = null;
  let cleanedExtracted: string | null = null;

  for (const candidate of fetchTargets) {
    if (!candidate.url || !/^https?:\/\//i.test(candidate.url)) continue;
    const candidateExtracted = await fetchArticleResult(candidate.url, 8000, { beforeDynamicFetch: () => observeJev("fetch", itemId) });
    const candidateContent = cleanArticleBody(candidateExtracted?.content, 50000) ?? candidateExtracted?.content ?? null;
    extracted = candidateExtracted;
    cleanedExtracted = candidateContent;
    if (candidateContent && shouldAcceptFetchedContent({
      currentContent: item.content,
      snippet: item.snippet,
      extractedContent: candidateContent,
    })) {
      acceptedTarget = candidate;
      break;
    }
  }

  const readabilityContent = extracted?.readabilityContent || null;
  if (!cleanedExtracted || !shouldAcceptFetchedContent({
    currentContent: item.content,
    snippet: item.snippet,
    extractedContent: cleanedExtracted,
  })) {
    const fallbackStatus = plainTextLength(item.snippet || '') >= 24 ? 'degraded' : 'failed';
    const warningBase = fallbackStatus === 'degraded'
      ? '正文抓取未命中，当前仅保留摘要片段'
      : '正文抓取失败，当前没有可读缓存';
    const warning = extracted?.blockedReason ? `${warningBase}（${extracted.blockedReason}）` : warningBase;
    const patch = buildRejectedContentFetchPatch({
      fallbackStatus,
      warning,
      extractedReadabilityContent: readabilityContent,
      extractedFetchEngine: extracted?.fetchEngine || null,
      extractedRenderMode: extracted?.renderMode || null,
      extractedBlockedReason: extracted?.blockedReason || null,
    });
    await db.update(schema.items).set(patch).where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)));

    return {
      item: {
        ...item,
        ...patch,
      },
      contentFetched: false,
      warning,
    };
  }

  const cleanedContent = cleanedExtracted;
  const cleanedSnippet = buildSnippet(cleanedContent, 220) ?? item.snippet;
  const nextLanguage = detectLikelyLanguage(`${item.title}\n${cleanedContent}`) || item.language;
  const contentChanged = cleanedContent.trim() !== String(item.content || '').trim();
  const aiResetPatch = buildContentRefetchAiResetPatch(acceptedTarget?.kind || fetchTarget.kind, contentChanged);

  await db.update(schema.items).set({
    content: cleanedContent,
    readabilityContent,
    readabilityStatus: readabilityContent ? 'ready' : 'missing',
    readabilityReason: readabilityContent ? null : 'readability_not_available',
    snippet: cleanedSnippet ?? null,
    language: nextLanguage ?? null,
    contentStatus: 'ready',
    contentError: null,
    fetchEngine: extracted?.fetchEngine || null,
    renderMode: extracted?.renderMode || null,
    blockedReason: null,
    ...aiResetPatch,
  }).where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)));

  return {
    item: {
      ...item,
      content: cleanedContent,
      readabilityContent,
      readabilityStatus: readabilityContent ? 'ready' : 'missing',
      readabilityReason: readabilityContent ? null : 'readability_not_available',
      snippet: cleanedSnippet ?? null,
      language: nextLanguage ?? null,
      contentStatus: 'ready',
      contentError: null,
      fetchEngine: extracted?.fetchEngine || null,
      renderMode: extracted?.renderMode || null,
      blockedReason: null,
      ...aiResetPatch,
    },
    contentFetched: true,
  };
}
