import test from 'node:test';
import assert from 'node:assert/strict';

import { selectDailyReportItems, type TopItem } from './daily-report.js';

const visibleItems: TopItem[] = [
  {
    id: 'low-1',
    title: '低分但可见条目',
    url: 'https://example.com/low-1',
    aiScore: 32,
    aiSummary: '有内容，只是分数不高。',
    sourceName: '测试信源',
    category: '测试',
    fetchedAt: '2026-05-12T08:00:00.000Z',
  },
  {
    id: 'low-2',
    title: '未评分可见条目',
    url: 'https://example.com/low-2',
    aiScore: null,
    aiSummary: '可作为降级日报素材。',
    sourceName: '测试信源',
    category: '测试',
    fetchedAt: '2026-05-12T07:00:00.000Z',
  },
];

test('falls back to latest visible items when minScore filters out every visible item', () => {
  const result = selectDailyReportItems(visibleItems, { topN: 5, minScore: 55 });

  assert.equal(result.selectionMode, 'latest_visible');
  assert.deepEqual(result.topItems.map((item) => item.id), ['low-1', 'low-2']);
  assert.equal(result.eligibleItems, 2);
});

test('returns empty selection only when there are no visible items', () => {
  const result = selectDailyReportItems([], { topN: 5, minScore: 55 });

  assert.equal(result.selectionMode, 'empty');
  assert.deepEqual(result.topItems, []);
  assert.equal(result.eligibleItems, 0);
});
