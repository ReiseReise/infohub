import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchFollowBuildersX, FOLLOW_BUILDERS_X_URL, parseFollowBuildersX } from './follow-builders.js';
import { fetchCustomProvider } from './custom-providers.js';
import type { SourceConfig } from './base.js';

const now = new Date('2026-10-07T10:00:00Z');
const tweet = {
  id: '210000000000000001', url: 'https://x.com/swyx/status/210000000000000001',
  text: 'Building coding agents requires careful evaluation of tool access, context and failure recovery.',
  createdAt: '2026-10-07T05:00:00Z', isQuote: false, quotedTweetId: null,
};
const feed = (tweets: unknown[] = [tweet]) => ({ generatedAt: '2026-10-07T06:00:00Z', x: [{ name: 'Swyx', handle: 'swyx', tweets }] });

test('public posts keep stable identity, original publication time and attribution across snapshots', () => {
  const first = parseFollowBuildersX(feed(), now).items[0];
  const second = parseFollowBuildersX({ ...feed(), generatedAt: '2026-10-07T09:00:00Z' }, now).items[0];
  assert.equal(first.guid, second.guid);
  assert.equal(first.url, second.url);
  assert.equal(first.publishedAt?.toISOString(), tweet.createdAt.replace('Z', '.000Z'));
  assert.equal(first.author, 'Swyx');
  assert.equal(first.curationSource, 'Follow Builders');
  assert.equal(first.curationMeta?.completeness, 'text_only');
});

test('exclude unselected authors, quotes without context, replies, short chatter and off-topic posts', () => {
  const input = feed([
    tweet,
    { ...tweet, isQuote: true },
    { ...tweet, quotedTweetId: '12345678900' },
    { ...tweet, text: '@someone ' + tweet.text },
    { ...tweet, text: 'Claude is good!' },
    { ...tweet, text: 'We enjoyed a wonderful dinner with friends and family and then walked around town.' },
  ]);
  input.x.push({ name: 'Other', handle: 'unselected', tweets: [tweet] });
  const result = parseFollowBuildersX(input, now);
  assert.equal(result.items.length, 1);
  assert.equal(result.diagnostics.rejected.missingContext, 3);
  assert.equal(result.diagnostics.rejected.offTopic, 2);
  assert.equal(result.diagnostics.rejected.unselected, 1);
});

test('reject missing, stale, future and upstream-error snapshots instead of pretending no new posts', () => {
  for (const invalid of [
    {}, { ...feed(), generatedAt: '2026-10-01T06:00:00Z' },
    { ...feed(), generatedAt: '2026-10-08T06:00:00Z' },
    { ...feed(), generatedAt: '2026-10-07' },
    { ...feed(), errors: ['X API failed'] }, { ...feed(), x: [{}] },
  ]) assert.throws(() => parseFollowBuildersX(invalid, now), /follow_builders_/);
  assert.equal(parseFollowBuildersX({ ...feed(), x: [] }, now).items.length, 0);
});

test('validate source links and dates; escape upstream HTML; deduplicate posts', () => {
  const result = parseFollowBuildersX(feed([
    { ...tweet, text: tweet.text + '<script>alert(1)</script>' }, tweet,
    { ...tweet, url: 'https://evil.example/swyx/status/' + tweet.id },
    { ...tweet, url: 'https://x.com/other/status/' + tweet.id },
    { ...tweet, url: 'http://x.com/swyx/status/' + tweet.id },
    { ...tweet, createdAt: '' }, { ...tweet, createdAt: '2026-09-01T00:00:00Z' },
  ]), now);
  assert.equal(result.items.length, 1);
  assert.match(result.items[0].content!, /&lt;script&gt;/);
  assert.equal(result.diagnostics.rejected.invalid, 4);
  assert.equal(result.diagnostics.rejected.stale, 1);
  assert.equal(result.diagnostics.rejected.duplicate, 1);
});

test('a feed cannot expand a selected author beyond three posts', () => {
  const posts = Array.from({ length: 5 }, (_, i) => ({ ...tweet,
    id: `21000000000000000${i}`, url: `https://x.com/swyx/status/21000000000000000${i}`,
  }));
  assert.equal(parseFollowBuildersX(feed(posts), now).items.length, 3);
});

test('custom provider uses only the fixed public endpoint and exposes selection diagnostics', async () => {
  let requested = '';
  const result = await fetchCustomProvider({ config: { provider: 'follow_builders_x', endpoint: 'http://127.0.0.1/private', selectedHandles: ['unselected'] } } as unknown as SourceConfig, {
    now: () => now,
    fetchImpl: (async (url, init) => {
      requested = String(url);
      assert.equal(init?.redirect, 'error');
      return new Response(JSON.stringify(feed()));
    }) as typeof fetch,
  });
  assert.equal(requested, FOLLOW_BUILDERS_X_URL);
  assert.equal(result?.items.length, 1);
  assert.equal(result?.sourceConfigPatch?.lastProviderOutcome, 'fresh');
});

test('network, malformed and oversized responses fail visibly without cached content', async () => {
  for (const response of [new Response('', { status: 503 }), new Response('invalid JSON'), new Response(' '.repeat(1024 * 1024 + 1))]) {
    const result = await fetchFollowBuildersX({ now: () => now, fetchImpl: (async () => response) as typeof fetch });
    assert.equal(result.outcomeHint, 'error');
    assert.equal(result.items.length, 0);
    assert.ok(result.error);
  }
  const failed = await fetchFollowBuildersX({ fetchImpl: (async () => { throw new Error('network unavailable'); }) as typeof fetch });
  assert.equal(failed.error, 'network unavailable');
});
