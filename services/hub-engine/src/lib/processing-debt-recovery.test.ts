import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectProcessingDebtRecoveryCandidates,
  shouldBypassQualityGateForDebtRecovery,
  type ProcessingDebtCandidate,
} from './processing-debt-recovery.js';

const now = new Date('2026-07-30T08:00:00.000Z');

function candidate(
  id: string,
  sourceId: number,
  fetchedAt: string,
  overrides: Partial<ProcessingDebtCandidate> = {},
): ProcessingDebtCandidate {
  return {
    id,
    sourceId,
    processingStatus: 'raw',
    fetchedAt,
    sourceName: `source-${sourceId}`,
    sourceStatus: 'active',
    sourceRole: 'normal',
    sourceTier: 'B',
    sourceAutoFetchEnabled: true,
    sourceConfig: { readingTier: 'light_reading', integrationStatus: 'active' },
    ...overrides,
  };
}

test('selects the oldest formal debt with a per-source fairness cap', () => {
  const selected = selectProcessingDebtRecoveryCandidates([
    candidate('source-1-newer', 1, '2026-07-30T05:00:00.000Z'),
    candidate('source-1-oldest', 1, '2026-07-30T01:00:00.000Z'),
    candidate('source-2-oldest', 2, '2026-07-30T02:00:00.000Z'),
    candidate('source-3-oldest', 3, '2026-07-30T03:00:00.000Z'),
  ], { now, minAgeMs: 30 * 60 * 1000, limit: 3, maxPerSource: 1 });

  assert.deepEqual(selected.map((item) => item.id), [
    'source-1-oldest',
    'source-2-oldest',
    'source-3-oldest',
  ]);
});

test('excludes radar, shadow, paused, fresh and non-debt candidates', () => {
  const selected = selectProcessingDebtRecoveryCandidates([
    candidate('radar', 1, '2026-07-30T01:00:00.000Z', { sourceRole: 'radar' }),
    candidate('shadow', 2, '2026-07-30T01:00:00.000Z', {
      sourceRole: 'reference',
      sourceConfig: { readingTier: 'high_value', integrationStatus: 'shadow' },
    }),
    candidate('paused', 3, '2026-07-30T01:00:00.000Z', {
      sourceConfig: { readingTier: 'paused', integrationStatus: 'active' },
    }),
    candidate('fresh', 4, '2026-07-30T07:45:00.000Z'),
    candidate('done', 5, '2026-07-30T01:00:00.000Z', { processingStatus: 'done' }),
    candidate('formal', 6, '2026-07-30T01:00:00.000Z'),
  ], { now, minAgeMs: 30 * 60 * 1000, limit: 10 });

  assert.deepEqual(selected.map((item) => item.id), ['formal']);
});

test('can recover one pending stage per source without exceeding the global limit', () => {
  const selected = selectProcessingDebtRecoveryCandidates([
    candidate('raw', 1, '2026-07-30T01:00:00.000Z'),
    candidate('summary', 2, '2026-07-30T02:00:00.000Z', { processingStatus: 'summary_failed' }),
    candidate('translation', 3, '2026-07-30T03:00:00.000Z', { processingStatus: 'translation_failed' }),
  ], { now, minAgeMs: 0, limit: 2 });

  assert.deepEqual(selected.map((item) => item.id), ['raw', 'summary']);
});

test('recovers a bounded burst when debt is concentrated in one formal source', () => {
  const selected = selectProcessingDebtRecoveryCandidates([
    candidate('oldest', 1, '2026-07-30T01:00:00.000Z'),
    candidate('second', 1, '2026-07-30T02:00:00.000Z'),
    candidate('third', 1, '2026-07-30T03:00:00.000Z'),
    candidate('fourth', 1, '2026-07-30T04:00:00.000Z'),
  ], { now, minAgeMs: 0, limit: 5, maxPerSource: 3 });

  assert.deepEqual(selected.map((item) => item.id), ['oldest', 'second', 'third']);
});

test('bypasses an unavailable quality gate but preserves a real quality gate', () => {
  assert.equal(shouldBypassQualityGateForDebtRecovery(false), true);
  assert.equal(shouldBypassQualityGateForDebtRecovery(true), false);
});

test('does not spend the recovery lane on stale historical debt', () => {
  const selected = selectProcessingDebtRecoveryCandidates([
    candidate('historical', 1, '2026-07-20T01:00:00.000Z'),
    candidate('current', 2, '2026-07-30T01:00:00.000Z'),
  ], { now, minAgeMs: 0, lookbackMs: 72 * 60 * 60 * 1000, limit: 10 });

  assert.deepEqual(selected.map((item) => item.id), ['current']);
});
