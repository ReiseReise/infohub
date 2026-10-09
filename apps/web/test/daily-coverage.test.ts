import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverageMarkdown, shiftDateKey } from '../src/features/daily/coverage.tsx';

test('daily coverage helpers preserve date navigation after component extraction', () => {
  assert.equal(shiftDateKey('2026-07-21', -1), '2026-07-20');
  assert.equal(shiftDateKey('2026-07-21', 1), '2026-07-22');
  assert.equal(shiftDateKey('invalid', 1), 'invalid');
});

test('daily coverage markdown keeps reader-facing group labels', () => {
  const markdown = buildCoverageMarkdown([
    {
      id: 'item-1',
      title: '重点文章',
      url: '/feed/item-1',
      sourceName: '测试来源',
      category: 'AI',
      status: 'selected',
      statusLabel: '已精选',
      digest: '这是一条可读摘要。',
      reason: '能支撑今日主线。',
      action: '建议精读。',
      score: 88,
      translationStatus: 'ready',
      translationStatusLabel: '已中文化',
    },
  ], {
    total: 1,
    selected: 1,
    review: 0,
    latestFallback: 0,
    excluded: 0,
    missingDigest: 0,
  });

  assert.match(markdown, /### 已精选/);
  assert.match(markdown, /\[重点文章\]\(\/feed\/item-1\)/);
  assert.doesNotMatch(markdown, /uncategorized|达到精选分/);
});
