import Parser from 'rss-parser';
import {
  plainTextLength,
  fetchArticleResult,
  trimMalformedFeedContinuation,
  type ExtractedArticleResult,
} from '../lib/content-extractor.js';
import { resolvePublishedDate } from '../lib/date-normalization.js';
import { logger } from '../lib/logger.js';
import type { Collector, CollectorResult, RawItem, SourceConfig } from './base.js';
import { resolveBestBlogsOriginalUrlFromHtml } from './webpage-index.js';

const DEFAULT_RSS_FEED_TIMEOUT_MS = 30_000;
const MAX_RSS_FEED_TIMEOUT_MS = 180_000;

export function resolveRssFeedTimeoutMs(source: Pick<SourceConfig, 'sourceTier' | 'processingProfile' | 'config'>): number {
  const configured = Number(source.config?.feedTimeoutMs ?? source.config?.rssTimeoutMs);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(MAX_RSS_FEED_TIMEOUT_MS, Math.max(10_000, Math.round(configured)));
  }

  const profile = String(source.processingProfile || '').trim().toLowerCase();
  const tier = String(source.sourceTier || '').trim().toUpperCase();
  const feedUrl = String(source.config?.url || '').trim().toLowerCase();

  if (feedUrl.includes('bestblogs.dev')) return 120_000;
  if (profile === 'full' || tier === 'S') return 90_000;
  if (profile === 'smart' || tier === 'A') return 60_000;
  return DEFAULT_RSS_FEED_TIMEOUT_MS;
}

function createRssParser(timeoutMs: number): Parser {
  return new Parser({
    timeout: timeoutMs,
    headers: { 'User-Agent': 'InfoHub/3.1 (+rss)' },
    customFields: {
      item: [
        ['enclosure', 'enclosure', { keepArray: false }],
        ['media:content', 'mediaContent', { keepArray: false }],
        ['media:thumbnail', 'mediaThumbnail', { keepArray: false }],
        ['content:encoded', 'contentEncoded', { keepArray: false }],
        ['description', 'description', { keepArray: false }],
        ['itunes:duration', 'itunesDuration', { keepArray: false }],
        ['itunes:image', 'itunesImage', { keepArray: false }],
      ],
    },
  });
}

function parseDurationSeconds(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }

  const value = String(raw || '').trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);

  const parts = value.split(':').map((item) => Number(item.trim()));
  if (parts.some((item) => !Number.isFinite(item) || item < 0)) return undefined;

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function extractAttrValue(value: unknown, key: string): string | undefined {
  const objectValue = asObject(value);
  const direct = objectValue[key];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const dollar = asObject(objectValue.$);
  const nested = dollar[key];
  if (typeof nested === 'string' && nested.trim()) return nested.trim();
  return undefined;
}

function inferMediaType(candidate: { type?: string; medium?: string; url?: string }): 'audio' | 'video' | 'image' | undefined {
  const type = String(candidate.type || '').toLowerCase();
  const medium = String(candidate.medium || '').toLowerCase();
  const url = String(candidate.url || '').toLowerCase();

  if (type.startsWith('audio/') || medium === 'audio' || /\.(mp3|m4a|aac|wav|ogg)(\?|$)/.test(url)) return 'audio';
  if (type.startsWith('video/') || medium === 'video' || /\.(mp4|mov|mkv|webm)(\?|$)/.test(url)) return 'video';
  if (type.startsWith('image/') || medium === 'image' || /\.(jpg|jpeg|png|gif|webp|avif)(\?|$)/.test(url)) return 'image';
  return undefined;
}

function firstImageFromHtml(input?: string | null): string | undefined {
  const match = (input || '').match(/<img[^>]+src=["']([^"']+)["']/i);
  const candidate = match?.[1]?.trim();
  return candidate || undefined;
}

