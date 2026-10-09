import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isWebpageSnapshotLikeItem,
  normalizeItemListQuery,
  rankFeedRecommendationItem,
  shouldExcludeSnapshotLikeItemsFromDefaultFeed,
} from './item-list-query.js';

test('normalizes score range and score sorting for item list queries', () => {
  const query = normalizeItemListQuery({
    minScore: '90',
    maxScore: '60',
    sortBy: 'score',
  });

  assert.equal(query.minScore, 60);
  assert.equal(query.maxScore, 90);
  assert.equal(query.sortBy, 'score');
  assert.equal(query.collapseEvents, false);
});

test('normalizes the event-collapse query flag without enabling it implicitly', () => {
  assert.equal(normalizeItemListQuery({ collapseEvents: 'true' }).collapseEvents, true);
  assert.equal(normalizeItemListQuery({ collapseEvents: true }).collapseEvents, true);
  assert.equal(normalizeItemListQuery({ collapseEvents: 'false' }).collapseEvents, false);
  assert.equal(normalizeItemListQuery({}).collapseEvents, false);
});

test('ignores invalid score bounds and keeps existing sort defaults', () => {
  const query = normalizeItemListQuery({
    minScore: '-10',
    maxScore: 'abc',
    sortBy: 'publishedAt',
  });

  assert.equal(query.minScore, null);
  assert.equal(query.maxScore, null);
  assert.equal(query.sortBy, 'publishedAt');
});

test('normalizes source tier and growth axis filters', () => {
  const query = normalizeItemListQuery({
    sourceTier: ' b ',
    growthAxis: '技术能力',
    readingTier: '浅阅读',
  });

  assert.equal(query.sourceTier, 'B');
  assert.equal(query.growthAxis, '技术能力');
  assert.equal(query.readingTier, 'light_reading');
});

test('detects webpage monitor snapshots that should not dominate recommended feed', () => {
  assert.equal(isWebpageSnapshotLikeItem({
    title: 'Newsroom \\ Anthropic',
    sourceName: 'Anthropic Newsroom',
    sourceType: 'webpage',
    sourceCollectorType: 'webpage',
  }), true);

  assert.equal(isWebpageSnapshotLikeItem({
    title: 'Claude Fable 5 and Claude Mythos 5',
    sourceName: 'Anthropic Newsroom',
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
    contentReadinessKind: 'index_item',
  }), false);
});

test('penalizes webpage snapshots in recommendation ranking without deleting them', () => {
  const snapshotRank = rankFeedRecommendationItem({
    title: 'Newsroom \\ Anthropic',
    sourceName: 'Anthropic Newsroom',
    sourceType: 'webpage',
    priorityScore: 0.92,
  });
  const articleRank = rankFeedRecommendationItem({
    title: 'Claude Fable 5 and Claude Mythos 5',
    sourceName: 'Anthropic Newsroom',
    sourceType: 'curated_index',
    priorityScore: 0.2,
  });

  assert.ok(articleRank > snapshotRank);
});

test('excludes snapshot-like items from the default feed but keeps them available in source or monitor views', () => {
  assert.equal(shouldExcludeSnapshotLikeItemsFromDefaultFeed({}), true);
  assert.equal(shouldExcludeSnapshotLikeItemsFromDefaultFeed({ search: 'Anthropic' }), false);
  assert.equal(shouldExcludeSnapshotLikeItemsFromDefaultFeed({ sourceId: '1354' }), false);
  assert.equal(shouldExcludeSnapshotLikeItemsFromDefaultFeed({ monitorOnly: true }), false);
  assert.equal(shouldExcludeSnapshotLikeItemsFromDefaultFeed({ category: '监控' }), false);
  assert.equal(shouldExcludeSnapshotLikeItemsFromDefaultFeed({ sourceType: 'webpage' }), false);
});
