import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DAILY_REPORT_WORKFLOW,
  classifyDailyReportReviewBucket,
  enforceDailyReportSourceShare,
  looksLikeModelMetaReportSummary,
  looksTruncatedReportSummary,
  normalizeReportSummaryText,
  normalizeDailyReportWorkflowConfig,
  prepareDailyReportCandidates,
  resolveDailyReportSourceLimit,
  isWebpageSnapshotDailyCandidate,
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

test('normalizes legacy T source tiers into the current authority scale', () => {
  const config = normalizeDailyReportWorkflowConfig({
    scope: {
      categories: ['AI'],
      keywords: ['模型'],
      sourceTiers: ['T1', 'T1.5', 'T2', 'A'],
    },
  });

  assert.deepEqual(config.scope.sourceTiers, ['S', 'A']);
});

test('maps reading tiers to conservative main-report source caps', () => {
  assert.equal(resolveDailyReportSourceLimit('high_value', 8), 5);
  assert.equal(resolveDailyReportSourceLimit('light_reading', 8), 2);
  assert.equal(resolveDailyReportSourceLimit('explore', 8), 1);
  assert.equal(resolveDailyReportSourceLimit('paused', 8), 0);
  assert.equal(resolveDailyReportSourceLimit('high_value', 3), 3);
});

test('keeps every source below the main-report 35 percent share cap', () => {
  const result = enforceDailyReportSourceShare([
    ...Array.from({ length: 6 }, (_, index) => ({ sourceName: 'Source A', id: `a-${index}` })),
    ...Array.from({ length: 2 }, (_, index) => ({ sourceName: 'Source B', id: `b-${index}` })),
    ...Array.from({ length: 2 }, (_, index) => ({ sourceName: 'Source C', id: `c-${index}` })),
  ]);
  const counts = result.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.sourceName] = (acc[entry.sourceName] || 0) + 1;
    return acc;
  }, {});
  assert.equal(Math.max(...Object.values(counts)) / result.length <= 0.35, true);
});

test('applies reading-tier caps to main reports but not explicit source reports', async () => {
  const candidates = Array.from({ length: 8 }, (_, index) => item({
    id: `light-${index}`,
    title: `Reuters AI signal ${index}`,
    sourceName: 'Reuters Technology AI',
    readingTier: 'light_reading',
    aiScore: 90 - index,
  }));

  const mainReport = await prepareDailyReportCandidates(candidates, normalizeDailyReportWorkflowConfig({
    topN: 8,
    perSourceLimit: 8,
  }));
  const sourceReport = await prepareDailyReportCandidates(candidates, normalizeDailyReportWorkflowConfig({
    topN: 8,
    perSourceLimit: 8,
    scope: { sourceNames: ['Reuters Technology AI'] },
  }));

  assert.equal(mainReport.finalCandidates.length, 2);
  assert.equal(sourceReport.finalCandidates.length, 8);
});

test('keeps enough default high-score candidates for radar-style daily reports', async () => {
  const categories = ['AI', 'tech', 'tech-cn', 'App&效率工具', 'Product Changelog', '研报&数据'] as const;
  const items = Array.from({ length: 60 }, (_, index) => {
    const category = categories[index % categories.length];
    return item({
      id: `radar-${index}`,
      title: `${category} 高价值信号 ${index}`,
      sourceName: `Radar Source ${index % 12}`,
      category,
      sourceTier: index % 3 === 0 ? 'S' : 'A',
      aiScore: 95 - (index % 25),
      aiSummary: `${category} 的中文摘要 ${index}，包含事实、影响和建议，适合进入模块化日报证据层。`,
    });
  });

  const result = await prepareDailyReportCandidates(items);

  assert.equal(result.selectionMode, 'scored');
  assert.ok(result.finalCandidates.length >= 35);
  assert.ok(new Set(result.finalCandidates.map((candidate) => candidate.category)).size >= 5);
  assert.ok(new Set(result.finalCandidates.map((candidate) => candidate.sourceName)).size >= 8);
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
  assert.match(result.finalCandidates[0].selectionReason, /高价值信号明确/);
  assert.match(result.finalCandidates[0].selectionReason, /AI/);
  assert.match(result.finalCandidates[0].selectionReason, /产品|技术|产业/);
});

