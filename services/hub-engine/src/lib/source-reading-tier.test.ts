import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSourceReadingTier, SOURCE_READING_TIER_VALUES } from './source-reading-tier.js';

test('source reading tier keeps explicit user marking before heuristics', () => {
  assert.equal(resolveSourceReadingTier({
    sourceTier: 'S',
    category: 'AI',
    config: { readingTier: 'light_reading' },
  }).value, 'light_reading');

  assert.deepEqual(SOURCE_READING_TIER_VALUES, ['high_value', 'light_reading', 'explore', 'paused']);
});

test('source reading tier separates high value from light reading and paused candidates', () => {
  assert.equal(resolveSourceReadingTier({ sourceTier: 'A', category: 'AI' }).value, 'high_value');
  assert.equal(resolveSourceReadingTier({ sourceTier: 'B', category: '浅阅读' }).value, 'light_reading');
  assert.equal(resolveSourceReadingTier({ sourceTier: 'B', tags: ['轻阅读'] }).value, 'light_reading');
  assert.equal(resolveSourceReadingTier({ sourceTier: 'D', status: 'paused' }).value, 'paused');
  assert.equal(resolveSourceReadingTier({ collectorType: 'webpage', sourceTier: 'B' }).value, 'explore');
});

test('does not treat legacy T1/T2 labels as reading tiers', () => {
  assert.equal(resolveSourceReadingTier({ sourceTier: 'T1' }).value, 'explore');
  assert.equal(resolveSourceReadingTier({ sourceTier: 'T2' }).value, 'explore');
});
