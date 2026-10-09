import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rankDueSources,
  scoreSourceSchedulingCandidate,
} from './source-scheduling-policy.js';

const NOW = new Date('2026-07-21T08:00:00.000Z');

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    priority: 3,
    sourceTier: 'B',
    processingProfile: 'brief',
    collectorType: 'rss',
    fetchInterval: 60,
    lastFetchedAt: new Date('2026-07-21T06:00:00.000Z'),
    nextFetchAt: new Date('2026-07-21T07:00:00.000Z'),
    healthScore: 100,
    errorCount: 0,
    ...overrides,
  };
}

test('source scheduling prefers a higher-priority source at equal freshness and cost', () => {
  const ranked = rankDueSources([
    candidate({ id: 1, priority: 2 }),
    candidate({ id: 2, priority: 5 }),
  ], NOW);

  assert.deepEqual(ranked.map((item) => item.id), [2, 1]);
  assert.ok(ranked[0].priorityScore > ranked[1].priorityScore);
});

test('source scheduling starvation compensation eventually rescues a low-priority source', () => {
  const ranked = rankDueSources([
    candidate({
      id: 1,
      priority: 5,
      lastFetchedAt: new Date('2026-07-21T06:45:00.000Z'),
      nextFetchAt: new Date('2026-07-21T07:45:00.000Z'),
    }),
    candidate({
      id: 2,
      priority: 1,
      lastFetchedAt: new Date('2026-07-20T08:00:00.000Z'),
      nextFetchAt: new Date('2026-07-21T07:45:00.000Z'),
    }),
  ], NOW);

  assert.equal(ranked[0].id, 2);
  assert.ok(ranked[0].starvationScore > ranked[1].starvationScore);
});

test('source scheduling accounts for fetch cost when other signals are equal', () => {
  const cheap = scoreSourceSchedulingCandidate(candidate({ id: 1 }), NOW);
  const expensive = scoreSourceSchedulingCandidate(candidate({
    id: 2,
    collectorType: 'webpage',
    processingProfile: 'full',
  }), NOW);

  assert.ok(cheap.fetchCost < expensive.fetchCost);
  assert.ok(cheap.score > expensive.score);
});

test('source scheduling gives never-fetched sources an explicit first-run boost', () => {
  const firstRun = scoreSourceSchedulingCandidate(candidate({
    id: 1,
    lastFetchedAt: null,
    nextFetchAt: null,
  }), NOW);
  const ordinary = scoreSourceSchedulingCandidate(candidate({ id: 2 }), NOW);

  assert.ok(firstRun.starvationScore > ordinary.starvationScore);
  assert.ok(firstRun.score > ordinary.score);
});

test('source scheduling uses next fetch time and id as deterministic tie breakers', () => {
  const ranked = rankDueSources([
    candidate({ id: 9, nextFetchAt: new Date('2026-07-21T07:30:00.000Z') }),
    candidate({ id: 4, nextFetchAt: new Date('2026-07-21T07:00:00.000Z') }),
    candidate({ id: 2, nextFetchAt: new Date('2026-07-21T07:00:00.000Z') }),
  ], NOW);

  assert.deepEqual(ranked.map((item) => item.id), [2, 4, 9]);
});
