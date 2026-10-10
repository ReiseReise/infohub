import { createHash } from 'node:crypto';
import { fetchBrowserAssist } from '../lib/browser-assist-client.js';
import { logger } from '../lib/logger.js';
import type { Collector, CollectorResult, RawItem, SourceConfig } from './base.js';

type ParseBestBlogsOptions = {
  indexUrl: string;
  capturedAt: Date;
};

type BestBlogsBriefItem = {
  resourceId?: unknown;
  contentType?: unknown;
  title?: unknown;
  url?: unknown;
  link?: unknown;
  originalUrl?: unknown;
  sourceUrl?: unknown;
  externalUrl?: unknown;
  canonicalUrl?: unknown;
  matchReason?: unknown;
  selectionReason?: unknown;
  sourceName?: unknown;
  totalScore?: unknown;
  weightedScore?: unknown;
  featured?: unknown;
  deepRead?: unknown;
  language?: unknown;
};

type ParseBestBlogsPayloadOptions = ParseBestBlogsOptions & {
  locale?: string;
  briefDate?: string;
};

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const numeric = Number.parseInt(code, 16);
      return Number.isFinite(numeric) ? String.fromCharCode(numeric) : _;
    })
    .replace(/&#(\d+);/g, (_, code) => {
      const numeric = Number(code);
      return Number.isFinite(numeric) ? String.fromCharCode(numeric) : _;
    });
}

function stripTags(value: string): string {
  return decodeBasicHtmlEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function extractAttr(html: string, attr: string): string {
  const match = html.match(new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match?.[1]?.trim() || '';
}

function resolveUrl(rawUrl: string, baseUrl: string): string {
  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return '';
  }
}

function isExternalArticleUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    return !parsed.hostname.endsWith('bestblogs.dev');
  } catch {
    return false;
  }
}

function unwrapBestBlogsOutboundUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('bestblogs.dev')) return url;
    const candidates = [
      parsed.searchParams.get('url'),
      parsed.searchParams.get('u'),
      parsed.searchParams.get('target'),
      parsed.searchParams.get('to'),
      parsed.searchParams.get('redirect'),
    ];
    for (const candidate of candidates) {
      const value = candidate?.trim();
      if (value && isExternalArticleUrl(value)) return value;
    }
  } catch {
    // Keep the original URL; the caller will reject it if it is not external.
  }
  return url;
}

function firstExplicitOriginalUrl(item: BestBlogsBriefItem): string {
  const candidates = [
    item.originalUrl,
    item.sourceUrl,
    item.externalUrl,
    item.canonicalUrl,
    item.url,
    item.link,
  ].map(asText);
  return candidates.find(isExternalArticleUrl) || '';
}

function extractTitle(block: string): string {
  const heading = block.match(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] || '';
  if (heading) return stripTags(heading);
  const ariaLabel = extractAttr(block, 'aria-label');
  if (ariaLabel) return stripTags(ariaLabel);
  const text = stripTags(block);
  return text.split(/[。.!?？；;]/)[0]?.trim().slice(0, 220) || '';
}

function extractSummary(block: string, title: string): string {
  const paragraph = block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '';
  const cleanedParagraph = stripTags(paragraph);
  if (cleanedParagraph && cleanedParagraph !== title) return cleanedParagraph.slice(0, 500);
  const text = stripTags(block).replace(title, '').trim();
  return text.slice(0, 500);
}

function extractImage(block: string, indexUrl: string): string | undefined {
  const img = block.match(/<img\b[^>]*>/i)?.[0] || '';
  if (!img) return undefined;
  const raw = extractAttr(img, 'src') || extractAttr(img, 'data-src');
  const resolved = raw ? resolveUrl(raw, indexUrl) : '';
  return resolved || undefined;
}

