import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEventClusterKey,
  selectEventClusterLead,
} from './event-clustering.js';

test('builds a stable event key from repeated AI launch wording', () => {
  assert.equal(
    buildEventClusterKey('Grok Web 正式推出 Connectors 功能，实现与日常应用深度集成'),
    buildEventClusterKey('xAI Grok Connectors 功能上线，打通 Office、GitHub 和 Notion'),
  );
});

test('keeps unrelated short commentary out of event clustering', () => {
  assert.equal(buildEventClusterKey('很多人都在说！'), null);
  assert.equal(buildEventClusterKey('OK'), null);
});

test('selects the most authoritative source as event cluster lead', () => {
  const lead = selectEventClusterLead([
    { id: 'kol', sourceTier: 'T2', sourceKind: 'x', authorityWeight: 0.9, aiScore: 82, priorityScore: 0.8, publishedAt: '2026-05-07T08:00:00Z' },
    { id: 'official-x', sourceTier: 'T1.5', sourceKind: 'x', authorityWeight: 1.08, aiScore: 75, priorityScore: 0.7, publishedAt: '2026-05-07T08:10:00Z' },
    { id: 'official-web', sourceTier: 'T1', sourceKind: 'official', authorityWeight: 1.28, aiScore: 70, priorityScore: 0.68, publishedAt: '2026-05-07T07:50:00Z' },
  ]);

  assert.equal(lead?.id, 'official-web');
});
