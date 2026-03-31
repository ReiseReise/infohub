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
  sourceHost?: string | null;
  iconUrl?: string | null;
  sourceType: string;
  collectorType: string;
  config: Record<string, unknown>;
  reason: string;
  confidence: number;
  discoveryKey: string;
  sampleCount: number;
  latestPublishedAt?: string | null;
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

const DISCOVERY_USER_AGENT = 'InfoHub/3.1 (+discovery-html)';

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

function resolveRelativeUrl(baseUrl: string, value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function extractAttr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match?.[1]?.trim();
}

function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match?.[1]?.replace(/\s+/g, ' ').trim();
  return title || null;
}

function extractHtmlDescription(html: string): string | null {
  const metaPatterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["'][^>]*>/i,
  ];
  for (const pattern of metaPatterns) {
    const value = pattern.exec(html)?.[1]?.replace(/\s+/g, ' ').trim();
    if (value) return value;
  }
  return null;
}

function extractHtmlIconUrl(html: string, baseUrl: string): string | null {
  const linkTags = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
  for (const tag of linkTags) {
    const rel = (extractAttr(tag, 'rel') || '').toLowerCase();
    if (!rel.includes('icon')) continue;
    const href = extractAttr(tag, 'href');
    const resolved = href ? resolveRelativeUrl(baseUrl, href) : undefined;
    if (resolved) return resolved;
  }

  try {
    const parsed = new URL(baseUrl);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}/favicon.ico`;
  } catch {
    return null;
  }
}

type HtmlFeedAlternate = {
  feedUrl: string;
  websiteUrl: string;
  pageTitle: string | null;
  pageDescription: string | null;
  iconUrl: string | null;
};

function extractHtmlFeedAlternates(html: string, baseUrl: string): HtmlFeedAlternate[] {
  const pageTitle = extractHtmlTitle(html);
  const pageDescription = extractHtmlDescription(html);
  const iconUrl = extractHtmlIconUrl(html, baseUrl);
  const seen = new Set<string>();
  const alternates: HtmlFeedAlternate[] = [];
  const linkTags = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);

  for (const tag of linkTags) {
    const rel = (extractAttr(tag, 'rel') || '').toLowerCase();
    const type = (extractAttr(tag, 'type') || '').toLowerCase();
    if (!rel.includes('alternate')) continue;
    if (!/(rss|atom|xml)/.test(type)) continue;

    const href = extractAttr(tag, 'href');
    const feedUrl = href ? resolveRelativeUrl(baseUrl, href) : undefined;
    if (!feedUrl || seen.has(feedUrl)) continue;
    seen.add(feedUrl);
    alternates.push({
      feedUrl,
      websiteUrl: baseUrl,
      pageTitle,
      pageDescription,
      iconUrl,
    });
  }

  return alternates;
}

async function fetchHtmlFeedAlternates(inputUrl: string): Promise<HtmlFeedAlternate[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch(inputUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': DISCOVERY_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!resp.ok) return [];
    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) return [];
    const html = await resp.text();
    if (!html.trim()) return [];
    return extractHtmlFeedAlternates(html, resp.url || inputUrl);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function pickSourceHost(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
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
  options?: {
    confidence?: number;
    reason?: string;
    websiteUrl?: string | null;
    iconUrl?: string | null;
    description?: string | null;
  },
): Promise<DiscoveryCandidate | null> {
  const feedUrl = normalizeHttpUrl(feedUrlInput);
  if (!feedUrl) return null;

  try {
    const feed = await parser.parseURL(feedUrl);
    const sampleItems = (feed.items || []).slice(0, 4).map((item) => ({
      title: item.title || 'Untitled',
      url: item.link || null,
      publishedAt: resolvePublishedDate(item as unknown as Record<string, unknown>)?.toISOString() || null,
    }));
    const latestPublishedAt = sampleItems
      .map((item) => item.publishedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .reverse()[0] || null;

    const websiteUrl = feed.link || options?.websiteUrl || null;
    const sourceHost = pickSourceHost(websiteUrl || feedUrl);
    const iconUrl = options?.iconUrl || (websiteUrl ? extractHtmlIconUrl('', websiteUrl) : null);

    const title = feed.title || (() => {
      try {
        return new URL(feedUrl).hostname.replace(/^www\./, '');
      } catch {
        return feedUrl;
      }
    })();

    return {
      title,
      description: feed.description || options?.description || null,
      websiteUrl,
      feedUrl,
      sourceHost,
      iconUrl,
      sourceType: 'rss',
      collectorType: 'rss',
      config: {
        url: feedUrl,
        ...(websiteUrl ? { htmlUrl: websiteUrl } : {}),
        ...(iconUrl ? { iconUrl } : {}),
      },
      reason: options?.reason || 'url-preview',
      confidence: options?.confidence ?? 0.9,
      discoveryKey: `rss:${feedUrl}`,
      sampleCount: sampleItems.length,
      latestPublishedAt,
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
      sourceHost: pickSourceHost(rssUrl),
      iconUrl: null,
      sourceType: 'rsshub',
      collectorType: 'rsshub',
      config: { route },
      reason: 'rsshub-route',
      confidence: 0.72,
      discoveryKey: `rsshub:${route}`,
      sampleCount: 0,
      latestPublishedAt: null,
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
  const websiteUrl = normalizeHttpUrl(url)
    || (typeof sourceConfig.htmlUrl === 'string' ? normalizeHttpUrl(sourceConfig.htmlUrl) : undefined)
    || null;
  const iconUrl = typeof sourceConfig.iconUrl === 'string' ? String(sourceConfig.iconUrl) : null;

  return {
    title: source.name,
    description: source.category || null,
    websiteUrl,
    feedUrl,
    sourceHost: pickSourceHost(websiteUrl || feedUrl),
    iconUrl,
    sourceType: source.sourceType,
    collectorType: source.collectorType,
    config: sourceConfig,
    reason: 'existing-source-match',
    confidence,
    discoveryKey: `source:${source.id}`,
    sampleCount: 0,
    latestPublishedAt: null,
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

async function discoverAlternatesFromHtml(
  url: string,
  limit: number,
): Promise<DiscoveryCandidate[]> {
  const alternates = await fetchHtmlFeedAlternates(url);
  if (alternates.length === 0) return [];

  const previews = await Promise.all(
    alternates.slice(0, limit).map((alternate, index) => previewRssFeed(alternate.feedUrl, {
      confidence: confidenceByIndex(index) + 0.02,
      reason: 'html-alternate',
      websiteUrl: alternate.websiteUrl,
      iconUrl: alternate.iconUrl,
      description: alternate.pageDescription,
    })),
  );

  return previews
    .filter((entry): entry is DiscoveryCandidate => Boolean(entry))
    .map((entry, index) => ({
      ...entry,
      title: entry.title || alternates[index]?.pageTitle || entry.sourceHost || entry.feedUrl || 'Untitled feed',
    }));
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

  const directPreview = await previewRssFeed(url, {
    confidence: 0.96,
    reason: 'direct-feed',
    websiteUrl: url,
  });
  const alternates = await discoverAlternatesFromHtml(url, Math.max(params.limit, 4));
  const probes = buildProbeFeedUrls(url).slice(0, Math.max(params.limit, 6));
  const probeResults = await Promise.all(
    probes.map((probe, index) => previewRssFeed(probe, { confidence: confidenceByIndex(index), reason: 'url-probe' })),
  );
  const probed = probeResults.filter((entry): entry is DiscoveryCandidate => Boolean(entry));

  return uniqByKey([...(directPreview ? [directPreview] : []), ...alternates, ...probed, ...local]).slice(0, params.limit);
}
