import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildItemTranslationJobId,
  buildItemTranslationJobOptions,
  buildItemTranslationRevision,
  evaluateTranslationProviderReadiness,
  ITEM_TRANSLATION_PRIORITIES,
  resolveTranslationReadinessJobDisposition,
} from './item-translation-policy.js';

test('translation job identity is stable for the same content/model revision', () => {
  const data = {
    userId: 'user/one',
    itemId: 'item:one',
    revision: 'abc123',
  };
  assert.equal(
    buildItemTranslationJobId(data),
    buildItemTranslationJobId(data),
  );
  assert.match(buildItemTranslationJobId(data), /^item_translation_[a-zA-Z0-9_-]+$/);
});

test('manual translation jobs outrank automatic jobs', () => {
  assert.ok(ITEM_TRANSLATION_PRIORITIES.manual < ITEM_TRANSLATION_PRIORITIES.automatic);
  assert.deepEqual(buildItemTranslationJobOptions('manual'), { priority: 1 });
  assert.deepEqual(buildItemTranslationJobOptions('automatic'), { priority: 10 });
});

test('translation provider readiness accepts the bound verified LLM without provider lock-in', () => {
  const now = new Date('2026-08-20T08:00:00.000Z');
  assert.deepEqual(
    evaluateTranslationProviderReadiness({ hasBinding: false }),
    { ready: false, reason: 'missing_binding' },
  );
  assert.deepEqual(
    evaluateTranslationProviderReadiness({
      hasBinding: true,
      modelConfig: {
        modelType: 'llm',
        isActive: true,
        hasApiKey: true,
        testStatus: 'untested',
      },
      now,
    }),
    { ready: false, reason: 'connection_not_verified' },
  );
  assert.deepEqual(
    evaluateTranslationProviderReadiness({
      hasBinding: true,
      modelConfig: {
        modelType: 'llm',
        isActive: true,
        hasApiKey: true,
        testStatus: 'untested',
        testedAt: '2026-08-01T00:00:00.000Z',
        recentSuccessAt: '2026-08-20T02:10:00.000Z',
      },
      now,
    }),
    { ready: true, reason: null },
  );
  assert.deepEqual(
    evaluateTranslationProviderReadiness({
      hasBinding: true,
      modelConfig: {
        modelType: 'llm',
        isActive: true,
        hasApiKey: true,
        testStatus: 'success',
      },
      now,
    }),
    { ready: true, reason: null },
  );
});

test('translation readiness rejects missing credentials, non-LLM targets, and stale evidence', () => {
  const now = new Date('2026-08-20T08:00:00.000Z');
  assert.deepEqual(
    evaluateTranslationProviderReadiness({
      hasBinding: true,
      modelConfig: {
        modelType: 'asr',
        isActive: true,
        hasApiKey: true,
        testStatus: 'success',
      },
      now,
    }),
    { ready: false, reason: 'wrong_model_type' },
  );
  assert.deepEqual(
    evaluateTranslationProviderReadiness({
      hasBinding: true,
      modelConfig: {
        modelType: 'llm',
        isActive: true,
        hasApiKey: false,
        testStatus: 'success',
      },
      now,
    }),
    { ready: false, reason: 'missing_api_key' },
  );
  assert.deepEqual(
    evaluateTranslationProviderReadiness({
      hasBinding: true,
      modelConfig: {
        modelType: 'llm',
        isActive: true,
        hasApiKey: true,
        testStatus: 'untested',
        recentSuccessAt: '2026-08-12T07:59:59.000Z',
      },
      now,
    }),
    { ready: false, reason: 'connection_not_verified' },
  );
});

test('a configuration invalidation or failed probe requires newer runtime success evidence', () => {
  const now = new Date('2026-08-20T08:00:00.000Z');
  assert.deepEqual(
    evaluateTranslationProviderReadiness({
      hasBinding: true,
      modelConfig: {
        modelType: 'llm',
        isActive: true,
        hasApiKey: true,
        testStatus: 'failed',
        testedAt: '2026-08-20T03:00:00.000Z',
        recentSuccessAt: '2026-08-20T02:10:00.000Z',
      },
      now,
    }),
    { ready: false, reason: 'connection_not_verified' },
  );
  assert.deepEqual(
    evaluateTranslationProviderReadiness({
      hasBinding: true,
      modelConfig: {
        modelType: 'llm',
        isActive: true,
        hasApiKey: true,
        testStatus: 'failed',
        testedAt: '2026-08-20T03:00:00.000Z',
        recentSuccessAt: '2026-08-20T03:01:00.000Z',
      },
      now,
    }),
    { ready: true, reason: null },
  );
});

test('automatic readiness blocks defer while manual requests stay visibly failed', () => {
  const blocked = { ready: false, reason: 'connection_not_verified' } as const;
  assert.equal(resolveTranslationReadinessJobDisposition('automatic', blocked), 'defer');
  assert.equal(resolveTranslationReadinessJobDisposition('manual', blocked), 'fail');
  assert.equal(resolveTranslationReadinessJobDisposition('automatic', { ready: true, reason: null }), 'proceed');
});

test('translation revision changes when model connection configuration changes', () => {
  const base = {
    title: 'A title',
    content: 'Body',
    modelConfigId: 'model-one',
    model: 'ep-example',
    modelConfigUpdatedAt: '2026-08-20T01:00:00.000Z',
    promptTemplateId: 'translation-v1',
  };
  assert.equal(buildItemTranslationRevision(base), buildItemTranslationRevision(base));
  assert.notEqual(
    buildItemTranslationRevision(base),
    buildItemTranslationRevision({ ...base, modelConfigUpdatedAt: '2026-08-20T02:00:00.000Z' }),
  );
});
