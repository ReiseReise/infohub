import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveRuleRoutingState } from './item-routing.js';

test('routes hard-filtered ready items into the filtered bucket', () => {
  const result = resolveRuleRoutingState({
    passed: false,
    reason: 'ai score too low: 50 < 70',
    contentStatus: 'ready',
    aiScore: 50,
  });

  assert.equal(result.isFiltered, true);
  assert.equal(result.filterBucket, 'filtered');
  assert.equal(result.qualityDecision, 'filter');
  assert.equal(result.priorityScoreMode, 'clear');
  assert.equal(result.filterReason, 'ai score too low: 50 < 70');
});

test('keeps incomplete filtered hits in main as review items', () => {
  const result = resolveRuleRoutingState({
    passed: false,
    reason: '命中关键词过滤',
    contentStatus: 'pending',
    aiScore: 72,
  });

  assert.equal(result.isFiltered, false);
  assert.equal(result.filterBucket, 'main');
  assert.equal(result.qualityDecision, 'review');
  assert.equal(result.priorityScoreMode, 'provisional');
  assert.match(result.filterReason || '', /待复核/);
});

test('routes passed items back to the main bucket', () => {
  const result = resolveRuleRoutingState({
    passed: true,
    reason: null,
    contentStatus: 'ready',
    aiScore: 81,
  });

  assert.equal(result.isFiltered, false);
  assert.equal(result.filterBucket, 'main');
  assert.equal(result.qualityDecision, 'pass');
  assert.equal(result.priorityScoreMode, 'calculated');
  assert.equal(result.filterReason, null);
});
