import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TIER_QUALITY_POLICIES,
  mergeQualityPolicy,
  resolveEffectiveQualityPolicy,
  resolveQualityOutcome,
} from './quality-filtering.js';

test('uses conservative defaults for tier quality policies', () => {
  assert.equal(DEFAULT_TIER_QUALITY_POLICIES.S.mode, 'skip');
  assert.equal(DEFAULT_TIER_QUALITY_POLICIES.A.onFilter, 'review');
  assert.equal(DEFAULT_TIER_QUALITY_POLICIES.B.mode, 'standard');
  assert.equal(DEFAULT_TIER_QUALITY_POLICIES.C.mode, 'strict');
  assert.equal(DEFAULT_TIER_QUALITY_POLICIES.D.onFilter, 'filter');
});

test('merges source overrides on top of tier defaults', () => {
  const merged = mergeQualityPolicy(DEFAULT_TIER_QUALITY_POLICIES.B, {
    mode: 'light',
    onFilter: 'review',
    minConfidence: 0.82,
  });

  assert.deepEqual(merged, {
    mode: 'light',
    onFilter: 'review',
    minConfidence: 0.82,
  });
});

test('downgrades A-tier filter hits into review outcomes by default', () => {
  const result = resolveQualityOutcome({
    itemId: 'item-a',
    sourceTier: 'A',
    summary: '观点有价值，但证据链不足。',
    reason: '命中半对半错风险',
    tags: ['半对半错风险'],
    riskFlags: ['证据不足'],
    decision: 'filter',
    confidence: 0.91,
    score: 41,
    policy: DEFAULT_TIER_QUALITY_POLICIES.A,
  });

  assert.equal(result.isFiltered, false);
  assert.equal(result.filterBucket, 'main');
  assert.equal(result.qualityDecision, 'review');
  assert.match(result.filterReason ?? '', /待复核/);
});

test('routes B-tier filter hits into the filtered bucket', () => {
  const result = resolveQualityOutcome({
    itemId: 'item-b',
    sourceTier: 'B',
    summary: '主要复述公开新闻，没有新增判断。',
    reason: '命中低信息密度与热点搬运',
    tags: ['低信息密度', '热点搬运'],
    riskFlags: ['疑似导流'],
    decision: 'filter',
    confidence: 0.88,
    score: 22,
    policy: DEFAULT_TIER_QUALITY_POLICIES.B,
  });

  assert.equal(result.isFiltered, true);
  assert.equal(result.filterBucket, 'filtered');
  assert.equal(result.qualityDecision, 'filter');
  assert.equal(result.filterReason, '命中低信息密度与热点搬运');
});

test('keeps low-confidence filter hits in review when the policy confidence threshold is not met', () => {
  const result = resolveQualityOutcome({
    itemId: 'item-c',
    sourceTier: 'C',
    summary: '内容偏空泛，且有明显导流。',
    reason: '命中疑似导流',
    tags: ['疑似导流'],
    riskFlags: ['营销导向'],
    decision: 'filter',
    confidence: 0.44,
    score: 33,
    policy: DEFAULT_TIER_QUALITY_POLICIES.C,
  });

  assert.equal(result.isFiltered, false);
  assert.equal(result.filterBucket, 'main');
  assert.equal(result.qualityDecision, 'review');
  assert.match(result.filterReason ?? '', /置信度不足/);
});

test('resolves effective policy from tier defaults plus source override', () => {
  const resolved = resolveEffectiveQualityPolicy({
    sourceTier: 'B',
    tierOverride: {
      minConfidence: 0.81,
    },
    sourceOverride: {
      mode: 'light',
      onFilter: 'review',
    },
  });

  assert.deepEqual(resolved, {
    mode: 'light',
    onFilter: 'review',
    minConfidence: 0.81,
  });
});
