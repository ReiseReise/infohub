import test from 'node:test';
import assert from 'node:assert/strict';

test('patches feed items inside every infinite-query page', async () => {
  const { patchFeedItemInInfiniteCache } = await import('../src/lib/feed-query-cache.ts');
  const current = {
    pages: [
      { data: [{ id: 'item-1', isRead: false }, { id: 'item-2', isRead: false }], total: 3 },
      { data: [{ id: 'item-3', isRead: false }], total: 3 },
    ],
    pageParams: [0, 20],
  };

  const updated = patchFeedItemInInfiniteCache(current, 'item-2', { isRead: true }) as typeof current;

  assert.equal(updated.pages[0].data[1].isRead, true);
  assert.equal(updated.pages[0].data[0].isRead, false);
  assert.equal(updated.pages[1].data[0].isRead, false);
  assert.deepEqual(updated.pageParams, [0, 20]);
  assert.notEqual(updated, current);
});

test('leaves unrelated cache shapes unchanged', async () => {
  const { patchFeedItemInInfiniteCache } = await import('../src/lib/feed-query-cache.ts');
  const current = { data: [{ id: 'item-1', isRead: false }] };

  assert.equal(patchFeedItemInInfiniteCache(current, 'item-1', { isRead: true }), current);
  assert.equal(patchFeedItemInInfiniteCache(undefined, 'item-1', { isRead: true }), undefined);
});

test('list refresh and repeated selection preserve full reader detail and assets', async () => {
  const { selectFeedDetailForRoute } = await import('../src/lib/feed-query-cache.ts');
  const detail = { id: 'a', content: 'Full article', aiTranslation: '完整译文', readingAssets: [{ type: 'qa', content: 'Saved answer' }] };
  const listItem = { id: 'a', aiTranslation: null, readingAssets: [], content: undefined };
  assert.equal(selectFeedDetailForRoute<typeof detail | typeof listItem>(detail, 'a', [listItem]), detail);
  assert.equal(selectFeedDetailForRoute(detail, 'a', []), detail);
});

test('changing or clearing the route never leaves the previous article selected', async () => {
  const { selectFeedDetailForRoute } = await import('../src/lib/feed-query-cache.ts');
  const previous = { id: 'a' }, next = { id: 'b' };
  assert.equal(selectFeedDetailForRoute(previous, 'b', [next]), next);
  assert.equal(selectFeedDetailForRoute(previous, 'missing', [next]), null);
  assert.equal(selectFeedDetailForRoute(previous, undefined, [next]), null);
});
