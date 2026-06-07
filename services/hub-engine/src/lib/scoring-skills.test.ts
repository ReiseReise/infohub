import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDeterministicFallbackScore,
  buildScoringRetryPrompt,
  buildScoringSkillHealthSummary,
  buildScoringModelRemediation,
  buildScoringModelProbeSummary,
  buildScoringModelRepairSummary,
  buildFallbackScoringRecoverySummary,
  buildFallbackScoringPrompt,
  buildSkillPrompt,
  buildSkillFailureSummary,
  canRecoverFallbackScoringItems,
  dedupeActiveScoringSkills,
  hasFallbackScoringRiskFlags,
  isRetryableScoringFailure,
  isFallbackScoringRecoveryStatus,
  normalizeFallbackScoringRecoveryRequest,
  parseSkillResponse,
  resolveScoringModelCircuitBreaker,
  type ScoringSkillRecord,
} from './scoring-skills.js';

function skill(input: Pick<ScoringSkillRecord, 'id' | 'name' | 'presetKey' | 'updatedAt'>): ScoringSkillRecord {
  return {
    id: input.id,
    userId: '00000000-0000-0000-0000-000000000001',
    name: input.name,
    description: null,
    presetKey: input.presetKey,
    status: 'active',
    weight: 1,
    instructionPrompt: '',
    rubricJson: {},
    outputSchemaVersion: 1,
    modelConfigId: null,
    isDefault: true,
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt,
  };
}

test('rejects empty scoring skill responses instead of defaulting to 50', () => {
  assert.throws(
    () => parseSkillResponse('   '),
    /empty_scoring_skill_response/,
  );
});

test('dedupes active scoring skills by preset key and keeps latest copy', () => {
  const older = new Date('2026-05-10T00:00:00Z');
  const newer = new Date('2026-05-12T00:00:00Z');
  const result = dedupeActiveScoringSkills([
    skill({ id: 1, name: 'AI产业信号', presetKey: 'ai_industry', updatedAt: older }),
    skill({ id: 2, name: 'AI产业信号', presetKey: 'ai_industry', updatedAt: newer }),
    skill({ id: 3, name: '产品落地信号', presetKey: 'product_signal', updatedAt: older }),
  ]);

  assert.deepEqual(result.map((item) => item.id), [2, 3]);
});

test('summarizes partial scoring skill failures without hiding usable results', () => {
  assert.equal(
    buildSkillFailureSummary(['empty_scoring_skill_response', 'empty_scoring_skill_response', 'bad_json']),
    'partial_scoring_skill_failures:empty_scoring_skill_response,bad_json',
  );
});

test('builds a compact fallback scoring prompt when all skills fail', () => {
  const prompt = buildFallbackScoringPrompt({
    title: 'OpenAI releases agent update',
    content: 'OpenAI released a new agent capability for enterprise users.'.repeat(20),
  });

  assert.match(prompt, /Return JSON only/);
  assert.match(prompt, /score/);
  assert.equal(prompt.length < 1800, true);
});

test('builds scoring skill prompts with strict compact JSON output guardrails', () => {
  const prompt = buildSkillPrompt({
    skill: skill({ id: 1, name: 'AI产业信号', presetKey: 'ai_industry', updatedAt: new Date('2026-06-01T00:00:00Z') }),
    title: 'OpenAI ships a new agent runtime',
    content: 'OpenAI released a new agent runtime for enterprise workflow automation.',
  });

  assert.match(prompt, /只返回一行 JSON/);
  assert.match(prompt, /不要输出 Markdown/);
  assert.match(prompt, /每个数组最多 3 项/);
});

