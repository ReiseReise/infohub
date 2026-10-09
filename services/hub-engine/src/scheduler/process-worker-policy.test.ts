import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DAILY_REPORT_WORKER_POLICY,
  FETCH_JOB_RETRY_POLICY,
  FETCH_WORKER_POLICY,
  PROCESS_WORKER_POLICY,
} from './process-worker-policy.js';

test('keeps slow source collection jobs locked through bounded fetch work', () => {
  assert.ok(FETCH_WORKER_POLICY.lockDuration >= 12 * 60 * 1000);
  assert.ok(FETCH_WORKER_POLICY.stalledInterval >= 30 * 1000);
  assert.ok(FETCH_WORKER_POLICY.maxStalledCount >= 2);
});

test('spaces fetch retries beyond short Docker DNS failure bursts', () => {
  assert.equal(FETCH_JOB_RETRY_POLICY.attempts, 3);
  assert.equal(FETCH_JOB_RETRY_POLICY.backoff.type, 'exponential');
  assert.ok(FETCH_JOB_RETRY_POLICY.backoff.delay >= 30 * 1000);
});

test('keeps multi-stage AI jobs locked across bounded model calls', () => {
  assert.equal(PROCESS_WORKER_POLICY.concurrency, 3);
  assert.ok(PROCESS_WORKER_POLICY.lockDuration >= 12 * 60 * 1000);
  assert.ok(PROCESS_WORKER_POLICY.stalledInterval >= 30 * 1000);
  assert.ok(PROCESS_WORKER_POLICY.maxStalledCount >= 2);
});

test('keeps full daily reports locked through the editorial pipeline', () => {
  assert.equal(DAILY_REPORT_WORKER_POLICY.concurrency, 1);
  assert.ok(DAILY_REPORT_WORKER_POLICY.lockDuration >= 45 * 60 * 1000);
  assert.ok(DAILY_REPORT_WORKER_POLICY.stalledInterval >= 30 * 1000);
});
