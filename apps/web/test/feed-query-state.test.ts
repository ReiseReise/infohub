import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFeedUrlParams, readFeedUrlState } from '../src/lib/feed-query-state.ts';

test('reads feed query state from url params with safe defaults', () => {
  const state = readFeedUrlState(new URLSearchParams('q=Anthropic&filter=unread&sort=latest&readingTier=high_value&score=80'));

  assert.deepEqual(state, {
    q: 'Anthropic',
    filter: 'unread',
    category: '',
    sourceId: '',
    sort: 'latest',
    sourceTier: '',
    readingTier: 'high_value',
    growthAxis: '',
    score: '80',
  });

  assert.deepEqual(readFeedUrlState(new URLSearchParams('sort=unexpected&filter=unknown&score=wat')), {
    q: '',
    filter: 'all',
    category: '',
    sourceId: '',
    sort: 'priority',
    sourceTier: '',
    readingTier: '',
    growthAxis: '',
    score: 'all',
  });
});

test('merges feed query params while removing defaults and cleared filters', () => {
  const params = mergeFeedUrlParams(
    new URLSearchParams('filter=unread&sort=latest&readingTier=paused&q=old'),
    {
      q: 'Anthropic',
      filter: 'all',
      sort: 'priority',
      readingTier: 'high_value',
      score: '70',
    },
  );

  assert.equal(params.get('q'), 'Anthropic');
  assert.equal(params.get('readingTier'), 'high_value');
  assert.equal(params.get('score'), '70');
  assert.equal(params.get('filter'), null);
  assert.equal(params.get('sort'), null);

  const cleared = mergeFeedUrlParams(params, {
    q: '',
    readingTier: '',
    score: 'all',
  });

  assert.equal(cleared.get('q'), null);
  assert.equal(cleared.get('readingTier'), null);
  assert.equal(cleared.get('score'), null);
});
