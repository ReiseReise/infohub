import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldRequireQualityCheckedForScoring } from './ai-scorer.js';

test('requires quality checked rows for normal scoring when quality filter is active', () => {
  assert.equal(shouldRequireQualityCheckedForScoring(new Set(['quality_filter']), {}), true);
});

test('bypasses quality checked gate for explicit fallback recovery rescoring', () => {
  assert.equal(
    shouldRequireQualityCheckedForScoring(new Set(['quality_filter']), { bypassQualityGate: true, itemIds: ['item-a'] }),
    false,
  );
  assert.equal(shouldRequireQualityCheckedForScoring(new Set(), {}), false);
});