function candidateBlocks(html: string): string[] {
  const articles = Array.from(html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi)).map((match) => match[0]);
  if (articles.length > 0) return articles;
  return Array.from(html.matchAll(/<a\b[^>]*href\s*=\s*["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi)).map((match) => match[0]);
}

function extractFirstExternalHref(block: string, indexUrl: string): string {
  for (const match of block.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const resolved = resolveUrl(match[1] || '', indexUrl);
    if (resolved && isExternalArticleUrl(resolved)) return resolved;
  }
  return '';
}

function buildBriefContent(params: {
  title: string;
  url: string;
  originalUrl?: string | null;
  summary: string;
  indexUrl: string;
  capturedAt: Date;
  sourceName?: string;
  score?: number;
}): string {
  const dateKey = params.capturedAt.toISOString().slice(0, 10);
  const lines = [
    '## BestBlogs Daily Brief',
    '',
    `- 榜单日期：${dateKey}`,
    ...(params.sourceName ? [`- 来源站点：${params.sourceName}`] : []),
    ...(typeof params.score === 'number' ? [`- 榜单评分：${params.score}`] : []),
    ...(params.originalUrl ? [`- 原站链接：${params.originalUrl}`] : []),
    `- 榜单详情：${params.url}`,
    `- 榜单页：${params.indexUrl}`,
    '',
    '## 榜单摘要',
    '',
    params.summary || params.title,
    '',
    '## 原文待补抓',
    '',
    params.originalUrl
      ? '当前条目来自每日精选榜单，已解析到原站链接；如需完整长文，可在详情页触发正文补抓。'
      : '当前条目来自每日精选榜单，已保留榜单摘要；原站链接尚未解析，补抓失败不会影响榜单摘要阅读。',
  ];
  return lines.join('\n').trim() + '\n';
}

function extractFirstHref(block: string, indexUrl: string): string {
  const raw = block.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/i)?.[1] || '';
  return raw ? resolveUrl(raw, indexUrl) : '';
}

function isAnthropicNewsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('anthropic.com')
      && /^\/news\/[^/?#]+/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function extractTime(block: string): Date | undefined {
  const datetime = block.match(/<time\b[^>]*datetime\s*=\s*["']([^"']+)["'][^>]*>/i)?.[1] || '';
  if (datetime) {
    const parsed = new Date(datetime.length <= 10 ? `${datetime}T00:00:00Z` : datetime);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const text = stripTags(block);
  const match = text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}\b/i);
  if (match?.[0]) {
    const parsed = new Date(`${match[0]} 00:00:00 UTC`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}

function extractAnthropicCategory(block: string): string {
  const text = stripTags(block);
  const known = ['Announcements', 'Policy', 'Research', 'Product', 'Company', 'Safety', 'News'];
  return known.find((category) => new RegExp(`\\b${category}\\b`, 'i').test(text)) || 'Announcements';
}

function normalizeAnthropicNewsTitle(title: string): string {
  return title
    .replace(/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}\s+/i, '')
    .replace(/^(?:Announcements|Policy|Research|Product|Company|Safety|News)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAnthropicNewsContent(params: {
  title: string;
  summary: string;
  category: string;
  url: string;
  indexUrl: string;
}): string {
  return [
    '## Anthropic Newsroom',
    '',
    `- 分类：${params.category}`,
    `- 原文链接：${params.url}`,
    `- 来源页：${params.indexUrl}`,
    '',
    '## 摘要',
    '',
    params.summary || params.title,
    '',
    '## 原文待补抓',
    '',
    '当前条目来自 Anthropic 新闻索引页，已拆成单篇新闻；如需完整正文，可在详情页触发正文补抓。',
  ].join('\n').trim() + '\n';
}

export function parseAnthropicNewsItems(html: string, options: ParseBestBlogsOptions): RawItem[] {
  const items: RawItem[] = [];
  const seen = new Set<string>();
  const anchorBlocks = Array.from(html.matchAll(/<a\b[^>]*href\s*=\s*["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi)).map((match) => match[0]);
  const blocks = [...candidateBlocks(html), ...anchorBlocks];

  for (const block of blocks) {
    const url = extractFirstHref(block, options.indexUrl);
    if (!url || !isAnthropicNewsUrl(url) || seen.has(url)) continue;
    const title = normalizeAnthropicNewsTitle(extractTitle(block));
    if (!title || title.length < 6 || /press|support|media assets|download press/i.test(title)) continue;
    const summary = extractSummary(block, title);
    const category = extractAnthropicCategory(block);
    const publishedAt = extractTime(block) || options.capturedAt;
    seen.add(url);
    items.push({
      title,
      url,
      guid: `anthropic_news:${sha1(url)}`,
      content: buildAnthropicNewsContent({
        title,
        summary,
        category,
        url,
        indexUrl: options.indexUrl,
      }),
      originalUrl: url,
      curationUrl: options.indexUrl,
      curationSource: 'Anthropic Newsroom',
      curationMeta: {
        indexKind: 'anthropic_news',
        category,
      },
      author: 'Anthropic',
      publishedAt,
      fetchEngine: 'webpage-index',
      renderMode: 'index',
      rawData: {
        indexUrl: options.indexUrl,
        indexKind: 'anthropic_news',
        category,
      },
    });
  }

  return items;
}

function bestBlogsInternalUrl(item: BestBlogsBriefItem, options: ParseBestBlogsPayloadOptions): string {
  const contentType = asText(item.contentType).toUpperCase();
  const resourceId = asText(item.resourceId);
  const routeByType: Record<string, string> = {
    ARTICLE: 'article',
    PODCAST: 'podcast',
    VIDEO: 'video',
    TWEET: 'status',
    TWITTER: 'status',
    NEWSLETTER: 'newsletter',
  };
  const route = routeByType[contentType] || 'article';
  const normalizedId = resourceId.startsWith('RAW_') ? resourceId.slice(4) : resourceId;
  const localePrefix = (options.locale || 'zh') === 'en' ? '/en' : '';
  if (!normalizedId) return options.indexUrl;
  const url = new URL(`${localePrefix}/${route}/${encodeURIComponent(normalizedId)}`, options.indexUrl);
  if (options.briefDate) {
    url.searchParams.set('utm_source', 'brief');
    url.searchParams.set('utm_medium', 'infohub');
    url.searchParams.set('utm_campaign', options.briefDate);
    url.searchParams.set('entry', 'infohub_brief_item');
  }
  return url.toString();
}

function decodeEscapedJsonString(value: string): string {
  return value
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => {
      const numeric = Number.parseInt(code, 16);
      return Number.isFinite(numeric) ? String.fromCharCode(numeric) : _;
    });
}

export function resolveBestBlogsOriginalUrlFromHtml(html: string, detailUrl: string): string | null {
  const searchBodies = [
    html,
    decodeEscapedJsonString(html),
    decodeEscapedJsonString(decodeEscapedJsonString(html)),
  ];
  const fieldPattern = /(?:originalUrl|sourceUrl|externalUrl|canonicalSourceUrl|sourceLink|originalLink|articleUrl|articleLink|targetUrl|targetLink|url)["']?\s*[:=]\s*["'](https?:\\?\/\\?\/[^"']+)["']/gi;
  for (const body of searchBodies) {
    for (const match of body.matchAll(fieldPattern)) {
      const resolved = unwrapBestBlogsOutboundUrl(decodeEscapedJsonString(match[1] || ''));
      if (isExternalArticleUrl(resolved)) return resolved;
    }
  }

  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const resolved = unwrapBestBlogsOutboundUrl(resolveUrl(match[1] || '', detailUrl));
    if (resolved && isExternalArticleUrl(resolved)) return resolved;
  }

  return null;
}

export function parseBestBlogsBriefPayload(payload: unknown, options: ParseBestBlogsPayloadOptions): RawItem[] {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root;
  const rawItems = Array.isArray(data.contentItems) ? data.contentItems as BestBlogsBriefItem[] : [];
  const briefDate = asText(data.briefDate) || options.briefDate || options.capturedAt.toISOString().slice(0, 10);
  const seen = new Set<string>();
  const items: RawItem[] = [];

  for (const rawItem of rawItems) {
    const title = asText(rawItem.title);
    const resourceId = asText(rawItem.resourceId);
    if (!title || title.length < 6 || !resourceId || seen.has(resourceId)) continue;
    seen.add(resourceId);

    const summary = asText(rawItem.matchReason) || asText(rawItem.selectionReason) || title;
    const url = bestBlogsInternalUrl(rawItem, { ...options, briefDate });
    const originalUrl = firstExplicitOriginalUrl(rawItem) || null;
    const score = asNumber(rawItem.weightedScore) ?? asNumber(rawItem.totalScore);
    const sourceName = asText(rawItem.sourceName);
    const hash = sha1(`${briefDate}\n${resourceId}\n${title}`);
    items.push({
      title,
      url,
      guid: `bestblogs:${resourceId || hash}`,
      content: buildBriefContent({
        title,
        url,
        originalUrl,
        summary,
        indexUrl: options.indexUrl,
        capturedAt: options.capturedAt,
        sourceName,
        score,
      }),
      author: sourceName || 'BestBlogs.dev',
      originalUrl,
      curationUrl: options.indexUrl,
      curationSource: 'BestBlogs Daily Brief',
      curationMeta: {
        briefDate,
        resourceId,
        sourceName,
        contentType: asText(rawItem.contentType),
        score,
      },
      publishedAt: new Date(`${briefDate}T00:00:00+08:00`),
      fetchEngine: 'bestblogs-public-brief',
      renderMode: 'index-api',
      rawData: {
        indexUrl: options.indexUrl,
        indexKind: 'bestblogs_daily_brief',
        briefDate,
        resourceId,
        sourceName,
        contentType: asText(rawItem.contentType),
        featured: Boolean(rawItem.featured),
        deepRead: Boolean(rawItem.deepRead),
        score,
        language: asText(rawItem.language),
        originalUrl,
      },
    });
  }

  return items;
}

export function parseBestBlogsBriefItems(html: string, options: ParseBestBlogsOptions): RawItem[] {
  const seen = new Set<string>();
  const items: RawItem[] = [];
  const blocks = candidateBlocks(html);

  for (const block of blocks) {
    const url = extractFirstExternalHref(block, options.indexUrl);
    if (!url || seen.has(url)) continue;
    const title = extractTitle(block);
    if (!title || title.length < 8) continue;
    const summary = extractSummary(block, title);
    const mediaUrl = extractImage(block, options.indexUrl);
    seen.add(url);
    const hash = sha1(`${url}\n${title}`);
    items.push({
      title,
      url,
      guid: `bestblogs:${hash}`,
      content: buildBriefContent({
        title,
        url,
        originalUrl: url,
        summary,
        indexUrl: options.indexUrl,
        capturedAt: options.capturedAt,
      }),
      originalUrl: url,
      curationUrl: options.indexUrl,
      curationSource: 'BestBlogs Daily Brief',
      curationMeta: {
        indexKind: 'bestblogs_daily_brief',
      },
      publishedAt: options.capturedAt,
      mediaUrl,
      mediaType: mediaUrl ? 'image' : undefined,
      fetchEngine: 'webpage-index',
      renderMode: 'index',
      rawData: {
        indexUrl: options.indexUrl,
        indexKind: 'bestblogs_daily_brief',
      },
    });
  }

  return items;
}

async function fetchBestBlogsPublicBrief(url: string, locale: string, timeoutMs: number): Promise<unknown | null> {
  const pageUrl = new URL(url);
  const apiUrl = new URL(`/api/proxy/briefs/public/today`, pageUrl.origin);
  apiUrl.searchParams.set('locale', locale);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'InfoHubBot/1.0 (+https://localhost)',
        Accept: 'application/json',
      },
      redirect: 'follow',
    });
    if (!resp.ok) return null;
    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) return null;
    return await resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHtml(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'InfoHubBot/1.0 (+https://localhost)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!resp.ok) return null;
    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) return null;
    return await resp.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveBestBlogsOriginalUrl(detailUrl: string, timeoutMs: number): Promise<string | null> {
  const html = await fetchHtml(detailUrl, timeoutMs);
  return html ? resolveBestBlogsOriginalUrlFromHtml(html, detailUrl) : null;
}

async function enrichBestBlogsApiItemsWithOriginalUrls(items: RawItem[]): Promise<RawItem[]> {
  return Promise.all(items.map(async (item) => {
    if (item.originalUrl || !item.url.includes('bestblogs.dev')) return item;
    const originalUrl = await resolveBestBlogsOriginalUrl(item.url, 5000).catch(() => null);
    if (!originalUrl) return item;
    return {
      ...item,
      originalUrl,
      content: buildBriefContent({
        title: item.title,
        url: item.url,
        originalUrl,
        summary: item.content || item.title,
        indexUrl: item.curationUrl || item.url,
        capturedAt: item.publishedAt || new Date(),
        sourceName: item.author,
      }),
      curationMeta: {
        ...(item.curationMeta || {}),
        originalUrlResolvedBy: 'bestblogs-detail-html',
      },
    };
  }));
}

export class WebpageIndexCollector implements Collector {
  readonly type = 'webpage_index';

  async fetch(source: SourceConfig): Promise<CollectorResult> {
    const targetUrl = String((source.config as { url?: string }).url || '').trim();
    const renderMode = String((source.config as { renderMode?: string }).renderMode || 'auto').trim() || 'auto';
    const browserProvider = String((source.config as { browserProvider?: string }).browserProvider || '').trim();
    const staticHtml = String((source.config as { staticHtml?: string }).staticHtml || '').trim();
    if (!targetUrl) {
      return { items: [], fetchedAt: new Date(), error: 'No url in source config', outcomeHint: 'error' };
    }

    const capturedAt = new Date();
    try {
      const indexKind = String((source.config as { indexKind?: string }).indexKind || '').trim();
      if (indexKind === 'anthropic_news' || targetUrl.includes('anthropic.com/news')) {
        let html = staticHtml || '';
        let fetchEngine = staticHtml ? 'static-html' : 'native';
        if (!html && renderMode === 'browser-assist') {
          const assisted = await fetchBrowserAssist(targetUrl, 'snapshot', { provider: browserProvider });
          html = assisted?.html || assisted?.content || '';
          fetchEngine = assisted?.provider ? `browser-assist:${assisted.provider}` : 'browser-assist';
        }
        if (!html) {
          html = await fetchHtml(targetUrl, 10000) || '';
        }
        const items = parseAnthropicNewsItems(html, { indexUrl: targetUrl, capturedAt });
        if (items.length === 0) {
          return {
            items: [],
            fetchedAt: capturedAt,
            outcomeHint: 'no_items',
            error: 'Anthropic 新闻页未解析到单篇新闻卡片',
            sourceConfigPatch: {
              lastFetchEngine: fetchEngine,
              lastBlockedReason: html ? 'anthropic_news_items_unavailable' : 'index_html_unavailable',
              lastIndexItemCount: 0,
              lastIndexFetchedAt: capturedAt.toISOString(),
            },
          };
        }
        return {
          items,
          fetchedAt: capturedAt,
          outcomeHint: 'new_items',
          sourceConfigPatch: {
            lastFetchEngine: fetchEngine,
            lastBlockedReason: null,
            lastIndexItemCount: items.length,
            lastIndexFetchedAt: capturedAt.toISOString(),
          },
        };
      }

      if (indexKind === 'bestblogs_daily_brief' || targetUrl.includes('bestblogs.dev')) {
        const locale = String((source.config as { locale?: string }).locale || 'zh').trim() || 'zh';
        const payload = await fetchBestBlogsPublicBrief(targetUrl, locale, 10000);
        const apiItems = await enrichBestBlogsApiItemsWithOriginalUrls(
          parseBestBlogsBriefPayload(payload, { indexUrl: targetUrl, capturedAt, locale }),
        );
        if (apiItems.length > 0) {
          return {
            items: apiItems,
            fetchedAt: capturedAt,
            outcomeHint: 'new_items',
            sourceConfigPatch: {
              lastFetchEngine: 'bestblogs-public-brief',
              lastBlockedReason: null,
              lastIndexItemCount: apiItems.length,
              lastIndexFetchedAt: capturedAt.toISOString(),
            },
          };
        }
      }

      let html = staticHtml || '';
      let fetchEngine = staticHtml ? 'static-html' : 'native';

      if (!html && renderMode === 'browser-assist') {
        const assisted = await fetchBrowserAssist(targetUrl, 'snapshot', { provider: browserProvider });
        html = assisted?.html || assisted?.content || '';
        fetchEngine = assisted?.provider ? `browser-assist:${assisted.provider}` : 'browser-assist';
      }
      if (!html) {
        html = await fetchHtml(targetUrl, 10000) || '';
      }

      const items = indexKind === 'bestblogs_daily_brief' || targetUrl.includes('bestblogs.dev')
        ? parseBestBlogsBriefItems(html, { indexUrl: targetUrl, capturedAt })
        : parseBestBlogsBriefItems(html, { indexUrl: targetUrl, capturedAt });

      if (items.length === 0) {
        return {
          items: [],
          fetchedAt: capturedAt,
          outcomeHint: 'no_items',
          error: '榜单页未解析到文章卡片',
          sourceConfigPatch: {
            lastFetchEngine: fetchEngine,
            lastBlockedReason: html ? 'index_items_unavailable' : 'index_html_unavailable',
            lastIndexItemCount: 0,
            lastIndexFetchedAt: capturedAt.toISOString(),
          },
        };
      }

      return {
        items,
        fetchedAt: capturedAt,
        outcomeHint: 'new_items',
        sourceConfigPatch: {
          lastFetchEngine: fetchEngine,
          lastBlockedReason: null,
          lastIndexItemCount: items.length,
          lastIndexFetchedAt: capturedAt.toISOString(),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ sourceId: source.id, error: message }, 'Webpage index fetch failed');
      return {
        items: [],
        fetchedAt: capturedAt,
        error: message,
        outcomeHint: 'error',
        sourceConfigPatch: {
          lastFetchEngine: renderMode === 'browser-assist' ? 'browser-assist' : 'native',
          lastBlockedReason: message,
          lastIndexItemCount: 0,
          lastIndexFetchedAt: capturedAt.toISOString(),
        },
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
