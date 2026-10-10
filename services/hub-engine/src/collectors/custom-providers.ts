import { createHash } from 'node:crypto';
import { resolvePublishedDate } from '../lib/date-normalization.js';
import type { CollectorResult, RawItem, SourceConfig } from './base.js';
import { fetchOrigin12Provider, isOrigin12Provider, type Origin12Provider } from './origin12-providers.js';
import { fetchFollowBuildersX } from './follow-builders.js';

export type CustomProvider = 'aihot_selected' | 'aihot_hot_topics' | 'follow_builders_preview' | 'follow_builders_x' | Origin12Provider;

type FetchLike = typeof fetch;

type ProviderOptions = {
  fetchImpl?: FetchLike;
  now?: () => Date;
};

type ProviderConfig = Record<string, unknown> & {
  provider?: CustomProvider;
  endpoint?: string;
  etag?: string;
  lastFingerprint?: string;
  backoffUntil?: string;
  cachedItems?: unknown[];
  nextCursor?: string;
  maxItems?: number;
};

const DEFAULT_AI_HOT_SELECTED = 'https://aihot.virxact.com/api/public/items?mode=selected';
const DEFAULT_AI_HOT_DAILY = 'https://aihot.virxact.com/api/public/daily';
const DEFAULT_FOLLOW_BUILDERS = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/config/default-sources.json';
const USER_AGENT = 'InfoHubV3/3.1 (+https://localhost)';
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ITEMS = 50;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function absoluteUrl(value: unknown, base: string): string | null {
  const raw = asString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeExternalArticleUrl(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      const normalized = key.toLowerCase();
      if (
        normalized.startsWith('utm_')
        || ['fbclid', 'gclid', 'igshid', 'mc_cid', 'mc_eid', 'ref', 'source'].includes(normalized)
      ) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return null;
  }
}

export function buildProviderFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function compactCache(items: RawItem[]): Array<Record<string, unknown>> {
  return items.slice(0, DEFAULT_MAX_ITEMS).map((item) => ({
    ...item,
    publishedAt: item.publishedAt?.toISOString(),
    rawData: undefined,
  }));
}

function restoreCache(value: unknown): RawItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const raw = asObject(entry);
    const publishedAt = asString(raw.publishedAt);
    return {
      title: asString(raw.title) || 'Untitled',
      url: asString(raw.url),
      guid: asString(raw.guid) || asString(raw.url),
      content: asString(raw.content),
      originalUrl: asString(raw.originalUrl) || null,
      curationUrl: asString(raw.curationUrl) || null,
      curationSource: asString(raw.curationSource) || null,
      curationMeta: asObject(raw.curationMeta),
      author: asString(raw.author),
      publishedAt: publishedAt ? new Date(publishedAt) : undefined,
      mediaUrl: asString(raw.mediaUrl) || undefined,
      mediaType: raw.mediaType === 'image' || raw.mediaType === 'audio' || raw.mediaType === 'video'
        ? raw.mediaType
        : undefined,
      fetchEngine: asString(raw.fetchEngine) || undefined,
      renderMode: asString(raw.renderMode) || undefined,
    } satisfies RawItem;
  }).filter((item) => Boolean(item.url));
}

async function readResponseText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error(`provider_response_too_large:${declared}`);
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error(`provider_response_too_large:${Buffer.byteLength(text, 'utf8')}`);
  }
  return text;
}

function retryAfterDate(response: Response, now: Date): string {
  const value = response.headers.get('retry-after');
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return new Date(now.getTime() + Math.max(1, seconds) * 1000).toISOString();
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(now.getTime() + 15 * 60 * 1000).toISOString();
}

function aihotAttribution(raw: Record<string, unknown>, canonical: string): Record<string, unknown> {
  const attribution = asObject(raw.attribution);
  return {
    source: asString(attribution.source) || 'AI HOT',
    canonical: asString(attribution.canonical) || canonical,
    required: true,
  };
}

