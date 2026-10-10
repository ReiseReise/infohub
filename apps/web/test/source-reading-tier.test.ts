import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE_READING_TIER_OPTIONS,
  resolveSourceReadingTier,
  sourceReadingTierBadge,
} from '../src/lib/source-reading-tier.ts';

test('resolves source reading tier as a consumption layer, not a topic category', () => {
  assert.equal(resolveSourceReadingTier({
    sourceTier: 'S',
    category: 'AI',
    config: { readingTier: 'light_reading' },
  }).value, 'light_reading');

  assert.equal(resolveSourceReadingTier({ sourceTier: 'A', category: 'AI' }).value, 'high_value');
  assert.equal(resolveSourceReadingTier({ sourceTier: 'B', category: '浅阅读' }).value, 'light_reading');
  assert.equal(resolveSourceReadingTier({ collectorType: 'webpage_index', sourceTier: 'B' }).value, 'explore');
});

test('exposes stable user-facing labels for source cleaning filters', () => {
  assert.deepEqual(SOURCE_READING_TIER_OPTIONS.map((option) => option.label), [
    '高价值',
    '浅阅读',
    '探索池',
    '暂停候选',
  ]);

  assert.equal(sourceReadingTierBadge({ sourceTier: 'A' }).label, '高价值');
  assert.equal(sourceReadingTierBadge({ category: '轻阅读' }).label, '浅阅读');
});
