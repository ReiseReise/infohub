import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildItemTranslationProgress,
  normalizeItemTranslationProgress,
  resolveItemTranslationJobProgress,
} from './item-translation-progress.js';

test('builds user-facing full translation progress checkpoints', () => {
  const progress = buildItemTranslationProgress('translating', {
    message: '正在分块翻译全文。',
    detail: { itemId: 'item_1', chunkCount: 5 },
  });

  assert.equal(progress.stage, 'translating');
  assert.equal(progress.label, '翻译全文');
  assert.equal(progress.percent, 62);
  assert.equal(progress.message, '正在分块翻译全文。');
  assert.deepEqual(progress.detail, { itemId: 'item_1', chunkCount: 5 });
  assert.ok(progress.updatedAt);
});

test('normalizes unknown full translation progress safely', () => {
  const progress = normalizeItemTranslationProgress({ stage: 'unknown', percent: 999 });

  assert.equal(progress.stage, 'queued');
  assert.equal(progress.label, '任务已创建');
  assert.equal(progress.percent, 5);
});

test('terminal job state overrides stale in-flight translation progress', () => {
  const completed = resolveItemTranslationJobProgress('completed', {
    stage: 'translating',
    percent: 62,
    message: '正在分块翻译全文。',
  }, {
    result: { translated: 1 },
  });

  assert.equal(completed.stage, 'completed');
  assert.equal(completed.percent, 100);
  assert.equal(completed.message, '全文翻译已完成。');
  assert.deepEqual(completed.detail, { translated: 1 });

  const failed = resolveItemTranslationJobProgress('failed', {
    stage: 'translating',
    percent: 62,
  }, {
    failedReason: '模型超时',
  });
  assert.equal(failed.stage, 'failed');
  assert.equal(failed.percent, 100);
  assert.equal(failed.message, '模型超时');

  const stalled = resolveItemTranslationJobProgress('failed', null, {
    failedReason: 'job stalled more than allowable limit',
  });
  assert.equal(stalled.message, '翻译服务暂时不可用，任务未完成。请稍后重试，或检查翻译模型配置。');
});