test('builds scoring skill health summary from recent AI usage errors', () => {
  const rows = [
    skill({ id: 1, name: 'AI产业信号', presetKey: 'ai_industry', updatedAt: new Date('2026-06-01T00:00:00Z') }),
    { ...skill({ id: 2, name: '产品落地信号', presetKey: 'product_delivery', updatedAt: new Date('2026-06-01T00:00:00Z') }), status: 'draft' as const },
  ];
  const health = buildScoringSkillHealthSummary(rows, [
    {
      status: 'error',
      label: 'AI产业信号',
      errorMessage: 'empty_scoring_skill_response',
      targetId: 'item-1',
      modelName: 'doubao-test',
      modelConfigId: 'feed-scoring',
      createdAt: new Date('2026-06-01T12:00:00Z'),
    },
    {
      status: 'success',
      label: 'AI产业信号',
      errorMessage: null,
      targetId: 'item-2',
      modelName: 'doubao-test',
      modelConfigId: 'feed-scoring',
      createdAt: new Date('2026-06-01T12:05:00Z'),
    },
    {
      status: 'skipped',
      label: 'Agent update / deterministic fallback scoring',
      errorMessage: 'empty_scoring_skill_response',
      targetId: 'item-3',
      modelName: 'doubao-test',
      modelConfigId: 'feed-scoring',
      createdAt: new Date('2026-06-01T12:10:00Z'),
    },
    {
      status: 'success',
      label: 'Agent update / AI产业信号 / retry recovered',
      errorMessage: null,
      targetId: 'item-4',
      modelName: 'doubao-test',
      modelConfigId: 'feed-scoring',
      createdAt: new Date('2026-06-01T12:12:00Z'),
    },
  ]);

  assert.equal(health.status, 'warning');
  assert.equal(health.totalSkillCount, 2);
  assert.equal(health.activeSkillCount, 1);
  assert.equal(health.recentErrorCount, 2);
  assert.equal(health.emptyResponseCount, 2);
  assert.equal(health.deterministicFallbackCount, 1);
  assert.equal(health.retryRecoveredCount, 1);
  assert.equal(health.lastErrorAt, '2026-06-01T12:10:00.000Z');
  assert.equal(health.activeSkills[0]?.name, 'AI产业信号');
  assert.equal(health.recentErrors[0]?.message, 'empty_scoring_skill_response');
  assert.equal(health.recentErrors[0]?.targetId, 'item-3');
  assert.ok(health.recommendations.some((item) => item.includes('JSON')));
});

test('builds conservative deterministic fallback scores when AI scoring is unavailable', () => {
  const result = buildDeterministicFallbackScore({
    title: 'OpenAI ships a new enterprise agent runtime',
    content: 'OpenAI released a new agent runtime for enterprise deployment with model orchestration and workflow automation.'.repeat(12),
    failureSummary: 'Audio internal LLM API error: 500 Internal Server Error',
  });

  assert.equal(result.confidence < 0.4, true);
  assert.equal(result.score >= 40, true);
  assert.equal(result.score < 62, true);
  assert.equal(result.decision, 'skip');
  assert.ok(result.reasons.some((reason) => reason.includes('AI 评分不可用')));
  assert.deepEqual(result.riskFlags, ['deterministic_fallback', 'ai_scoring_unavailable']);
  assert.match(result.rawResponse, /deterministic_fallback/);
});

test('identifies retryable scoring failures and builds a compact retry prompt', () => {
  assert.equal(isRetryableScoringFailure('empty_scoring_skill_response'), true);
  assert.equal(isRetryableScoringFailure('Audio internal LLM API error: 500 Internal Server Error'), true);
  assert.equal(isRetryableScoringFailure('LLM API error: 429 Too Many Requests'), true);
  assert.equal(isRetryableScoringFailure('invalid_json_shape'), false);

  const prompt = buildScoringRetryPrompt({
    title: 'OpenAI ships agent runtime',
    content: 'A compact article about OpenAI agent runtime and enterprise workflow automation.'.repeat(40),
    failureMessage: 'empty_scoring_skill_response',
  });

  assert.match(prompt, /Retry scoring after failure/);
  assert.match(prompt, /Return exactly one JSON object/);
  assert.match(prompt, /empty_scoring_skill_response/);
  assert.equal(prompt.length < 1800, true);
});

