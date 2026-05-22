import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEmptyDailyReportDiagnosis } from './daily-report-diagnostics.js';

test('builds an empty daily report diagnosis when new items cannot enter the report', () => {
  const diagnosis = buildEmptyDailyReportDiagnosis({
    newItems: 48,
    eligibleItems: 0,
    filteredItems: 43,
    filteredBucketItems: 5,
    reviewItems: 0,
    pendingItems: 0,
    topFilterReasons: [
      { reason: 'ai score too low: 50 < 70', count: 43 },
    ],
  });

  assert.equal(diagnosis.status, 'empty_diagnosis');
  assert.match(diagnosis.markdown, /今日新增 48 条/);
  assert.match(diagnosis.markdown, /可入报内容为 0 条/);
  assert.match(diagnosis.markdown, /ai score too low: 50 < 70/);
  assert.deepEqual(diagnosis.funnel, {
    newItems: 48,
    eligibleItems: 0,
    filteredItems: 43,
    filteredBucketItems: 5,
    reviewItems: 0,
    pendingItems: 0,
  });
});
