import assert from 'node:assert/strict';
import test from 'node:test';
import { findEquivalentSourceScope, getSourceScopeUrl } from './source-scope.js';

test('getSourceScopeUrl reads stable feed URL fields from source config', () => {
  assert.equal(getSourceScopeUrl({ config: { url: 'https://example.com/feed.xml' } }), 'https://example.com/feed.xml');
  assert.equal(getSourceScopeUrl({ config: { feedUrl: 'https://example.com/rss' } }), 'https://example.com/rss');
  assert.equal(getSourceScopeUrl({ config: { rssUrl: 'https://example.com/rss.xml' } }), 'https://example.com/rss.xml');
  assert.equal(getSourceScopeUrl({ config: { url: '' } }), null);
});

test('findEquivalentSourceScope maps another account source id to current user source by feed URL first', () => {
  const requested = {
    id: 1362,
    name: 'Reuters Technology AI',
    category: 'AI',
    sourceTier: 'A',
    config: { url: 'https://yzcw.dpdns.org/users/1/web_requests/573/R-Technology-AI-slu896.xml' },
  };
  const candidates = [
    {
      id: 777,
      name: 'Reuters Technology AI',
      category: 'AI',
      sourceTier: 'A',
      config: { url: 'https://other.example.com/feed.xml' },
    },
    {
      id: 1363,
      name: 'Reuters Technology AI',
      category: 'AI',
      sourceTier: 'A',
      config: { url: 'https://yzcw.dpdns.org/users/1/web_requests/573/R-Technology-AI-slu896.xml' },
    },
  ];

  const mapped = findEquivalentSourceScope(requested, candidates);

  assert.equal(mapped?.id, 1363);
});

test('findEquivalentSourceScope falls back to source name only when URL is unavailable', () => {
  const mapped = findEquivalentSourceScope(
    { id: 1, name: 'Manual Inbox', category: 'mail', sourceTier: 'B', config: {} },
    [
      { id: 2, name: 'Other', category: 'mail', sourceTier: 'B', config: {} },
      { id: 3, name: 'Manual Inbox', category: 'mail', sourceTier: 'B', config: {} },
    ],
  );

  assert.equal(mapped?.id, 3);
});

test('findEquivalentSourceScope does not map different feed URLs even when names match', () => {
  const mapped = findEquivalentSourceScope(
    { id: 1, name: 'Reuters Technology AI', category: 'AI', sourceTier: 'A', config: { url: 'https://a.example/rss.xml' } },
    [
      { id: 2, name: 'Reuters Technology AI', category: 'AI', sourceTier: 'A', config: { url: 'https://b.example/rss.xml' } },
    ],
  );

  assert.equal(mapped, null);
});
