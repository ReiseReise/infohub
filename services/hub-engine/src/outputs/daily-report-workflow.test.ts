import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DAILY_REPORT_WORKFLOW,
  classifyDailyReportReviewBucket,
  looksLikeModelMetaReportSummary,
  looksTruncatedReportSummary,
  normalizeReportSummaryText,
  normalizeDailyReportWorkflowConfig,
  prepareDailyReportCandidates,
  summarizeDailyReportExcludedCandidates,
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
  assert.match(result.finalCandidates[0].selectionReason, /AI/);
  assert.match(result.finalCandidates[0].selectionReason, /产品|技术|产业/);
});

test('routes fallback-scored items to review instead of trusted scored daily candidates', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'fallback-high',
      title: 'OpenAI 发布 Agent 产品能力更新',
      aiScore: 88,
      scoreRiskFlags: ['deterministic_fallback', 'ai_scoring_unavailable'],
      aiSummary: 'OpenAI 发布 Agent 产品能力更新，影响企业工作流与开发者生态。',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5 }));

  assert.equal(result.selectionMode, 'empty');
  assert.equal(result.funnel.scoredCandidates, 0);
  assert.equal(result.funnel.fallbackScoredCandidates, 1);
  assert.equal(result.funnel.finalCandidates, 0);
  assert.equal(result.reviewCandidates[0].id, 'fallback-high');
  assert.equal(result.finalCandidates.length, 0);
  assert.match(result.reviewCandidates[0].selectionReason, /低置信兜底评分待复核/);
  assert.match(result.reviewCandidates[0].selectionReason, /deterministic_fallback/);
});

test('does not hide fallback scoring debt behind latest visible candidates', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'fallback-high',
      title: 'OpenAI 发布 Agent 产品能力更新',
      aiScore: 88,
      scoreRiskFlags: ['deterministic_fallback', 'ai_scoring_unavailable'],
      aiSummary: 'OpenAI 发布 Agent 产品能力更新，影响企业工作流与开发者生态。',
    }),
    item({
      id: 'latest-low',
      title: '普通工具讨论帖',
      aiScore: 42,
      category: 'App&效率工具',
      aiSummary: '一个普通工具讨论帖，信息增量有限。',
    }),
  ], normalizeDailyReportWorkflowConfig({
    minScore: 70,
    topN: 5,
    enableLatestFallback: true,
  }));

  assert.equal(result.selectionMode, 'empty');
  assert.equal(result.funnel.fallbackScoredCandidates, 1);
  assert.equal(result.funnel.latestFallbackCandidates, 1);
  assert.equal(result.funnel.finalCandidates, 0);
  assert.equal(result.finalCandidates.length, 0);
  assert.equal(result.excluded.some((candidate) => candidate.reason === 'fallback_scored'), true);
});

test('uses a clean snippet instead of a truncated Chinese summary in daily report candidates', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'truncated-summary',
      title: '罗福莉划重点，小米大模型降价99%的秘籍公开',
      aiScore: 90,
      aiSummary: '6月1日消息，小米公开 MiMo API 永久降价99%的技术秘籍，这是业内首篇全面覆盖Hybrid S',
      snippet: '小米公开 MiMo-V2.5 系列 API 降价背后的推理优化、混合架构和训练策略，说明国产大模型正在通过工程降本进入更激烈的平台竞争。',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5 }));

  assert.equal(looksTruncatedReportSummary(result.finalCandidates[0].aiSummary), true);
  assert.equal(result.finalCandidates[0].reportSummary, '小米公开 MiMo-V2.5 系列 API 降价背后的推理优化、混合架构和训练策略，说明国产大模型正在通过工程降本进入更激烈的平台竞争。');
});

test('trims long truncated report summaries to the last complete sentence', () => {
  const text = '智东西报道，小米公开 MiMo-V2.5 系列 API 降价背后的推理优化、混合架构和训练策略，说明国产大模型正在通过工程降本进入更激烈的平台竞争。其降价的核心技术基础是 KV Cache 存储压缩至同级方';

  assert.equal(looksTruncatedReportSummary(text), true);
  assert.equal(
    normalizeReportSummaryText(text),
    '智东西报道，小米公开 MiMo-V2.5 系列 API 降价背后的推理优化、混合架构和训练策略，说明国产大模型正在通过工程降本进入更激烈的平台竞争。',
  );
});

