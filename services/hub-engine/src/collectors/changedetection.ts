import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import type { Collector, CollectorResult, RawItem, SourceConfig } from './base.js';

export class ChangedetectionCollector implements Collector {
  readonly type = 'changedetection';

  private buildHeaders(contentType?: string): Record<string, string> {
    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = contentType;
    if (config.changedetection.apiKey) {
      headers['x-api-key'] = config.changedetection.apiKey;
    }
    return headers;
  }

  async fetch(source: SourceConfig): Promise<CollectorResult> {
    const watchUrl = (source.config as { url?: string }).url;
    const watchUuid = (source.config as { uuid?: string }).uuid;

    if (!watchUrl && !watchUuid) {
      return { items: [], fetchedAt: new Date(), error: 'No url or uuid in source config' };
    }

    try {
      const baseUrl = config.changedetection.url;
      const listResp = await fetch(`${baseUrl}/api/v1/watch`, {
        headers: this.buildHeaders(),
      });
      if (!listResp.ok) {
        return { items: [], fetchedAt: new Date(), error: `CD list API error: ${listResp.status}` };
      }

      const watches = await listResp.json() as Record<string, any>;
      let resolvedUuid = watchUuid;
      let resolvedWatchUrl = watchUrl;
      if (!resolvedUuid) {
        const match = Object.entries(watches).find(([_, w]) => w.url === watchUrl);
        if (match) {
          resolvedUuid = match[0];
          resolvedWatchUrl = watchUrl;
        } else {
          const createResp = await fetch(`${baseUrl}/api/v1/watch`, {
            method: 'POST',
            headers: this.buildHeaders('application/json'),
            body: JSON.stringify({ url: watchUrl, title: source.name, tag: source.category }),
          });
          if (!createResp.ok) {
            return { items: [], fetchedAt: new Date(), error: `CD create API error: ${createResp.status}` };
          }
          const created = await createResp.json().catch(() => ({})) as Record<string, unknown>;
          resolvedUuid = String(created.uuid || created.id || '').trim();
          logger.info({ sourceId: source.id, url: watchUrl, uuid: resolvedUuid || null }, 'Auto-created changedetection watch');
          if (!resolvedUuid) {
            const refreshedListResp = await fetch(`${baseUrl}/api/v1/watch`, {
              headers: this.buildHeaders(),
            });
            if (refreshedListResp.ok) {
              const refreshed = await refreshedListResp.json() as Record<string, any>;
              const createdMatch = Object.entries(refreshed).find(([_, w]) => w.url === watchUrl);
              resolvedUuid = createdMatch?.[0];
            }
          }
          return {
            items: [],
            fetchedAt: new Date(),
            outcomeHint: 'no_change',
            sourceConfigPatch: resolvedUuid ? {
              uuid: resolvedUuid,
              lastChangeSummary: '变更监控已创建，等待下一次抓取生成变化记录',
            } : undefined,
          };
        }
      }

      if (!resolvedUuid) {
        return { items: [], fetchedAt: new Date(), error: 'changedetection watch uuid missing' };
      }

      const histResp = await fetch(`${baseUrl}/api/v1/watch/${resolvedUuid}/history`, {
        headers: this.buildHeaders(),
      });
      if (!histResp.ok) {
        return { items: [], fetchedAt: new Date() };
      }

      const hist = await histResp.json() as Record<string, number>;
      const recent = Object.keys(hist).sort().reverse().slice(0, 3);
      if (recent.length === 0) {
        return {
          items: [],
          fetchedAt: new Date(),
          outcomeHint: 'no_change',
          sourceConfigPatch: {
            uuid: resolvedUuid,
            lastChangeSummary: '当前未检测到网页变化',
          },
        };
      }

      const items: RawItem[] = [];
      for (const ts of recent) {
        const detailResp = await fetch(`${baseUrl}/api/v1/watch/${resolvedUuid}/history/${ts}`, {
          headers: this.buildHeaders(),
        });
        const text = detailResp.ok ? (await detailResp.text()).trim() : '';
        items.push({
          title: `${source.name} — 变更 ${new Date(parseInt(ts, 10) * 1000).toLocaleString()}`,
          url: `${resolvedWatchUrl || `${baseUrl}/watch/${resolvedUuid}`}#changedetection-${ts}`,
          guid: `changedetection:${resolvedUuid}:${ts}`,
          content: text.slice(0, 5000) || '变更已记录，但当前未拿到可读 diff 内容。',
          publishedAt: new Date(parseInt(ts, 10) * 1000),
        });
      }

      return {
        items,
        fetchedAt: new Date(),
        sourceConfigPatch: {
          uuid: resolvedUuid,
          lastChangeSummary: items[0]?.title || '已抓取变化记录',
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ sourceId: source.id, error: message }, 'Changedetection fetch failed');
      return { items: [], fetchedAt: new Date(), error: message };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(`${config.changedetection.url}/`);
      return resp.ok;
    } catch {
      return false;
    }
  }
}
