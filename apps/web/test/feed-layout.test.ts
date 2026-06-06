import test from 'node:test';
import assert from 'node:assert/strict';

test('places feed detail before the list on narrow screens when an item is selected', async () => {
  const mod = await import('../src/lib/feed-layout.ts').catch(() => ({}));
  const resolveFeedDetailOrderClassName = (mod as {
    resolveFeedDetailOrderClassName?: (hasSelectedItem: boolean) => string;
  }).resolveFeedDetailOrderClassName;

  assert.equal(typeof resolveFeedDetailOrderClassName, 'function');
  assert.match(resolveFeedDetailOrderClassName(true), /order-first/);
  assert.match(resolveFeedDetailOrderClassName(true), /xl:order-none/);
});

test('keeps feed detail after the list on narrow screens when no item is selected', async () => {
  const { resolveFeedDetailOrderClassName } = await import('../src/lib/feed-layout.ts');

  assert.equal(resolveFeedDetailOrderClassName(false), '');
});

test('auto-scrolls selected feed detail into view on narrow screens only', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.equal(mod.shouldAutoScrollFeedDetailIntoView(true, 390), true);
  assert.equal(mod.shouldAutoScrollFeedDetailIntoView(true, 1279), true);
  assert.equal(mod.shouldAutoScrollFeedDetailIntoView(true, 1280), false);
  assert.equal(mod.shouldAutoScrollFeedDetailIntoView(false, 390), false);
});

test('uses a stacked feed detail header before desktop width', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.match(mod.feedDetailHeaderClassName, /flex-col/);
  assert.match(mod.feedDetailHeaderClassName, /sm:flex-row/);
});