test('drops model meta replies instead of treating them as report summaries', async () => {
  const badSummary = '您似乎没有提供需要改写的摘要内容，请补充具体的摘要文本，我会按照要求将其忠实改写成简体中文。';
  const result = await prepareDailyReportCandidates([
    item({
      id: 'meta-summary',
      title: 'AI 日报摘要修复策略更新',
      aiScore: 88,
      aiSummary: badSummary,
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5 }));

  assert.equal(looksLikeModelMetaReportSummary(badSummary), true);
  assert.equal(normalizeReportSummaryText(badSummary), '');
  assert.equal(result.finalCandidates[0].reportSummary, 'AI 日报摘要修复策略更新');
});

test('ranks direct product and technical signals ahead of aggregation digests', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'daily-digest',
      title: '2026-05-28日刊',
      sourceName: 'AI洞察日报 RSS Feed',
      aiScore: 92,
      aiSummary: '这是一条中文摘要，汇总了多条 AI 行业消息。',
    }),
    item({
      id: 'hn-digest',
      title: '2026-05-28 Hacker News Top Stories #',
      sourceName: 'BestBlogs.dev',
      aiScore: 90,
      aiSummary: '这是一条中文摘要，汇总了 Hacker News 热门内容。',
    }),
    item({
      id: 'product-signal',
      title: '腾讯推出 Miora AI 创意 Agent Studio 国际版公测',
      sourceName: '智东西',
      aiScore: 82,
      aiSummary: '腾讯推出 Miora AI 创意 Agent Studio 国际版公测，提供面向创意工作流的 Agent 能力。',
    }),
    item({
      id: 'technical-signal',
      title: 'Fractal Skills：给 AI Agent 一副不会过期的缰绳',
      sourceName: 'V2EX - 分享创造',
      category: 'App&效率工具',
      aiScore: 85,
      aiSummary: 'Fractal Skills 通过分层文档组织方式减少 AI Agent 使用过期上下文的风险。',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 2, perSourceLimit: 4 }));

  assert.deepEqual(result.finalCandidates.map((candidate) => candidate.id), [
    'technical-signal',
    'product-signal',
  ]);
  assert.ok(result.scoredCandidates.every((candidate) => !candidate.title.includes('日刊')));
});

test('keeps aggregation digest candidates from dominating the final daily report', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'bestblogs-1',
      title: 'Claude 4.8 炸场！部分能力超过 Mythos',
      sourceName: 'BestBlogs.dev',
      aiScore: 96,
      aiSummary: '这是一条中文摘要，汇总了 Claude 模型进展。',
    }),
    item({
      id: 'bestblogs-2',
      title: '96 年厂二代去工厂帮老板养 Agent',
      sourceName: 'BestBlogs.dev',
      aiScore: 93,
      aiSummary: '这是一条中文摘要，汇总了制造业 Agent 案例。',
    }),
    item({
      id: 'bestblogs-3',
      title: '具身智能十万小时操作数据专题',
      sourceName: 'BestBlogs.dev',
      aiScore: 92,
      aiSummary: '这是一条中文摘要，汇总了具身智能数据观点。',
    }),
    item({
      id: 'direct-1',
      title: 'Anthropic 发布 Claude 企业工作流更新',
      sourceName: 'Anthropic Blog',
      sourceTier: 'T1',
      aiScore: 78,
      aiSummary: 'Anthropic 发布 Claude 企业工作流更新，影响企业 AI 产品落地。',
    }),
    item({
      id: 'direct-2',
      title: '字节开源 Java WebAssembly 运行时 endive',
      sourceName: 'Jdon | 极道',
      category: 'tech-cn',
      aiScore: 76,
      aiSummary: '字节开源 Java WebAssembly 运行时，降低开发者部署门槛。',
    }),
    item({
      id: 'direct-3',
      title: 'Glean ARR 突破 3 亿美元',
      sourceName: 'TechCrunch',
      aiScore: 74,
      aiSummary: 'Glean 企业 AI 搜索收入增长，说明 B 端 AI 预算正在重新分配。',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 6, perSourceLimit: 6 }));

  assert.ok(result.finalCandidates.filter((candidate) => candidate.sourceName === 'BestBlogs.dev').length <= 2);
  assert.deepEqual(result.finalCandidates.filter((candidate) => candidate.id.startsWith('direct-')).map((candidate) => candidate.id), [
    'direct-1',
    'direct-2',
    'direct-3',
  ]);
  assert.match(result.finalCandidates.find((candidate) => candidate.sourceName === 'BestBlogs.dev')!.selectionReason, /聚合源/);
});

