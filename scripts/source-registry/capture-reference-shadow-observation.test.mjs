import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXPECTED_SHADOW_KEYS,
  buildReferenceShadowObservation,
} from './capture-reference-shadow-observation.mjs';

function payload(overrides = {}) {
  return {
    data: {
      total: 259,
      activeCounts: {
        total: 31,
        reference: 10,
        formalReference: 0,
        referenceShadow: 10,
        referenceFormal: 0,
        totalScheduled: 31,
      },
      items: EXPECTED_SHADOW_KEYS.map((key, index) => ({
        key,
        name: `Source ${index + 1}`,
        sourceId: 1390 + index,
        integrationStatus: 'shadow',
        quality: {
          observationDays: 1,
          eligibleForActivation: false,
          aiRelevanceRate: 1,
          aiProcessingRate: 0.8,
        },
      })),
      ...overrides,
    },
  };
}

test('shadow observation captures all expected sources without mutating lifecycle state', () => {
  const snapshot = buildReferenceShadowObservation(payload(), '2026-07-21T02:00:00.000Z');

  assert.equal(snapshot.mode, 'read_only');
  assert.equal(snapshot.status, 'observing');
  assert.equal(snapshot.summary.capturedShadowCount, EXPECTED_SHADOW_KEYS.length);
  assert.equal(snapshot.summary.referenceShadow, 10);
  assert.equal(snapshot.summary.referenceFormal, 0);
  assert.equal(snapshot.summary.totalScheduled, 31);
  assert.equal(snapshot.summary.minimumObservationDays, 1);
  assert.equal(snapshot.summary.formalActivationCount, 0);
  assert.deepEqual(snapshot.missingKeys, []);
  assert.deepEqual(snapshot.wrongStatus, []);
});

test('shadow observation enters review state when a source is missing or formally active', () => {
  const items = payload().data.items.slice(0, EXPECTED_SHADOW_KEYS.length - 1);
  items[0] = { ...items[0], integrationStatus: 'active' };
  const snapshot = buildReferenceShadowObservation(payload({ items }));

  assert.equal(snapshot.status, 'review');
  assert.equal(snapshot.missingKeys.length, 1);
  assert.deepEqual(snapshot.wrongStatus, [{
    key: EXPECTED_SHADOW_KEYS[0],
    status: 'active',
  }]);
  assert.equal(snapshot.summary.formalActivationCount, 1);
});
