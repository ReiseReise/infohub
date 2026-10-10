import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDailyCatchUpDateKeys,
  buildDailyReportJobId,
  getNextDailyScheduleAt,
  resolveDailyRecoveryCheck,
  resolveDailyGenerationPublicStatus,
  shouldReuseExistingDailyReport,
} from '../lib/daily-report-schedule-policy.js';

test('builds stable daily report job ids across manual and scheduled callers', () => {
  assert.equal(
    buildDailyReportJobId('user id', '2026-07-11', 'full', 'full', 1363),
    'daily_report_user_id_2026-07-11_full_full_1363',
  );
});

test('builds oldest-first catch-up dates including today after the scheduled hour', () => {
  const dates = buildDailyCatchUpDateKeys(new Date('2026-07-11T02:30:00.000Z'), 3, 6);
  assert.deepEqual(dates, ['2026-07-09', '2026-07-10', '2026-07-11']);
});

test('uses yesterday as the latest eligible report before the scheduled hour', () => {
  const dates = buildDailyCatchUpDateKeys(new Date('2026-07-10T20:30:00.000Z'), 2, 6);
  assert.deepEqual(dates, ['2026-07-09', '2026-07-10']);
});

test('runs the daily recovery check once per interval while keeping the eligible report date', () => {
  const beforeSchedule = resolveDailyRecoveryCheck(
    null,
    new Date('2026-07-10T21:30:00.000Z'),
    6,
  );
  assert.equal(beforeSchedule.dateKey, '2026-07-10');
  assert.equal(beforeSchedule.shouldRun, true);

  const sameInterval = resolveDailyRecoveryCheck(
    beforeSchedule.checkKey,
    new Date('2026-07-10T21:39:59.000Z'),
    6,
  );
  assert.equal(sameInterval.dateKey, '2026-07-10');
  assert.equal(sameInterval.checkKey, beforeSchedule.checkKey);
  assert.equal(sameInterval.shouldRun, false);

  const nextInterval = resolveDailyRecoveryCheck(
    beforeSchedule.checkKey,
    new Date('2026-07-10T21:45:00.000Z'),
    6,
  );
  assert.equal(nextInterval.dateKey, '2026-07-10');
  assert.notEqual(nextInterval.checkKey, beforeSchedule.checkKey);
  assert.equal(nextInterval.shouldRun, true);
});

test('computes the next local six o clock schedule', () => {
  assert.equal(
    getNextDailyScheduleAt(new Date('2026-07-10T20:30:00.000Z'), 6).toISOString(),
    '2026-07-10T22:00:00.000Z',
  );
  assert.equal(
    getNextDailyScheduleAt(new Date('2026-07-11T00:00:00.000Z'), 6).toISOString(),
    '2026-07-11T22:00:00.000Z',
  );
});

test('maps queue and quality results to user-facing generation states', () => {
  assert.equal(resolveDailyGenerationPublicStatus('waiting'), 'scheduled');
  assert.equal(resolveDailyGenerationPublicStatus('active'), 'running');
  assert.equal(resolveDailyGenerationPublicStatus('completed', { qualityStatus: 'full' }), 'full');
  assert.equal(resolveDailyGenerationPublicStatus('completed', { qualityStatus: 'degraded' }), 'degraded');
  assert.equal(resolveDailyGenerationPublicStatus('failed'), 'failed');
});

test('reuses a full report but refreshes a degraded report when new material arrived', () => {
  assert.equal(shouldReuseExistingDailyReport({
    qualityStatus: 'full',
    savedItemCount: 0,
    currentItemCount: 20,
  }), true);
  assert.equal(shouldReuseExistingDailyReport({
    qualityStatus: 'degraded',
    savedItemCount: 0,
    currentItemCount: 19,
  }), false);
  assert.equal(shouldReuseExistingDailyReport({
    qualityStatus: 'degraded',
    savedItemCount: 12,
    currentItemCount: 23,
  }), false);
  assert.equal(shouldReuseExistingDailyReport({
    qualityStatus: 'degraded',
    savedItemCount: 12,
    currentItemCount: 12,
  }), true);
  assert.equal(shouldReuseExistingDailyReport({
    qualityStatus: 'degraded',
    savedItemCount: 12,
    currentItemCount: 12,
    savedReadyCount: 0,
    currentReadyCount: 8,
  }), false);
  assert.equal(shouldReuseExistingDailyReport({
    qualityStatus: 'degraded',
    savedItemCount: 12,
    currentItemCount: 12,
    savedMaterialFingerprint: 'same-state',
    currentMaterialFingerprint: 'new-state',
  }), false);
  assert.equal(shouldReuseExistingDailyReport({
    qualityStatus: 'degraded',
    savedItemCount: 12,
    currentItemCount: 12,
    savedMaterialFingerprint: 'same-state',
    currentMaterialFingerprint: 'same-state',
  }), true);
});
