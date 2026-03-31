import Parser from 'rss-parser';
import { resolvePublishedDate } from '../lib/date-normalization.js';
import { logger } from '../lib/logger.js';
import type { Collector, CollectorResult, RawItem, SourceConfig } from './base.js';

const parser = new Parser({
  timeout: 30000,
  headers: { 'User-Agent': 'InfoHub/3.0' },
  customFields: {
    item: [
      ['enclosure', 'enclosure', { keepArray: false }],
      ['media:content', 'mediaContent', { keepArray: false }],
      ['content:encoded', 'contentEncoded', { keepArray: false }],
      ['itunes:duration', 'itunesDuration', { keepArray: false }],
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

export class RssCollector implements Collector {
  readonly type = 'rss';

  async fetch(source: SourceConfig): Promise<CollectorResult> {
    const url = (source.config as { url?: string }).url;
    if (!url) {
      return { items: [], fetchedAt: new Date(), error: 'No URL in source config' };
    }

    try {
      const feed = await parser.parseURL(url);
      const items: RawItem[] = (feed.items || []).map((entry) => {
        const enclosure = (entry as any).enclosure;
        const contentEncoded = (entry as any).contentEncoded as string | undefined;
        const rawDuration = (entry as any).itunesDuration
          || (entry as any).itunes?.duration
          || (entry as any)['itunes:duration'];
        let mediaUrl: string | undefined;
        let mediaType: 'audio' | 'video' | 'image' | undefined;

        if (enclosure?.url) {
          mediaUrl = enclosure.url;
          const type = (enclosure.type || '') as string;
          if (type.startsWith('audio/')) mediaType = 'audio';
          else if (type.startsWith('video/')) mediaType = 'video';
          else if (type.startsWith('image/')) mediaType = 'image';
        }

        return {
          title: entry.title || 'Untitled',
          url: entry.link || '',
          guid: entry.guid || (entry as any).id || entry.link || '',
          content: contentEncoded || entry.content || entry.contentSnippet || '',
          author: entry.creator || (entry as any).author || '',
          publishedAt: resolvePublishedDate(entry as unknown as Record<string, unknown>),
          mediaUrl,
          mediaType,
          audioDuration: parseDurationSeconds(rawDuration),
          rawData: entry as unknown as Record<string, unknown>,
        };
      }).filter((item) => item.url);

      logger.info({ sourceId: source.id, name: source.name, count: items.length }, 'RSS fetch complete');
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
