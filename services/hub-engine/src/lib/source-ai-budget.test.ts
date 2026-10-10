import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SOURCE_AI_DAILY_BUDGETS,
  buildSourceAiBudgetSnapshot,
  normalizeSourceAiDailyBudget,
  resolveSourceAiDailyBudget,
  selectAutomaticSourceAiCandidates,
  type SourceAiBudgetCandidate,
  type SourceAiDailyUsageState,
} from './source-ai-budget.js';

function usage(input: { processed?: string[]; counts?: Array<[number, number]> } = {}): SourceAiDailyUsageState {
  return {
    windowStart: new Date('2026-07-11T00:00:00+08:00'),
    windowEnd: new Date('2026-07-12T00:00:00+08:00'),
    processedItemIds: new Set(input.processed || []),
    processedBySource: new Map(input.counts || []),
  };
}

function candidate(id: string, sourceId: number, sourceConfig: Record<string, unknown> = {}): SourceAiBudgetCandidate {
  return {
    id,
    sourceId,
    sourceName: `source-${sourceId}`,
    sourceTier: 'B',
    sourceStatus: 'active',
    sourceAutoFetchEnabled: true,
    sourceConfig,
  };
}

test('source AI budgets follow reading tier defaults and allow explicit override', () => {
  assert.deepEqual(SOURCE_AI_DAILY_BUDGETS, {
    high_value: 40,
    light_reading: 10,
    explore: 3,
    paused: 0,
  });
  assert.equal(resolveSourceAiDailyBudget({ sourceTier: 'S' }), 40);
  assert.equal(resolveSourceAiDailyBudget({ sourceTier: 'B' }), 10);
  assert.equal(resolveSourceAiDailyBudget({ sourceTier: 'D' }), 3);
  assert.equal(resolveSourceAiDailyBudget({ sourceStatus: 'paused', sourceTier: 'S' }), 0);
  assert.equal(resolveSourceAiDailyBudget({ sourceTier: 'D', sourceConfig: { aiDailyBudget: 27 } }), 27);
  assert.equal(normalizeSourceAiDailyBudget(0), 0);
  assert.equal(normalizeSourceAiDailyBudget(201), null);
  assert.equal(normalizeSourceAiDailyBudget(2.5), null);
});

test('automatic selector counts each new item once and blocks sources at budget', () => {
  const candidates = [
    candidate('light-existing', 1, { readingTier: 'light_reading' }),
    candidate('light-new', 1, { readingTier: 'light_reading' }),
    candidate('explore-blocked', 2, { readingTier: 'explore' }),
    candidate('paused-blocked', 3, { readingTier: 'paused' }),
    candidate('high-new', 4, { readingTier: 'high_value' }),
  ];
  const selected = selectAutomaticSourceAiCandidates(candidates, usage({
    processed: ['light-existing'],
    counts: [[1, 10], [2, 3], [4, 39]],
  }), 10);

  assert.deepEqual(selected.map((entry) => entry.id), ['light-existing', 'high-new']);
});

test('automatic selector does not let duplicate rows consume multiple source slots', () => {
  const selected = selectAutomaticSourceAiCandidates([
    candidate('one', 5, { aiDailyBudget: 1 }),
    candidate('one', 5, { aiDailyBudget: 1 }),
    candidate('two', 5, { aiDailyBudget: 1 }),
  ], usage(), 10);
  assert.deepEqual(selected.map((entry) => entry.id), ['one']);
});

test('budget-exempt local work stays available after a source reaches its limit', () => {
  const exempt = { ...candidate('filtered', 6, { aiDailyBudget: 0 }), budgetExempt: true };
  assert.deepEqual(selectAutomaticSourceAiCandidates([exempt], usage(), 10).map((entry) => entry.id), ['filtered']);
});

test('budget snapshot reports configured limit, distinct usage, and remaining capacity', () => {
  const snapshot = buildSourceAiBudgetSnapshot(
    { sourceTier: 'B', sourceConfig: { readingTier: 'light_reading' } },
    usage({ counts: [[9, 7]] }),
    9,
  );
  assert.equal(snapshot.aiDailyBudget, 10);
  assert.equal(snapshot.aiProcessedToday, 7);
  assert.equal(snapshot.aiBudgetRemaining, 3);
  assert.equal(snapshot.aiBudgetWindowStart, '2026-07-10T16:00:00.000Z');
});
