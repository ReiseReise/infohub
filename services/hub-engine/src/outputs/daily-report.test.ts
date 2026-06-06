import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendSceneMarkdownContract,
  buildFinalFallback,
  buildFinalContext,
  buildGenerationScopeMarkdown,
  buildDailyReportInsightConflictUpdate,
  buildModuleContext,
  countMainVisibleItemsForReportFunnel,
  buildSceneRepairPrompt,
  enforceFinalReadingAdvice,
  normalizeDailyReportCandidateFunnelForSnapshot,
  repairSceneMarkdownWithFallback,
  resolveScenePromptTemplate,
  runDailyReportModuleTasks,
  shouldTryDeterministicSceneRepairFirst,
  shouldRunDailyReportAiStage,
  selectDailyReportItems,
  type DailyReportModule,
  type DailyReportSnapshot,
  type TopItem,
} from './daily-report.js';

const visibleItems: TopItem[] = [
  {
    id: 'low-1',
    title: '低分但可见条目',
    url: 'https://example.com/low-1',
    aiScore: 32,
    aiSummary: '有内容，只是分数不高。',
    sourceName: '测试信源',
    category: '测试',
    fetchedAt: '2026-05-12T08:00:00.000Z',
  },
  {
    id: 'low-2',
    title: '未评分可见条目',
    url: 'https://example.com/low-2',
    aiScore: null,
    aiSummary: '可作为降级日报素材。',
    sourceName: '测试信源',
    category: '测试',
    fetchedAt: '2026-05-12T07:00:00.000Z',
  },
];

test('falls back to latest visible items when minScore filters out every visible item', () => {
  const result = selectDailyReportItems(visibleItems, { topN: 5, minScore: 55 });

  assert.equal(result.selectionMode, 'latest_visible');
  assert.deepEqual(result.topItems.map((item) => item.id), ['low-1', 'low-2']);
  assert.equal(result.eligibleItems, 2);
});