test('dedupes repeated daily report events across direct and aggregation sources', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'direct-claude',
      title: 'Claude双王炸！官宣融资4407亿，最强通用模型Opus 4.8登场',
      sourceName: '智东西',
      aiScore: 85,
      aiSummary: 'Claude Opus 4.8 发布并伴随融资消息，是今天 AI 模型与资本市场的重要事件。',
    }),
    item({
      id: 'aggregate-claude',
      title: 'Claude 4.8 炸场！部分能力超过 Mythos，支持数百子智能体并行',
      sourceName: 'BestBlogs.dev',
      aiScore: 95,
      aiSummary: '这是一条中文摘要，汇总了 Claude 4.8 模型能力进展。',
    }),
    item({
      id: 'glean',
      title: 'Glean ARR 突破 3 亿美元',
      sourceName: 'TechCrunch',
      aiScore: 74,
      aiSummary: 'Glean 企业 AI 搜索收入增长，说明 B 端 AI 预算正在重新分配。',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5, perSourceLimit: 5 }));

  assert.deepEqual(result.finalCandidates.map((candidate) => candidate.id), ['direct-claude', 'glean']);
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
  assert.equal(result.excluded[0].sourceName, '测试信源');
  assert.equal(result.excluded[0].category, 'AI');
  assert.equal(result.excluded[0].aiScore, 92);
  assert.equal(result.excluded[0].translationStatus, 'failed');
  assert.equal(result.excluded[0].detail, 'translation model unavailable');
});

test('does not count original-Chinese skipped translations as translation failures', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'zh-title-skipped-translation',
      title: 'Grok 视频模型登顶图生视频榜首',
      aiScore: 86,
      aiSummary: 'Grok image to video model reaches the top of an arena leaderboard.',
      language: 'en',
      translationStatus: 'pending',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5, requireChinese: true }), {
    translateItem: async (candidate) => ({
      ...candidate,
      translationStatus: 'skipped',
      translationReason: '原文已是中文',
      language: 'zh',
    }),
  });

  assert.equal(result.funnel.translationPending, 1);
  assert.equal(result.funnel.translationFailed, 0);
  assert.equal(result.finalCandidates.length, 1);
  assert.equal(result.finalCandidates[0].reportSummary, 'Grok 视频模型登顶图生视频榜首');
});

test('keeps pending translation candidates visible in preview mode without admitting them to generation by default', async () => {
  const englishCandidate = item({
    id: 'en-preview',
    title: 'AI Data Centers Are Deeply Unpopular',
    aiScore: 91,
    aiSummary: 'AI data centers face resistance from local communities.',
    language: 'en',
    translationStatus: 'pending',
  });
  const config = normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5, requireChinese: true });

  const generation = await prepareDailyReportCandidates([englishCandidate], config);
  assert.equal(generation.funnel.translationPending, 1);
  assert.equal(generation.funnel.translationFailed, 1);
  assert.equal(generation.finalCandidates.length, 0);

  const preview = await prepareDailyReportCandidates([englishCandidate], config, {
    allowPendingTranslationCandidates: true,
  });
  assert.equal(preview.funnel.translationPending, 1);
  assert.equal(preview.funnel.translationFailed, 0);
  assert.equal(preview.finalCandidates.length, 1);
  assert.equal(preview.finalCandidates[0].id, 'en-preview');
  assert.equal(preview.finalCandidates[0].chineseReady, false);
});

test('does not translate English items that cannot enter the daily report scope', async () => {
  let translateCalls = 0;
  const result = await prepareDailyReportCandidates([
    item({
      id: 'offscope-en',
      title: 'A personal note about weekend reading',
      category: 'Life Style',
      aiTags: [],
      aiScore: 40,
      aiSummary: 'A personal note about weekend reading habits.',
      language: 'en',
      translationStatus: 'pending',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5, requireChinese: true }), {
    translateItem: async () => {
      translateCalls += 1;
      return { translationStatus: 'ready', aiTranslation: '不应被调用。' };
    },
  });

  assert.equal(translateCalls, 0);
  assert.equal(result.funnel.scopeMatched, 0);
  assert.equal(result.funnel.translationPending, 0);
  assert.equal(result.funnel.translationFailed, 0);
  assert.equal(result.finalCandidates.length, 0);
  assert.equal(result.excluded[0].reason, 'not_selected');
});

test('excludes non scoped content from latest fallback', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'life-tool-1',
      title: '一篇关于周末阅读习惯的观察',
      category: 'Life Style',
      aiTags: [],
      aiScore: 35,
      aiSummary: '作者记录了周末阅读习惯的变化，适合稍后扫读。',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5, enableLatestFallback: true }));

  assert.equal(result.funnel.scopeMatched, 0);
  assert.equal(result.selectionMode, 'empty');
  assert.equal(result.finalCandidates.length, 0);
  assert.equal(result.excluded[0].reason, 'not_selected');
});

