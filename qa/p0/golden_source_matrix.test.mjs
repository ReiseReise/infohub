import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSourceRow, GOLDEN_SOURCE_SPECS, renderMarkdown } from './golden_source_matrix.mjs';

test('keeps the golden source matrix fixed at twenty source roles', () => {
  assert.equal(GOLDEN_SOURCE_SPECS.length, 20);
  assert.equal(new Set(GOLDEN_SOURCE_SPECS.map((spec) => spec.key)).size, 20);
});

test('reports source health and content coverage without inventing missing sources', () => {
  const healthy = buildSourceRow(GOLDEN_SOURCE_SPECS[0], {
    id: 1,
    name: 'OpenAI News',
    sourceTier: 'A',
    readingTier: 'high_value',
    healthStatus: 'healthy',
  }, [
    { title: 'A', fullTextReady: true, translationStatus: 'ready' },
    { title: 'B', fullTextReady: true, translationStatus: 'pending' },
  ], 2);
  const missing = buildSourceRow(GOLDEN_SOURCE_SPECS[1], null);
  assert.equal(healthy.status, 'pass');
  assert.equal(healthy.fullText, 2);
  assert.equal(missing.status, 'missing');
  assert.match(renderMarkdown([healthy, missing], '2026-07-11T00:00:00.000Z'), /通过 1；需复核 0；缺失 1/);
});
