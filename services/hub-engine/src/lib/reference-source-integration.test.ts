import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReferenceSourceCatalogItem } from './reference-source-catalog.js';
import {
  assertReferenceSourceCapacity,
  buildReferenceIntegrationSourceDefinition,
  evaluateReferenceSourceQuality,
  resolveReferenceIntegrationStatus,
  summarizeReferenceFetchRuns,
} from './reference-source-integration.js';

function candidate(overrides: Partial<ReferenceSourceCatalogItem> = {}): ReferenceSourceCatalogItem {
  return {
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
    description: 'Long-form AI interviews',
    notes: '',
    provenance: {
      sourceUrl: 'https://example.com/catalog',
      observedAt: '2026-07-20T00:00:00.000Z',
    },
    ...overrides,
  } as ReferenceSourceCatalogItem;
}

test('reference source definitions start in shadow and reuse the RSS collector for podcasts', () => {
  const definition = buildReferenceIntegrationSourceDefinition(candidate());
  assert.equal(definition.status, 'active');
  assert.equal(definition.sourceRole, 'reference');
  assert.equal(definition.sourceType, 'audio');
  assert.equal(definition.collectorType, 'rss');
  assert.equal(definition.config.integrationStatus, 'shadow');
  assert.equal(definition.config.integrationType, 'reference_source');
  assert.equal(definition.config.url, 'https://feeds.example.com/no-priors');
});

test('Follow Builders X uses the fixed aggregate adapter and keeps individual account pages out of generic crawling', () => {
  const entry = candidate({ key: 'follow_builders:feed:x-selected', channel: 'x', importMode: 'adapter_required' });
  const definition = buildReferenceIntegrationSourceDefinition(entry);
  assert.equal(definition.collectorType, 'custom');
  assert.equal(definition.config.provider, 'follow_builders_x');
  assert.equal(definition.config.integrationStatus, 'shadow');
  assert.equal(definition.fetchInterval, 360);
  assert.equal(definition.autoTranscribe, false);
  assert.equal((definition.config.selectedHandles as string[]).length, 5);
  assert.throws(() => buildReferenceIntegrationSourceDefinition({ ...entry, key: 'follow_builders:x:swyx' }), /单个 X 账号/);
});

test('AI HOT selected definition uses the custom radar provider with attribution', () => {
  const definition = buildReferenceIntegrationSourceDefinition(candidate({
    key: 'aihot:channel:selected',
    name: 'AI HOT 精选雷达',
    provider: 'aihot',
    providerLabel: 'AI HOT',
    providerSourceId: 'selected',
    channel: 'radar_feed',
    feedUrl: 'https://aihot.virxact.com/feed.xml',
    siteUrl: 'https://aihot.virxact.com/',
    sourceKind: 'media',
    category: 'AI Radar',
    readingTier: 'light_reading',
    importMode: 'adapter_required',
    provenance: {
      sourceUrl: 'https://aihot.virxact.com/agent',
      observedAt: '2026-07-20T00:00:00.000Z',
      attributionRequired: true,
    },
  }));
  assert.equal(definition.collectorType, 'custom');
  assert.equal(definition.sourceRole, 'radar');
  assert.equal(definition.config.provider, 'aihot_selected');
  assert.equal((definition.config.attribution as Record<string, unknown>).required, true);
});