test('does not admit leaked structured translation output into daily report material', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'invalid-translation',
      title: 'Claude translation contract update',
      aiSummary: 'The release changes the translation contract and validation rules.',
      aiTranslation: '前置说明 {"translatedTitle":"译文标题","blocks":[{"id":"b0001","markdown":"这不是可展示正文。"}]}',
      language: 'en',
      translationStatus: 'ready',
      contentLength: 1200,
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5, requireChinese: true }));

  assert.equal(result.funnel.translationFailed, 1);
  assert.equal(result.finalCandidates.length, 0);
  assert.equal(result.excluded[0]?.reason, 'translation_failed');
});

test('limits scoped daily report candidates to the configured source ids', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'reuters-1',
      title: 'Reuters AI round-up',
      sourceId: 1362,
      sourceName: 'Reuters Technology AI',
      category: 'uncategorized',
      aiScore: 78,
      aiSummary: '路透科技 AI 线索，涵盖模型发布、监管和产业合作。',
    }),
    item({
      id: 'other-1',
      title: 'Another AI feed item',
      sourceId: 999,
      sourceName: 'Other AI Source',
      category: 'AI',
      aiScore: 88,
      aiSummary: '另一条高分 AI 条目。',
    }),
  ], normalizeDailyReportWorkflowConfig({
    topN: 10,
    minScore: 55,
    scope: {
      categories: ['AI'],
      keywords: ['AI'],
      sourceTiers: ['S', 'A', 'B'],
      sourceIds: [1362],
    },
  }));

  assert.deepEqual(result.finalCandidates.map((candidate) => candidate.id), ['reuters-1']);
  assert.equal(result.funnel.scopeMatched, 1);
  assert.deepEqual(result.excluded, []);
});

test('admits matching source-scoped candidates even when they do not match category or keyword scope', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'reuters-2',
      title: 'Reuters enterprise contracts update',
      sourceId: 1362,
      sourceName: 'Reuters Technology AI',
      category: 'uncategorized',
      aiScore: 74,
      aiSummary: '路透条目主要是企业合作和行业跟进，但属于用户指定的单源日报范围。',
    }),
  ], normalizeDailyReportWorkflowConfig({
    topN: 10,
    minScore: 55,
    scope: {
      categories: ['不存在的分类'],
      keywords: ['不存在的关键词'],
      sourceTiers: [],
      sourceIds: [1362],
    },
  }));

  assert.equal(result.funnel.scopeMatched, 1);
  assert.equal(result.finalCandidates[0]?.id, 'reuters-2');
});

test('uses source-scoped review candidates instead of producing an empty report', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'reuters-review-1',
      title: 'Reuters reports Anthropic expands enterprise partnerships',
      sourceId: 1362,
      sourceName: 'Reuters Technology AI',
      category: 'uncategorized',
      aiScore: 74,
      scoreRiskFlags: ['deterministic_fallback', 'ai_scoring_unavailable'],
      aiSummary: '路透报道称 Anthropic 扩大企业合作，涉及受监管行业落地，但当前评分来自低置信兜底。',
    }),
    item({
      id: 'reuters-review-2',
      title: 'Reuters tracks OpenAI infrastructure hiring',
      sourceId: 1362,
      sourceName: 'Reuters Technology AI',
      category: 'uncategorized',
      aiScore: 71,
      scoreRiskFlags: ['deterministic_fallback'],
      aiSummary: '路透跟进 OpenAI 基础设施招聘，说明算力和交付仍在继续扩张。',
    }),
  ], normalizeDailyReportWorkflowConfig({
    topN: 10,
    minScore: 80,
    scope: {
      categories: ['不存在的分类'],
      keywords: ['不存在的关键词'],
      sourceTiers: [],
      sourceIds: [1362],
    },
  }));

  assert.equal(result.selectionMode, 'review');
  assert.equal(result.funnel.reviewCandidates, 2);
  assert.equal(result.funnel.finalCandidates, 2);
  assert.deepEqual(new Set(result.finalCandidates.map((candidate) => candidate.id)), new Set(['reuters-review-1', 'reuters-review-2']));
  assert.equal(result.excluded.some((candidate) => candidate.reason === 'fallback_scored'), false);
});

