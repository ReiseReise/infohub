import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExcludedCandidateRepairPlan,
  resolveRepairProblemActions,
  resolveExcludedCandidateRepairAction,
  summarizeExcludedCandidateRepairRuns,
} from '../src/lib/insights-repair-actions.ts';

test('maps daily report exclusion reasons to targeted repair stages', () => {
  assert.deepEqual(resolveExcludedCandidateRepairAction('translation_failed'), {
    stage: 'translation',
    label: '重跑翻译',
    hint: '重新生成中文译文后再预览候选池。',
    canRun: true,
  });
  assert.deepEqual(resolveExcludedCandidateRepairAction('not_chinese'), {
    stage: 'translation',
    label: '补中文材料',
    hint: '优先补翻译；如果仍无中文摘要，再回到 Feed 补正文和摘要。',
    canRun: true,
  });
  assert.deepEqual(resolveExcludedCandidateRepairAction('not_selected'), {
    stage: 'scoring',
    label: '重跑评分',
    hint: '刷新 AI 评分和标签后再判断是否达到入报门槛。',
    canRun: true,
  });
  assert.deepEqual(resolveExcludedCandidateRepairAction('business_noise'), {
    stage: null,
    label: '查看条目',
    hint: '这是噪声收紧结果，建议先人工查看，不默认重跑 AI。',
    canRun: false,
  });
});

test('routes low-score translation skips to scoring before translation', () => {
  assert.deepEqual(resolveExcludedCandidateRepairAction('translation_failed', 'AI 评分过低，跳过翻译'), {
    stage: 'scoring',
    label: '重跑评分',
    hint: '当前因低分跳过翻译；先刷新评分，达标后再补翻译。',
    canRun: true,
  });
});

test('builds a bounded runnable repair plan for excluded candidate groups', () => {
  const plan = buildExcludedCandidateRepairPlan([
    { id: 'low-score-translation', reason: 'translation_failed', detail: 'AI 评分过低，跳过翻译' },
    { id: 'normal-translation', reason: 'translation_failed', detail: 'translation unavailable' },
    { id: 'business-noise', reason: 'business_noise', detail: '泛商业噪声' },
    { id: 'not-selected', reason: 'not_selected', detail: '未达到精选分' },
  ], 2);

  assert.deepEqual(plan, [
    { itemId: 'low-score-translation', stage: 'scoring', label: '重跑评分' },
    { itemId: 'normal-translation', stage: 'translation', label: '重跑翻译' },
  ]);
});

test('summarizes repair runs with warnings and failed items', () => {
  const summary = summarizeExcludedCandidateRepairRuns([
    {
      itemId: 'ok',
      title: '已修复条目',
      stage: 'scoring',
      label: '重跑评分',
      response: {
        matched: 1,
        scored: 1,
        summarized: 0,
        translated: 0,
        skipped: {},
        errors: {},
      },
    },
    {
      itemId: 'warn',
      title: '空响应条目',
      stage: 'scoring',
      label: '重跑评分',
      response: {
        matched: 1,
        scored: 0,
        summarized: 0,
        translated: 0,
        skipped: { scoring: 0 },
        errors: { scoring: ['empty_scoring_skill_response'] },
      },
    },
    {
      itemId: 'skipped',
      title: '策略跳过条目',
      stage: 'translation',
      label: '重跑翻译',
      response: {
        matched: 1,
        scored: 0,
        summarized: 0,
        translated: 0,
        skipped: { translation: 1 },
        errors: {},
      },
    },
  ]);

  assert.equal(summary.totalRuns, 3);
  assert.equal(summary.matched, 3);
  assert.equal(summary.successfulRuns, 1);
  assert.equal(summary.warningRuns, 2);
  assert.equal(summary.skippedTotal, 1);
  assert.deepEqual(summary.stageCounts, { scoring: 2, translation: 1 });
  assert.deepEqual(summary.problemItems.map((item) => [item.itemId, item.title, item.messages]), [
    ['warn', '空响应条目', ['scoring: empty_scoring_skill_response']],
    ['skipped', '策略跳过条目', ['策略跳过 1 次']],
  ]);
});

test('counts content and quality repair progress as successful daily report candidate fixes', () => {
  const summary = summarizeExcludedCandidateRepairRuns([
    {
      itemId: 'content-ready',
      title: '正文已补齐',
      stage: 'content',
      label: '补正文',
      response: {
        matched: 1,
        content: 1,
        quality: 0,
        scored: 0,
        summarized: 0,
        translated: 0,
        skipped: {},
        errors: {},
      },
    },
    {
      itemId: 'quality-ready',
      title: '质检已重跑',
      stage: 'quality',
      label: '重跑质检',
      response: {
        matched: 1,
        content: 0,
        quality: 1,
        scored: 0,
        summarized: 0,
        translated: 0,
        skipped: {},
        errors: {},
      },
    },
  ]);

  assert.equal(summary.content, 1);
  assert.equal(summary.quality, 1);
  assert.equal(summary.successfulRuns, 2);
  assert.equal(summary.warningRuns, 0);
});

test('suggests concrete follow-up actions for empty scoring responses', () => {
  const actions = resolveRepairProblemActions({
    itemId: 'warn',
    title: '空响应条目',
    stage: 'scoring',
    label: '重跑评分',
    messages: ['scoring: empty_scoring_skill_response'],
  });

  assert.deepEqual(actions, [
    { kind: 'retry', label: '再次重跑评分', stage: 'scoring', itemId: 'warn' },
    { kind: 'link', label: 'Feed 详情', href: '/feed/warn' },
    { kind: 'link', label: '查看评分配置', href: '/settings' },
  ]);
});