test('summarizes unstable scoring models for circuit breaker decisions', () => {
  const rows = [
    skill({ id: 1, name: 'AI产业信号', presetKey: 'ai_industry', updatedAt: new Date('2026-06-01T00:00:00Z') }),
  ];
  const health = buildScoringSkillHealthSummary(rows, [
    {
      status: 'error',
      label: 'Article A / AI产业信号 / retry failed',
      errorMessage: 'empty_scoring_skill_response',
      targetId: 'item-a',
      modelName: 'ep-bad-model',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:00:00Z'),
    },
    {
      status: 'error',
      label: 'Article B / AI产业信号 / retry failed',
      errorMessage: 'Audio internal LLM API error: 500 Internal Server Error',
      targetId: 'item-b',
      modelName: 'ep-bad-model',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:01:00Z'),
    },
    {
      status: 'skipped',
      label: 'Article C / deterministic fallback scoring',
      errorMessage: 'empty_scoring_skill_response',
      targetId: 'item-c',
      modelName: 'ep-bad-model',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:02:00Z'),
    },
    {
      status: 'success',
      label: 'Article D / AI产业信号 / retry recovered',
      errorMessage: null,
      targetId: 'item-d',
      modelName: 'ep-ok-model',
      modelConfigId: 'model-b',
      createdAt: new Date('2026-06-01T12:03:00Z'),
    },
  ]);

  assert.equal(health.unstableModelCount, 1);
  assert.equal(health.unstableModels[0]?.modelConfigId, 'model-a');
  assert.equal(health.unstableModels[0]?.retryableFailureCount, 3);
  assert.equal(health.unstableModels[0]?.deterministicFallbackCount, 1);
  assert.equal(health.unstableModels[0]?.circuitBreakerRecommended, true);
  assert.ok(health.recommendations.some((item) => item.includes('暂停或切换评分模型')));
});

test('does not keep a scoring model unstable after repeated real successes newer than failures', () => {
  const rows = [
    skill({ id: 1, name: 'AI产业信号', presetKey: 'ai_industry', updatedAt: new Date('2026-06-01T00:00:00Z') }),
  ];
  const health = buildScoringSkillHealthSummary(rows, [
    {
      status: 'error',
      label: 'Article A / AI产业信号 / retry failed',
      errorMessage: 'empty_scoring_skill_response',
      targetId: 'item-a',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:00:00Z'),
    },
    {
      status: 'error',
      label: 'Article B / AI产业信号 / retry failed',
      errorMessage: 'empty_scoring_skill_response',
      targetId: 'item-b',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:01:00Z'),
    },
    {
      status: 'skipped',
      label: 'Article C / deterministic fallback scoring',
      errorMessage: 'empty_scoring_skill_response',
      targetId: 'item-c',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:02:00Z'),
    },
    {
      status: 'success',
      label: 'Article D / AI产业信号',
      errorMessage: null,
      targetId: 'item-d',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:03:00Z'),
    },
    {
      status: 'success',
      label: 'Article E / 产品落地信号',
      errorMessage: null,
      targetId: 'item-e',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:04:00Z'),
    },
    {
      status: 'success',
      label: 'Article F / 头部舆论与资本信号',
      errorMessage: null,
      targetId: 'item-f',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:05:00Z'),
    },
  ]);

  assert.equal(health.unstableModelCount, 0);
  assert.equal(health.unstableModels.length, 0);
});

test('resolves runtime circuit breaker decisions for unstable scoring model', () => {
  const events = [
    {
      status: 'error',
      label: 'Article A / AI产业信号 / retry failed',
      errorMessage: 'empty_scoring_skill_response',
      targetId: 'item-a',
      modelName: 'ep-bad-model',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:00:00Z'),
    },
    {
      status: 'error',
      label: 'Article B / AI产业信号 / retry failed',
      errorMessage: 'Audio internal LLM API error: 500 Internal Server Error',
      targetId: 'item-b',
      modelName: 'ep-bad-model',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:01:00Z'),
    },
    {
      status: 'skipped',
      label: 'Article C / deterministic fallback scoring',
      errorMessage: 'empty_scoring_skill_response',
      targetId: 'item-c',
      modelName: 'ep-bad-model',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:02:00Z'),
    },
    {
      status: 'success',
      label: 'Article D / AI产业信号 / retry recovered',
      errorMessage: null,
      targetId: 'item-d',
      modelName: 'ep-ok-model',
      modelConfigId: 'model-b',
      createdAt: new Date('2026-06-01T12:03:00Z'),
    },
  ];

  const unstable = resolveScoringModelCircuitBreaker({
    modelConfigId: 'model-a',
    modelName: 'ep-bad-model',
  }, events);
  assert.equal(unstable.shouldBypass, true);
  assert.equal(unstable.modelKey, 'model-a');
  assert.equal(unstable.retryableFailureCount, 3);
  assert.equal(unstable.deterministicFallbackCount, 1);
  assert.ok(unstable.reason);
  assert.match(unstable.reason, /评分模型近期不稳定/);

  const healthy = resolveScoringModelCircuitBreaker({
    modelConfigId: 'model-b',
    modelName: 'ep-ok-model',
  }, events);
  assert.equal(healthy.shouldBypass, false);
});

