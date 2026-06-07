import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  buildSnippet,
  cleanArticleBody,
  detectLikelyLanguage,
  fetchArticleResult,
  plainTextLength,
} from './content-extractor.js';

type ItemForEnrichment = {
  id: string;
  userId: string;
  title: string;
  url: string;
  content: string | null;
  snippet: string | null;
  language: string | null;
  contentStatus: string | null;
  contentError: string | null;
  fetchEngine: string | null;
  renderMode: string | null;
  blockedReason: string | null;
};

export type ContentBasis = 'title' | 'snippet' | 'content';

export function resolveItemText(item: {
  title: string;
  content?: string | null;
  snippet?: string | null;
}): { text: string; basis: ContentBasis } {
  const content = (cleanArticleBody(item.content, 50000) || item.content || '').trim();
  if (plainTextLength(content) >= 180) {
    return { text: content, basis: 'content' };
  }

  const snippet = (cleanArticleBody(item.snippet, 2000) || item.snippet || '').trim();
  if (plainTextLength(snippet) >= 24) {
    return { text: snippet, basis: 'snippet' };
  }

  return { text: item.title.trim(), basis: 'title' };
}

export async function getItemForEnrichment(userId: string, itemId: string): Promise<ItemForEnrichment | null> {
  const rows = await db
    .select({
      id: schema.items.id,
      userId: schema.items.userId,
      title: schema.items.title,
      url: schema.items.url,
      content: schema.items.content,
      snippet: schema.items.snippet,
      language: schema.items.language,
      contentStatus: schema.items.contentStatus,
      contentError: schema.items.contentError,
      fetchEngine: schema.items.fetchEngine,
      renderMode: schema.items.renderMode,
      blockedReason: schema.items.blockedReason,
    })
    .from(schema.items)
    .where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)))
    .limit(1);

  return rows[0] ?? null;
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
  if (!options.force && currentLen >= 180) {
    return { item, contentFetched: false };
  }

  if (!/^https?:\/\//i.test(item.url)) {
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
    blockedReason: null,
  }).where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)));

  const extracted = await fetchArticleResult(item.url);
  const cleanedExtracted = cleanArticleBody(extracted?.content, 50000) ?? extracted?.content ?? null;
  const extractedLen = plainTextLength(cleanedExtracted || '');
  const snippetLen = plainTextLength(item.snippet || '');
  const minimumAcceptedLength = currentLen > 0
    ? Math.max(Math.min(currentLen + 24, 140), 60)
    : 60;

  if (!cleanedExtracted || extractedLen < minimumAcceptedLength || extractedLen <= snippetLen) {
    const fallbackStatus = plainTextLength(item.snippet || '') >= 24 ? 'degraded' : 'failed';
    const warningBase = fallbackStatus === 'degraded'
      ? '正文抓取未命中，当前仅保留摘要片段'
      : '正文抓取失败，当前没有可读缓存';
    const warning = extracted?.blockedReason ? `${warningBase}（${extracted.blockedReason}）` : warningBase;
    await db.update(schema.items).set({
      contentStatus: fallbackStatus,
      contentError: warning,
      fetchEngine: extracted?.fetchEngine || null,
      renderMode: extracted?.renderMode || null,
      blockedReason: extracted?.blockedReason || 'content_unavailable',
    }).where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)));

    return {
      item: {
        ...item,
        contentStatus: fallbackStatus,
        contentError: warning,
        fetchEngine: extracted?.fetchEngine || null,
        renderMode: extracted?.renderMode || null,
        blockedReason: extracted?.blockedReason || 'content_unavailable',
      },
      contentFetched: false,
      warning,
    };
  }

  const cleanedContent = cleanedExtracted;
  const cleanedSnippet = buildSnippet(cleanedContent, 220) ?? item.snippet;
  const nextLanguage = detectLikelyLanguage(`${item.title}\n${cleanedContent}`) || item.language;

  await db.update(schema.items).set({
    content: cleanedContent,
    snippet: cleanedSnippet ?? null,
    language: nextLanguage ?? null,
    contentStatus: 'ready',
    contentError: null,
    fetchEngine: extracted?.fetchEngine || null,
    renderMode: extracted?.renderMode || null,
    blockedReason: null,
  }).where(and(eq(schema.items.id, itemId), eq(schema.items.userId, userId)));

  return {
    item: {
      ...item,
      content: cleanedContent,
      snippet: cleanedSnippet ?? null,
      language: nextLanguage ?? null,
      contentStatus: 'ready',
      contentError: null,
      fetchEngine: extracted?.fetchEngine || null,
      renderMode: extracted?.renderMode || null,
      blockedReason: null,
    },
    contentFetched: true,
  };
}