test('origin12 definitions use dedicated custom adapters and locked refresh cadences', () => {
  const research = buildReferenceIntegrationSourceDefinition(candidate({
    key: 'origin12:research-radar',
    name: '论文雷达',
    provider: 'origin12',
    providerLabel: '源头信息员',
    providerSourceId: 'research-radar',
    channel: 'research_radar',
    feedUrl: null,
    siteUrl: 'https://huggingface.co/papers',
    sourceKind: 'research',
    category: 'AI Research',
    importMode: 'adapter_required',
    refreshMinutes: 360,
    logicalSites: [
      { name: 'Hugging Face Papers', url: 'https://huggingface.co/papers', required: true },
      { name: 'alphaXiv', url: 'https://alphaxiv.org/', required: true },
      { name: 'arXiv', url: 'https://arxiv.org/', required: true },
    ],
  }));
  assert.equal(research.collectorType, 'custom');
  assert.equal(research.sourceType, 'curated_index');
  assert.equal(research.config.provider, 'origin12_research_radar');
  assert.equal(research.fetchInterval, 360);
  assert.equal(research.sourceRole, 'reference');

  const modelReality = buildReferenceIntegrationSourceDefinition(candidate({
    key: 'origin12:model-reality',
    name: '模型现实监测',
    provider: 'origin12',
    providerLabel: '源头信息员',
    providerSourceId: 'model-reality',
    channel: 'model_reality',
    feedUrl: null,
    siteUrl: 'https://arena.ai/leaderboard/text/english',
    sourceKind: 'benchmark',
    category: 'AI Models',
    importMode: 'adapter_required',
    refreshMinutes: 1440,
    logicalSites: [],
  }));
  assert.equal(modelReality.collectorType, 'custom');
  assert.equal(modelReality.sourceType, 'curated_index');
  assert.equal(modelReality.config.provider, 'origin12_model_reality');
});

test('shadow quality gate requires seven days and every threshold', () => {
  const notReady = evaluateReferenceSourceQuality({
    createdAt: '2026-07-18T00:00:00.000Z',
    fetchAttempts: 20,
    fetchSuccesses: 20,
    itemCount: 20,
    relevantItemCount: 20,
    aiProcessedItemCount: 8,
    originalLinkCount: 20,
    noiseItemCount: 0,
    duplicateCount: 2,
  }, new Date('2026-07-20T00:00:00.000Z'));
  assert.equal(notReady.eligibleForActivation, false);
  assert.match(notReady.activationReasons.join(' '), /尚未满 7 天/);

  const ready = evaluateReferenceSourceQuality({
    createdAt: '2026-07-10T00:00:00.000Z',
    fetchAttempts: 20,
    fetchSuccesses: 19,
    itemCount: 20,
    relevantItemCount: 17,
    aiProcessedItemCount: 12,
    originalLinkCount: 19,
    noiseItemCount: 1,
    duplicateCount: 2,
  }, new Date('2026-07-20T00:00:00.000Z'));
  assert.equal(ready.fetchSuccessRate, 0.95);
  assert.equal(ready.aiRelevanceRate, 0.85);
  assert.equal(ready.aiProcessingRate, 0.6);
  assert.equal(ready.originalLinkRate, 0.95);
  assert.equal(ready.noiseRate, 0.05);
  assert.equal(ready.eligibleForActivation, true);
});

test('AI processing completeness is distinct from relevance and blocks activation below 60 percent', () => {
  const quality = evaluateReferenceSourceQuality({
    createdAt: '2026-07-10T00:00:00.000Z',
    fetchAttempts: 20,
    fetchSuccesses: 20,
    itemCount: 20,
    relevantItemCount: 20,
    aiProcessedItemCount: 2,
    originalLinkCount: 20,
    noiseItemCount: 0,
    duplicateCount: 0,
  }, new Date('2026-07-20T00:00:00.000Z'));

  assert.equal(quality.aiRelevanceRate, 1);
  assert.equal(quality.aiProcessingRate, 0.1);
  assert.equal(quality.eligibleForActivation, false);
  assert.match(quality.activationReasons.join(' '), /AI 处理率低于 60%/);
});

