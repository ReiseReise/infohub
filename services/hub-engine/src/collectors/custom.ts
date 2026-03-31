import { resolvePublishedDate } from '../lib/date-normalization.js';
import { logger } from '../lib/logger.js';
import type { Collector, CollectorResult, RawItem, SourceConfig } from './base.js';

export class CustomCollector implements Collector {
  readonly type = 'custom';

  async fetch(source: SourceConfig): Promise<CollectorResult> {
    const endpoint = (source.config as { endpoint?: string }).endpoint;
    const method = (source.config as { method?: string }).method || 'GET';
    const headers = (source.config as { headers?: Record<string, string> }).headers || {};

    if (!endpoint) {
      return { items: [], fetchedAt: new Date(), error: 'No endpoint in source config' };
    }

    try {
      const resp = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
      });

      if (!resp.ok) {
        return { items: [], fetchedAt: new Date(), error: `Custom API error: ${resp.status}` };
      }

      const data = await resp.json() as any;

      let items: RawItem[] = [];
      if (Array.isArray(data)) {
        items = data.map(normalizeItem);
      } else if (data.items && Array.isArray(data.items)) {
        items = data.items.map(normalizeItem);
      } else if (data.data && Array.isArray(data.data)) {
        items = data.data.map(normalizeItem);
      }

      logger.info({ sourceId: source.id, count: items.length }, 'Custom fetch complete');
      return { items, fetchedAt: new Date() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ sourceId: source.id, error: message }, 'Custom fetch failed');
      return { items: [], fetchedAt: new Date(), error: message };
    }
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

function normalizeItem(raw: any): RawItem {
  return {
    title: raw.title || raw.text || raw.content?.slice(0, 100) || 'Untitled',
    url: raw.url || raw.link || raw.href || '',
    guid: raw.id || raw.guid || raw.url || '',
    content: raw.content || raw.body || raw.text || '',
    author: raw.author || raw.user || raw.username || '',
    publishedAt: resolvePublishedDate(raw as Record<string, unknown>),
    mediaUrl: raw.mediaUrl || raw.media_url || raw.image || undefined,
    rawData: raw,
  };
}
