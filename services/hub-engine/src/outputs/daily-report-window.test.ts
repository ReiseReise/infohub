import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveDailyReportWindow } from './daily-report-window.js';

test('resolves a date key into one local calendar day', () => {
  const window = resolveDailyReportWindow('2026-05-26');

  assert.equal(window.dateKey, '2026-05-26');
  assert.equal(window.dayEnd.getTime() - window.dayStart.getTime(), 24 * 60 * 60 * 1000);
  assert.equal(window.dayStart.getFullYear(), 2026);
  assert.equal(window.dayStart.getMonth(), 4);
  assert.equal(window.dayStart.getDate(), 26);
});

test('keeps local date keys instead of deriving them from UTC ISO strings', () => {
  const window = resolveDailyReportWindow(new Date(2026, 4, 26, 23, 30, 0, 0));

  assert.equal(window.dateKey, '2026-05-26');
});

test('rejects invalid date keys', () => {
  assert.throws(() => resolveDailyReportWindow('2026-02-31'), /invalid_daily_report_date/);
});