function extractMedia(entry: Record<string, unknown>): { mediaUrl?: string; mediaType?: 'audio' | 'video' | 'image' } {
  const candidates = [
    {
      url: extractAttrValue(entry.enclosure, 'url'),
      type: extractAttrValue(entry.enclosure, 'type'),
      medium: extractAttrValue(entry.enclosure, 'medium'),
    },
    {
      url: extractAttrValue(entry.mediaContent, 'url'),
      type: extractAttrValue(entry.mediaContent, 'type'),
      medium: extractAttrValue(entry.mediaContent, 'medium'),
    },
    {
      url: extractAttrValue(entry.mediaThumbnail, 'url'),
      type: 'image/*',
      medium: 'image',
    },
    {
      url: extractAttrValue(entry.itunesImage, 'href') || extractAttrValue(entry.itunesImage, 'url'),
      type: 'image/*',
      medium: 'image',
    },
    {
      url: firstImageFromHtml(String(entry.contentEncoded || entry.content || '')),
      type: 'image/*',
      medium: 'image',
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.url) continue;
    return {
      mediaUrl: candidate.url,
      mediaType: inferMediaType(candidate),
    };
  }

  return {};
}

export type FeedEntryUrlResolution = {
  url: string;
  basis: 'entry_link' | 'http_guid' | 'media_enclosure' | 'missing';
};

function httpUrl(value: unknown): string {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate || !/^https?:\/\//i.test(candidate)) return '';
  try {
    return new URL(candidate).toString();
  } catch {
    return '';
  }
}

export function resolveFeedEntryUrl(
  entry: Record<string, unknown>,
  media = extractMedia(entry),
): FeedEntryUrlResolution {
  const link = httpUrl(entry.link);
  if (link) return { url: link, basis: 'entry_link' };

  const guid = httpUrl(entry.guid) || httpUrl(entry.id);
  if (guid) return { url: guid, basis: 'http_guid' };

  const mediaUrl = httpUrl(media.mediaUrl);
  if (mediaUrl && (media.mediaType === 'audio' || media.mediaType === 'video')) {
    return { url: mediaUrl, basis: 'media_enclosure' };
  }

  return { url: '', basis: 'missing' };
}

function shouldPrefetchFullText(source: SourceConfig): boolean {
  const profile = String(source.processingProfile || '').toLowerCase();
  const tier = String(source.sourceTier || '').toUpperCase();
  return profile === 'full' || profile === 'smart' || tier === 'S' || tier === 'A';
}

function fullTextBudget(source: SourceConfig): number {
  const profile = String(source.processingProfile || '').toLowerCase();
  const tier = String(source.sourceTier || '').toUpperCase();
  if (profile === 'full') return tier === 'S' || tier === 'A' ? 8 : 6;
  if (profile === 'smart') return tier === 'S' || tier === 'A' ? 5 : 3;
  return tier === 'S' ? 4 : tier === 'A' ? 2 : 1;
}

function shouldUseExtractedContent(original: string, extracted?: string | null): boolean {
  const originalLen = plainTextLength(original);
  const extractedLen = plainTextLength(extracted || '');
  if (extractedLen < 120) return false;
  if (originalLen === 0) return extractedLen >= 120;
  return extractedLen >= Math.max(originalLen + 60, 220);
}

function isBestBlogsArticleUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('bestblogs.dev') && /^\/(?:en\/)?article\/[^/?#]+/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function resolveBestBlogsRssOriginalUrlFromHtml(html: string, detailUrl: string): string | null {
  if (!isBestBlogsArticleUrl(detailUrl)) return null;
  return resolveBestBlogsOriginalUrlFromHtml(html, detailUrl);
}

