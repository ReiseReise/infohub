import assert from 'node:assert/strict';
import test from 'node:test';

import { waitForQueueQuiescence } from './startup-recovery.js';

test('waits until the startup fetch queue is quiet for consecutive checks', async () => {
  const states = [
    { waiting: 2, active: 1, delayed: 0, prioritized: 0 },
    { waiting: 0, active: 1, delayed: 0, prioritized: 0 },
    { waiting: 0, active: 0, delayed: 0, prioritized: 0 },
    { waiting: 0, active: 0, delayed: 0, prioritized: 0 },
  ];
  let index = 0;
  let now = 0;
  const result = await waitForQueueQuiescence({
    queue: {
      getJobCounts: async () => states[Math.min(index++, states.length - 1)],
    },
    timeoutMs: 100,
    pollIntervalMs: 5,
    stableChecks: 2,
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
  });

  assert.equal(result.settled, true);
  assert.equal(result.checks, 4);
  assert.equal(result.pending, 0);
});

test('returns a timeout result instead of blocking startup recovery forever', async () => {
  let now = 0;
  const result = await waitForQueueQuiescence({
    queue: {
      getJobCounts: async () => ({ waiting: 1, active: 1, delayed: 0, prioritized: 0 }),
    },
    timeoutMs: 10,
    pollIntervalMs: 5,
    stableChecks: 2,
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
  });

  assert.equal(result.settled, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.pending, 2);
});
