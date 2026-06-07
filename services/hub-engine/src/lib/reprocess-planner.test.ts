import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReprocessResetPatch,
  normalizeReprocessRequest,
  shouldReprocessItem,
  type ReprocessCandidate,
} from './reprocess-planner.js';

const candidate: ReprocessCandidate = {
  id: 'item-1',
  sourceId: 7,
  fetchedAt: new Date('2026-05-26T08:00:00.000Z'),
  contentStatus: 'failed',
  processingStatus: 'summary_failed',
  summaryStatus: 'failed',
  translationStatus: 'pending',
  isFiltered: false,
  filterBucket: 'main',
  qualityTags: [],
};

test('normalizes reprocess requests with conservative limits', () => {
  const request = normalizeReprocessRequest({
    stage: 'translation',
    sourceId: '7',
    limit: '500',
    date: '2026-05-26',
  });

  assert.equal(request.stage, 'translation');
  assert.equal(request.sourceId, 7);
  assert.equal(request.limit, 100);
  assert.equal(request.dateStart?.getFullYear(), 2026);
  assert.equal(request.dateStart?.getMonth(), 4);
  assert.equal(request.dateStart?.getDate(), 26);
  assert.equal((request.dateEnd?.getTime() || 0) - (request.dateStart?.getTime() || 0), 24 * 60 * 60 * 1000);
});

test('normalizes a single item reprocess request', () => {
  const request = normalizeReprocessRequest({
    stage: 'summary',
    itemId: 'item-1',
    limit: '50',
  });

  assert.equal(request.stage, 'summary');
  assert.equal(request.itemId, 'item-1');
  assert.equal(request.limit, 1);
});

test('matches candidates by source, date and failed stage', () => {
  const request = normalizeReprocessRequest({
    stage: 'summary',
    sourceId: 7,
    date: '2026-05-26',
  });

  assert.equal(shouldReprocessItem(candidate, request), true);
  assert.equal(shouldReprocessItem({ ...candidate, sourceId: 8 }, request), false);
  assert.equal(shouldReprocessItem({ ...candidate, fetchedAt: new Date(2026, 4, 25, 23, 59, 59) }, request), false);
});

test('matches a single item request even when current stage is already terminal', () => {
  const request = normalizeReprocessRequest({
    stage: 'summary',
    itemId: 'item-1',
  });

  assert.equal(shouldReprocessItem({
    ...candidate,
    contentStatus: 'ready',
    processingStatus: 'done',
    summaryStatus: 'skipped',
  }, request), true);
  assert.equal(shouldReprocessItem({
    ...candidate,
    id: 'item-2',
    contentStatus: 'ready',
    processingStatus: 'done',
    summaryStatus: 'skipped',
  }, request), false);
});

test('matches ready upstream states for summary and translation retries', () => {
  const summaryRequest = normalizeReprocessRequest({ stage: 'summary' });
  const translationRequest = normalizeReprocessRequest({ stage: 'translation' });

  assert.equal(shouldReprocessItem({
    ...candidate,
    processingStatus: 'scored',
    summaryStatus: 'pending',
  }, summaryRequest), true);
  assert.equal(shouldReprocessItem({
    ...candidate,
    processingStatus: 'summarized',
    translationStatus: 'pending',
  }, translationRequest), true);
});

test('matches content retries for short excerpt rows that were previously marked ready', () => {
  const contentRequest = normalizeReprocessRequest({ stage: 'content' });

  assert.equal(shouldReprocessItem({
    ...candidate,
    contentStatus: 'ready',
    contentLength: 117,
    snippetLength: 117,
  }, contentRequest), true);
  assert.equal(shouldReprocessItem({
    ...candidate,
    contentStatus: 'ready',
    contentLength: 900,
    snippetLength: 220,
  }, contentRequest), false);
});

test('matches summary retries when full content replaces a snippet-based summary', () => {
  const summaryRequest = normalizeReprocessRequest({ stage: 'summary' });

  assert.equal(shouldReprocessItem({
    ...candidate,
    contentStatus: 'ready',
    processingStatus: 'done',
    summaryStatus: 'ready',
    summaryBasis: 'snippet',
    aiScore: 70,
  }, summaryRequest), true);
  assert.equal(shouldReprocessItem({
    ...candidate,
    contentStatus: 'ready',
    processingStatus: 'done',
    summaryStatus: 'ready',
    summaryBasis: 'content',
    aiScore: 70,
  }, summaryRequest), false);
});

test('all-stage batch retries skip terminal strategy-skipped items', () => {
  const allRequest = normalizeReprocessRequest({ stage: 'all', sourceId: 7 });

  assert.equal(shouldReprocessItem({
    ...candidate,
    contentStatus: 'ready',
    contentLength: 1200,
    snippetLength: 180,
    aiScore: 38,
    processingStatus: 'done',
    summaryStatus: 'skipped',
    summaryBasis: null,
    translationStatus: 'skipped',
    qualityTags: [],
  }, allRequest), false);

  assert.equal(shouldReprocessItem({
    ...candidate,
    contentStatus: 'ready',
    contentLength: 1200,
    snippetLength: 180,
    processingStatus: 'raw',
    summaryStatus: 'pending',
    translationStatus: 'pending',
    qualityTags: [],
  }, allRequest), true);
});

test('builds stage-specific reset patches without unfiltering hard rule items', () => {
  const summaryPatch = buildReprocessResetPatch('summary', false);
  assert.equal(summaryPatch.processingStatus, 'scored');
  assert.equal(summaryPatch.aiSummary, null);
  assert.equal(summaryPatch.summaryStatus, 'pending');

  const allPatch = buildReprocessResetPatch('all', true);
  assert.equal(allPatch.processingStatus, 'raw');
  assert.equal(allPatch.aiScore, null);
  assert.equal(allPatch.aiSummary, null);
  assert.equal(allPatch.aiTranslation, null);
  assert.equal(Object.hasOwn(allPatch, 'isFiltered'), false);
});
