import test from 'node:test';
import assert from 'node:assert/strict';

import { feedKeys, type FeedListParams } from '../src/lib/feed-query-keys';

const params: FeedListParams = {
  filter: 'all',
  sortMode: 'latest',
  searchQuery: '',
  category: '',
  sourceId: '',
  sourceTierFilter: '',
  readingTierFilter: '',
  growthAxisFilter: '',
  scoreBand: 'all',
};

test('feed query keys isolate otherwise identical requests by user id', () => {
  assert.notDeepEqual(feedKeys.list('user-a', params), feedKeys.list('user-b', params));
  assert.notDeepEqual(feedKeys.detail('user-a', 'item-1'), feedKeys.detail('user-b', 'item-1'));
});

test('feed query keys are stable for the same user and inputs', () => {
  assert.deepEqual(feedKeys.list('user-a', params), feedKeys.list('user-a', params));
  assert.deepEqual(feedKeys.scoreBreakdown('user-a', 'item-1'), feedKeys.scoreBreakdown('user-a', 'item-1'));
});
