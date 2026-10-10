import assert from 'node:assert/strict';
import test from 'node:test';

import {
  eventCollapseFeatureEnabled,
  resolveEventCollapsePreference,
} from './event-collapse-policy.js';

test('event collapse stays enabled by default and accepts explicit disable values', () => {
  assert.equal(eventCollapseFeatureEnabled({}), true);
  assert.equal(eventCollapseFeatureEnabled({ INFOHUB_EVENT_COLLAPSE_ENABLED: 'true' }), true);
  assert.equal(eventCollapseFeatureEnabled({ INFOHUB_EVENT_COLLAPSE_ENABLED: 'false' }), false);
  assert.equal(eventCollapseFeatureEnabled({ INFOHUB_EVENT_COLLAPSE_ENABLED: '0' }), false);
  assert.equal(eventCollapseFeatureEnabled({ INFOHUB_EVENT_COLLAPSE_ENABLED: 'off' }), false);
});

test('disabled feature flag overrides recommended defaults and explicit requests', () => {
  assert.equal(resolveEventCollapsePreference({ enabled: false, view: 'recommended' }), false);
  assert.equal(resolveEventCollapsePreference({ enabled: false, requested: 'true', view: 'recommended' }), false);
});

test('enabled feature flag preserves explicit requests and recommended default', () => {
  assert.equal(resolveEventCollapsePreference({ enabled: true, view: 'recommended' }), true);
  assert.equal(resolveEventCollapsePreference({ enabled: true, view: 'latest' }), false);
  assert.equal(resolveEventCollapsePreference({ enabled: true, requested: 'false', view: 'recommended' }), 'false');
});