export function mapAiHotItem(value: unknown): RawItem | null {
  const raw = asObject(value);
  const originalUrl = normalizeExternalArticleUrl(raw.url || raw.originalUrl || raw.sourceUrl);
  if (!originalUrl) return null;
  const curationUrl = absoluteUrl(raw.permalink || raw.curationUrl, 'https://aihot.virxact.com/')
    || 'https://aihot.virxact.com/';
  const externalId = asString(raw.id) || buildProviderFingerprint(originalUrl).slice(0, 20);
  const sourceNames = Array.isArray(raw.sourceNames)
    ? raw.sourceNames.map(asString).filter(Boolean)
    : Array.isArray(raw.sources)
      ? raw.sources.map((source) => asString(asObject(source).name || source)).filter(Boolean)
      : asString(raw.source)
        ? [asString(raw.source)]
        : [];
  const sourceCount = asNumber(raw.sourceCount) ?? (sourceNames.length || null);
  const canonical = curationUrl;

  return {
    title: asString(raw.title) || asString(raw.title_en) || 'AI HOT 未命名条目',
    url: originalUrl,
    originalUrl,
    guid: `aihot:${externalId}`,
    content: asString(raw.summary) || asString(raw.description),
    author: asString(raw.source) || 'AI HOT',
    publishedAt: resolvePublishedDate(raw),
    mediaUrl: absoluteUrl(raw.image || raw.mediaUrl || raw.cover, curationUrl) || undefined,
    mediaType: raw.image || raw.mediaUrl || raw.cover ? 'image' : undefined,
    curationUrl,
    curationSource: 'AI HOT',
    curationMeta: {
      provider: 'aihot',
      externalId,
      category: asString(raw.category) || null,
      externalScore: asNumber(raw.score),
      externalSourceCount: sourceCount,
      externalSourceNames: sourceNames,
      normalizedOriginalUrl: originalUrl,
      canonical,
      attribution: aihotAttribution(raw, canonical),
      evidenceScope: 'external_radar',
      evidenceNotice: sourceCount
        ? `外部雷达发现 ${sourceCount} 个来源，尚未等同于本地核验。`
        : '外部雷达发现，尚未等同于本地核验。',
    },
    fetchEngine: 'aihot_public_api',
    renderMode: 'curated_index',
    rawData: raw,
  };
}

function collectDailyItems(value: unknown): unknown[] {
  const raw = asObject(value);
  const direct = Array.isArray(raw.items) ? raw.items : [];
  const sections = Array.isArray(raw.sections)
    ? raw.sections
    : Object.values(asObject(raw.sections));
  const sectionItems = sections.flatMap((section) => {
    const candidate = asObject(section);
    return Array.isArray(candidate.items) ? candidate.items : [];
  });
  return [...direct, ...sectionItems];
}

function followBuilderItems(value: unknown): RawItem[] {
  const raw = asObject(value);
  const groups: Array<{ key: string; channel: string }> = [
    { key: 'podcasts', channel: 'podcast' },
    { key: 'blogs', channel: 'blog' },
    { key: 'builders', channel: 'x' },
    { key: 'twitter', channel: 'x' },
  ];
  const items: RawItem[] = [];
  for (const { key, channel } of groups) {
    const entries = Array.isArray(raw[key]) ? raw[key] : [];
    for (const value of entries) {
      const entry = asObject(value);
      const name = asString(entry.name) || asString(entry.title) || asString(entry.handle);
      const originalUrl = normalizeExternalArticleUrl(entry.url || entry.siteUrl || entry.rssUrl);
      if (!name || !originalUrl) continue;
      items.push({
        title: name,
        url: originalUrl,
        originalUrl,
        guid: `follow-builders:${channel}:${buildProviderFingerprint(originalUrl).slice(0, 20)}`,
        content: asString(entry.description) || `Follow Builders ${channel} 候选来源。`,
        author: 'Follow Builders',
        curationUrl: 'https://github.com/zarazhangrui/follow-builders',
        curationSource: 'Follow Builders',
        curationMeta: {
          provider: 'follow_builders',
          channel,
          handle: asString(entry.handle) || null,
          rssUrl: asString(entry.rssUrl) || null,
          attribution: {
            source: 'Follow Builders',
            canonical: 'https://github.com/zarazhangrui/follow-builders',
          },
          previewOnly: true,
        },
        fetchEngine: 'follow_builders_config',
        renderMode: 'reference_preview',
        rawData: entry,
      });
    }
  }
  return items;
}