test('excludes webpage monitor snapshots from final daily report candidates', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'snapshot-1',
      title: 'Newsroom \\ Anthropic',
      sourceName: 'Anthropic Newsroom',
      sourceType: 'webpage',
      sourceTier: 'S',
      aiScore: 92,
      aiSummary: 'Anthropic 新闻室首页包含 press、support 和 download press kit 等媒体资源入口。',
      snippet: 'press support download press kit',
    }),
    item({
      id: 'news-1',
      title: 'Claude Fable 5 and Claude Mythos 5',
      sourceName: 'Anthropic Newsroom',
      sourceType: 'curated_index',
      sourceTier: 'S',
      aiScore: 88,
      aiSummary: 'Anthropic 发布 Claude Fable 5 与 Claude Mythos 5，面向长任务和专业工作。',
    }),
  ], { topN: 10, minScore: 55 });

  assert.deepEqual(result.finalCandidates.map((candidate) => candidate.id), ['news-1']);
  assert.equal(result.excluded.find((candidate) => candidate.id === 'snapshot-1')?.reason, 'webpage_snapshot');
});

test('detects Anthropic newsroom monitor snapshots without treating index news as snapshots', () => {
  assert.equal(isWebpageSnapshotDailyCandidate({
    title: 'Newsroom \\ Anthropic',
    sourceName: 'Anthropic Newsroom',
    sourceType: 'webpage',
    aiSummary: '媒体咨询 press@anthropic.com，支持入口和 download press kit。',
    snippet: 'press support download press kit',
  }), true);

  assert.equal(isWebpageSnapshotDailyCandidate({
    title: 'Claude Fable 5 and Claude Mythos 5',
    sourceName: 'Anthropic Newsroom',
    sourceType: 'curated_index',
    aiSummary: 'Anthropic 发布新模型。',
    snippet: '模型发布',
  }), false);
});

test('routes fallback-scored items to review and keeps them out of final candidates when there is no fallback material', async () => {
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

test('uses substantial fallback-scored review pool instead of producing an empty daily report', async () => {
  const result = await prepareDailyReportCandidates(
    Array.from({ length: 12 }, (_, index) => item({
      id: `fallback-pool-${index}`,
      title: `Claude Agent 企业工作流更新 ${index}`,
      sourceName: `AI Source ${index % 4}`,
      category: index % 2 === 0 ? 'AI' : 'Agent/产品',
      aiScore: 82 - (index % 5),
      scoreRiskFlags: ['deterministic_fallback', 'ai_scoring_unavailable'],
      aiSummary: `Claude Agent 企业工作流更新 ${index}，具备产品、技术或产业直接增量，但评分来自低置信兜底。`,
    })),
    normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 12, perSourceLimit: 6 }),
  );

  assert.equal(result.selectionMode, 'review');
  assert.equal(result.funnel.scoredCandidates, 0);
  assert.equal(result.funnel.latestFallbackCandidates, 0);
  assert.equal(result.funnel.fallbackScoredCandidates, 12);
  assert.ok(result.finalCandidates.length >= 10);
  assert.ok(result.finalCandidates.every((candidate) => candidate.selectionMode === 'review'));
  assert.ok(result.finalCandidates.every((candidate) => /低置信兜底评分待复核/.test(candidate.selectionReason)));
});

test('uses the available fallback review pool when a low-volume day has enough factual material', async () => {
  const result = await prepareDailyReportCandidates(
    Array.from({ length: 8 }, (_, index) => item({
      id: `fallback-low-volume-${index}`,
      title: `AI 基础设施与模型更新 ${index}`,
      sourceName: `High Value Source ${index % 4}`,
      category: index % 2 === 0 ? 'AI' : '基础设施与算力',
      aiScore: 80 - (index % 4),
      scoreRiskFlags: ['deterministic_fallback', 'ai_scoring_unavailable'],
      aiSummary: `AI 基础设施与模型更新 ${index}，正文和摘要可核验，但模型评分暂时使用低置信兜底。`,
    })),
    normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 18, perSourceLimit: 6 }),
  );

  assert.equal(result.selectionMode, 'review');
  assert.equal(result.funnel.scoredCandidates, 0);
  assert.equal(result.funnel.fallbackScoredCandidates, 8);
  assert.equal(result.finalCandidates.length, 8);
  assert.ok(result.finalCandidates.every((candidate) => candidate.selectionMode === 'review'));
});

