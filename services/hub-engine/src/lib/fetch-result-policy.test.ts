import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCollectorFetchResult } from './fetch-result-policy.js';

test('treats collector errors without items as real fetch failures', () => {
  assert.equal(classifyCollectorFetchResult({
    items: [],
    error: 'Client network socket disconnected',
  }), 'error');
});

test('keeps usable fallback items as degraded success', () => {
  assert.equal(classifyCollectorFetchResult({
    items: [{ title: 'cached article' }],
    error: 'primary endpoint timed out',
  }), 'degraded_success');
});

test('treats item and empty feed responses without errors as success', () => {
  assert.equal(classifyCollectorFetchResult({ items: [] }), 'success');
  assert.equal(classifyCollectorFetchResult({ items: [{ title: 'article' }] }), 'success');
});