test('runtime circuit breaker honors successful probe after historical failures', () => {
  const decision = resolveScoringModelCircuitBreaker({
    modelConfigId: 'model-a',
    modelName: 'dashscope/qwen-flash',
  }, [
    {
      status: 'error',
      label: 'Article A / AI产业信号 / retry failed',
      errorMessage: 'empty_scoring_skill_response',
      targetId: 'item-a',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:00:00Z'),
    },
    {
      status: 'error',
      label: 'Article B / AI产业信号 / retry failed',
      errorMessage: 'Audio internal LLM API error: 500 Internal Server Error',
      targetId: 'item-b',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:01:00Z'),
    },
    {
      status: 'skipped',
      label: 'Article C / deterministic fallback scoring',
      errorMessage: 'empty_scoring_skill_response',
      targetId: 'item-c',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:02:00Z'),
    },
    {
      status: 'success',
      label: 'Article D / scoring model probe',
      errorMessage: null,
      targetId: 'item-d',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:10:00Z'),
    },
  ]);

  assert.equal(decision.shouldBypass, false);
  assert.equal(decision.reason, null);
});

test('runtime circuit breaker resets after repeated real scoring successes newer than failures', () => {
  const decision = resolveScoringModelCircuitBreaker({
    modelConfigId: 'model-a',
    modelName: 'dashscope/qwen-flash',
  }, [
    {
      status: 'error',
      label: 'Article A / AI产业信号 / retry failed',
      errorMessage: 'empty_scoring_skill_response',
      targetId: 'item-a',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:00:00Z'),
    },
    {
      status: 'error',
      label: 'Article B / AI产业信号 / retry failed',
      errorMessage: 'empty_scoring_skill_response',
      targetId: 'item-b',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:01:00Z'),
    },
    {
      status: 'skipped',
      label: 'Article C / deterministic fallback scoring',
      errorMessage: 'empty_scoring_skill_response',
      targetId: 'item-c',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:02:00Z'),
    },
    {
      status: 'success',
      label: 'Article D / AI产业信号',
      errorMessage: null,
      targetId: 'item-d',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:03:00Z'),
    },
    {
      status: 'success',
      label: 'Article E / 产品落地信号',
      errorMessage: null,
      targetId: 'item-e',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:04:00Z'),
    },
    {
      status: 'success',
      label: 'Article F / 头部舆论与资本信号',
      errorMessage: null,
      targetId: 'item-f',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:05:00Z'),
    },
  ]);

  assert.equal(decision.shouldBypass, false);
  assert.equal(decision.reason, null);
});

test('runtime circuit breaker keeps bypassing when probe failure is newer than success', () => {
  const decision = resolveScoringModelCircuitBreaker({
    modelConfigId: 'model-a',
    modelName: 'dashscope/qwen-flash',
  }, [
    {
      status: 'success',
      label: 'Article D / scoring model probe',
      errorMessage: null,
      targetId: 'item-d',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:00:00Z'),
    },
    {
      status: 'error',
      label: 'Article E / AI产业信号 / retry failed',
      errorMessage: 'empty_scoring_skill_response',
      targetId: 'item-e',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:10:00Z'),
    },
    {
      status: 'error',
      label: 'Article F / AI产业信号 / retry failed',
      errorMessage: 'empty_scoring_skill_response',
      targetId: 'item-f',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:11:00Z'),
    },
    {
      status: 'skipped',
      label: 'Article G / deterministic fallback scoring',
      errorMessage: 'empty_scoring_skill_response',
      targetId: 'item-g',
      modelName: 'dashscope/qwen-flash',
      modelConfigId: 'model-a',
      createdAt: new Date('2026-06-01T12:12:00Z'),
    },
  ]);

  assert.equal(decision.shouldBypass, true);
});