test('supplements a thin scored pool with a substantial review pool during daily recovery', async () => {
  const scoredPool = Array.from({ length: 2 }, (_, index) => item({
    id: `scored-recovery-${index}`,
    title: `OpenAI 模型能力正式更新 ${index}`,
    sourceName: `Official Source ${index}`,
    category: 'AI',
    aiScore: 88 - index,
    aiSummary: `OpenAI 模型能力正式更新 ${index}，具备可核验的一手产品与技术增量。`,
  }));
  const fallbackPool = Array.from({ length: 12 }, (_, index) => item({
    id: `fallback-recovery-${index}`,
    title: `AI 产业与基础设施进展 ${index}`,
    sourceName: `Review Source ${index % 4}`,
    category: index % 2 === 0 ? 'AI' : '基础设施与算力',
    aiScore: 82 - (index % 5),
    scoreRiskFlags: ['deterministic_fallback', 'ai_scoring_unavailable'],
    aiSummary: `AI 产业与基础设施进展 ${index}，正文和来源均可核验，但评分暂时来自低置信兜底。`,
  }));

  const result = await prepareDailyReportCandidates(
    [...scoredPool, ...fallbackPool],
    normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 12, perSourceLimit: 6 }),
  );

  assert.equal(result.selectionMode, 'review');
  assert.equal(result.funnel.scoredCandidates, 2);
  assert.equal(result.funnel.fallbackScoredCandidates, 12);
  assert.ok(result.finalCandidates.length >= 10);
  assert.ok(result.finalCandidates.some((candidate) => candidate.id.startsWith('scored-recovery-')));
  assert.ok(result.finalCandidates.some((candidate) => candidate.id.startsWith('fallback-recovery-')));
  assert.equal(
    result.excluded.some((candidate) => (
      candidate.reason === 'fallback_scored'
      && result.finalCandidates.some((selected) => selected.id === candidate.id)
    )),
    false,
  );
});

test('prefers a substantial fallback review pool over a few latest visible candidates', async () => {
  const fallbackPool = Array.from({ length: 12 }, (_, index) => item({
    id: `fallback-with-latest-${index}`,
    title: `AI 模型与 Agent 高价值更新 ${index}`,
    sourceName: `Review Source ${index % 4}`,
    category: index % 2 === 0 ? 'AI' : 'Agent/产品',
    aiScore: 84 - (index % 5),
    scoreRiskFlags: ['deterministic_fallback', 'ai_scoring_unavailable'],
    aiSummary: `AI 模型与 Agent 高价值更新 ${index}，正文与摘要均可核验，但评分链路暂时使用低置信兜底。`,
  }));
  const latestPool = Array.from({ length: 2 }, (_, index) => item({
    id: `latest-alongside-review-${index}`,
    title: `普通工具最新讨论 ${index}`,
    sourceName: `Latest Source ${index}`,
    category: 'App&效率工具',
    aiScore: 42 - index,
    aiSummary: `普通工具最新讨论 ${index}，信息增量有限，仅适合作为最新兜底。`,
  }));

  const result = await prepareDailyReportCandidates(
    [...fallbackPool, ...latestPool],
    normalizeDailyReportWorkflowConfig({
      minScore: 70,
      topN: 12,
      perSourceLimit: 6,
      enableLatestFallback: true,
    }),
  );

  assert.equal(result.selectionMode, 'review');
  assert.equal(result.funnel.scoredCandidates, 0);
  assert.equal(result.funnel.fallbackScoredCandidates, 12);
  assert.equal(result.funnel.latestFallbackCandidates, 2);
  assert.ok(result.finalCandidates.length >= 10);
  assert.ok(result.finalCandidates.every((candidate) => candidate.id.startsWith('fallback-with-latest-')));
  assert.ok(result.finalCandidates.every((candidate) => candidate.selectionMode === 'review'));
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

  assert.equal(result.selectionMode, 'latest_visible');
  assert.equal(result.funnel.fallbackScoredCandidates, 1);
  assert.equal(result.funnel.latestFallbackCandidates, 1);
  assert.equal(result.funnel.finalCandidates, 1);
  assert.equal(result.finalCandidates.length, 1);
  assert.equal(result.finalCandidates[0].id, 'latest-low');
  assert.equal(result.excluded.some((candidate) => candidate.reason === 'fallback_scored'), true);
});

