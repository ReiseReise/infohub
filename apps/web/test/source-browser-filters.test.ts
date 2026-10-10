import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSourcesForBrowser, resolveSourceBrowserQueryState } from '../src/lib/source-browser-filters.ts';

const sources = [
  {
    id: 1362,
    name: 'Reuters Technology AI',
    category: 'AI',
    collectorType: 'rss',
    sourceTier: 'A',
    config: { readingTier: 'high_value' },
    topicGroup: 'ai_frontier',
    topicGroupLabel: 'AI 前沿',
    governanceRole: 'professional_media',
    governanceRoleLabel: '专业媒体',
    classificationSource: 'cold_start',
    needsGovernanceReview: true,
    sourceHost: 'reuters.com',
    status: 'active',
  },
  {
    id: 36,
    name: '36kr',
    category: '其他',
    collectorType: 'rsshub',
    sourceTier: 'B',
    config: { readingTier: 'light_reading' },
    topicGroup: 'business_industry',
    governanceRole: 'professional_media',
    classificationSource: 'manual',
    needsGovernanceReview: false,
    sourceHost: '36kr.com',
    status: 'active',
  },
  {
    id: 500,
    name: '网页监控',
    category: '监控',
    collectorType: 'changedetection',
    sourceTier: 'D',
    config: { readingTier: 'paused' },
    topicGroup: 'other',
    governanceRole: 'monitor',
    classificationSource: 'manual',
    needsGovernanceReview: false,
    sourceHealth: { healthStatus: 'fetch_failing' },
    status: 'active',
  },
];

test('filters sources by content channel, collection channel and reading intent', () => {
  const filtered = filterSourcesForBrowser(sources, {
    category: 'AI',
    collector: 'rss',
    readingTier: 'high_value',
  });

  assert.deepEqual(filtered.map((source) => source.id), [1362]);
});

test('normalizes source browser query params with safe defaults', () => {
  const state = resolveSourceBrowserQueryState(new URLSearchParams('q=reuters&category=AI&collector=rss&readingTier=high_value&topic=ai_frontier&role=professional_media&governance=pending&tier=A&health=all&sort=quality'));

  assert.deepEqual(state, {
    q: 'reuters',
    category: 'AI',
    collector: 'rss',
    readingTier: 'high_value',
    topicGroup: 'ai_frontier',
    governanceRole: 'professional_media',
    governanceStatus: 'pending',
    tier: 'A',
    health: 'all',
    focus: 'all',
    sort: 'quality',
    view: '',
    status: 'active',
  });
});

test('keeps archived source scope in the query state', () => {
  const state = resolveSourceBrowserQueryState(new URLSearchParams('status=paused'));

  assert.equal(state.status, 'paused');
});

test('filters cold-start classifications by topic, source role and review state', () => {
  const filtered = filterSourcesForBrowser(sources, {
    topicGroup: 'ai_frontier',
    governanceRole: 'professional_media',
    governanceStatus: 'pending',
  });

  assert.deepEqual(filtered.map((source) => source.id), [1362]);
});
