import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUserFetchSettings } from './fetch-settings.js';

test('defaults automatic fetch, summary, and translation to enabled', () => {
  assert.deepEqual(normalizeUserFetchSettings('user-1'), {
    userId: 'user-1',
    autoFetchEnabled: true,
    autoSummaryEnabled: true,
    autoTranslationEnabled: true,
    createdAt: undefined,
    updatedAt: undefined,
  });
});

test('preserves explicit automatic AI switches', () => {
  const normalized = normalizeUserFetchSettings('user-1', {
    userId: 'user-1',
    autoFetchEnabled: true,
    autoSummaryEnabled: false,
    autoTranslationEnabled: false,
  });

  assert.equal(normalized.autoFetchEnabled, true);
  assert.equal(normalized.autoSummaryEnabled, false);
  assert.equal(normalized.autoTranslationEnabled, false);
});
