import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { RssCollector } from './rss.js';
import type { Collector, CollectorResult, SourceConfig } from './base.js';

export class YoutubeCollector implements Collector {
  readonly type = 'youtube';
  private rssCollector = new RssCollector();

  async fetch(source: SourceConfig): Promise<CollectorResult> {
    const channelId = (source.config as { channelId?: string }).channelId;
    const playlistId = (source.config as { playlistId?: string }).playlistId;
    const rsshubRoute = (source.config as { route?: string }).route;

    let feedUrl: string;

    if (rsshubRoute) {
      feedUrl = `${config.rsshub.baseUrl}${rsshubRoute.startsWith('/') ? rsshubRoute : '/' + rsshubRoute}`;
    } else if (channelId) {
      feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    } else if (playlistId) {
      feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
    } else {
      return { items: [], fetchedAt: new Date(), error: 'No channelId, playlistId, or route in config' };
    }

    logger.debug({ sourceId: source.id, feedUrl }, 'YouTube fetch via RSS');

    const proxiedSource: SourceConfig = {
      ...source,
      config: { ...source.config, url: feedUrl },
    };

    const result = await this.rssCollector.fetch(proxiedSource);

    result.items = result.items.map(item => ({
      ...item,
      mediaType: 'video' as const,
      mediaUrl: item.url,
    }));

    return result;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
