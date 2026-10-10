import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReferenceSourcePayload,
  enrichReferenceSourceCatalog,
  filterReferenceSourceCatalog,
  parseReferenceSourceCatalog,
  type ReferenceSourceCatalogItem,
} from './reference-source-catalog.js';

const importable: ReferenceSourceCatalogItem = {
  key: 'follow_builders:podcast:no-priors',
  name: 'No Priors',
  provider: 'follow_builders',
  providerLabel: 'Follow Builders',
  providerSourceId: 'no-priors',
  channel: 'podcast',
  feedUrl: 'https://feeds.example.com/no-priors',
  feedCandidates: ['https://feeds.example.com/no-priors'],
  siteUrl: 'https://example.com/no-priors',
  category: 'AI Podcast',
  sourceKind: 'podcast',
  sourceTier: 'A',
  readingTier: 'high_value',
  recommended: true,
  defaultEnabled: false,
  importMode: 'podcast',
  providerEnabled: true,
  providerStatus: 'configured',
  observationStatus: 'current',
  firstObservedAt: '2026-07-20T00:00:00.000Z',
  lastObservedAt: '2026-07-20T00:00:00.000Z',
  description: '深度访谈',
  notes: '',
  provenance: {
    sourceUrl: 'https://example.com/catalog',
    observedAt: '2026-07-20T00:00:00.000Z',
  },
};

test('catalog parser keeps every valid source disabled by default and removes duplicate keys', () => {
  const catalog = parseReferenceSourceCatalog({
    version: 1,
    updatedAt: '2026-07-20T00:00:00.000Z',
    sourcePolicy: { defaultEnabled: true, maxImportPerRequest: 99 },
    sources: [
      { ...importable, defaultEnabled: true },
      { ...importable, name: 'duplicate' },
      { name: 'missing key' },
    ],
  });

  assert.equal(catalog.sources.length, 1);
  assert.equal(catalog.sources[0].defaultEnabled, false);
  assert.equal(catalog.sourcePolicy.defaultEnabled, false);
  assert.equal(catalog.sourcePolicy.maxImportPerRequest, 20);
  assert.equal(catalog.stats.current, 1);
  assert.equal(catalog.stats.historical, 0);
});

test('catalog parser preserves historical candidates without enabling them', () => {
  const catalog = parseReferenceSourceCatalog({
    updatedAt: '2026-07-20T00:00:00.000Z',
    sources: [{
      ...importable,
      observationStatus: 'historical',
      providerStatus: 'historical',
      providerEnabled: false,
      defaultEnabled: true,
    }],
  });

  assert.equal(catalog.sources[0].observationStatus, 'historical');
  assert.equal(catalog.sources[0].defaultEnabled, false);
  assert.equal(catalog.stats.current, 0);
  assert.equal(catalog.stats.historical, 1);
});

test('catalog parser accepts origin12 logical sources with cadence and component sites', () => {
  const catalog = parseReferenceSourceCatalog({
    updatedAt: '2026-08-10T00:00:00.000Z',
    sources: [{
      ...importable,
      key: 'origin12:research-radar',
      name: '论文雷达',
      provider: 'origin12',
      providerLabel: '源头信息员',
      providerSourceId: 'research-radar',
      importMode: 'adapter_required',
      refreshMinutes: 360,
      logicalSites: [
        { name: 'Hugging Face Papers', url: 'https://huggingface.co/papers', required: true },
        { name: '', url: 'https://invalid.example', required: true },
      ],
    }],
  });

  assert.equal(catalog.sources[0].provider, 'origin12');
  assert.equal(catalog.sources[0].refreshMinutes, 360);
  assert.deepEqual(catalog.sources[0].logicalSites, [
    { name: 'Hugging Face Papers', url: 'https://huggingface.co/papers', required: true },
  ]);
});

test('catalog enrichment reports existing subscriptions and adapter-only sources', () => {
  const adapterOnly: ReferenceSourceCatalogItem = {
    ...importable,
    key: 'follow_builders:blog:claude-blog',
    name: 'Claude Blog',
    channel: 'webpage_index',
    feedUrl: null,
    feedCandidates: [],
    importMode: 'adapter_required',
  };
  const enriched = enrichReferenceSourceCatalog([importable, adapterOnly], [{
    id: 42,
    name: 'No Priors',
    collectorType: 'rss',
    config: { url: 'https://feeds.example.com/no-priors' },
  }]);

  assert.equal(enriched[0].alreadyAdded, true);
  assert.equal(enriched[0].existingSourceId, 42);
  assert.equal(enriched[0].canImport, false);
  assert.match(enriched[1].importReason, /适配器/);
});

test('catalog filters and builds a conservative source payload', () => {
  const view = enrichReferenceSourceCatalog([importable], []);
  assert.equal(filterReferenceSourceCatalog(view, { q: 'prior', provider: 'follow_builders', recommended: true }).length, 1);
  assert.equal(filterReferenceSourceCatalog(view, { channel: 'x' }).length, 0);

  const payload = buildReferenceSourcePayload(importable);
  assert.equal(payload.collectorType, 'rss');
  assert.equal(payload.sourceType, 'audio');
  assert.equal(payload.status, 'active');
  assert.equal(payload.processingProfile, 'full');
  assert.equal(payload.config.readingTier, 'high_value');
  assert.equal(payload.config.referenceCatalogKey, importable.key);
});
