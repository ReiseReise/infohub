import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldAutoUpgradeReadableContent } from './content-upgrade-policy.js';

test('auto upgrades official webpage_index items when original article url exists', () => {
  assert.equal(shouldAutoUpgradeReadableContent({
    sourceType: 'curated_index',
    collectorType: 'webpage_index',
    sourceKind: 'official',
    sourceTier: 'S',
    originalUrl: 'https://www.anthropic.com/news/fable-mythos-access',
    fetchEngine: 'webpage-index',
    renderMode: 'index',
  }), true);
});

test('auto upgrades A-tier curated items with original article url', () => {
  assert.equal(shouldAutoUpgradeReadableContent({
    sourceType: 'curated_index',
    collectorType: 'webpage_index',
    sourceKind: 'media',
    sourceTier: 'A',
    originalUrl: 'https://example.com/deep-read',
    fetchEngine: 'webpage-index',
    renderMode: 'index',
  }), true);
});

test('does not auto upgrade curated summary items without original article url', () => {
  assert.equal(shouldAutoUpgradeReadableContent({
    sourceType: 'curated_index',
    collectorType: 'webpage_index',
    sourceKind: 'media',
    sourceTier: 'A',
    originalUrl: null,
    fetchEngine: 'bestblogs-public-brief',
    renderMode: 'index-api',
  }), false);
});

test('does not auto upgrade plain rss entries', () => {
  assert.equal(shouldAutoUpgradeReadableContent({
    sourceType: 'rss',
    collectorType: 'rss',
    sourceKind: 'official',
    sourceTier: 'A',
    originalUrl: 'https://openai.com/index/nextdoor',
    fetchEngine: 'rss',
    renderMode: 'feed',
  }), false);
});

test('does not auto upgrade when source strategy is feed-only', () => {
  assert.equal(shouldAutoUpgradeReadableContent({
    sourceType: 'curated_index',
    collectorType: 'webpage_index',
    sourceKind: 'official',
    sourceTier: 'S',
    originalUrl: 'https://www.anthropic.com/news/fable-mythos-access',
    fetchEngine: 'webpage-index',
    renderMode: 'index',
    contentStrategy: 'feed_only',
  }), false);
});

test('allows full-strategy rss sources to auto upgrade article bodies', () => {
  assert.equal(shouldAutoUpgradeReadableContent({
    sourceType: 'rss',
    collectorType: 'rss',
    sourceKind: 'blog',
    sourceTier: 'B',
    url: 'https://openai.com/news/how-engineers-at-nextdoor-use-codex-to-build-without-limits',
    originalUrl: null,
    fetchEngine: 'rss',
    renderMode: 'feed',
    contentStrategy: 'full',
  }), true);
});
