import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeQualityPolicyConfigInputs,
  resolveLayeredTierPolicy,
} from './quality-policies.js';

test('merges global and user tier overrides without dropping untouched fields', () => {
  const merged = mergeQualityPolicyConfigInputs(
    { onFilter: 'filter', minConfidence: 0.63 },
    { mode: 'strict' },
  );

  assert.deepEqual(merged, {
    mode: 'strict',
    onFilter: 'filter',
    minConfidence: 0.63,
  });
});

test('resolves effective tier policy from system defaults plus layered overrides', () => {
  const resolved = resolveLayeredTierPolicy({
    sourceTier: 'B',
    globalOverride: {
      onFilter: 'review',
      minConfidence: 0.79,
    },
    userOverride: {
      mode: 'light',
    },
  });

  assert.deepEqual(resolved, {
    mode: 'light',
    onFilter: 'review',
    minConfidence: 0.79,
  });
});
