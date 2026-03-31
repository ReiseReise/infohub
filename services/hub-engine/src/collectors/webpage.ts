import { createHash } from 'node:crypto';
import { fetchPageSnapshot } from '../lib/content-extractor.js';
import { logger } from '../lib/logger.js';
import type { Collector, CollectorResult, SourceConfig } from './base.js';

export class WebpageCollector implements Collector {
  readonly type = 'webpage';

  async fetch(source: SourceConfig): Promise<CollectorResult> {
    const targetUrl = String((source.config as { url?: string }).url || '').trim();
    const renderMode = String((source.config as { renderMode?: string }).renderMode || 'auto').trim() || 'auto';
    const previousHash = String((source.config as { lastSnapshotHash?: string }).lastSnapshotHash || '').trim();
    const previousSnippet = String((source.config as { lastSnapshotSnippet?: string }).lastSnapshotSnippet || '').trim();
    if (!targetUrl) {
      return { items: [], fetchedAt: new Date(), error: 'No url in source config' };
    }

    try {
      const snapshot = await fetchPageSnapshot(targetUrl);
      if (!snapshot?.content) {
        return {
          items: [],
          fetchedAt: new Date(),
          error: '网页正文提取失败',
          sourceConfigPatch: {
            lastFetchEngine: renderMode === 'auto' ? 'native-or-scrapling' : `scrapling:${renderMode}`,
            lastBlockedReason: snapshot?.blockedReason || 'content_unavailable',
          },
        };
      }

      const capturedAt = new Date();
      const normalized = snapshot.content.replace(/\s+/g, ' ').trim();
      const hash = createHash('sha1').update(normalized).digest('hex');
      const nextSnippet = normalized.slice(0, 220);

      if (previousHash && previousHash === hash) {
        return {
          items: [],
          fetchedAt: capturedAt,
          outcomeHint: 'no_change',
          sourceConfigPatch: {
            lastSnapshotHash: hash,
            lastSnapshotSnippet: nextSnippet,
            lastSnapshotTitle: snapshot.title || source.name,
            lastSnapshotAt: capturedAt.toISOString(),
            lastChangeSummary: '网页内容未变化',
            lastFetchEngine: renderMode === 'auto' ? 'native-or-scrapling' : `scrapling:${renderMode}`,
            lastBlockedReason: null,
          },
        };
      }

      const changeSummary = previousSnippet && previousSnippet !== nextSnippet
        ? `网页正文发生变化。上一版摘要：${previousSnippet.slice(0, 100)}；当前摘要：${nextSnippet.slice(0, 100)}`
        : '首次抓取网页快照，已生成正文缓存。';
      return {
        items: [{
          title: snapshot.title || source.name,
          url: `${targetUrl}#snapshot-${capturedAt.getTime()}`,
          guid: `webpage:${source.id}:${capturedAt.getTime()}`,
          content: `## 变化摘要\n\n${changeSummary}\n\n---\n\n${snapshot.content}`,
          publishedAt: capturedAt,
        }],
        fetchedAt: capturedAt,
        sourceConfigPatch: {
          lastSnapshotHash: hash,
          lastSnapshotSnippet: nextSnippet,
          lastSnapshotTitle: snapshot.title || source.name,
          lastSnapshotAt: capturedAt.toISOString(),
          lastChangeSummary: changeSummary,
          lastFetchEngine: snapshot.fetchEngine || (renderMode === 'auto' ? 'native-or-scrapling' : `scrapling:${renderMode}`),
          lastBlockedReason: null,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ sourceId: source.id, error: message }, 'Webpage snapshot fetch failed');
      return {
        items: [],
        fetchedAt: new Date(),
        error: message,
        sourceConfigPatch: {
          lastFetchEngine: renderMode === 'auto' ? 'native-or-scrapling' : `scrapling:${renderMode}`,
          lastBlockedReason: message,
        },
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