test('admits unscored Claude model release items through latest fallback instead of dropping them', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'claude-fable-raw',
      title: '实测 Claude 史上最强模型 Fable 5，普通人慎用',
      sourceName: 'BestBlogs.dev',
      category: 'AI',
      aiScore: null,
      aiSummary: null,
      snippet: 'Claude Fable 5 是 Anthropic 发布的新一代模型，具备更强的软件工程、科研和长任务能力，值得作为今日 AI 模型主线追踪。',
      processingStatus: 'raw',
      translationStatus: 'pending',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5, enableLatestFallback: true }));

  assert.equal(result.selectionMode, 'latest_visible');
  assert.equal(result.funnel.scopeMatched, 1);
  assert.equal(result.funnel.latestFallbackCandidates, 1);
  assert.equal(result.funnel.finalCandidates, 1);
  assert.equal(result.finalCandidates[0].id, 'claude-fable-raw');
  assert.equal(result.finalCandidates[0].selectionMode, 'latest_visible');
  assert.match(result.finalCandidates[0].selectionReason, /热点信号|最新线索|Claude|模型/);
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
      sourceTier: 'S',
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

test('does not collapse distinct persisted events just because both mention Mythos', async () => {
  const result = await prepareDailyReportCandidates([
    item({ id: 'one', title: 'Claude Mythos 发布技术更新', clusterId: 'model-release', aiScore: 90 }),
    item({ id: 'two', title: 'Claude Mythos 遭遇服务故障', clusterId: 'service-outage', aiScore: 89 }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5, perSourceLimit: 5 }));
  assert.deepEqual(result.finalCandidates.map((entry) => entry.id).sort(), ['one', 'two']);
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

test('pending queue work remains visible as pending and is not counted as a model failure', async () => {
  const candidate = item({ id: 'still-queued', title: 'OpenAI releases a new model', aiScore: 90,
    aiSummary: 'The release introduces new capabilities.', language: 'en', translationStatus: 'pending' });
  const result = await prepareDailyReportCandidates([candidate], { requireChinese: true }, {
    translateItem: async () => ({ translationStatus: 'pending', translationReason: '中文化任务仍在排队或处理中' }),
  });
  assert.equal(result.funnel.translationPending, 1);
  assert.equal(result.funnel.translationFailed, 0);
  assert.equal(result.finalCandidates.length, 0);
  assert.match(result.excluded[0].detail || '', /排队或处理中/);
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

test('does not report policy-skipped English translations as model failures', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'en-low-score-policy-skip',
      title: 'Winamp launches a creator marketplace',
      aiScore: 48,
      aiSummary: 'Winamp launches a marketplace for music creators.',
      language: 'en',
      translationStatus: 'pending',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 55, topN: 5, requireChinese: true }), {
    translateItem: async (candidate) => ({
      ...candidate,
      translationStatus: 'skipped',
      translationReason: 'AI 评分过低，跳过翻译',
    }),
  });

  assert.equal(result.funnel.translationPending, 0);
  assert.equal(result.funnel.translationFailed, 0);
  assert.equal(result.finalCandidates.length, 0);
  assert.equal(result.excluded[0].reason, 'not_selected');
  assert.equal(result.excluded[0].detail, 'AI 评分过低，跳过翻译');
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

test('keeps market headlines out of latest fallback even when summaries contain polluted Claude text', async () => {
  const result = await prepareDailyReportCandidates([
    item({
      id: 'polluted-market',
      title: '现货黄金日内跌幅扩大至2%',
      category: 'uncategorized',
      sourceName: '36kr',
      aiTags: ['Claude Fable 5'],
      aiScore: 51,
      filterBucket: 'main',
      isFiltered: false,
      aiSummary: '市场短线波动，同时另一条快讯提到 Claude Fable 5 发布。',
    }),
    item({
      id: 'real-claude',
      title: 'Initial impressions of Claude Fable 5',
      category: 'AI',
      sourceName: 'simonwillison.net',
      aiScore: null,
      filterBucket: 'main',
      isFiltered: false,
      snippet: 'Claude Fable 5 是 Anthropic 发布的新模型，值得跟踪其工程能力变化。',
    }),
  ], normalizeDailyReportWorkflowConfig({ minScore: 70, topN: 5, enableLatestFallback: true }));

  assert.equal(result.selectionMode, 'latest_visible');
  assert.deepEqual(result.finalCandidates.map((entry) => entry.id), ['real-claude']);
  assert.equal(result.latestFallbackCandidates.some((entry) => entry.id === 'polluted-market'), false);
  assert.equal(result.excluded.find((entry) => entry.id === 'polluted-market')?.reason, 'business_noise');
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
      sourceTiers: ['S'],
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
      sourceTiers: ['S'],
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
