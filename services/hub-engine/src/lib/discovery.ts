import Parser from 'rss-parser';
import { config } from '../config/index.js';
import { resolvePublishedDate } from './date-normalization.js';
import { normalizeHttpUrl, normalizeRoute } from './source-normalization.js';

export type DiscoverMode = 'search' | 'rss' | 'rsshub';

export interface SourceLike {
  id: number;
  name: string;
  sourceType: string;
  collectorType: string;
  config: unknown;
  category?: string | null;
}

export interface DiscoveryCandidate {
  title: string;
  description?: string | null;
  websiteUrl?: string | null;
  feedUrl?: string | null;
  sourceType: string;
  collectorType: string;
  config: Record<string, unknown>;
  reason: string;
  confidence: number;
  discoveryKey: string;
  sampleItems: Array<{
    title: string;
    url?: string | null;
    publishedAt?: string | null;
  }>;
}

const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'InfoHub/3.0 (+discovery)',
  },
});

function buildProbeFeedUrls(inputUrl: string): string[] {
  const parsed = new URL(inputUrl);
  const origin = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
  const probes = new Set<string>();

  probes.add(inputUrl);

  const common = ['/feed', '/feed.xml', '/rss', '/rss.xml', '/atom.xml', '/index.xml'];
  for (const suffix of common) {
    probes.add(`${origin}${suffix}`);
  }

  probes.add(`https://openrss.org/${parsed.hostname}`);
  return [...probes];
}

function confidenceByIndex(index: number): number {
  const value = 0.95 - index * 0.08;
  return Math.max(0.55, Number(value.toFixed(2)));
}

export function extractRsshubRoute(input: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith('rsshub://')) {
    return normalizeRoute(trimmed);
  }

  if (trimmed.startsWith('/')) {
    return normalizeRoute(trimmed);
  }

  return undefined;
}

export async function previewRssFeed(
  feedUrlInput: string,
  options?: { confidence?: number; reason?: string },
): Promise<DiscoveryCandidate | null> {
  const feedUrl = normalizeHttpUrl(feedUrlInput);
  if (!feedUrl) return null;

  try {
    const feed = await parser.parseURL(feedUrl);
    const sampleItems = (feed.items || []).slice(0, 3).map((item) => ({
      title: item.title || 'Untitled',
      url: item.link || null,
      publishedAt: resolvePublishedDate(item as unknown as Record<string, unknown>)?.toISOString() || null,
    }));

    const title = feed.title || (() => {
      try {
        return new URL(feedUrl).hostname.replace(/^www\./, '');
      } catch {
        return feedUrl;
      }
    })();

    return {
      title,
      description: feed.description || null,
      websiteUrl: feed.link || null,
      feedUrl,
      sourceType: 'rss',
      collectorType: 'rss',
      config: { url: feedUrl },
      reason: options?.reason || 'url-preview',
      confidence: options?.confidence ?? 0.9,
      discoveryKey: `rss:${feedUrl}`,
      sampleItems,
    };
  } catch {
    return null;
  }
}

export async function previewRsshubRoute(routeInput: string): Promise<DiscoveryCandidate | null> {
  const route = normalizeRoute(routeInput);
  if (!route) return null;
  const rssUrl = `${config.rsshub.baseUrl}${route}`;
  const preview = await previewRssFeed(rssUrl, { reason: 'rsshub-preview', confidence: 0.86 });

  if (!preview) {
    return {
      title: `RSSHub ${route}`,
      description: 'RSSHub 路由预览暂不可用，仍可尝试直接订阅。',
      websiteUrl: null,
      feedUrl: rssUrl,
      sourceType: 'rsshub',
      collectorType: 'rsshub',
      config: { route },
      reason: 'rsshub-route',
      confidence: 0.72,
      discoveryKey: `rsshub:${route}`,
      sampleItems: [],
    };
  }

  return {
    ...preview,
    sourceType: 'rsshub',
    collectorType: 'rsshub',
    config: { route },
    feedUrl: rssUrl,
    reason: 'rsshub-route',
    confidence: 0.86,
    discoveryKey: `rsshub:${route}`,
  };
}

function buildCandidateFromSource(source: SourceLike, confidence = 0.8): DiscoveryCandidate {
  const sourceConfig = (source.config && typeof source.config === 'object')
    ? (source.config as Record<string, unknown>)
    : {};

  const url = String(sourceConfig.url || '');
  const route = String(sourceConfig.route || '');
  const endpoint = String(sourceConfig.endpoint || '');

  const feedUrl = normalizeHttpUrl(url)
    || (route ? `${config.rsshub.baseUrl}${route.startsWith('/') ? route : `/${route}`}` : undefined)
    || normalizeHttpUrl(endpoint)
    || null;

  return {
    title: source.name,
    description: source.category || null,
    websiteUrl: null,
    feedUrl,
    sourceType: source.sourceType,
    collectorType: source.collectorType,
    config: sourceConfig,
    reason: 'existing-source-match',
    confidence,
    discoveryKey: `source:${source.id}`,
    sampleItems: [],
  };
}

function discoverFromSources(query: string, sources: SourceLike[]): DiscoveryCandidate[] {
  if (!query) return [];
  const keyword = query.toLowerCase();

  const matches = sources.filter((source) => {
    const sourceConfig = (source.config && typeof source.config === 'object')
      ? (source.config as Record<string, unknown>)
      : {};
    const searchable = [
      source.name,
      source.category || '',
      String(sourceConfig.url || ''),
      String(sourceConfig.route || ''),
      String(sourceConfig.channelId || ''),
    ].join(' ').toLowerCase();
    return searchable.includes(keyword);
  });

  return matches.slice(0, 10).map((source, index) => buildCandidateFromSource(source, confidenceByIndex(index)));
}

function uniqByKey(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  const deduped = new Map<string, DiscoveryCandidate>();
  for (const candidate of candidates) {
    if (!deduped.has(candidate.discoveryKey)) {
      deduped.set(candidate.discoveryKey, candidate);
    }
  }
  return [...deduped.values()];
}

export async function discoverCandidates(params: {
  query: string;
  mode: DiscoverMode;
  sources: SourceLike[];
  limit: number;
}): Promise<DiscoveryCandidate[]> {
  const query = params.query.trim();
  if (!query) return [];

  const mode = params.mode;
  const local = mode === 'rss' || mode === 'rsshub' ? [] : discoverFromSources(query, params.sources);

  if (mode === 'rsshub' || query.startsWith('rsshub://') || query.startsWith('/')) {
    const route = extractRsshubRoute(query);
    if (!route) return local.slice(0, params.limit);
    const preview = await previewRsshubRoute(route);
    return uniqByKey([...(preview ? [preview] : []), ...local]).slice(0, params.limit);
  }

  const asUrl = normalizeHttpUrl(query);
  const shouldProbeUrl = mode === 'rss' || Boolean(asUrl) || (/^[\w.-]+\.[a-z]{2,}/i.test(query) && !query.includes(' '));

  if (!shouldProbeUrl) {
    return uniqByKey(local).slice(0, params.limit);
  }

  const url = asUrl || normalizeHttpUrl(`https://${query}`);
  if (!url) return uniqByKey(local).slice(0, params.limit);

  const probes = buildProbeFeedUrls(url).slice(0, Math.max(params.limit, 6));
  const probeResults = await Promise.all(
    probes.map((probe, index) => previewRssFeed(probe, { confidence: confidenceByIndex(index), reason: 'url-probe' })),
  );
  const probed = probeResults.filter((entry): entry is DiscoveryCandidate => Boolean(entry));

  return uniqByKey([...probed, ...local]).slice(0, params.limit);
}
