import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveFetchJobTimeoutMs, resolveFetchTriggerMode } from './fetch-trigger-policy.js';

test('keeps rss manual fetch synchronous by default', () => {
  assert.equal(resolveFetchTriggerMode({ collectorType: 'rss' }), 'sync');
  assert.equal(resolveFetchTriggerMode({ collectorType: 'rsshub' }), 'sync');
});

test('queues slow webpage collectors by default', () => {
  assert.equal(resolveFetchTriggerMode({ collectorType: 'webpage' }), 'queue');
  assert.equal(resolveFetchTriggerMode({ collectorType: 'webpage_index' }), 'queue');
  assert.equal(resolveFetchTriggerMode({ collectorType: 'changedetection' }), 'queue');
});

test('allows explicit sync mode for webpage collectors with timeout guard', () => {
  assert.equal(resolveFetchTriggerMode({ collectorType: 'webpage', requestedMode: 'sync' }), 'sync');
  assert.equal(resolveFetchTriggerMode({ collectorType: 'changedetection', requestedMode: 'sync' }), 'sync');
});

test('explicit async request queues every collector', () => {
  assert.equal(resolveFetchTriggerMode({ collectorType: 'rss', requestedMode: 'async' }), 'queue');
  assert.equal(resolveFetchTriggerMode({ collectorType: 'custom', requestedMode: 'queue' }), 'queue');
});

test('sets bounded job timeouts for slow collectors', () => {
  assert.equal(resolveFetchJobTimeoutMs('webpage'), 60_000);
  assert.equal(resolveFetchJobTimeoutMs('webpage_index'), 60_000);
  assert.equal(resolveFetchJobTimeoutMs('changedetection'), 60_000);
  assert.equal(resolveFetchJobTimeoutMs('rsshub'), 45_000);
  assert.equal(resolveFetchJobTimeoutMs('rss'), 60_000);
});

test('gives full-text rss batches enough time to finish bounded article prefetch', () => {
  assert.equal(resolveFetchJobTimeoutMs('rss', {
    processingProfile: 'full',
    sourceTier: 'S',
    config: { url: 'https://openai.com/news/rss.xml' },
  }), 240_000);
  assert.equal(resolveFetchJobTimeoutMs('rss', {
    processingProfile: 'smart',
    sourceTier: 'A',
  }), 180_000);
  assert.equal(resolveFetchJobTimeoutMs('rss', {
    processingProfile: 'brief',
    sourceTier: 'B',
    config: { url: 'https://www.bestblogs.dev/feed' },
  }), 240_000);
});
