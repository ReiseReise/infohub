import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DAILY_REPORT_WORKFLOW,
  normalizeDailyReportWorkflowConfig,
  prepareDailyReportCandidates,
  type DailyReportCandidateInput,
} from './daily-report-workflow.js';

const baseItem = {
  url: 'https://example.com',
  sourceName: '测试信源',
  category: 'AI',
  sourceType: 'article',
  sourceTier: 'B',
  sourceKind: 'rss',
  fetchedAt: '2026-05-12T08:00:00.000Z',
  publishedAt: '2026-05-12T08:00:00.000Z',
  aiTags: ['AI'],
};

function item(input: Partial<DailyReportCandidateInput> & { id: string; title: string }): DailyReportCandidateInput {
  return {
    ...baseItem,
    aiScore: 80,
    aiSummary: '这是一条中文摘要，说明了 AI 产品的重要变化。',
    aiTranslation: null,
    language: 'zh',
    translationStatus: 'skipped',
    translationReason: '原文已是中文',
    ...input,
  };
}

test('normalizes workflow config with safe defaults and bounded values', () => {
  const config = normalizeDailyReportWorkflowConfig({
    topN: 200,
    minScore: -1,
    perSourceLimit: 0,
    enableLatestFallback: false,
    requireChinese: false,
  });

  assert.equal(config.topN, 50);
  assert.equal(config.minScore, 0);
  assert.equal(config.perSourceLimit, 1);
  assert.equal(config.enableLatestFallback, false);
  assert.equal(config.requireChinese, false);
  assert.deepEqual(config.enabledModules, DEFAULT_DAILY_REPORT_WORKFLOW.enabledModules);
});

test('keeps high score AI scoped items as scored candidates with Chinese report text', async () => {
  const result = await prepareDailyReportCandidates([
    item({ id: 'ai-1', title: 'Claude Code 发布智能体视图', aiScore: 86 }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5 }));

  assert.equal(result.selectionMode, 'scored');
  assert.equal(result.funnel.finalCandidates, 1);
  assert.equal(result.finalCandidates[0].id, 'ai-1');
  assert.equal(result.finalCandidates[0].displayTitle, 'Claude Code 发布智能体视图');
  assert.equal(result.finalCandidates[0].reportSummary, '这是一条中文摘要，说明了 AI 产品的重要变化。');
  assert.match(result.finalCandidates[0].selectionReason, /达到精选分/);
});

test('translates English candidates before admitting them to the report', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'en-1',
      title: 'Cursor now integrates with Microsoft Teams',
      aiScore: 88,
      aiSummary: 'Cursor adds a Microsoft Teams integration for enterprise collaboration.',
      language: 'en',
      translationStatus: 'pending',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5, requireChinese: true }), {
    translateItem: async (candidate) => ({
      ...candidate,
      aiTranslation: 'Cursor 新增 Microsoft Teams 集成，强化企业协作场景。',
      translationStatus: 'ready',
      language: 'en',
    }),
  });

  assert.equal(result.funnel.translationPending, 1);
  assert.equal(result.funnel.translationFailed, 0);
  assert.equal(result.finalCandidates.length, 1);
  assert.equal(result.finalCandidates[0].reportSummary, 'Cursor 新增 Microsoft Teams 集成，强化企业协作场景。');
});

test('excludes English candidates when translation fails under requireChinese gate', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'en-failed',
      title: 'OpenAI launches a security research program',
      aiScore: 92,
      aiSummary: 'OpenAI launches a new security research program for defenders.',
      language: 'en',
      translationStatus: 'pending',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5, requireChinese: true }), {
    translateItem: async (candidate) => ({
      ...candidate,
      translationStatus: 'failed',
      translationReason: 'translation model unavailable',
    }),
  });

  assert.equal(result.funnel.translationFailed, 1);
  assert.equal(result.finalCandidates.length, 0);
  assert.equal(result.excluded[0].reason, 'translation_failed');
});

test('allows non scoped content only through latest fallback and marks the reason', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'market-1',
      title: '恒指开盘涨0.34%，快手涨超9%',
      category: '投资理财',
      aiTags: [],
      aiScore: 35,
      aiSummary: '港股开盘走高，快手涨幅明显。',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5, enableLatestFallback: true }));

  assert.equal(result.funnel.scopeMatched, 0);
  assert.equal(result.selectionMode, 'latest_visible');
  assert.equal(result.finalCandidates.length, 1);
  assert.equal(result.finalCandidates[0].selectionMode, 'latest_visible');
  assert.match(result.finalCandidates[0].selectionReason, /最新兜底/);
});

test('uses soft score filtered scoped items as review candidates before latest fallback', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'soft-filtered-ai',
      title: '网易有道发布企业级大模型聚合平台',
      aiScore: 50,
      filterBucket: 'filtered',
      isFiltered: true,
      filterReason: 'ai score too low: 50 < 70',
      qualityDecision: 'filter',
    }),
    item({
      id: 'non-ai-market',
      title: 'A股三大指数收盘涨跌不一',
      category: '投资理财',
      aiTags: [],
      aiScore: 20,
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5, enableLatestFallback: true }));

  assert.equal(result.selectionMode, 'review');
  assert.equal(result.funnel.softFilteredRecovered, 1);
  assert.equal(result.funnel.reviewCandidates, 1);
  assert.equal(result.finalCandidates.length, 1);
  assert.equal(result.finalCandidates[0].id, 'soft-filtered-ai');
  assert.equal(result.finalCandidates[0].selectionMode, 'review');
  assert.match(result.finalCandidates[0].selectionReason, /低分复核/);
});

test('keeps repaired low score items in review mode after they return to main feed', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'repaired-low-score-ai',
      title: '某工具平台上线 AI 智能体工作流能力',
      aiScore: 50,
      filterBucket: 'main',
      isFiltered: false,
      filterReason: '低分复核：原 AI 分数门槛不再作为硬过滤',
      qualityDecision: 'review',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5, enableLatestFallback: true }));

  assert.equal(result.selectionMode, 'review');
  assert.equal(result.funnel.softFilteredRecovered, 1);
  assert.equal(result.funnel.reviewCandidates, 1);
  assert.equal(result.finalCandidates[0].selectionMode, 'review');
  assert.match(result.finalCandidates[0].selectionReason, /低分复核/);
});
