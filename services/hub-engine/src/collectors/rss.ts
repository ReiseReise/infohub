import Parser from 'rss-parser';
import { plainTextLength, fetchArticleResult } from '../lib/content-extractor.js';
import { resolvePublishedDate } from '../lib/date-normalization.js';
import { logger } from '../lib/logger.js';
import type { Collector, CollectorResult, RawItem, SourceConfig } from './base.js';

const parser = new Parser({
  timeout: 30000,
  headers: { 'User-Agent': 'InfoHub/3.1 (+rss)' },
  customFields: {
    item: [
      ['enclosure', 'enclosure', { keepArray: false }],
      ['media:content', 'mediaContent', { keepArray: false }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: false }],
      ['content:encoded', 'contentEncoded', { keepArray: false }],
      ['itunes:duration', 'itunesDuration', { keepArray: false }],
      ['itunes:image', 'itunesImage', { keepArray: false }],
    ],
  },
});

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

export class RssCollector implements Collector {
  readonly type = 'rss';

  async fetch(source: SourceConfig): Promise<CollectorResult> {
    const url = (source.config as { url?: string }).url;
    if (!url) {
      return { items: [], fetchedAt: new Date(), error: 'No URL in source config' };
    }

    try {
      const feed = await parser.parseURL(url);
      const shouldEnrich = shouldPrefetchFullText(source);
      let remainingBudget = shouldEnrich ? fullTextBudget(source) : 0;
      const entries = (feed.items || []).slice(0, 30) as unknown as Array<Record<string, unknown>>;
      const items: RawItem[] = [];

      for (const entry of entries) {
        const link = String(entry.link || '').trim();
        if (!link) continue;

        const contentEncoded = typeof entry.contentEncoded === 'string' ? entry.contentEncoded : undefined;
        const baseContent = contentEncoded || String(entry.content || entry.contentSnippet || '').trim();
        const media = extractMedia(entry);
        const rawDuration = entry.itunesDuration
          || asObject(entry.itunes).duration
          || entry['itunes:duration'];

        let content = baseContent;
        let fetchEngine: string | undefined;
        let renderMode: string | undefined;
        let blockedReason: string | undefined;

        const needsFullText = remainingBudget > 0 && /^https?:\/\//i.test(link) && plainTextLength(baseContent) < 220;
        if (needsFullText) {
          remainingBudget -= 1;
          try {
            const extracted = await fetchArticleResult(link);
            if (shouldUseExtractedContent(baseContent, extracted?.content)) {
              content = extracted?.content || baseContent;
              fetchEngine = extracted?.fetchEngine || undefined;
              renderMode = extracted?.renderMode || undefined;
              blockedReason = extracted?.blockedReason || undefined;
            } else if (extracted?.blockedReason) {
              fetchEngine = extracted.fetchEngine || undefined;
              renderMode = extracted.renderMode || undefined;
              blockedReason = extracted.blockedReason;
            }
          } catch (error) {
            blockedReason = error instanceof Error ? error.message : String(error);
          }
        }

        items.push({
          title: String(entry.title || 'Untitled').trim() || 'Untitled',
          url: link,
          guid: String(entry.guid || entry.id || entry.link || '').trim() || link,
          content: content || '',
          author: String(entry.creator || entry.author || '').trim(),
          publishedAt: resolvePublishedDate(entry),
          mediaUrl: media.mediaUrl,
          mediaType: media.mediaType,
          audioDuration: parseDurationSeconds(rawDuration),
          fetchEngine,
          renderMode,
          blockedReason,
          rawData: entry,
        });
      }

      logger.info({
        sourceId: source.id,
        name: source.name,
        count: items.length,
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
