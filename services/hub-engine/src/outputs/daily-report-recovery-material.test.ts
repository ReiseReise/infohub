import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDailyReportRecoveryContext } from './daily-report-recovery-material.js';

test('builds a stable recovery fingerprint independent of row order', () => {
  const rows = [
    {
      id: 'raw-item',
      fetchedAt: '2026-07-30T01:00:00.000Z',
      processingStatus: 'raw',
      summaryStatus: 'pending',
      filterBucket: 'main',
      isFiltered: false,
    },
    {
      id: 'ready-item',
      fetchedAt: '2026-07-30T02:00:00.000Z',
      processingStatus: 'summarized',
      summaryStatus: 'completed',
      aiScore: 82,
      aiSummary: '可用摘要',
      filterBucket: 'main',
      isFiltered: false,
    },
  ];
  const first = buildDailyReportRecoveryContext(rows, new Date('2026-07-30T03:00:00.000Z'));
  const second = buildDailyReportRecoveryContext([...rows].reverse(), new Date('2026-07-30T04:00:00.000Z'));

  assert.equal(first.materialFingerprint, second.materialFingerprint);
  assert.equal(first.itemCount, 2);
  assert.equal(first.mainVisibleCount, 2);
  assert.equal(first.readyCount, 1);
  assert.equal(first.latestFetchedAt, '2026-07-30T02:00:00.000Z');
});

test('changes the fingerprint and readiness when an existing item finishes AI processing', () => {
  const raw = buildDailyReportRecoveryContext([{
    id: 'same-item',
    processingStatus: 'raw',
    summaryStatus: 'pending',
    filterBucket: 'main',
    isFiltered: false,
  }]);
  const ready = buildDailyReportRecoveryContext([{
    id: 'same-item',
    processingStatus: 'summarized',
    summaryStatus: 'completed',
    aiScore: 86,
    aiSummary: '处理完成',
    filterBucket: 'main',
    isFiltered: false,
  }]);

  assert.equal(raw.itemCount, ready.itemCount);
  assert.equal(raw.readyCount, 0);
  assert.equal(ready.readyCount, 1);
  assert.notEqual(raw.materialFingerprint, ready.materialFingerprint);
});