async function fetchBestBlogsDetailHtml(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'InfoHub/3.1 (+rss-bestblogs)',
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

async function resolveBestBlogsRssOriginalUrl(url: string, timeoutMs = 2500): Promise<string | null> {
  if (!isBestBlogsArticleUrl(url)) return null;
  const html = await fetchBestBlogsDetailHtml(url, timeoutMs);
  return html ? resolveBestBlogsRssOriginalUrlFromHtml(html, url) : null;
}

type PrefetchedFullTextMerge = {
  content: string;
  readabilityContent?: string | null;
  fetchEngine?: string;
  renderMode?: string;
  blockedReason?: string;
};

export function mergePrefetchedFullText(
  baseContent: string,
  extracted?: ExtractedArticleResult | null,
): PrefetchedFullTextMerge {
  let content = baseContent;
  let readabilityContent: string | null | undefined;
  let fetchEngine: string | undefined;
  let renderMode: string | undefined;
  let blockedReason: string | undefined;

  if (shouldUseExtractedContent(baseContent, extracted?.content)) {
    content = extracted?.content || baseContent;
    readabilityContent = extracted?.readabilityContent || null;
    fetchEngine = extracted?.fetchEngine || undefined;
    renderMode = extracted?.renderMode || undefined;
    blockedReason = extracted?.blockedReason || undefined;
  } else if (extracted?.blockedReason) {
    fetchEngine = extracted.fetchEngine || undefined;
    renderMode = extracted.renderMode || undefined;
    blockedReason = extracted.blockedReason;
  }

  return {
    content,
    readabilityContent,
    fetchEngine,
    renderMode,
    blockedReason,
  };
}

type FeedContentField = 'contentEncoded' | 'summary' | 'content' | 'description' | 'contentSnippet';

type FeedContentCandidate = {
  field: FeedContentField;
  content: string;
  textLength: number;
  score: number;
};

function stripHtmlForScoring(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function countMatches(input: string, pattern: RegExp): number {
  return input.match(pattern)?.length ?? 0;
}

function feedContentScore(field: FeedContentField, content: string): number {
  const text = stripHtmlForScoring(content);
  const textLength = plainTextLength(text);
  if (textLength <= 0) return Number.NEGATIVE_INFINITY;

  const htmlStructure =
    countMatches(content, /<\/p>/gi)
    + countMatches(content, /<li\b/gi)
    + countMatches(content, /<pre\b|<code\b/gi) * 2
    + countMatches(content, /<blockquote\b/gi)
    + countMatches(content, /<img\b/gi);
  const linkCount = countMatches(content, /<a\b/gi);
  const lineCount = text.split(/\n+/).filter((line) => line.trim().length >= 16).length;
  const noiseHits = countMatches(text, /\b(?:Sponsored by|Register here|Advertisement|Cookie policy|Privacy policy)\b/gi)
    + countMatches(text, /press@anthropic\.com|Download press kit|How to get support|Non-media inquiries/gi) * 2;

  const fieldWeight: Record<FeedContentField, number> = {
    contentEncoded: 140,
    summary: 120,
    content: 80,
    description: 60,
    contentSnippet: -260,
  };
  const snippetPenalty = field === 'contentSnippet' && textLength >= 160 ? 180 : 0;
  const linkFarmPenalty = linkCount >= 20 && htmlStructure < 4 ? linkCount * 35 : 0;

  return textLength
    + htmlStructure * 65
    + Math.min(lineCount, 12) * 16
    + fieldWeight[field]
    - noiseHits * 900
    - snippetPenalty
    - linkFarmPenalty;
}

export function chooseBestFeedContent(entry: {
  contentEncoded?: unknown;
  summary?: unknown;
  content?: unknown;
  description?: unknown;
  contentSnippet?: unknown;
}): FeedContentCandidate {
  const fields: FeedContentField[] = ['contentEncoded', 'summary', 'content', 'description', 'contentSnippet'];
  const candidates = fields
    .map((field) => {
      const content = typeof entry[field] === 'string' ? trimMalformedFeedContinuation(entry[field].trim()) : '';
      return {
        field,
        content,
        textLength: plainTextLength(stripHtmlForScoring(content)),
        score: feedContentScore(field, content),
      };
    })
    .filter((candidate) => candidate.content);

  if (!candidates.length) {
    return { field: 'contentSnippet', content: '', textLength: 0, score: Number.NEGATIVE_INFINITY };
  }

  return candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return right.textLength - left.textLength;
  })[0];
}

export class RssCollector implements Collector {
  readonly type = 'rss';

