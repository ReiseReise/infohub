import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReferenceDailyComparisonObservation,
  extractLocalFeedItemIds,
} from './capture-reference-daily-comparison.mjs';

test('extracts unique local feed links without treating external links as traceable items', () => {
  const markdown = [
    '[Alpha](/feed/11111111-1111-4111-8111-111111111111)',
    '[Alpha duplicate](/feed/11111111-1111-4111-8111-111111111111?from=daily)',
    '[External](https://example.com/feed/not-local)',
    '[Beta](/feed/22222222-2222-4222-8222-222222222222)',
  ].join('\n');
  assert.deepEqual(extractLocalFeedItemIds(markdown), [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ]);
});

test('records baseline shadow metrics and requires every local report link to resolve', () => {
  const firstId = '11111111-1111-4111-8111-111111111111';
  const secondId = '22222222-2222-4222-8222-222222222222';
  const observation = buildReferenceDailyComparisonObservation({
    catalogPayload: {
      data: {
        total: 251,
        items: [
          { integrationStatus: 'shadow' },
          { integrationStatus: 'shadow' },
        ],
      },
    },
    runReportPayload: {
      data: {
        date: '2026-07-21',
        qualityStatus: 'degraded',
        publicationStatus: 'draft',
        itemCount: 37,
      },
    },
    candidatePreviewPayload: {
      data: {
        date: '2026-07-21',
        funnel: {
          reviewCandidates: 13,
          fallbackScoredCandidates: 31,
          latestFallbackCandidates: 2,
          finalCandidates: 13,
        },
        coverageDiagnostics: { hotNotSelected: 9 },
        candidates: Array.from({ length: 13 }, (_, index) => ({
          id: `candidate-${index}`,
          sourceName: `Source ${index % 9}`,
          selectionMode: 'review',
        })),
      },
    },
    publishedReportPayload: {
      data: {
        date: '2026-07-20',
        qualityStatus: 'full',
        publicationStatus: 'published',
        publishable: true,
        itemCount: 19,
        markdown: `[Alpha](/feed/${firstId})\n[Beta](/feed/${secondId})`,
        priorityArticles: [{ id: firstId }],
        moduleSections: [{ key: 'models' }],
        eventMetrics: {
          independentEventCount: 21,
          multiSourceEventCount: 1,
          firstPartyEventShare: 0.25,
          aihotLocalMissCount: 3,
        },
      },
    },
    linkChecks: [
      { id: firstId, ok: true },
      { id: secondId, ok: true },
    ],
    capturedAt: '2026-07-21T02:00:00.000Z',
  });

  assert.equal(observation.phase, 'baseline_shadow');
  assert.equal(observation.status, 'observing');
  assert.equal(observation.sources.formalReferenceCount, 0);
  assert.equal(observation.sources.shadowReferenceCount, 2);
  assert.equal(observation.currentRun.publicationStatus, 'draft');
  assert.equal(observation.liveCandidatePreview.finalCandidates, 13);
  assert.equal(observation.liveCandidatePreview.candidateSourceCount, 9);
  assert.deepEqual(observation.liveCandidatePreview.selectionModes, ['review']);
  assert.equal(observation.latestPublished.publicationStatus, 'published');
  assert.equal(observation.traceability.traceabilityRate, 1);
  assert.equal(observation.comparison.multiSourceEventCount, 1);
});

test('keeps the snapshot in review when a published report link is missing', () => {
  const itemId = '11111111-1111-4111-8111-111111111111';
  const observation = buildReferenceDailyComparisonObservation({
    catalogPayload: { data: { items: [{ integrationStatus: 'active' }] } },
    runReportPayload: { data: { date: '2026-07-21' } },
    publishedReportPayload: {
      data: {
        date: '2026-07-21',
        qualityStatus: 'full',
        publicationStatus: 'published',
        markdown: `[Missing](/feed/${itemId})`,
      },
    },
    linkChecks: [{ id: itemId, ok: false, status: 404 }],
  });

  assert.equal(observation.phase, 'post_activation');
  assert.equal(observation.status, 'review');
  assert.deepEqual(observation.traceability.missingIds, [itemId]);
});
