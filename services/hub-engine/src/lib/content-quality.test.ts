import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSourceQualityFunnel,
  classifySourceQualityGrade,
  type SourceQualityInput,
} from './content-quality.js';

const baseInput: SourceQualityInput = {
  itemsFound: 100,
  itemsNew: 60,
  itemsDuplicate: 40,
  itemCount: 80,
  entryCount: 60,
  filteredCount: 20,
  contentReadyCount: 48,
  contentDegradedCount: 8,
  contentMissingCount: 4,
  qualityPassCount: 42,
  qualityReviewCount: 12,
  qualityFilterCount: 6,
  scoredCount: 50,
  summarizedCount: 45,
  translationCompletedCount: 40,
  reportSelectedCount: 12,
};

test('builds a source quality funnel with stable rates and score', () => {
  const funnel = buildSourceQualityFunnel(baseInput);

  assert.equal(funnel.fetched, 100);
  assert.equal(funnel.unique, 60);
  assert.equal(funnel.contentReady, 48);
  assert.equal(funnel.qualityReview, 12);
  assert.equal(funnel.scored, 50);
  assert.equal(funnel.reportSelected, 12);
  assert.equal(funnel.duplicateRate, 0.4);
  assert.equal(funnel.contentReadyRate, 0.8);
  assert.equal(funnel.aiReadyRate, 0.75);
  assert.equal(funnel.noiseRate, 0.333);
  assert.equal(funnel.reportSelectedRate, 0.2);
  assert.equal(funnel.qualityScore, 68);
});

test('keeps historical duplicate counts coherent with current unique inventory', () => {
  const funnel = buildSourceQualityFunnel({
    itemsFound: 825,
    itemsNew: 0,
    itemsDuplicate: 825,
    itemCount: 11,
    entryCount: 11,
    filteredCount: 0,
    contentReadyCount: 11,
    scoredCount: 11,
    summarizedCount: 11,
    translationCompletedCount: 11,
  });

  assert.equal(funnel.fetched, 825);
  assert.equal(funnel.unique, 11);
  assert.equal(funnel.duplicate, 814);
  assert.equal(funnel.duplicateRate, 0.987);
  assert.ok(funnel.unique + funnel.duplicate <= funnel.fetched);
});

test('classifies high quality sources without over-penalizing small feeds', () => {
  const funnel = buildSourceQualityFunnel({
    ...baseInput,
    itemsFound: 4,
    itemsNew: 4,
    itemsDuplicate: 0,
    itemCount: 4,
    entryCount: 4,
    filteredCount: 0,
    contentReadyCount: 4,
    contentDegradedCount: 0,
    contentMissingCount: 0,
    qualityPassCount: 4,
    qualityReviewCount: 0,
    qualityFilterCount: 0,
    scoredCount: 4,
    summarizedCount: 4,
    translationCompletedCount: 4,
    reportSelectedCount: 2,
  });

  assert.equal(funnel.qualityScore, 100);
  assert.equal(classifySourceQualityGrade(funnel), 'excellent');
});

test('classifies noisy sources that fetch but rarely produce readable content', () => {
  const funnel = buildSourceQualityFunnel({
    ...baseInput,
    itemsFound: 50,
    itemsNew: 10,
    itemsDuplicate: 40,
    itemCount: 10,
    entryCount: 2,
    filteredCount: 8,
    contentReadyCount: 1,
    contentDegradedCount: 1,
    contentMissingCount: 8,
    qualityPassCount: 1,
    qualityReviewCount: 1,
    qualityFilterCount: 8,
    scoredCount: 1,
    summarizedCount: 0,
    translationCompletedCount: 0,
    reportSelectedCount: 0,
  });

  assert.equal(funnel.qualityScore, 11);
  assert.equal(funnel.noiseRate, 0.9);
  assert.equal(classifySourceQualityGrade(funnel), 'poor');
});
