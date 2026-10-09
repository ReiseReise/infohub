import { normalizeRadarArticleUrl } from '../lib/external-radar-dedupe.js';
import { isFirstPartySource } from '../lib/source-governance-classification.js';

export interface DailyReportEventMetricItem {
  id: string;
  sourceId?: number | null;
  sourceName?: string | null;
  sourceCategory?: string | null;
  sourceType?: string | null;
  sourceCollectorType?: string | null;
  sourceConfig?: unknown;
  sourceRole?: string | null;
  sourceKind?: string | null;
  clusterId?: string | null;
  title?: string | null;
  url?: string | null;
  originalUrl?: string | null;
  category?: string | null;
  aiTags?: unknown;
  curationSource?: string | null;
  curationMeta?: unknown;
}

export interface DailyReportEventMetrics {
  localItemCount: number;
  independentEventCount: number;
  multiSourceEventCount: number;
  firstPartyEventCount: number;
  firstPartyEventShare: number;
  modelProductEventCount: number;
  externalRadarItemCount: number;
  externalRadarEventCount: number;
  aihotLocalMissCount: number;
  unverifiableRadarItemCount: number;
}

const SUSPICIOUS_CLUSTER_TOKENS = new Set([
  'alt', 'article', 'class', 'content', 'div', 'gif', 'href', 'html', 'http', 'https',
  'image', 'img', 'jpeg', 'jpg', 'oss', 'png', 'script', 'span', 'src', 'style', 'svg', 'webp',
]);

function normalizedClusterId(value?: string | null): string | null {
  const tokens = String(value || '')
    .trim()
    .toLowerCase()
    .split(':')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length < 2 || tokens.length > 6) return null;
  if (tokens.some((token) => SUSPICIOUS_CLUSTER_TOKENS.has(token))) return null;
  return tokens.join(':');
}

function normalizedOriginalUrl(item: DailyReportEventMetricItem): string | null {
  const isRadar = ['radar', 'reference'].includes(String(item.sourceRole || '').toLowerCase());
  if (isRadar && !item.originalUrl) return null;
  return normalizeRadarArticleUrl(item.originalUrl || item.url);
}

function eventKey(item: DailyReportEventMetricItem): string {
  const clusterId = normalizedClusterId(item.clusterId);
  if (clusterId) return `cluster:${clusterId}`;
  const url = normalizedOriginalUrl(item);
  if (url) return `url:${url}`;
  return `item:${item.id}`;
}

function sourceKey(item: DailyReportEventMetricItem): string {
  if (item.sourceId != null) return `id:${item.sourceId}`;
  const sourceName = String(item.sourceName || '').trim().toLowerCase();
  return sourceName ? `name:${sourceName}` : `item:${item.id}`;
}

function tagsText(value: unknown): string {
  return Array.isArray(value) ? value.map((entry) => String(entry || '')).join(' ') : '';
}

function isModelOrProductEvent(items: DailyReportEventMetricItem[]): boolean {
  const text = items
    .map((item) => `${item.title || ''} ${item.category || ''} ${tagsText(item.aiTags)}`)
    .join(' ');
  return /(claude|anthropic|openai|gpt|gemini|deepmind|model|模型|agent|智能体|产品|product|launch|release|发布|上线|api|codex|cursor|copilot)/i.test(text);
}

function isFirstParty(item: DailyReportEventMetricItem): boolean {
  return isFirstPartySource({
    name: item.sourceName,
    category: item.sourceCategory || item.category,
    sourceType: item.sourceType,
    collectorType: item.sourceCollectorType,
    sourceKind: item.sourceKind,
    sourceRole: item.sourceRole,
    config: item.sourceConfig,
  });
}

function isAiHot(item: DailyReportEventMetricItem): boolean {
  return /ai\s*hot/i.test(`${item.curationSource || ''} ${item.sourceName || ''}`);
}

export function buildDailyReportEventMetrics(input: {
  localItems: DailyReportEventMetricItem[];
  radarItems?: DailyReportEventMetricItem[];
}): DailyReportEventMetrics {
  const localGroups = new Map<string, DailyReportEventMetricItem[]>();
  for (const item of input.localItems) {
    const key = eventKey(item);
    localGroups.set(key, [...(localGroups.get(key) || []), item]);
  }

  let multiSourceEventCount = 0;
  let firstPartyEventCount = 0;
  let modelProductEventCount = 0;
  for (const items of localGroups.values()) {
    if (new Set(items.map(sourceKey)).size >= 2) multiSourceEventCount += 1;
    if (items.some(isFirstParty)) firstPartyEventCount += 1;
    if (isModelOrProductEvent(items)) modelProductEventCount += 1;
  }

  const localClusters = new Set(
    input.localItems
      .map((item) => normalizedClusterId(item.clusterId))
      .filter((value): value is string => Boolean(value)),
  );
  const localUrls = new Set(
    input.localItems
      .map(normalizedOriginalUrl)
      .filter((value): value is string => Boolean(value)),
  );
  const radarItems = input.radarItems || [];
  const verifiableRadarItems = radarItems.filter((item) => Boolean(normalizedOriginalUrl(item)));
  const radarEventKeys = new Set(verifiableRadarItems.map(eventKey));
  const missedAiHotKeys = new Set<string>();
  for (const item of verifiableRadarItems.filter(isAiHot)) {
    const clusterId = normalizedClusterId(item.clusterId);
    const originalUrl = normalizedOriginalUrl(item);
    const foundLocally = Boolean(
      (clusterId && localClusters.has(clusterId))
      || (originalUrl && localUrls.has(originalUrl)),
    );
    if (!foundLocally) missedAiHotKeys.add(eventKey(item));
  }

  const independentEventCount = localGroups.size;
  return {
    localItemCount: input.localItems.length,
    independentEventCount,
    multiSourceEventCount,
    firstPartyEventCount,
    firstPartyEventShare: independentEventCount > 0
      ? Number((firstPartyEventCount / independentEventCount).toFixed(4))
      : 0,
    modelProductEventCount,
    externalRadarItemCount: radarItems.length,
    externalRadarEventCount: radarEventKeys.size,
    aihotLocalMissCount: missedAiHotKeys.size,
    unverifiableRadarItemCount: radarItems.length - verifiableRadarItems.length,
  };
}
