import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceConfig } from './base.js';
import {
  fetchCustomProvider,
  mapAiHotItem,
  normalizeExternalArticleUrl,
} from './custom-providers.js';

function source(config: Record<string, unknown>): SourceConfig {
  return {
    id: 88,
    name: 'Reference radar',
    sourceType: 'curated_index',
    collectorType: 'custom',
    sourceTier: 'A',
    processingProfile: 'smart',
    sourceRole: 'radar',
    config,
    category: 'AI Radar',
    priority: 4,
    fetchInterval: 180,
    status: 'active',
  };
}

const rawAiHotItem = {
  id: 'radar-1',
  title: 'A new model ships',
  url: 'https://example.com/model/?utm_source=aihot&ref=radar#top',
  permalink: '/items/radar-1',
  source: 'Example Labs',
  publishedAt: '2026-07-20T08:00:00.000Z',
  summary: 'A concise external radar summary.',
  category: 'ai-models',
  score: 91,
  sourceCount: 4,
  sourceNames: ['Example Labs', 'Media A', 'Media B', 'Media C'],
  attribution: {
    source: 'AI HOT',
    canonical: 'https://aihot.virxact.com/items/radar-1',
  },
};

test('AI HOT mapping keeps the original article canonical and explicit external attribution', () => {
  const item = mapAiHotItem(rawAiHotItem);
  assert.ok(item);
  assert.equal(item.url, 'https://example.com/model');
  assert.equal(item.originalUrl, 'https://example.com/model');
  assert.equal(item.curationUrl, 'https://aihot.virxact.com/items/radar-1');
  assert.equal(item.curationSource, 'AI HOT');
  assert.equal(item.curationMeta?.externalSourceCount, 4);
  assert.equal(item.curationMeta?.evidenceScope, 'external_radar');
  assert.match(String(item.curationMeta?.evidenceNotice), /尚未等同于本地核验/);
  assert.deepEqual(item.curationMeta?.attribution, {
    source: 'AI HOT',
    canonical: 'https://aihot.virxact.com/items/radar-1',
    required: true,
  });
});

test('external URL normalization only removes tracking parameters', () => {
  assert.equal(
    normalizeExternalArticleUrl('https://EXAMPLE.com/a/?id=42&utm_medium=rss#fragment'),
    'https://example.com/a?id=42',
  );
});

test('AI HOT selected adapter sends non-browser headers and persists fingerprint, ETag and cursor', async () => {
  let requestHeaders = new Headers();
  const result = await fetchCustomProvider(source({
    provider: 'aihot_selected',
    endpoint: 'https://aihot.example/items',
  }), {
    now: () => new Date('2026-07-20T10:00:00.000Z'),
    fetchImpl: (async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        items: [rawAiHotItem],
        nextCursor: 'cursor-2',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: '"v2"' },
      });
    }) as typeof fetch,
  });

  assert.ok(result);
  assert.equal(result.items.length, 1);
  assert.equal(requestHeaders.get('user-agent'), 'InfoHubV3/3.1 (+https://localhost)');
  assert.equal(result.sourceConfigPatch?.etag, '"v2"');
  assert.equal(result.sourceConfigPatch?.nextCursor, 'cursor-2');
  assert.equal(typeof result.sourceConfigPatch?.lastFingerprint, 'string');
  assert.equal((result.sourceConfigPatch?.cachedItems as unknown[]).length, 1);
});

test('AI HOT adapter treats 304 as unchanged and does not replay cache as new items', async () => {
  let ifNoneMatch = '';
  const result = await fetchCustomProvider(source({
    provider: 'aihot_selected',
    endpoint: 'https://aihot.example/items',
    etag: '"v1"',
    cachedItems: [{
      title: 'Cached',
      url: 'https://example.com/cached',
      guid: 'cached-1',
    }],
  }), {
    fetchImpl: (async (_input, init) => {
      ifNoneMatch = new Headers(init?.headers).get('if-none-match') || '';
      return new Response(null, { status: 304 });
    }) as typeof fetch,
  });

  assert.ok(result);
  assert.equal(ifNoneMatch, '"v1"');
  assert.equal(result.items.length, 0);
  assert.equal(result.outcomeHint, 'no_change');
  assert.equal(result.sourceConfigPatch?.lastProviderOutcome, 'not_modified');
});

test('AI HOT adapter honors 429 backoff and falls back to the cached snapshot', async () => {
  const result = await fetchCustomProvider(source({
    provider: 'aihot_selected',
    endpoint: 'https://aihot.example/items',
    cachedItems: [{
      title: 'Cached radar item',
      url: 'https://example.com/cached',
      guid: 'cached-1',
      curationSource: 'AI HOT',
    }],
  }), {
    now: () => new Date('2026-07-20T10:00:00.000Z'),
    fetchImpl: (async () => new Response(null, {
      status: 429,
      headers: { 'retry-after': '120' },
    })) as typeof fetch,
  });

  assert.ok(result);
  assert.equal(result.items.length, 1);
  assert.equal(result.sourceConfigPatch?.backoffUntil, '2026-07-20T10:02:00.000Z');
  assert.equal(result.sourceConfigPatch?.lastProviderOutcome, 'rate_limited_cache');
});

test('provider timeout uses a cached snapshot and reports degraded success', async () => {
  const result = await fetchCustomProvider(source({
    provider: 'aihot_selected',
    endpoint: 'https://aihot.example/items',
    cachedItems: [{
      title: 'Cached radar item',
      url: 'https://example.com/cached',
      guid: 'cached-1',
    }],
  }), {
    fetchImpl: (async () => {
      throw new Error('request_timeout');
    }) as typeof fetch,
  });

  assert.ok(result);
  assert.equal(result.items.length, 1);
  assert.match(result.error || '', /provider_cache_fallback:request_timeout/);
  assert.equal(result.sourceConfigPatch?.lastProviderOutcome, 'network_cache');
});

test('AI HOT daily adapter maps section items while preserving original links', async () => {
  const result = await fetchCustomProvider(source({
    provider: 'aihot_hot_topics',
    endpoint: 'https://aihot.example/daily',
  }), {
    fetchImpl: (async () => new Response(JSON.stringify({
      sections: [{ key: 'models', items: [rawAiHotItem] }],
    }), { status: 200 })) as typeof fetch,
  });

  assert.ok(result);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].originalUrl, 'https://example.com/model');
});

test('Follow Builders adapter returns preview-only candidates and never disguises them as articles', async () => {
  const result = await fetchCustomProvider(source({
    provider: 'follow_builders_preview',
    endpoint: 'https://follow-builders.example/config.json',
  }), {
    fetchImpl: (async () => new Response(JSON.stringify({
      podcasts: [{ name: 'No Priors', url: 'https://example.com/no-priors', rssUrl: 'https://example.com/no-priors.xml' }],
      builders: [{ name: 'Builder A', url: 'https://x.com/builder-a', handle: '@builder-a' }],
    }), { status: 200 })) as typeof fetch,
  });

  assert.ok(result);
  assert.equal(result.items.length, 2);
  assert.equal(result.items.every((item) => item.curationMeta?.previewOnly === true), true);
  assert.equal(result.items.some((item) => item.curationMeta?.channel === 'x'), true);
});