test('appends exact markdown section contract for daily report modules', () => {
  const prompt = appendSceneMarkdownContract('decision', '请输出日报决策简报。');

  assert.match(prompt, /## 总体判断/);
  assert.match(prompt, /## 关键变化/);
  assert.match(prompt, /## 风险与机会/);
  assert.match(prompt, /## 下一步动作/);
  assert.match(prompt, /不要省略标题/);
  assert.match(prompt, /全文至少/);
});

test('uses default scene prompt as the primary instruction when configured module prompt is too terse', () => {
  const template = resolveScenePromptTemplate(
    'decision',
    '你是决策简报代理。请基于 {context} 输出：总体判断、关键变化、风险与机会、下一步动作。',
    'daily_report_decision',
  );

  assert.match(template, /必须包含：/);
  assert.match(template, /用户补充要求：/);
  assert.match(template, /输出：总体判断/);
});

test('builds a scene repair prompt that preserves prior output and enforces missing sections', () => {
  const prompt = buildSceneRepairPrompt(
    'reading',
    '## 必读\n\n- 只写了一个标题。',
    '## 必读\n\n- fallback 必读\n\n## 速览\n\n- fallback 速览\n\n## 可跳过\n\n- fallback 可跳过',
    '重点条目：\n1. Agent Studio 发布',
    'missing_sections',
  );

  assert.match(prompt, /请修复并补全上一次不合格的日报模块输出/);
  assert.match(prompt, /不要删除已有有效内容/);
  assert.match(prompt, /不合格原因：missing_sections/);
  assert.match(prompt, /上一次不合格输出：/);
  assert.match(prompt, /只写了一个标题/);
  assert.match(prompt, /可参考的确定性草稿：/);
  assert.match(prompt, /fallback 速览/);
  assert.match(prompt, /## 必读/);
  assert.match(prompt, /## 速览/);
  assert.match(prompt, /## 可跳过/);
  assert.match(prompt, /全文至少/);
});

test('repairs incomplete scene markdown by preserving AI text and filling missing fallback sections', () => {
  const repaired = repairSceneMarkdownWithFallback(
    'reading',
    '## 必读\n\n- AI 已经判断 Agent Studio 是今天最值得读的产品信号。',
    '## 必读\n\n- fallback 必读\n\n## 速览\n\n- fallback 速览\n\n## 可跳过\n\n- fallback 可跳过',
  );

  assert.match(repaired, /AI 已经判断 Agent Studio/);
  assert.match(repaired, /## 速览/);
  assert.match(repaired, /fallback 速览/);
  assert.match(repaired, /## 可跳过/);
  assert.match(repaired, /fallback 可跳过/);
});

test('uses deterministic repair first for structural daily report defects', () => {
  assert.equal(shouldTryDeterministicSceneRepairFirst('missing_sections'), true);
  assert.equal(shouldTryDeterministicSceneRepairFirst('too_short'), true);
  assert.equal(shouldTryDeterministicSceneRepairFirst('truncated'), true);
  assert.equal(shouldTryDeterministicSceneRepairFirst('unknown_provider_error'), false);
});

test('returns empty selection only when there are no visible items', () => {
  const result = selectDailyReportItems([], { topN: 5, minScore: 55 });

  assert.equal(result.selectionMode, 'empty');
  assert.deepEqual(result.topItems, []);
  assert.equal(result.eligibleItems, 0);
});

test('normalizes generated report candidate funnel to the full day counts', () => {
  const funnel = normalizeDailyReportCandidateFunnelForSnapshot({
    todayNew: 72,
    mainVisible: 72,
    scopeMatched: 69,
    scoredCandidates: 9,
    reviewCandidates: 0,
    fallbackScoredCandidates: 0,
    softFilteredRecovered: 0,
    scoreFailedCandidates: 0,
    latestFallbackCandidates: 40,
    translationPending: 2,
    translationFailed: 2,
    finalCandidates: 9,
  }, 172, 72);

  assert.equal(funnel.todayNew, 172);
  assert.equal(funnel.mainVisible, 72);
  assert.equal(funnel.finalCandidates, 9);
});

test('counts main visible report rows from the full day audit set instead of the sampled candidate set', () => {
  const count = countMainVisibleItemsForReportFunnel([
    { isFiltered: false, filterBucket: 'main' },
    { isFiltered: false, filterBucket: 'main' },
    { isFiltered: true, filterBucket: 'filtered' },
    { isFiltered: true, filterBucket: 'main' },
    { isFiltered: false, filterBucket: 'filtered' },
  ]);

  assert.equal(count, 2);
});

test('refreshes generatedAt when updating an existing daily insight row', () => {
  const update = buildDailyReportInsightConflictUpdate({
    summary: '# 今日日报',
    itemCount: 12,
    topics: ['AI'],
    payload: { snapshot: { date: '2026-06-04' } },
  });

  assert.equal(update.summary, '# 今日日报');
  assert.equal(update.itemCount, 12);
  assert.equal(update.pipelineVersion, 3);
  assert.ok(update.generatedAt instanceof Date);
});

test('runs independent daily report content modules concurrently', async () => {
  const started: string[] = [];
  const assigned: string[] = [];
  let releaseDecision!: () => void;
  let releaseResearch!: () => void;

  const decisionDone = new Promise<string>((resolve) => {
    releaseDecision = () => resolve('decision-result');
  });
  const researchDone = new Promise<string>((resolve) => {
    releaseResearch = () => resolve('research-result');
  });

  const running = runDailyReportModuleTasks([
    {
      key: 'decision',
      enabled: true,
      run: async () => {
        started.push('decision');
        return decisionDone;
      },
      assign: (value) => assigned.push(value),
    },
    {
      key: 'research',
      enabled: true,
      run: async () => {
        started.push('research');
        return researchDone;
      },
      assign: (value) => assigned.push(value),
    },
    {
      key: 'reading',
      enabled: false,
      run: async () => {
        started.push('reading');
        return 'reading-result';
      },
      assign: (value) => assigned.push(value),
    },
  ]);

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, ['decision', 'research']);
  assert.deepEqual(assigned, []);

  releaseResearch();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(assigned, ['research-result']);

  releaseDecision();
  await running;
  assert.deepEqual(assigned, ['research-result', 'decision-result']);
});

test('builds compact final context without embedding full module markdown', () => {
  const longModuleMarkdown = [
    '## 总体判断',
    '- 这是前面应该保留的判断。',
    'x'.repeat(5000),
    'MODULE_TAIL_SHOULD_NOT_BE_IN_FINAL_CONTEXT',
  ].join('\n');
  const snapshot: DailyReportSnapshot = {
    date: '2026-05-29',
    totalItems: 120,
    newItems: 42,
    compareWindowDays: 7,
    topItems: Array.from({ length: 12 }, (_, index) => ({
      id: `item-${index}`,
      title: `AI 重点新闻 ${index}`,
      url: `https://example.com/${index}`,
      aiScore: 80 - index,
      aiSummary: `这是第 ${index} 条摘要，说明主要事实和阅读价值。`,
      sourceName: '测试信源',
      category: 'AI',
      fetchedAt: '2026-05-29T08:00:00.000Z',
    })),
    highScoreItems: [],
    byCategory: [{ category: 'AI', count: 8, baselineAvg: 3.2, delta: 4.8 }],
    topSources: [{ sourceName: '测试信源', count: 8 }],
    themeClusters: [{ label: '模型发布', count: 6, sampleTitles: ['AI 重点新闻 0'] }],
    generatedAt: '2026-05-29T10:00:00.000Z',
  };
  const module: DailyReportModule = {
    key: 'decision',
    title: '决策简报',
    markdown: longModuleMarkdown,
    bullets: ['保留结构化要点一', '保留结构化要点二'],
    citations: [],
    meta: { sceneType: 'daily_report_decision', status: 'ai' },
  };

  const context = buildFinalContext(snapshot, {
    summary: '今日 AI 主线清晰。',
    prioritySignals: ['模型发布'],
    themeLabels: ['模型发布'],
    watchlist: ['AI 重点新闻 0'],
  }, {
    decision: module,
    research: { ...module, key: 'research', title: '研究汇总' },
    reading: { ...module, key: 'reading', title: '阅读导航' },
  });

  assert.match(context, /决策简报/);
  assert.match(context, /保留结构化要点一/);
  assert.doesNotMatch(context, /MODULE_TAIL_SHOULD_NOT_BE_IN_FINAL_CONTEXT/);
  assert.ok(context.length < 9000, `final context should be compact, got ${context.length}`);
});

test('builds compact module context from bounded item summaries', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-05-29',
    totalItems: 240,
    newItems: 120,
    compareWindowDays: 7,
    topItems: Array.from({ length: 30 }, (_, index) => ({
      id: `item-${index}`,
      title: `AI 长新闻 ${index}`,
      url: `https://example.com/long-${index}`,
      aiScore: 88 - index,
      aiSummary: `摘要 ${index} ${'很长的背景说明'.repeat(80)} TAIL_${index}`,
      sourceName: '测试信源',
      category: 'AI',
      fetchedAt: '2026-05-29T08:00:00.000Z',
    })),
    highScoreItems: [],
    byCategory: [{ category: 'AI', count: 30, baselineAvg: 4.5, delta: 25.5 }],
    topSources: [{ sourceName: '测试信源', count: 30 }],
    themeClusters: [{ label: '模型发布', count: 18, sampleTitles: ['AI 长新闻 0', 'AI 长新闻 1'] }],
    generatedAt: '2026-05-29T10:00:00.000Z',
  };

  const context = buildModuleContext(snapshot, {
    summary: '清洗摘要',
    prioritySignals: Array.from({ length: 20 }, (_, index) => `信号 ${index}`),
    themeLabels: ['模型发布'],
    watchlist: ['AI 长新闻 0'],
  }, 'research');

  assert.match(context, /当前模块要求/);
  assert.match(context, /AI 长新闻 0/);
  assert.doesNotMatch(context, /TAIL_12/);
  assert.ok(context.length < 7500, `module context should be compact, got ${context.length}`);
});

test('fast daily report mode skips blocking pre-final AI stages but keeps final synthesis', () => {
  assert.equal(shouldRunDailyReportAiStage('fast', 'cleaning', true, 'full'), false);
  assert.equal(shouldRunDailyReportAiStage('fast', 'decision', true, 'full'), false);
  assert.equal(shouldRunDailyReportAiStage('fast', 'research', true, 'full'), false);
  assert.equal(shouldRunDailyReportAiStage('fast', 'reading', true, 'full'), false);
  assert.equal(shouldRunDailyReportAiStage('fast', 'final', true, 'full'), true);
  assert.equal(shouldRunDailyReportAiStage('full', 'research', true, 'full'), true);
  assert.equal(shouldRunDailyReportAiStage('full', 'research', false, 'full'), false);
  assert.equal(shouldRunDailyReportAiStage('full', 'research', true, 'decision'), false);
});

test('final fallback does not repeat the same lead item across every section', () => {
  const leadTitle = 'Claude双王炸！官宣融资4407亿，最强通用模型Opus 4.8登场';
  const snapshot: DailyReportSnapshot = {
    date: '2026-05-29',
    totalItems: 240,
    newItems: 120,
    compareWindowDays: 7,
    topItems: [
      {
        id: 'claude',
        title: leadTitle,
        url: 'https://example.com/claude',
        aiScore: 85,
        aiSummary: 'Anthropic 发布 Claude Opus 4.8，并披露融资与成本变化。',
        sourceName: '智东西',
        category: 'AI',
        selectionMode: 'scored',
        fetchedAt: '2026-05-29T08:00:00.000Z',
      },
      {
        id: 'groq',
        title: 'Groq 转型 AI 推理云',
        url: 'https://example.com/groq',
        aiScore: 82,
        aiSummary: 'Groq 转向推理云服务。',
        sourceName: 'TechCrunch',
        category: 'AI',
        selectionMode: 'scored',
        fetchedAt: '2026-05-29T08:10:00.000Z',
      },
      {
        id: 'detect',
        title: '腾讯朱雀 AI 检测方法实测',
        url: 'https://example.com/detect',
        aiScore: 78,
        aiSummary: 'AI 内容检测工具实测。',
        sourceName: 'V2EX',
        category: 'AI',
        selectionMode: 'scored',
        fetchedAt: '2026-05-29T08:20:00.000Z',
      },
    ],
    highScoreItems: [],
    byCategory: [{ category: 'AI', count: 71, baselineAvg: 26.9, delta: 44.1 }],
    topSources: [{ sourceName: '智东西', count: 3 }],
    themeClusters: [{ label: '模型发布', count: 6, sampleTitles: [leadTitle] }],
    generatedAt: '2026-05-29T10:00:00.000Z',
  };

  const fallback = buildFinalFallback(snapshot, {
    summary: `今日头部信号包括 ${leadTitle}，以及推理云和检测工具进展。`,
    prioritySignals: [leadTitle, 'Groq 转型 AI 推理云', '腾讯朱雀 AI 检测方法实测'],
    themeLabels: ['模型发布', '推理云', 'AI 检测'],
    watchlist: [leadTitle],
    domainBuckets: {
      model_releases: [leadTitle],
      industry: ['Groq 转型 AI 推理云'],
      tips: ['腾讯朱雀 AI 检测方法实测'],
    },
  }, {});

  const repeatedTitleCount = (fallback.markdown.match(new RegExp(leadTitle, 'g')) || []).length;
  assert.ok(repeatedTitleCount <= 2, `lead title repeated ${repeatedTitleCount} times`);
  assert.doesNotMatch(fallback.markdown, /先读 《Claude双王炸/);
});

test('generation scope explains whether the report used fast or full mode', () => {
  const scope = buildGenerationScopeMarkdown({
    date: '2026-05-29',
    totalItems: 240,
    newItems: 120,
    generationMode: 'fast',
    compareWindowDays: 7,
    topItems: [],
    highScoreItems: [],
    byCategory: [],
    topSources: [],
    themeClusters: [],
    generatedAt: '2026-05-29T10:00:00.000Z',
    candidateFunnel: {
      todayNew: 120,
      mainVisible: 72,
      scopeMatched: 68,
      scoredCandidates: 12,
      reviewCandidates: 0,
      fallbackScoredCandidates: 3,
      softFilteredRecovered: 0,
      scoreFailedCandidates: 0,
      latestFallbackCandidates: 26,
      translationPending: 0,
      translationFailed: 0,
      finalCandidates: 12,
    },
  });

  assert.match(scope, /生成模式：快速交付/);
  assert.match(scope, /清洗\/决策\/研究\/阅读不阻塞/);
  assert.match(scope, /低置信兜底候选：3 条/);
});

test('final fallback reading advice separates must read, skim and defer choices', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-05-29',
    totalItems: 120,
    newItems: 42,
    compareWindowDays: 7,
    topItems: [
      {
        id: 'lead',
        title: 'Claude Opus 4.8 发布',
        url: 'https://example.com/lead',
        aiScore: 86,
        aiSummary: '模型升级。',
        sourceName: '智东西',
        category: 'AI',
        selectionMode: 'scored',
      },
      {
        id: 'tool',
        title: 'Win11 AI 一键工具',
        url: 'https://example.com/tool',
        aiScore: 72,
        aiSummary: '工具更新。',
        sourceName: 'V2EX',
        category: 'App&效率工具',
        selectionMode: 'scored',
      },
      {
        id: 'fallback',
        title: 'AI 行业轻量动态',
        url: 'https://example.com/fallback',
        aiScore: 43,
        aiSummary: '可暂缓。',
        sourceName: '聚合源',
        category: 'AI',
        selectionMode: 'latest_visible',
      },
    ],
    highScoreItems: [],
    byCategory: [],
    topSources: [],
    themeClusters: [],
    generatedAt: '2026-05-29T10:00:00.000Z',
  };

  const fallback = buildFinalFallback(snapshot, {
    summary: '今日 AI 主线明确。',
    prioritySignals: ['Claude Opus 4.8 发布', 'Win11 AI 一键工具'],
    themeLabels: ['模型发布', '工具'],
    watchlist: [],
  }, {});

  assert.match(fallback.markdown, /### 先读/);
  assert.match(fallback.markdown, /### 扫读/);
  assert.match(fallback.markdown, /### 暂缓/);
  assert.match(fallback.markdown, /AI 行业轻量动态/);
});

test('final fallback reading advice links titles directly instead of ordinal cross references', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-05-29',
    totalItems: 120,
    newItems: 42,
    compareWindowDays: 7,
    topItems: [
      {
        id: 'lead',
        title: 'Claude Opus 4.8 发布',
        url: 'https://example.com/lead',
        aiScore: 86,
        aiSummary: '模型升级。',
        sourceName: '智东西',
        category: 'AI',
        selectionMode: 'scored',
      },
    ],
    highScoreItems: [],
    byCategory: [],
    topSources: [],
    themeClusters: [],
    generatedAt: '2026-05-29T10:00:00.000Z',
  };

  const fallback = buildFinalFallback(snapshot, {
    summary: '今日 AI 主线明确。',
    prioritySignals: ['Claude Opus 4.8 发布'],
    themeLabels: ['模型发布'],
    watchlist: [],
  }, {});

  assert.doesNotMatch(fallback.markdown, /见头部舆论\/新闻焦点第 \d+ 条/);
  assert.match(fallback.markdown, /\[Claude Opus 4\.8 发布\]\(https:\/\/example\.com\/lead\)/);
});

test('final ai markdown reading advice is rewritten into deterministic reading tiers', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-05-29',
    totalItems: 120,
    newItems: 42,
    compareWindowDays: 7,
    topItems: [
      {
        id: 'lead',
        title: 'Claude Opus 4.8 发布',
        url: 'https://example.com/lead',
        aiScore: 86,
        aiSummary: '模型升级。',
        sourceName: '智东西',
        category: 'AI',
        selectionMode: 'scored',
      },
      {
        id: 'fallback',
        title: '泛 AI 轻量动态',
        url: 'https://example.com/fallback',
        aiScore: 42,
        aiSummary: '低优先级动态。',
        sourceName: '聚合源',
        category: 'AI',
        selectionMode: 'latest_visible',
      },
    ],
    highScoreItems: [],
    byCategory: [],
    topSources: [],
    themeClusters: [],
    generatedAt: '2026-05-29T10:00:00.000Z',
  };
  const aiMarkdown = [
    '## 今日结论',
    '',
    '今日 AI 主线明确。',
    '',
    '## 阅读建议',
    '',
    '1. **深度研究**：旧式主题列表。',
    '2. **技术实践**：旧式主题列表。',
    '',
    '## 下一步动作',
    '',
    '- 核对原文。',
  ].join('\n');

  const rewritten = enforceFinalReadingAdvice(aiMarkdown, snapshot);

  assert.match(rewritten, /### 先读/);
  assert.match(rewritten, /### 扫读/);
  assert.match(rewritten, /### 暂缓/);
  assert.match(rewritten, /泛 AI 轻量动态/);
  assert.doesNotMatch(rewritten, /见头部舆论\/新闻焦点第 \d+ 条/);
  assert.match(rewritten, /来自最新兜底或低分内容/);
  assert.doesNotMatch(rewritten, /深度研究/);
  assert.match(rewritten, /## 下一步动作/);
});

test('final ai markdown removes dangling truncated conclusion fragments', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-05-29',
    totalItems: 120,
    newItems: 42,
    compareWindowDays: 7,
    topItems: [
      {
        id: 'lead',
        title: 'Claude Opus 4.8 发布',
        url: 'https://example.com/lead',
        aiScore: 86,
        aiSummary: '模型升级。',
        sourceName: '智东西',
        category: 'AI',
        selectionMode: 'scored',
      },
    ],
    highScoreItems: [],
    byCategory: [],
    topSources: [],
    themeClusters: [],
    generatedAt: '2026-05-29T10:00:00.000Z',
  };
  const aiMarkdown = [
    '## 今日结论',
    '',
    '今日新增50条内容，内容结构向垂直化Blogs倾斜。AI',
    '',
    '## 关键进展',
    '',
    '- 旧关键进展。',
    '',
    '## 阅读建议',
    '',
    '- 旧阅读建议。',
    '',
    '## 下一步动作',
    '',
    '- 继续关注。',
  ].join('\n');

  const rewritten = enforceFinalReadingAdvice(aiMarkdown, snapshot);

  assert.match(rewritten, /内容结构向垂直化Blogs倾斜。/);
  assert.doesNotMatch(rewritten, /倾斜。AI\s*\n\n## 关键进展/);
});

test('final ai markdown completes conclusion punctuation and rewrites industry signals deterministically', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-05-29',
    totalItems: 120,
    newItems: 42,
    compareWindowDays: 7,
    topItems: [
      {
        id: 'infra',
        title: '特锐德推出算力中心供电站“算电岛”',
        url: 'https://example.com/infra',
        aiScore: 92,
        aiSummary: '算力中心供电基础设施更新。',
        reportSummary: '算力中心供电基础设施更新。',
        sourceName: '36kr',
        category: 'AI',
        selectionMode: 'scored',
      },
      {
        id: 'pluralistic',
        title: 'Pluralistic: Refining humanity',
        url: 'https://example.com/pluralistic',
        aiScore: 63,
        aiSummary: '技术与人文讨论。',
        sourceName: 'pluralistic.net',
        category: 'Blogs',
        selectionMode: 'scored',
      },
    ],
    highScoreItems: [],
    byCategory: [],
    topSources: [],
    themeClusters: [],
    generatedAt: '2026-05-29T10:00:00.000Z',
  };
  const aiMarkdown = [
    '## 今日结论',
    '',
    '今日 AI 产业信号突出',
    '',
    '## 关键进展',
    '',
    '- 旧关键进展。',
    '',
    '## 头部舆论/新闻焦点',
    '',
    '- 旧焦点。',
    '',
    '## AI 产业与产品信号',
    '',
    '- 产品发布/更新：Pluralistic: Refining humanity',
    '',
    '## 阅读建议',
    '',
    '- 旧阅读建议。',
    '',
    '## 下一步动作',
    '',
    '- 继续关注。',
  ].join('\n');

  const rewritten = enforceFinalReadingAdvice(aiMarkdown, snapshot);

  assert.match(rewritten, /今日 AI 产业信号突出。/);
  assert.match(rewritten, /## AI 产业与产品信号/);
  assert.match(rewritten, /\[特锐德推出算力中心供电站“算电岛”\]\(https:\/\/example\.com\/infra\)/);
  assert.match(rewritten, /\[Pluralistic: Refining humanity\]\(https:\/\/example\.com\/pluralistic\)/);
  assert.doesNotMatch(rewritten, /产品发布\/更新：Pluralistic/);
});

test('final ai markdown next actions are rewritten into deterministic action plan', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-05-29',
    totalItems: 120,
    newItems: 42,
    compareWindowDays: 7,
    topItems: [
      {
        id: 'lead',
        title: 'Claude Opus 4.8 发布',
        url: 'https://example.com/lead',
        aiScore: 86,
        aiSummary: '模型升级。',
        sourceName: '智东西',
        category: 'AI',
        selectionMode: 'scored',
      },
    ],
    highScoreItems: [],
    byCategory: [],
    topSources: [],
    themeClusters: [],
    generatedAt: '2026-05-29T10:00:00.000Z',
    candidateFunnel: {
      todayNew: 42,
      mainVisible: 40,
      scopeMatched: 16,
      scoredCandidates: 8,
      reviewCandidates: 0,
      fallbackScoredCandidates: 2,
      softFilteredRecovered: 0,
      scoreFailedCandidates: 1,
      latestFallbackCandidates: 0,
      translationPending: 0,
      translationFailed: 1,
      finalCandidates: 8,
    },
  };
  const aiMarkdown = [
    '## 今日结论',
    '',
    '今日 AI 主线明确。',
    '',
    '## 关键进展',
    '',
    '- 模型发布值得关注。',
    '',
    '## 头部舆论/新闻焦点',
    '',
    '- Claude Opus 4.8 发布。',
    '',
    '## AI 产业与产品信号',
    '',
    '- 模型能力升级。',
    '',
    '## 阅读建议',
    '',
    '- 旧阅读建议。',
    '',
    '## 下一步动作',
    '',
    '- 继续关注行业动态。',
  ].join('\n');

  const rewritten = enforceFinalReadingAdvice(aiMarkdown, snapshot);

  assert.match(rewritten, /按“阅读建议”完成原文核对/);
  assert.match(rewritten, /低置信兜底\/评分失败\/翻译失败候选/);
  assert.match(rewritten, /重新预览候选池/);
  assert.doesNotMatch(rewritten, /继续关注行业动态/);
});

test('final ai markdown key progress is aligned with top selected items', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-05-29',
    totalItems: 120,
    newItems: 42,
    compareWindowDays: 7,
    topItems: [
      {
        id: 'lead',
        title: 'Claude Opus 4.8 发布',
        url: 'https://example.com/lead',
        aiScore: 86,
        aiSummary: '模型升级。',
        reportSummary: 'Claude Opus 4.8 发布带来模型能力升级。',
        selectionReason: '达到精选分阈值 70，且匹配日报范围。',
        sourceName: '智东西',
        category: 'AI',
        selectionMode: 'scored',
      },
      {
        id: 'tool',
        title: 'Agent 工作流平台更新',
        url: 'https://example.com/tool',
        aiScore: 74,
        aiSummary: '智能体工具链更新。',
        selectionReason: '产品落地信号明确。',
        sourceName: 'Product Hunt',
        category: 'AI工具',
        selectionMode: 'scored',
      },
    ],
    highScoreItems: [],
    byCategory: [],
    topSources: [],
    themeClusters: [],
    generatedAt: '2026-05-29T10:00:00.000Z',
  };
  const aiMarkdown = [
    '## 今日结论',
    '',
    '今日 AI 主线明确。',
    '',
    '## 关键进展',
    '',
    '- 行业持续发展，值得关注。',
    '',
    '## 头部舆论/新闻焦点',
    '',
    '- Claude Opus 4.8 发布。',
    '',
    '## AI 产业与产品信号',
    '',
    '- 模型能力升级。',
    '',
    '## 阅读建议',
    '',
    '- 旧阅读建议。',
    '',
    '## 下一步动作',
    '',
    '- 继续关注。',
  ].join('\n');

  const rewritten = enforceFinalReadingAdvice(aiMarkdown, snapshot);

  assert.match(rewritten, /\[Claude Opus 4\.8 发布\]\(https:\/\/example\.com\/lead\)/);
  assert.match(rewritten, /入报原因：达到精选分阈值 70/);
  assert.match(rewritten, /\[Agent 工作流平台更新\]\(https:\/\/example\.com\/tool\)/);
  assert.doesNotMatch(rewritten, /行业持续发展，值得关注/);
});