test('builds remediation plan with backup model when scoring model is unstable', () => {
  const remediation = buildScoringModelRemediation({
    currentModelConfigId: 'model-a',
    unstableModels: [{
      modelKey: 'model-a',
      modelName: 'ep-bad-model',
      modelConfigId: 'model-a',
      retryableFailureCount: 4,
      retryRecoveredCount: 1,
      deterministicFallbackCount: 1,
      lastFailureAt: '2026-06-01T12:00:00.000Z',
      circuitBreakerRecommended: true,
    }],
    availableModels: [
      {
        id: 'model-a',
        alias: 'Bad Scoring Model',
        provider: 'volcengine_ark',
        modelName: 'ep-bad-model',
        modelType: 'llm',
        isActive: true,
        isDefault: true,
        testStatus: 'passed',
      },
      {
        id: 'model-b',
        alias: 'Stable Backup',
        provider: 'openai',
        modelName: 'gpt-4.1-mini',
        modelType: 'llm',
        isActive: true,
        isDefault: false,
        testStatus: 'passed',
      },
      {
        id: 'model-c',
        alias: 'Untested Backup',
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        modelType: 'llm',
        isActive: true,
        isDefault: false,
        testStatus: 'untested',
      },
    ],
  });

  assert.equal(remediation.action, 'switch_model');
  assert.equal(remediation.currentModelConfigId, 'model-a');
  assert.equal(remediation.recommendedModelConfigId, 'model-b');
  assert.equal(remediation.candidateModels[0]?.id, 'model-b');
  assert.match(remediation.message, /建议切换评分场景/);
});

test('builds remediation plan without backup when no stable model exists', () => {
  const remediation = buildScoringModelRemediation({
    currentModelConfigId: 'model-a',
    unstableModels: [{
      modelKey: 'model-a',
      modelName: 'ep-bad-model',
      modelConfigId: 'model-a',
      retryableFailureCount: 4,
      retryRecoveredCount: 0,
      deterministicFallbackCount: 1,
      lastFailureAt: '2026-06-01T12:00:00.000Z',
      circuitBreakerRecommended: true,
    }],
    availableModels: [
      {
        id: 'model-a',
        alias: 'Bad Scoring Model',
        provider: 'volcengine_ark',
        modelName: 'ep-bad-model',
        modelType: 'llm',
        isActive: true,
        isDefault: true,
        testStatus: 'passed',
      },
    ],
  });

  assert.equal(remediation.action, 'repair_config');
  assert.equal(remediation.recommendedModelConfigId, null);
  assert.equal(remediation.candidateModels.length, 0);
  assert.match(remediation.message, /没有可用备用模型/);
});

test('excludes recently failed probe models from remediation candidates', () => {
  const remediation = buildScoringModelRemediation({
    currentModelConfigId: 'model-a',
    unstableModels: [{
      modelKey: 'model-a',
      modelName: 'ep-bad-model',
      modelConfigId: 'model-a',
      retryableFailureCount: 4,
      retryRecoveredCount: 0,
      deterministicFallbackCount: 1,
      lastFailureAt: '2026-06-01T12:00:00.000Z',
      circuitBreakerRecommended: true,
    }],
    probeEvents: [
      {
        status: 'error',
        label: 'Probe failed',
        errorMessage: 'Audio internal LLM API error: 500 Internal Server Error',
        targetId: 'item-a',
        modelName: 'qwen/qwen-plus',
        modelConfigId: 'model-b',
        createdAt: new Date('2026-06-01T12:05:00Z'),
      },
      {
        status: 'error',
        label: 'Probe failed',
        errorMessage: 'empty_scoring_skill_response',
        targetId: 'item-b',
        modelName: 'qwen/qwen-plus',
        modelConfigId: 'model-b',
        createdAt: new Date('2026-06-01T12:06:00Z'),
      },
    ],
    availableModels: [
      {
        id: 'model-a',
        alias: 'Bad Scoring Model',
        provider: 'volcengine_ark',
        modelName: 'ep-bad-model',
        modelType: 'llm',
        isActive: true,
        isDefault: true,
        testStatus: 'passed',
      },
      {
        id: 'model-b',
        alias: 'Qwen Plus',
        provider: 'dashscope',
        modelName: 'qwen/qwen-plus',
        modelType: 'llm',
        isActive: true,
        isDefault: false,
        testStatus: 'untested',
      },
    ],
  });

  assert.equal(remediation.action, 'repair_config');
  assert.equal(remediation.candidateModels.length, 0);
  assert.match(remediation.message, /没有可用备用模型/);
});

