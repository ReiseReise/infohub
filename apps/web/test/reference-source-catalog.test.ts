import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReferenceSourceCatalogItem } from '../src/lib/api/contracts.ts';
import {
  referenceChannelLabel,
  referenceIntegrationState,
  referenceSourceState,
  toggleReferenceSourceSelection,
} from '../src/lib/reference-source-catalog.ts';

const item = (overrides: Partial<ReferenceSourceCatalogItem> = {}): ReferenceSourceCatalogItem => ({
  key: 'qmreader:simonwillison',
  name: "Simon Willison's Weblog",
  provider: 'qmreader',
  providerLabel: 'QMReader',
  providerSourceId: 'simonwillison',
  channel: 'blog',
  feedUrl: 'https://simonwillison.net/atom/everything/',
  feedCandidates: ['https://simonwillison.net/atom/everything/'],
  siteUrl: 'https://simonwillison.net/',
  category: 'AI',
  sourceKind: 'blog',
  sourceTier: 'A',
  readingTier: 'high_value',
  recommended: false,
  defaultEnabled: false,
  importMode: 'rss',
  providerEnabled: true,
  providerStatus: 'healthy',
  observationStatus: 'current',
  firstObservedAt: '2026-07-20T00:00:00.000Z',
  lastObservedAt: '2026-07-20T00:00:00.000Z',
  description: '',
  notes: '',
  provenance: { sourceUrl: 'https://example.com', observedAt: '2026-07-20T00:00:00.000Z' },
  alreadyAdded: false,
  existingSourceId: null,
  canImport: true,
  importReason: '可以选择导入',
  ...overrides,
});

test('reference catalog labels channel and import state in user language', () => {
  assert.equal(referenceChannelLabel('podcast'), '播客');
  assert.deepEqual(referenceSourceState(item()), { label: '可选择', tone: 'ready' });
  assert.deepEqual(referenceSourceState(item({ canImport: false, importMode: 'adapter_required' })), {
    label: '待适配',
    tone: 'adapter',
  });
});

test('reference selection never exceeds the catalog limit', () => {
  const full = ['a', 'b', 'c', 'd', 'e'];
  const blocked = toggleReferenceSourceSelection(full, item(), 5);
  assert.deepEqual(blocked.selected, full);
  assert.match(blocked.error || '', /最多选择 5/);

  const removed = toggleReferenceSourceSelection(full, item({ key: 'c' }), 5);
  assert.deepEqual(removed.selected, ['a', 'b', 'd', 'e']);
});

test('reference-only entries cannot be selected', () => {
  const result = toggleReferenceSourceSelection([], item({ canImport: false, importMode: 'reference_only' }), 5);
  assert.deepEqual(result.selected, []);
  assert.match(result.error || '', /不能直接导入/);
});

test('reference lifecycle states use explicit user language', () => {
  assert.deepEqual(referenceIntegrationState('available'), { label: '仅记录', tone: 'available' });
  assert.deepEqual(referenceIntegrationState('shadow'), { label: '影子观察', tone: 'shadow' });
  assert.deepEqual(referenceIntegrationState('active'), { label: '正式采纳', tone: 'active' });
  assert.deepEqual(referenceIntegrationState('paused'), { label: '已暂停', tone: 'paused' });
  assert.deepEqual(referenceIntegrationState('removed'), { label: '已移出', tone: 'removed' });
});
