import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeExternalRadarMetadata,
  normalizeRadarArticleUrl,
  radarComparableUrl,
} from './external-radar-dedupe.js';

test('normalizes tracking-only variants without stripping meaningful article parameters', () => {
  assert.equal(
    normalizeRadarArticleUrl('https://example.com/story/?utm_source=radar&fbclid=1'),
    'https://example.com/story',
  );
  assert.equal(
    normalizeRadarArticleUrl('https://example.com/article?id=42&utm_source=radar'),
    'https://example.com/article?id=42',
  );
  assert.equal(radarComparableUrl('https://example.com/article?id=42')?.queryless, null);
});

test('merges radar evidence without replacing existing curation metadata', () => {
  const merged = mergeExternalRadarMetadata({
    existing: { briefDate: '2026-07-20', externalRadars: { another: { score: 1 } } },
    incoming: { externalId: 'aihot-1', sourceCount: 4 },
    provider: 'aihot',
    observedAt: new Date('2026-07-20T10:00:00.000Z'),
  });

  assert.equal(merged.briefDate, '2026-07-20');
  assert.deepEqual((merged.externalRadars as Record<string, unknown>).another, { score: 1 });
  assert.deepEqual((merged.externalRadars as Record<string, unknown>).aihot, { externalId: 'aihot-1', sourceCount: 4 });
  assert.equal(merged.externalRadarUpdatedAt, '2026-07-20T10:00:00.000Z');
});