test('allows historically unstable models after a successful newer probe', () => {
  const remediation = buildScoringModelRemediation({
    currentModelConfigId: 'model-a',
    unstableModels: [
      {
        modelKey: 'model-a',
        modelName: 'ep-bad-model',
        modelConfigId: 'model-a',
        retryableFailureCount: 4,
        retryRecoveredCount: 0,
        deterministicFallbackCount: 1,
        lastFailureAt: '2026-06-01T12:00:00.000Z',
        circuitBreakerRecommended: true,
      },
      {
        modelKey: 'model-b',
        modelName: 'dashscope/qwen-flash',
        modelConfigId: 'model-b',
        retryableFailureCount: 12,
        retryRecoveredCount: 0,
        deterministicFallbackCount: 0,
        lastFailureAt: '2026-06-01T12:05:00.000Z',
        circuitBreakerRecommended: true,
      },
    ],
    probeEvents: [
      {
        status: 'success',
        label: 'Probe passed',
        errorMessage: null,
        targetId: 'item-a',
        modelName: 'dashscope/qwen-flash',
        modelConfigId: 'model-b',
        createdAt: new Date('2026-06-01T12:10:00Z'),
      },
    ],
    availableModels: [
      {
        id: 'model-a',
        alias: 'Bad Scoring Model',
        provider: 'volcengine_ark',
        modelName: 'ep-bad-model',
        modelType: 'llm',
        isActive: true,
        isDefault: true,
        testStatus: 'passed',
      },
      {
        id: 'model-b',
        alias: 'Qwen Flash',
        provider: 'dashscope',
        modelName: 'dashscope/qwen-flash',
        modelType: 'llm',
        isActive: true,
        isDefault: false,
        testStatus: 'untested',
      },
    ],
  });

  assert.equal(remediation.action, 'switch_model');
  assert.equal(remediation.recommendedModelConfigId, 'model-b');
  assert.equal(remediation.candidateModels[0]?.id, 'model-b');
});

test('summarizes scoring model probe results and gates model switching', () => {
  const passed = buildScoringModelProbeSummary({
    modelConfigId: 'model-b',
    modelLabel: 'Stable Backup',
    results: [
      { itemId: 'item-a', title: 'Agent runtime', ok: true, score: 72, decision: 'worth_read', confidence: 0.76 },
      { itemId: 'item-b', title: 'Bad response', ok: false, error: 'empty_scoring_skill_response' },
    ],
  });

  assert.equal(passed.status, 'passed');
  assert.equal(passed.canSwitch, true);
  assert.equal(passed.probed, 2);
  assert.equal(passed.passed, 1);
  assert.equal(passed.failed, 1);
  assert.match(passed.message, /备用模型可用于评分/);

  const failed = buildScoringModelProbeSummary({
    modelConfigId: 'model-c',
    modelLabel: 'Broken Backup',
    results: [
      { itemId: 'item-c', title: 'Empty', ok: false, error: 'empty_scoring_skill_response' },
    ],
  });

  assert.equal(failed.status, 'failed');
  assert.equal(failed.canSwitch, false);
  assert.equal(failed.firstError, 'empty_scoring_skill_response');
  assert.match(failed.message, /暂不建议切换/);
});

test('summarizes post-switch scoring repair results', () => {
  const recovered = buildScoringModelRepairSummary({
    modelConfigId: 'model-b',
    modelLabel: 'Stable Backup',
    itemIds: ['item-a', 'item-b', 'item-c'],
    scoring: {
      processed: 2,
      attempted: 3,
      failed: 1,
      skipped: 0,
      errors: ['partial failure'],
    },
  });

  assert.equal(recovered.status, 'recovered');
  assert.equal(recovered.recovered, 2);
  assert.equal(recovered.attempted, 3);
  assert.equal(recovered.recoveryRate, 0.67);
  assert.equal(recovered.canContinueBatchRepair, true);
  assert.match(recovered.message, /已恢复 2\/3/);

  const failed = buildScoringModelRepairSummary({
    modelConfigId: 'model-c',
    modelLabel: 'Broken Backup',
    itemIds: ['item-a', 'item-b'],
    scoring: {
      processed: 0,
      attempted: 2,
      failed: 2,
      skipped: 0,
      errors: ['still failing'],
    },
  });

  assert.equal(failed.status, 'failed');
  assert.equal(failed.canContinueBatchRepair, false);
  assert.equal(failed.firstError, 'still failing');
  assert.match(failed.message, /没有恢复失败条目/);
});

