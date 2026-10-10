import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeCatalogHistory, followBuildersXSelectedEntry } from './refresh-reference-source-catalog.mjs';

test('Follow Builders aggregate remains an attributed, disabled candidate on refresh', () => {
  const candidate = followBuildersXSelectedEntry('2026-10-07T00:00:00Z');
  assert.equal(candidate.key, 'follow_builders:feed:x-selected');
  assert.equal(candidate.defaultEnabled, false);
  assert.equal(candidate.importMode, 'adapter_required');
  assert.equal(candidate.provenance.attributionRequired, true);
  assert.equal(candidate.feedUrl.endsWith('/feed-x.json'), true);
});

const currentSource = {
  key: 'qmreader:current',
  name: 'Current source',
  provider: 'qmreader',
  sourceTier: 'B',
  readingTier: 'light_reading',
  recommended: false,
  defaultEnabled: false,
  providerEnabled: true,
  providerStatus: 'ok',
  notes: '',
  provenance: { sourceUrl: 'https://example.com/current', observedAt: '2026-07-20T00:00:00.000Z' },
};

test('catalog refresh preserves candidates that disappear from the latest public snapshot', () => {
  const historicalSource = {
    ...currentSource,
    key: 'aihot:observed:cloudflare-blog',
    name: 'Cloudflare Blog',
    provider: 'aihot',
    providerStatus: 'observed',
    provenance: { sourceUrl: 'https://aihot.example/items', observedAt: '2026-07-19T00:00:00.000Z' },
  };

  const merged = mergeCatalogHistory(
    [currentSource],
    [currentSource, historicalSource],
    '2026-07-20T12:00:00.000Z',
  );

  assert.equal(merged.length, 2);
  assert.equal(merged[0].observationStatus, 'current');
  assert.equal(merged[0].lastObservedAt, '2026-07-20T12:00:00.000Z');
  assert.equal(merged[1].observationStatus, 'historical');
  assert.equal(merged[1].providerEnabled, false);
  assert.equal(merged[1].defaultEnabled, false);
  assert.match(merged[1].notes, /保留为历史候选证据/);
});

test('catalog refresh keeps manual source judgements while updating observation timestamps', () => {
  const previous = {
    ...currentSource,
    sourceTier: 'A',
    readingTier: 'high_value',
    recommended: true,
    manualNotes: '人工复核后保留',
    firstObservedAt: '2026-07-01T00:00:00.000Z',
  };

  const [merged] = mergeCatalogHistory(
    [currentSource],
    [previous],
    '2026-07-20T12:00:00.000Z',
  );

  assert.equal(merged.sourceTier, 'A');
  assert.equal(merged.readingTier, 'high_value');
  assert.equal(merged.recommended, true);
  assert.equal(merged.notes, '人工复核后保留');
  assert.equal(merged.firstObservedAt, '2026-07-01T00:00:00.000Z');
  assert.equal(merged.lastObservedAt, '2026-07-20T12:00:00.000Z');
});
