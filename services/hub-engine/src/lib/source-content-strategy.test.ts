import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveSourceContentStrategy,
  normalizeSourceContentStrategy,
  sourceContentStrategyLabel,
} from './source-content-strategy.js';

test('normalizes supported source content strategies', () => {
  assert.equal(normalizeSourceContentStrategy('full'), 'full');
  assert.equal(normalizeSourceContentStrategy('feed_only'), 'feed_only');
  assert.equal(normalizeSourceContentStrategy('monitor_only'), 'monitor_only');
  assert.equal(normalizeSourceContentStrategy('  smart  '), 'smart');
  assert.equal(normalizeSourceContentStrategy('unknown'), null);
});

test('derives monitor-only for webpage monitors and monitor profiles', () => {
  assert.equal(deriveSourceContentStrategy({
    collectorType: 'webpage',
    processingProfile: 'monitor',
  }), 'monitor_only');

  assert.equal(deriveSourceContentStrategy({
    collectorType: 'changedetection',
    sourceRole: 'monitor',
    processingProfile: 'smart',
  }), 'monitor_only');
});

test('derives smart for webpage index sources by default', () => {
  assert.equal(deriveSourceContentStrategy({
    collectorType: 'webpage_index',
    processingProfile: 'smart',
  }), 'smart');
});

test('derives smart for default rss reading sources', () => {
  assert.equal(deriveSourceContentStrategy({
    collectorType: 'rss',
    processingProfile: 'brief',
    sourceType: 'rss',
  }), 'smart');
});

test('derives full for full-processing sources unless explicitly overridden', () => {
  assert.equal(deriveSourceContentStrategy({
    collectorType: 'rss',
    processingProfile: 'full',
  }), 'full');

  assert.equal(deriveSourceContentStrategy({
    collectorType: 'rss',
    processingProfile: 'full',
    contentStrategy: 'feed_only',
  }), 'feed_only');
});

test('labels source content strategy in user language', () => {
  assert.equal(sourceContentStrategyLabel('feed_only'), '仅信任订阅正文');
  assert.equal(sourceContentStrategyLabel('smart'), '智能补全文');
  assert.equal(sourceContentStrategyLabel('full'), '优先补全原文');
  assert.equal(sourceContentStrategyLabel('monitor_only'), '仅监控不补正文');
});