async function fetchJsonProvider(
  source: SourceConfig,
  endpoint: string,
  config: ProviderConfig,
  mapper: (value: unknown) => RawItem[],
  options: ProviderOptions,
): Promise<CollectorResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now ? options.now() : new Date();
  const cached = restoreCache(config.cachedItems);
  const backoffUntil = config.backoffUntil ? new Date(config.backoffUntil) : null;
  if (backoffUntil && !Number.isNaN(backoffUntil.getTime()) && backoffUntil > now) {
    return {
      items: cached,
      fetchedAt: now,
      outcomeHint: 'no_change',
      sourceConfigPatch: {
        lastProviderOutcome: 'backoff_cache',
        lastProviderCheckedAt: now.toISOString(),
      },
    };
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': USER_AGENT,
  };
  if (config.etag) headers['if-none-match'] = config.etag;

  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 304) {
      return {
        items: [],
        fetchedAt: now,
        outcomeHint: 'no_change',
        sourceConfigPatch: {
          lastProviderOutcome: 'not_modified',
          lastProviderCheckedAt: now.toISOString(),
        },
      };
    }
    if (response.status === 429) {
      return {
        items: cached,
        fetchedAt: now,
        outcomeHint: 'no_change',
        sourceConfigPatch: {
          backoffUntil: retryAfterDate(response, now),
          lastProviderOutcome: cached.length > 0 ? 'rate_limited_cache' : 'rate_limited',
          lastProviderError: 'HTTP 429',
          lastProviderCheckedAt: now.toISOString(),
        },
      };
    }
    if (!response.ok) throw new Error(`provider_http_${response.status}`);

    const payload = JSON.parse(await readResponseText(response));
    const fingerprint = buildProviderFingerprint(payload);
    if (config.lastFingerprint && config.lastFingerprint === fingerprint) {
      return {
        items: [],
        fetchedAt: now,
        outcomeHint: 'no_change',
        sourceConfigPatch: {
          etag: response.headers.get('etag') || config.etag || null,
          lastProviderOutcome: 'fingerprint_unchanged',
          lastProviderCheckedAt: now.toISOString(),
        },
      };
    }

    const limit = Math.max(1, Math.min(Number(config.maxItems || DEFAULT_MAX_ITEMS), DEFAULT_MAX_ITEMS));
    const items = mapper(payload).filter((item) => Boolean(item.url)).slice(0, limit);
    const payloadObject = asObject(payload);
    return {
      items,
      fetchedAt: now,
      outcomeHint: items.length > 0 ? 'new_items' : 'no_items',
      sourceConfigPatch: {
        etag: response.headers.get('etag') || null,
        lastFingerprint: fingerprint,
        nextCursor: asString(payloadObject.nextCursor) || null,
        cachedItems: compactCache(items),
        cacheFetchedAt: now.toISOString(),
        backoffUntil: null,
        lastProviderOutcome: items.length > 0 ? 'updated' : 'empty',
        lastProviderCheckedAt: now.toISOString(),
        lastProviderError: null,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (cached.length > 0) {
      return {
        items: cached,
        fetchedAt: now,
        outcomeHint: 'no_change',
        error: `provider_cache_fallback:${message}`,
        sourceConfigPatch: {
          lastProviderOutcome: 'network_cache',
          lastProviderError: message,
          lastProviderCheckedAt: now.toISOString(),
        },
      };
    }
    return { items: [], fetchedAt: now, error: message };
  }
}

export function isCustomProvider(value: unknown): value is CustomProvider {
  return value === 'aihot_selected'
    || value === 'aihot_hot_topics'
    || value === 'follow_builders_preview'
    || value === 'follow_builders_x'
    || isOrigin12Provider(value);
}

export async function fetchCustomProvider(
  source: SourceConfig,
  options: ProviderOptions = {},
): Promise<CollectorResult | null> {
  const config = source.config as ProviderConfig;
  if (!isCustomProvider(config.provider)) return null;
  if (config.provider === 'follow_builders_x') return fetchFollowBuildersX(options);
  if (isOrigin12Provider(config.provider)) return fetchOrigin12Provider(source, options);

  if (config.provider === 'aihot_selected') {
    const endpoint = asString(config.endpoint) || DEFAULT_AI_HOT_SELECTED;
    return fetchJsonProvider(source, endpoint, config, (payload) => {
      const raw = asObject(payload);
      const entries = Array.isArray(raw.items) ? raw.items : Array.isArray(payload) ? payload : [];
      return entries.map(mapAiHotItem).filter((item): item is RawItem => Boolean(item));
    }, options);
  }

  if (config.provider === 'aihot_hot_topics') {
    const endpoint = asString(config.endpoint) || DEFAULT_AI_HOT_DAILY;
    return fetchJsonProvider(source, endpoint, config, (payload) => (
      collectDailyItems(payload).map(mapAiHotItem).filter((item): item is RawItem => Boolean(item))
    ), options);
  }

  const endpoint = asString(config.endpoint) || DEFAULT_FOLLOW_BUILDERS;
  return fetchJsonProvider(source, endpoint, config, followBuilderItems, options);
}
