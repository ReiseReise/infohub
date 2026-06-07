import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReprocessStageNotice,
  getDetailEmptyState,
  getReprocessStageActionState,
  getScoreBreakdownDiagnostic,
  qualityDecisionLabel,
  shouldRefreshScoreBreakdownAfterEnrich,
  shouldRefreshScoreBreakdownAfterReprocess,
} from '../src/lib/feed-diagnostics.ts';

test('does not present default pass rows as AI quality checked', () => {
  assert.equal(qualityDecisionLabel({
    qualityDecision: 'pass',
    qualityScore: null,
    qualityCheckedAt: null,
  }), '规则通过（未做 AI 质检）');
});

test('labels quality decisions with available evidence', () => {
  assert.equal(qualityDecisionLabel({
    qualityDecision: 'pass',
    qualityScore: 82,
    qualityCheckedAt: '2026-06-03T05:00:00.000Z',
  }), '质检通过');
  assert.equal(qualityDecisionLabel({ qualityDecision: 'review' }), '进入复核');
  assert.equal(qualityDecisionLabel({ qualityDecision: 'filter' }), '质检过滤');
  assert.equal(qualityDecisionLabel({}), '等待质检');
});

test('marks strategy-skipped translation retries as not useful', () => {
  const state = getReprocessStageActionState('translation', {
    translationStatus: 'skipped',
    translationReason: '原文已是中文，跳过翻译',
  });

  assert.equal(state.disabled, true);
  assert.equal(state.reason, '原文已是中文，跳过翻译');
});

test('marks strategy-skipped summary retries as not useful', () => {
  const state = getReprocessStageActionState('summary', {
    summaryStatus: 'skipped',
    summaryReason: 'AI评分低于摘要阈值，跳过摘要',
  });

  assert.equal(state.disabled, true);
  assert.equal(state.reason, 'AI评分低于摘要阈值，跳过摘要');
});

test('keeps failed or pending stages actionable', () => {
  assert.equal(getReprocessStageActionState('translation', {
    translationStatus: 'failed',
    translationReason: '模型空响应',
  }).disabled, false);
  assert.equal(getReprocessStageActionState('summary', {
    summaryStatus: 'pending',
  }).disabled, false);
});

test('diagnoses trusted skill score breakdowns', () => {
  const diagnostic = getScoreBreakdownDiagnostic({
    aiScore: 91,
    breakdowns: [{
      score: 91,
      confidence: 0.92,
      riskFlags: [],
    }],
  });

  assert.equal(diagnostic.kind, 'skill_breakdown');
  assert.equal(diagnostic.title, 'Skill 评分已拆解');
  assert.equal(diagnostic.tone, 'ok');
});

test('diagnoses fallback score breakdowns as low confidence', () => {
  const diagnostic = getScoreBreakdownDiagnostic({
    aiScore: 72,
    breakdowns: [{
      score: 72,
      confidence: 0.2,
      riskFlags: ['model_circuit_breaker'],
    }],
  });

  assert.equal(diagnostic.kind, 'fallback_score');
  assert.equal(diagnostic.title, '低置信评分');
  assert.match(diagnostic.description, /模型熔断/);
});

test('diagnoses legacy single scores separately from missing scores', () => {
  const legacy = getScoreBreakdownDiagnostic({ aiScore: 68, breakdowns: [] });
  assert.equal(legacy.kind, 'legacy_single_score');
  assert.equal(legacy.title, '旧版单分');
  assert.equal(legacy.tone, 'warning');

  const missing = getScoreBreakdownDiagnostic({ aiScore: null, breakdowns: [] });
  assert.equal(missing.kind, 'missing_score');
  assert.equal(missing.title, '等待评分');
  assert.equal(missing.tone, 'neutral');
});

test('explains summary empty states with repair guidance', () => {
  const skipped = getDetailEmptyState('summary', {
    summaryStatus: 'skipped',
    summaryReason: 'AI评分低于摘要阈值，跳过摘要',
  });

  assert.equal(skipped.title, '摘要按策略跳过');
  assert.equal(skipped.reason, 'AI评分低于摘要阈值，跳过摘要');
  assert.match(skipped.action, /先重跑评分/);

  const failed = getDetailEmptyState('summary', {
    summaryStatus: 'failed',
    summaryReason: '模型空响应',
  });
  assert.equal(failed.title, '摘要生成失败');
  assert.match(failed.action, /重跑摘要/);
});

test('explains original and translation empty states with concrete next actions', () => {
  const original = getDetailEmptyState('original', {
    contentStatus: 'failed',
    contentError: '403 blocked',
  });
  assert.equal(original.title, '正文抓取失败');
  assert.equal(original.reason, '403 blocked');
  assert.match(original.action, /补正文/);

  const translation = getDetailEmptyState('translation', {
    translationStatus: 'skipped',
    translationReason: '原文已是中文，跳过翻译',
  });
  assert.equal(translation.title, '翻译按策略跳过');
  assert.equal(translation.reason, '原文已是中文，跳过翻译');
  assert.match(translation.action, /无需翻译/);
});

test('summarizes stage reprocess results by outcome severity', () => {
  const noMatch = buildReprocessStageNotice('summary', {
    matched: 0,
    content: 0,
    quality: 0,
    scored: 0,
    summarized: 0,
    translated: 0,
    skipped: {},
    errors: {},
  });
  assert.equal(noMatch.tone, 'warning');
  assert.match(noMatch.message, /没有命中可修复条目/);

  const skipped = buildReprocessStageNotice('summary', {
    matched: 1,
    content: 0,
    quality: 0,
    scored: 0,
    summarized: 0,
    translated: 0,
    skipped: { summary: 1 },
    errors: {},
  });
  assert.equal(skipped.tone, 'warning');
  assert.match(skipped.message, /策略跳过/);

  const failed = buildReprocessStageNotice('translation', {
    matched: 1,
    content: 0,
    quality: 0,
    scored: 0,
    summarized: 0,
    translated: 0,
    skipped: {},
    errors: { translation: ['模型空响应'] },
  });
  assert.equal(failed.tone, 'danger');
  assert.match(failed.message, /模型空响应/);

  const success = buildReprocessStageNotice('scoring', {
    matched: 1,
    content: 0,
    quality: 0,
    scored: 1,
    summarized: 0,
    translated: 0,
    skipped: {},
    errors: {},
  });
  assert.equal(success.tone, 'success');
  assert.match(success.message, /评分修复完成/);
});

test('refreshes score breakdown after score-affecting reprocess actions', () => {
  assert.equal(shouldRefreshScoreBreakdownAfterReprocess('full-ai'), true);
  assert.equal(shouldRefreshScoreBreakdownAfterReprocess('scoring'), true);
  assert.equal(shouldRefreshScoreBreakdownAfterReprocess('all'), true);
  assert.equal(shouldRefreshScoreBreakdownAfterReprocess('summary'), false);
  assert.equal(shouldRefreshScoreBreakdownAfterReprocess('translation'), false);
});

test('refreshes score breakdown after enrich only when scoring changed', () => {
  assert.equal(shouldRefreshScoreBreakdownAfterEnrich({ scored: 1 }), true);
  assert.equal(shouldRefreshScoreBreakdownAfterEnrich({ scored: 0 }), false);
  assert.equal(shouldRefreshScoreBreakdownAfterEnrich({}), false);
});