  async fetch(source: SourceConfig): Promise<CollectorResult> {
    const url = (source.config as { url?: string }).url;
    if (!url) {
      return { items: [], fetchedAt: new Date(), error: 'No URL in source config' };
    }

    try {
      const feedTimeoutMs = resolveRssFeedTimeoutMs(source);
      const feed = await createRssParser(feedTimeoutMs).parseURL(url);
      const shouldEnrich = shouldPrefetchFullText(source);
      let remainingBudget = shouldEnrich ? fullTextBudget(source) : 0;
      let bestBlogsOriginalBudget = String(url).includes('bestblogs.dev') ? 8 : 0;
      const entries = (feed.items || []).slice(0, 30) as unknown as Array<Record<string, unknown>>;
      const items: RawItem[] = [];

      for (const entry of entries) {
        const media = extractMedia(entry);
        const entryUrl = resolveFeedEntryUrl(entry, media);
        const link = entryUrl.url;
        if (!link) continue;

        const contentEncoded = typeof entry.contentEncoded === 'string' ? entry.contentEncoded : undefined;
        const bestContent = chooseBestFeedContent({
          contentEncoded,
          summary: entry.summary,
          content: entry.content,
          description: entry.description,
          contentSnippet: entry.contentSnippet,
        });
        const baseContent = bestContent.content;
        const rawDuration = entry.itunesDuration
          || asObject(entry.itunes).duration
          || entry['itunes:duration'];

        let content = baseContent;
        let readabilityContent: string | null | undefined;
        let fetchEngine: string | undefined;
        let renderMode: string | undefined;
        let blockedReason: string | undefined;
        let originalUrl: string | null = null;
        let curationUrl: string | null = null;
        let curationSource: string | null = null;
        let curationMeta: Record<string, unknown> | null = null;

        if (bestBlogsOriginalBudget > 0 && isBestBlogsArticleUrl(link)) {
          bestBlogsOriginalBudget -= 1;
          try {
            originalUrl = await resolveBestBlogsRssOriginalUrl(link);
            if (originalUrl) {
              curationUrl = link;
              curationSource = 'BestBlogs RSS';
              curationMeta = { originalUrlResolvedBy: 'bestblogs-rss-detail-html' };
            }
          } catch (error) {
            blockedReason = error instanceof Error ? error.message : String(error);
          }
        }

        const articleFetchUrl = originalUrl || link;
        const needsFullText = remainingBudget > 0 && /^https?:\/\//i.test(articleFetchUrl) && plainTextLength(baseContent) < 220;
        if (needsFullText) {
          remainingBudget -= 1;
          try {
            const extracted = await fetchArticleResult(articleFetchUrl);
            const merged = mergePrefetchedFullText(baseContent, extracted);
            content = merged.content;
            readabilityContent = merged.readabilityContent;
            fetchEngine = merged.fetchEngine;
            renderMode = merged.renderMode;
            blockedReason = merged.blockedReason;
          } catch (error) {
            blockedReason = error instanceof Error ? error.message : String(error);
          }
        }

        items.push({
          title: String(entry.title || 'Untitled').trim() || 'Untitled',
          url: link,
          guid: String(entry.guid || entry.id || entry.link || '').trim() || link,
          content: content || '',
          readabilityContent: readabilityContent ?? null,
          originalUrl,
          curationUrl,
          curationSource,
          curationMeta,
          author: String(entry.creator || entry.author || '').trim(),
          publishedAt: resolvePublishedDate(entry),
          mediaUrl: media.mediaUrl,
          mediaType: media.mediaType,
          audioDuration: parseDurationSeconds(rawDuration),
          fetchEngine,
          renderMode,
          blockedReason,
          rawData: {
            ...entry,
            infohubEntryUrlBasis: entryUrl.basis,
          },
        });
      }

      logger.info({
        sourceId: source.id,
        name: source.name,
        count: items.length,
        feedTimeoutMs,
        fullTextPrefetch: shouldEnrich,
        fullTextBudgetUsed: shouldEnrich ? fullTextBudget(source) - remainingBudget : 0,
      }, 'RSS fetch complete');
      return { items, fetchedAt: new Date() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ sourceId: source.id, name: source.name, error: message }, 'RSS fetch failed');
      return { items: [], fetchedAt: new Date(), error: message };
    }
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
