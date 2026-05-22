import test from 'node:test';
import assert from 'node:assert/strict';

import { isFetchJobInFlight, shouldRemoveExistingFetchJob } from './fetch-dedupe.js';

test('keeps in-flight fetch jobs deduped', () => {
  for (const state of ['waiting', 'active', 'delayed', 'prioritized']) {
    assert.equal(isFetchJobInFlight(state), true, state);
    assert.equal(shouldRemoveExistingFetchJob(state), false, state);
  }
});

test('removes terminal fetch jobs before re-enqueueing cron work', () => {
  for (const state of ['completed', 'failed', 'unknown']) {
    assert.equal(isFetchJobInFlight(state), false, state);
    assert.equal(shouldRemoveExistingFetchJob(state), true, state);
  }
});
