import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDailyReportEventMetrics } from './daily-report-event-metrics.js';

test('counts local events and keeps external radar claims separate from local evidence', () => {
  const metrics = buildDailyReportEventMetrics({
    localItems: [
      {
        id: 'official',
        sourceId: 1,
        sourceName: 'Anthropic',
        sourceRole: 'normal',
        sourceKind: 'official',
        clusterId: 'anthropic:claude:model',
        title: 'Anthropic releases Claude Opus 5',
        url: 'https://anthropic.com/news/claude-opus-5',
      },
      {
        id: 'media',
        sourceId: 2,
        sourceName: 'Tech media',
        sourceRole: 'normal',
        sourceKind: 'media',
        clusterId: 'anthropic:claude:model',
        title: 'Anthropic releases Claude Opus 5',
        url: 'https://media.example/claude-opus-5',
      },
      {
        id: 'product',
        sourceId: 3,
        sourceName: 'OpenAI',
        sourceRole: 'normal',
        sourceKind: 'official',
        clusterId: 'openai:agent:product',
        title: 'OpenAI launches a new Agent product',
        url: 'https://openai.com/news/agent-product',
      },
    ],
    radarItems: [
      {
        id: 'radar-match',
        sourceId: 50,
        sourceName: 'AI HOT Selected',
        sourceRole: 'radar',
        sourceKind: 'api',
        clusterId: 'anthropic:claude:model',
        title: 'Claude Opus 5 ships',
        url: 'https://anthropic.com/news/claude-opus-5?utm_source=aihot',
        originalUrl: 'https://anthropic.com/news/claude-opus-5?utm_source=aihot',
        curationSource: 'AI HOT',
        curationMeta: { externalSourceCount: 12 },
      },
      {
        id: 'radar-miss',
        sourceId: 50,
        sourceName: 'AI HOT Selected',
        sourceRole: 'radar',
        sourceKind: 'api',
        clusterId: 'gemini:new:model',
        title: 'Gemini Ultra 4 announced',
        url: 'https://deepmind.google/news/gemini-ultra-4',
        originalUrl: 'https://deepmind.google/news/gemini-ultra-4',
        curationSource: 'AI HOT',
      },
      {
        id: 'radar-unverifiable',
        sourceId: 50,
        sourceName: 'AI HOT Selected',
        sourceRole: 'radar',
        sourceKind: 'api',
        clusterId: 'unknown:radar:item',
        title: 'Unverifiable radar card',
        url: 'https://aihot.virxact.com/items/unverifiable',
        originalUrl: null,
        curationSource: 'AI HOT',
      },
    ],
  });

  assert.equal(metrics.independentEventCount, 2);
  assert.equal(metrics.multiSourceEventCount, 1);
  assert.equal(metrics.firstPartyEventCount, 2);
  assert.equal(metrics.firstPartyEventShare, 1);
  assert.equal(metrics.modelProductEventCount, 2);
  assert.equal(metrics.externalRadarEventCount, 2);
  assert.equal(metrics.aihotLocalMissCount, 1);
  assert.equal(metrics.unverifiableRadarItemCount, 1);
  assert.equal(metrics.localItemCount, 3);
  assert.equal(metrics.externalRadarItemCount, 3);
});

test('does not count radar-only sourceCount as locally verified evidence', () => {
  const metrics = buildDailyReportEventMetrics({
    localItems: [],
    radarItems: [{
      id: 'radar-only',
      sourceId: 80,
      sourceName: 'AI HOT Selected',
      sourceRole: 'radar',
      sourceKind: 'api',
      clusterId: 'new:model:release',
      title: 'A new model release',
      url: 'https://example.com/model',
      originalUrl: 'https://example.com/model',
      curationSource: 'AI HOT',
      curationMeta: { externalSourceCount: 99 },
    }],
  });

  assert.equal(metrics.independentEventCount, 0);
  assert.equal(metrics.multiSourceEventCount, 0);
  assert.equal(metrics.externalRadarEventCount, 1);
  assert.equal(metrics.aihotLocalMissCount, 1);
});

test('counts known first-party RSS and blog sources with the shared governance classification', () => {
  const metrics = buildDailyReportEventMetrics({
    localItems: [
      {
        id: 'deepmind',
        sourceId: 1,
        sourceName: 'Google DeepMind',
        sourceKind: 'rss',
        sourceType: 'rss',
        sourceCollectorType: 'rss',
        sourceConfig: { url: 'https://deepmind.google/blog/rss.xml' },
        clusterId: 'gemini:model:release',
        title: 'Google DeepMind releases a new Gemini model',
        url: 'https://deepmind.google/blog/new-gemini-model',
      },
      {
        id: 'hugging-face',
        sourceId: 2,
        sourceName: 'Hugging Face Blog',
        sourceKind: 'blog',
        sourceType: 'rss',
        sourceCollectorType: 'rss',
        sourceConfig: { url: 'https://huggingface.co/blog/feed.xml' },
        clusterId: 'huggingface:model:release',
        title: 'Hugging Face releases a new open model',
        url: 'https://huggingface.co/blog/new-open-model',
      },
    ],
  });

  assert.equal(metrics.independentEventCount, 2);
  assert.equal(metrics.firstPartyEventCount, 2);
  assert.equal(metrics.firstPartyEventShare, 1);
});