test('summarizes excluded candidates by reason with stable samples', () => {
  const summary = summarizeDailyReportExcludedCandidates([
    { id: 'noise-1', title: 'A股行情震荡', reason: 'business_noise', detail: '泛商业噪声' },
    { id: 'noise-2', title: '融资公告', reason: 'business_noise', detail: '泛商业噪声' },
    { id: 'translation-1', title: 'AI data centers', reason: 'translation_failed', detail: 'translation unavailable' },
    { id: 'selected-1', title: '周末阅读', reason: 'not_selected', detail: '未达到精选分' },
  ], 1);

  assert.equal(summary.total, 4);
  assert.deepEqual(summary.byReason.map((group) => [group.reason, group.count]), [
    ['translation_failed', 1],
    ['business_noise', 2],
    ['not_selected', 1],
  ]);
  assert.equal(summary.byReason.find((group) => group.reason === 'business_noise')?.samples.length, 1);
  assert.equal(summary.byReason.find((group) => group.reason === 'business_noise')?.samples[0].id, 'noise-1');
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

test('keeps broad finance and stock movement items out of review and latest fallback', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'market-noise',
      title: '恒指开盘涨0.34%，快手涨超9%',
      category: 'News',
      sourceName: '36kr',
      aiTags: ['商业'],
      aiScore: 50,
      filterBucket: 'main',
      isFiltered: false,
      filterReason: '低分复核：原 AI 分数门槛不再作为硬过滤',
      qualityDecision: 'review',
      aiSummary: '港股开盘走高，快手涨幅明显，指数短线波动。',
    }),
    item({
      id: 'ai-review',
      title: 'OpenAI 发布面向企业的 Agent 工作流更新',
      category: 'AI',
      aiTags: ['Agent'],
      aiScore: 50,
      filterBucket: 'main',
      isFiltered: false,
      filterReason: '低分复核：原 AI 分数门槛不再作为硬过滤',
      qualityDecision: 'review',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5, enableLatestFallback: true }));

  assert.equal(classifyDailyReportReviewBucket(result.reviewCandidates[0]), 'ai_tech_review');
  assert.equal(result.selectionMode, 'review');
  assert.deepEqual(result.finalCandidates.map((entry) => entry.id), ['ai-review']);
  assert.equal(result.excluded.find((entry) => entry.id === 'market-noise')?.reason, 'business_noise');
});

test('keeps high scoring brokerage regulation cleanup out of scored daily candidates', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'brokerage-cleanup',
      title: '富途老虎长桥之后，未被点名的华盛证券也将清理内地业务',
      sourceName: '36kr',
      category: 'uncategorized',
      aiScore: 66.51,
      aiTags: ['华盛证券', '跨境券商', '内地业务清理', '监管整治'],
      aiSummary: '跨境券商华盛证券发布通知，暂停股票等品种在内地的新开仓、加仓交易，落实行业监管要求。',
    }),
    item({
      id: 'ai-regulation',
      title: '欧盟发布 AI 模型监管实施细则',
      category: 'AI',
      aiScore: 78,
      aiTags: ['AI监管', '模型治理'],
      aiSummary: '欧盟发布 AI 模型监管实施细则，明确大模型透明度、安全评估和企业合规要求。',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 60, topN: 5, enableLatestFallback: true }));

  assert.deepEqual(result.finalCandidates.map((entry) => entry.id), ['ai-regulation']);
  assert.equal(result.excluded.find((entry) => entry.id === 'brokerage-cleanup')?.reason, 'business_noise');
  assert.equal(classifyDailyReportReviewBucket(result.finalCandidates[0]), 'ai_tech_review');
});

