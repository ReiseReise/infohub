import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyReportTranslationJob, waitForDailyReportTranslation } from './daily-report-candidate-translation-policy.js';

test('daily report candidate translation enters the shared automatic queue', () => {
  assert.deepEqual(buildDailyReportTranslationJob('user-1', 'item-1'), {
    userId: 'user-1',
    itemId: 'item-1',
    mode: 'automatic',
    trigger: 'daily_report',
  });
});

test('waits through queued and active states before reading translated candidates', async () => {
  const states = ['waiting', 'active', 'completed'];
  let clock = 0;
  const result = await waitForDailyReportTranslation({ getState: async () => states.shift()! }, {
    deadlineAt: 3000, now: () => clock, sleep: async (ms) => { clock += ms; },
  });
  assert.equal(result, 'completed');
  assert.equal(clock, 2000);
});

test('uses a shared report deadline and preserves pending instead of claiming success or failure', async () => {
  let clock = 0;
  const opts = { deadlineAt: 1500, now: () => clock, sleep: async (ms: number) => { clock += ms; } };
  assert.equal(await waitForDailyReportTranslation({ getState: async () => 'delayed' }, opts), 'pending');
  assert.equal(clock, 1500);
  assert.equal(await waitForDailyReportTranslation({ getState: async () => 'waiting' }, opts), 'pending');
  assert.equal(clock, 1500);
  assert.equal(await waitForDailyReportTranslation({ getState: async () => 'failed' }, opts), 'failed');
  assert.equal(await waitForDailyReportTranslation({ getState: async () => 'completed' }, opts), 'completed');
});