test('identifies fallback scoring risk flags across breakdown rows', () => {
  assert.equal(hasFallbackScoringRiskFlags(['deterministic_fallback']), true);
  assert.equal(hasFallbackScoringRiskFlags(['model_circuit_breaker', '太泛']), true);
  assert.equal(hasFallbackScoringRiskFlags(['ai_scoring_unavailable']), true);
  assert.equal(hasFallbackScoringRiskFlags(['scoring_retry_recovered']), false);
  assert.equal(hasFallbackScoringRiskFlags(null), false);
});

test('summarizes historical fallback scoring recovery with verified results only', () => {
  const partial = buildFallbackScoringRecoverySummary({
    candidateCount: 12,
    itemIds: ['item-a', 'item-b', 'item-c'],
    verifiedRecoveredItemIds: ['item-a'],
    scoring: {
      processed: 3,
      attempted: 3,
      failed: 0,
      skipped: 0,
      errors: [],
    },
  });

  assert.equal(partial.status, 'partial');
  assert.equal(partial.candidateCount, 12);
  assert.equal(partial.attempted, 3);
  assert.equal(partial.recovered, 1);
  assert.equal(partial.failed, 2);
  assert.equal(partial.remainingCandidateCount, 11);
  assert.equal(partial.recoveryRate, 0.33);
  assert.match(partial.message, /真实 Skill 评分恢复 1\/3/);

  const recovered = buildFallbackScoringRecoverySummary({
    candidateCount: 2,
    itemIds: ['item-a', 'item-b'],
    verifiedRecoveredItemIds: ['item-a', 'item-b'],
    scoring: {
      processed: 2,
      attempted: 2,
      failed: 0,
      skipped: 0,
      errors: [],
    },
  });

  assert.equal(recovered.status, 'recovered');
  assert.equal(recovered.failed, 0);
  assert.equal(recovered.remainingCandidateCount, 0);

  const empty = buildFallbackScoringRecoverySummary({
    candidateCount: 0,
    itemIds: [],
    verifiedRecoveredItemIds: [],
    scoring: {
      processed: 0,
      attempted: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    },
  });

  assert.equal(empty.status, 'empty');
  assert.match(empty.message, /没有历史兜底评分条目/);

  const blocked = buildFallbackScoringRecoverySummary({
    candidateCount: 6,
    itemIds: [],
    verifiedRecoveredItemIds: [],
    blockedReason: '当前评分模型处于熔断状态',
    scoring: {
      processed: 0,
      attempted: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    },
  });

  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.remainingCandidateCount, 6);
  assert.equal(blocked.firstError, '当前评分模型处于熔断状态');
  assert.match(blocked.message, /先切换或修复评分模型/);
});

test('allows ordinary authenticated users to recover their own fallback scoring items', () => {
  assert.equal(canRecoverFallbackScoringItems('user'), true);
  assert.equal(canRecoverFallbackScoringItems('admin'), true);
  assert.equal(canRecoverFallbackScoringItems(null), false);
  assert.equal(canRecoverFallbackScoringItems('suspended'), false);
});

test('normalizes targeted fallback scoring recovery requests', () => {
  const targeted = normalizeFallbackScoringRecoveryRequest({
    limit: 50,
    itemIds: [
      'item-a',
      ' ',
      'item-a',
      ...Array.from({ length: 25 }, (_, index) => `item-${index}`),
    ],
  });

  assert.equal(targeted.limit, 20);
  assert.equal(targeted.itemIds.length, 20);
  assert.equal(targeted.itemIds[0], 'item-a');
  assert.equal(targeted.itemIds[1], 'item-0');
  assert.equal(targeted.itemIds.includes(' '), false);

  const global = normalizeFallbackScoringRecoveryRequest({});
  assert.equal(global.limit, 3);
  assert.deepEqual(global.itemIds, []);
});

test('allows fallback scoring recovery for completed feed items', () => {
  assert.equal(isFallbackScoringRecoveryStatus('scored'), true);
  assert.equal(isFallbackScoringRecoveryStatus('done'), true);
  assert.equal(isFallbackScoringRecoveryStatus('raw'), false);
  assert.equal(isFallbackScoringRecoveryStatus('score_failed'), false);
});