test('keeps generic securities regulator speeches out of scored daily candidates', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'securities-regulator-speech',
      title: '证监会主席吴清：坚决遏制概念炒作、复杂嵌套、过度投机、通道空转等伪创新、乱创新',
      sourceName: '36kr',
      category: 'uncategorized',
      aiScore: 76.17,
      aiTags: ['证监会主席吴清', '基金业协会', '创新', '伪创新', '乱创新', '科技赋能', '错位发展', '风险防控', '数字化转型'],
      aiSummary: '证监会主席吴清在中国证券投资基金业协会第四届会员代表大会上致辞，指出人工智能等技术推动基金行业变革，机构需提升创新广度与深度以对接市场需求，加强科技赋能，运用AI、大数据等新技术赋能投研、客服、内控等场景推进数字化转型；同时强调错位发展，头部机构提升综合实力，中小机构立足特色走精品化路线；并要求统筹发展与安全，加强创新风险防控，坚决遏制概念炒作、复杂嵌套、过度投机、通道空转等伪创新、乱创新。',
    }),
    item({
      id: 'ai-regulation',
      title: '欧盟发布 AI 模型监管实施细则',
      category: 'AI',
      aiScore: 78,
      aiTags: ['AI监管', '模型治理'],
      aiSummary: '欧盟发布 AI 模型监管实施细则，明确大模型透明度、安全评估和企业合规要求。',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 55, topN: 5, enableLatestFallback: true }));

  assert.deepEqual(result.finalCandidates.map((entry) => entry.id), ['ai-regulation']);
  assert.equal(result.excluded.find((entry) => entry.id === 'securities-regulator-speech')?.reason, 'business_noise');
});

test('keeps bond market financing news out of scored daily candidates', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'dim-sum-bond',
      title: '境外发行人前5个月发行规模超去年全年 外资积极入场助点心债热度高企',
      sourceName: '36kr',
      category: 'uncategorized',
      aiScore: 64.8,
      aiTags: ['点心债', '外资入场', '发行规模', '人民币国际化', '金融市场开放'],
      aiSummary: '在美元融资成本高企、全球资本寻求资金避风港的背景下，香港点心债市场热度高企。今年前5个月点心债发行规模达4300亿元，境外发行人规模超过去年全年，外资机构参与度显著提升。',
    }),
    item({
      id: 'ai-infrastructure',
      title: '英伟达发布新一代 AI 服务器平台',
      category: 'AI',
      aiScore: 74,
      aiTags: ['英伟达', 'AI服务器'],
      aiSummary: '英伟达发布新一代 AI 服务器平台，带来算力基础设施升级。',
    }),
  ], normalizeDailyReportWorkflowConfig({
    minScore: 55,
    topN: 5,
    enableLatestFallback: true,
    scope: {
      categories: ['AI'],
      keywords: ['融资', '商业', '金融'],
      sourceTiers: ['T1'],
    },
  }));

  assert.deepEqual(result.finalCandidates.map((entry) => entry.id), ['ai-infrastructure']);
  assert.equal(result.excluded.find((entry) => entry.id === 'dim-sum-bond')?.reason, 'business_noise');
});

test('labels high score business noise even when it does not match the saved report scope', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'brokerage-out-of-scope',
      title: '富途老虎长桥之后，未被点名的华盛证券也将清理内地业务',
      sourceName: '36kr',
      category: 'uncategorized',
      aiScore: 66.51,
      aiTags: ['华盛证券', '跨境券商', '内地业务清理', '监管整治'],
      aiSummary: '跨境券商华盛证券发布通知，暂停股票等品种在内地的新开仓、加仓交易，落实行业监管要求。',
    }),
  ], normalizeDailyReportWorkflowConfig({
    minScore: 60,
    topN: 5,
    enableLatestFallback: true,
    scope: {
      categories: ['AI'],
      keywords: ['AI', '大模型'],
      sourceTiers: ['T1'],
    },
  }));

  assert.equal(result.funnel.scopeMatched, 0);
  assert.equal(result.finalCandidates.length, 0);
  assert.equal(result.excluded.find((entry) => entry.id === 'brokerage-out-of-scope')?.reason, 'business_noise');
});

test('keeps generic aggregation noise out of fallback-scored daily review', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'generic-bestblogs',
      title: '宋徽宗是怎么耍弄权术的？',
      sourceName: 'BestBlogs.dev',
      category: 'AI',
      aiScore: 45,
      scoreRiskFlags: ['deterministic_fallback', 'ai_scoring_unavailable'],
      aiSummary: '这是一篇历史人物权术解读，与 AI、科技、产品或头部产业信号无关。',
    }),
    item({
      id: 'ai-bestblogs',
      title: '微软发布 Scout 智能体框架',
      sourceName: 'BestBlogs.dev',
      category: 'AI',
      aiScore: 78,
      aiSummary: '微软发布 Scout 智能体框架，影响 AI Agent 工程工作流。',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5, enableLatestFallback: true }));

  assert.equal(result.excluded.find((entry) => entry.id === 'generic-bestblogs')?.reason, 'business_noise');
  assert.equal(result.reviewCandidates.some((entry) => entry.id === 'generic-bestblogs'), false);
  assert.deepEqual(result.finalCandidates.map((entry) => entry.id), ['ai-bestblogs']);
});
