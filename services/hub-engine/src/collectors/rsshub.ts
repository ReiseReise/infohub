import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { RssCollector } from './rss.js';
import type { Collector, CollectorResult, SourceConfig } from './base.js';

export class RsshubCollector implements Collector {
  readonly type = 'rsshub';
  private rssCollector = new RssCollector();

  async fetch(source: SourceConfig): Promise<CollectorResult> {
    const route = (source.config as { route?: string }).route;
    if (!route) {
      return { items: [], fetchedAt: new Date(), error: 'No route in source config' };
    }

    const rsshubUrl = `${config.rsshub.baseUrl}${route.startsWith('/') ? route : '/' + route}`;
    logger.debug({ sourceId: source.id, route, rsshubUrl }, 'RSSHub fetch via RSS parser');

    const proxiedSource: SourceConfig = {
      ...source,
      config: { ...source.config, url: rsshubUrl },
    };

    return this.rssCollector.fetch(proxiedSource);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(`${config.rsshub.baseUrl}/`);
      return resp.ok;
    } catch {
      return false;
    }
  }
}