test('every required component must independently reach the 95 percent activation gate', () => {
  const quality = evaluateReferenceSourceQuality({
    createdAt: '2026-08-01T00:00:00.000Z',
    fetchAttempts: 20,
    fetchSuccesses: 20,
    itemCount: 20,
    relevantItemCount: 20,
    aiProcessedItemCount: 20,
    originalLinkCount: 20,
    noiseItemCount: 0,
    duplicateCount: 0,
    componentHealth: {
      huggingface: { name: 'Hugging Face Papers', required: true, attempts7d: 20, successes7d: 20, successRate: 1 },
      alphaxiv: { name: 'alphaXiv', required: true, attempts7d: 20, successes7d: 18, successRate: 0.9 },
      arxiv: { name: 'arXiv', required: true, attempts7d: 20, successes7d: 20, successRate: 1 },
    },
  }, new Date('2026-08-10T00:00:00.000Z'));
  assert.equal(quality.eligibleForActivation, false);
  assert.match(quality.activationReasons.join('；'), /alphaXiv 组件抓取成功率未达到 95%/);
  assert.equal(quality.componentHealth.find((entry) => entry.key === 'alphaxiv')?.eligible, false);
});

test('reference fetch quality collapses a recovered retry into one successful logical run', () => {
  const summary = summarizeReferenceFetchRuns([
    {
      status: 'error',
      startedAt: '2026-07-21T04:36:19.000Z',
      finishedAt: '2026-07-21T04:36:29.000Z',
    },
    {
      status: 'success',
      startedAt: '2026-07-21T04:36:34.000Z',
      finishedAt: '2026-07-21T04:36:36.000Z',
    },
  ]);

  assert.deepEqual(summary, {
    rawAttempts: 2,
    fetchAttempts: 1,
    fetchSuccesses: 1,
    recoveredRetries: 1,
  });
});

test('reference fetch quality keeps unresolved or late failures visible', () => {
  const summary = summarizeReferenceFetchRuns([
    {
      status: 'error',
      startedAt: '2026-07-21T04:00:00.000Z',
      finishedAt: '2026-07-21T04:00:10.000Z',
    },
    {
      status: 'success',
      startedAt: '2026-07-21T04:02:00.000Z',
      finishedAt: '2026-07-21T04:02:02.000Z',
    },
    {
      status: 'running',
      startedAt: '2026-07-21T04:03:00.000Z',
    },
    {
      status: 'error',
      startedAt: '2026-07-21T04:04:00.000Z',
      finishedAt: '2026-07-21T04:04:10.000Z',
    },
  ]);

  assert.deepEqual(summary, {
    rawAttempts: 3,
    fetchAttempts: 3,
    fetchSuccesses: 1,
    recoveredRetries: 0,
  });
});

test('capacity guard enforces total and reference source limits', () => {
  assert.doesNotThrow(() => assertReferenceSourceCapacity({
    totalScheduled: 30,
    referenceShadow: 9,
    referenceFormal: 4,
    targetStatus: 'shadow',
  }));
  assert.throws(
    () => assertReferenceSourceCapacity({
      totalScheduled: 31,
      referenceShadow: 9,
      referenceFormal: 4,
      targetStatus: 'shadow',
    }),
    /总调度来源已达到上限 31/,
  );
  assert.throws(
    () => assertReferenceSourceCapacity({
      totalScheduled: 30,
      referenceShadow: 10,
      referenceFormal: 4,
      targetStatus: 'shadow',
    }),
    /影子来源已达到上限 10/,
  );
  assert.throws(
    () => assertReferenceSourceCapacity({
      totalScheduled: 30,
      referenceShadow: 9,
      referenceFormal: 5,
      targetStatus: 'active',
      alreadyScheduled: true,
    }),
    /正式参考来源已达到上限 5/,
  );
  assert.doesNotThrow(() => assertReferenceSourceCapacity({
    totalScheduled: 31,
    referenceShadow: 10,
    referenceFormal: 4,
    targetStatus: 'active',
    alreadyScheduled: true,
  }));
});

test('integration lifecycle status is read from source config and remains reversible', () => {
  assert.equal(resolveReferenceIntegrationStatus(null), 'available');
  assert.equal(resolveReferenceIntegrationStatus({ status: 'active', config: { integrationStatus: 'shadow' } }), 'shadow');
  assert.equal(resolveReferenceIntegrationStatus({ status: 'paused', config: { integrationStatus: 'removed' } }), 'removed');
});
