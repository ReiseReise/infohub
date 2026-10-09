import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAiOutputQualityFailure,
  isRetryableAiRuntimeFailure,
  resolveAiRuntimeCircuit,
  resolveAiTargetQualityCooldown,
  resolveAutomaticAiRoute,
} from './ai-runtime-circuit.js';

const NOW = new Date('2026-07-21T08:00:00.000Z');
const CONFIG = {
  provider: 'volcengine_ark',
  model: 'ep-summary',
  modelConfigId: 'summary-config',
};

function event(overrides: Record<string, unknown> = {}) {
  return {
    status: 'error',
    provider: CONFIG.provider,
    modelName: CONFIG.model,
    modelConfigId: CONFIG.modelConfigId,
    errorMessage: 'Audio internal LLM API error: 500',
    createdAt: new Date('2026-07-21T07:58:00.000Z'),
    ...overrides,
  };
}

test('runtime circuit stays closed below the retryable failure threshold', () => {
  const decision = resolveAiRuntimeCircuit([
    event(),
    event({ createdAt: new Date('2026-07-21T07:57:00.000Z') }),
  ], CONFIG, { now: NOW });

  assert.equal(decision.shouldBypass, false);
  assert.equal(decision.retryableFailureCount, 2);
});

test('runtime circuit opens after three recent retryable provider failures', () => {
  const decision = resolveAiRuntimeCircuit([
    event(),
    event({ createdAt: new Date('2026-07-21T07:57:00.000Z'), errorMessage: 'model_request_timeout' }),
    event({ createdAt: new Date('2026-07-21T07:56:00.000Z'), errorMessage: 'fetch failed' }),
  ], CONFIG, { now: NOW });

  assert.equal(decision.shouldBypass, true);
  assert.equal(decision.retryableFailureCount, 3);
  assert.equal(decision.openUntil, '2026-07-21T08:08:00.000Z');
  assert.equal(resolveAutomaticAiRoute({ automatic: true, circuit: decision, hasFallback: true }), 'fallback');
  assert.equal(resolveAutomaticAiRoute({ automatic: true, circuit: decision, hasFallback: false }), 'defer');
  assert.equal(resolveAutomaticAiRoute({ automatic: false, circuit: decision, hasFallback: false }), 'primary');
});

test('runtime circuit ignores quality failures and unrelated model errors', () => {
  const decision = resolveAiRuntimeCircuit([
    event({ errorMessage: 'summary_quality_incomplete:摘要过短' }),
    event({ modelConfigId: 'other-config', errorMessage: 'Audio internal LLM API error: 500' }),
    event({ provider: 'dashscope', modelName: 'qwen-flash', modelConfigId: null, errorMessage: 'timeout' }),
  ], CONFIG, { now: NOW });

  assert.equal(decision.shouldBypass, false);
  assert.equal(decision.retryableFailureCount, 0);
  assert.equal(isRetryableAiRuntimeFailure('translation_quality_incomplete'), false);
  assert.equal(isRetryableAiRuntimeFailure('provider returned 429 too many requests'), true);
});

test('automatic translation defers when both primary and independent fallback circuits are open', () => {
  const primaryCircuit = resolveAiRuntimeCircuit([
    event(),
    event({ createdAt: new Date('2026-07-21T07:57:00.000Z') }),
    event({ createdAt: new Date('2026-07-21T07:56:00.000Z') }),
  ], CONFIG, { now: NOW });
  const fallbackConfig = { provider: 'dashscope', model: 'qwen-flash', modelConfigId: 'fallback-config' };
  const fallbackCircuit = resolveAiRuntimeCircuit([
    event({ provider: fallbackConfig.provider, modelName: fallbackConfig.model, modelConfigId: fallbackConfig.modelConfigId }),
    event({ provider: fallbackConfig.provider, modelName: fallbackConfig.model, modelConfigId: fallbackConfig.modelConfigId, createdAt: new Date('2026-07-21T07:57:00.000Z') }),
    event({ provider: fallbackConfig.provider, modelName: fallbackConfig.model, modelConfigId: fallbackConfig.modelConfigId, createdAt: new Date('2026-07-21T07:56:00.000Z') }),
  ], fallbackConfig, { now: NOW });

  assert.equal(primaryCircuit.shouldBypass, true);
  assert.equal(fallbackCircuit.shouldBypass, true);
  assert.equal(resolveAutomaticAiRoute({
    automatic: true,
    circuit: primaryCircuit,
    hasFallback: !fallbackCircuit.shouldBypass,
  }), 'defer');
});

test('a newer success closes the circuit and only later failures count', () => {
  const decision = resolveAiRuntimeCircuit([
    event({ createdAt: new Date('2026-07-21T07:52:00.000Z') }),
    event({ createdAt: new Date('2026-07-21T07:53:00.000Z') }),
    event({ createdAt: new Date('2026-07-21T07:54:00.000Z') }),
    event({ status: 'success', errorMessage: null, createdAt: new Date('2026-07-21T07:55:00.000Z') }),
    event({ createdAt: new Date('2026-07-21T07:58:00.000Z') }),
  ], CONFIG, { now: NOW });

  assert.equal(decision.shouldBypass, false);
  assert.equal(decision.retryableFailureCount, 1);
});

test('cooldown expiry allows a fresh automatic probe', () => {
  const decision = resolveAiRuntimeCircuit([
    event({ createdAt: new Date('2026-07-21T07:45:00.000Z') }),
    event({ createdAt: new Date('2026-07-21T07:44:00.000Z') }),
    event({ createdAt: new Date('2026-07-21T07:43:00.000Z') }),
  ], CONFIG, { now: NOW, windowMs: 30 * 60 * 1000 });

  assert.equal(decision.shouldBypass, false);
  assert.equal(decision.retryableFailureCount, 3);
  assert.equal(decision.openUntil, '2026-07-21T07:55:00.000Z');
});

test('target quality cooldown stops repeated automatic translation for the same item and model', () => {
  const decision = resolveAiTargetQualityCooldown([
    event({
      targetId: 'item-1',
      errorMessage: '译文没有完整保留原文链接结构。',
      createdAt: new Date('2026-07-21T07:58:00.000Z'),
    }),
  ], CONFIG, 'item-1', { now: NOW });

  assert.equal(decision.shouldBypass, true);
  assert.equal(decision.retryAfter, '2026-07-22T07:58:00.000Z');
  assert.equal(isAiOutputQualityFailure('translation_quality_incomplete'), true);
});

test('target quality cooldown ignores provider failures, other items, and other model configs', () => {
  const decision = resolveAiTargetQualityCooldown([
    event({ targetId: 'item-1', errorMessage: 'provider returned 500' }),
    event({ targetId: 'item-2', errorMessage: '译文没有完整保留原文链接结构。' }),
    event({ targetId: 'item-1', modelConfigId: 'other-config', errorMessage: 'translation_quality_incomplete' }),
  ], CONFIG, 'item-1', { now: NOW });

  assert.equal(decision.shouldBypass, false);
});
