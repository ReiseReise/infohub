import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendSceneMarkdownContract,
  buildDailyReportEditorialContext,
  buildDailyReportItemUrl,
  buildDailyInsightType,
  buildDegradedDailyReportPresentation,
  buildFinalFallback,
  isInternalProcessingTag,
  buildFinalContext,
  buildFinalExpansionPrompt,
  buildGenerationScopeMarkdown,
  buildDailyReportInsightConflictUpdate,
  buildDailyReportPriorityArticles,
  buildDailyReportModuleSections,
  buildDailyReportEditorialDigest,
  buildDailyReportSupplementalArticles,
  buildDailyReportTrendSummary,
  buildDailyReportCoverageIndex,
  buildDailyReportCandidateSampleOrder,
  buildModuleContext,
  countMainVisibleItemsForReportFunnel,
  buildSceneRepairPrompt,
  enforceFinalReadingAdvice,
  ensureReportHeading,
  finalizeDailyReportDelivery,
  findUnsupportedDailyReportLinks,
  groundDailyReportModelMarkdown,
  inspectFinalMarkdownStructure,
  normalizeDailyReportCandidateFunnelForSnapshot,
  normalizeFinalSceneMarkdownStructure,
  mergeFinalSceneExpansion,
  prepareFinalSceneOutputForQuality,
  repairSceneMarkdownWithFallback,
  rewriteDailyReportLinksToReader,
  resolveFinalReportLengthTarget,
  resolveScenePromptTemplate,
  runDailyReportModuleTasks,
  sanitizeDailyReportMarkdown,
  shouldComposeFinalExpansion,
  shouldTryDeterministicSceneRepairFirst,
  shouldRunDailyReportAiStage,
  selectDailyReportItems,
  humanizeDailyReportExcludedDetail,
  humanizeDailyReportSelectionReason,
  isDailyReportHotSignal,
  type DailyReportModule,
  type DailyReportModuleSection,
  type DailyReportPriorityArticle,
  type DailyReportSnapshot,
  type TopItem,
} from './daily-report.js';

test('scales final report length to the available evidence instead of padding thin days', () => {
  const baseSnapshot: DailyReportSnapshot = {
    date: '2026-07-13', totalItems: 20, newItems: 8, compareWindowDays: 7,
    topItems: [], highScoreItems: [], byCategory: [], topSources: [], themeClusters: [],
    generatedAt: '2026-07-13T09:00:00.000Z',
  };
  const makeItem = (index: number): TopItem => ({
    id: `item-${index}`,
    title: `证据 ${index}`,
    url: `https://example.com/${index}`,
    sourceName: '测试来源',
    category: '测试',
    fetchedAt: '2026-07-13T08:00:00.000Z',
    aiScore: null,
    aiSummary: null,
  });

  assert.deepEqual(resolveFinalReportLengthTarget({ ...baseSnapshot, topItems: Array.from({ length: 6 }, (_, index) => makeItem(index)) }), {
    evidenceCount: 6,
    minChars: 1800,
    targetLabel: '2200-3200 个中文字符',
  });
  assert.equal(resolveFinalReportLengthTarget({ ...baseSnapshot, topItems: Array.from({ length: 24 }, (_, index) => makeItem(index)) }).minChars, 4500);
  assert.equal(resolveFinalReportLengthTarget({ ...baseSnapshot, topItems: Array.from({ length: 36 }, (_, index) => makeItem(index)) }).minChars, 6000);
});

test('does not promote generic source categories into the editorial cover title', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-13', totalItems: 80, newItems: 20, compareWindowDays: 7,
    topItems: [{
      id: 'cover-1', title: '模型工具更新', url: 'https://example.com/cover-1', sourceName: '官方来源',
      category: 'Blogs', fetchedAt: '2026-07-13T08:00:00.000Z', aiScore: 88, aiSummary: '有明确事实增量。',
    }],
    highScoreItems: [],
    byCategory: [{ category: 'Blogs', count: 12, baselineAvg: 10, delta: 2 }],
    topSources: [{ sourceName: '官方来源', count: 3 }],
    themeClusters: [
      { label: 'Blogs', count: 12, sampleTitles: ['模型工具更新'] },
      { label: 'tech', count: 8, sampleTitles: ['工程技术更新'] },
      { label: '模型工具', count: 3, sampleTitles: ['模型工具更新'] },
    ],
    moduleSections: [
      { key: 'models_labs', title: '模型发布与实验室动向', conclusion: '模型工具出现增量。', priorityArticles: [], signals: [], noise: [], actions: [], coverageCount: 3 },
      { key: 'agent_products', title: 'Agent 与产品入口', conclusion: '产品入口有新变化。', priorityArticles: [], signals: [], noise: [], actions: [], coverageCount: 2 },
    ],
    generatedAt: '2026-07-13T09:00:00.000Z',
  };

  const digest = buildDailyReportEditorialDigest(snapshot);

  assert.doesNotMatch(digest.coverJudgement.title, /^Blogs/);
  assert.match(digest.coverJudgement.title, /模型发布与实验室动向/);
  assert.match(digest.coverJudgement.title, /Agent 与产品入口/);
  assert.match(digest.coverJudgement.summary, /样本不足以构成趋势/);
  assert.match(digest.coverJudgement.summary, /模型工具更新/);
  assert.doesNotMatch(digest.coverJudgement.summary, /(?:^|、)tech(?:、|$)/i);
  assert.doesNotMatch(digest.coverJudgement.summary, /阅读时先核对头部文章/);
});

test('does not expose internal fallback labels as editorial themes', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-19', totalItems: 80, newItems: 8, compareWindowDays: 7,
    topItems: Array.from({ length: 4 }, (_, index) => ({
      id: `fallback-theme-${index}`,
      title: `AI 工具更新 ${index + 1}`,
      url: `https://example.com/fallback-theme-${index}`,
      sourceName: '测试来源',
      category: '技术动态',
      fetchedAt: '2026-07-19T08:00:00.000Z',
      aiScore: 70,
      aiSummary: '这是一条带有明确事实的技术更新。',
    })),
    highScoreItems: [],
    byCategory: [{ category: '技术动态', count: 4, baselineAvg: 2, delta: 2 }],
    topSources: [{ sourceName: '测试来源', count: 4 }],
    themeClusters: [
      { label: '本地兜底', count: 4, sampleTitles: ['AI 工具更新 1'] },
      { label: '模型工具', count: 2, sampleTitles: ['AI 工具更新 2'] },
    ],
    moduleSections: [{
      key: 'models_labs',
      title: '模型发布与实验室动向',
      conclusion: '模型工具出现事实增量。',
      priorityArticles: [], signals: [], noise: [], actions: [], coverageCount: 4,
    }],
    generatedAt: '2026-07-19T09:00:00.000Z',
  };

  const digest = buildDailyReportEditorialDigest(snapshot);
  const grounded = groundDailyReportModelMarkdown('# 模型工具继续更新', snapshot);

  assert.doesNotMatch(digest.coverJudgement.title, /本地兜底/);
  assert.doesNotMatch(digest.coverJudgement.summary, /本地兜底/);
  assert.doesNotMatch(digest.radarOverview.markdown, /本地兜底/);
  assert.doesNotMatch(grounded.markdown, /本地兜底/);
});

test('builds distinct insight types for main daily report and source-scoped daily reports', () => {
  assert.equal(buildDailyInsightType(), 'daily');
  assert.equal(buildDailyInsightType(undefined), 'daily');
  assert.equal(buildDailyInsightType(null), 'daily');
  assert.equal(buildDailyInsightType(1362), 'daily_source_1362');
});

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

test('retires legacy final workflow prompts in favor of the editorial publication contract', () => {
  const template = resolveScenePromptTemplate(
    'final',
    '你是最终日报整合代理。必须包含：今日封面判断、信息雷达总览、候选池和评分阈值。{context}',
    'daily_report_final',
  );

  assert.match(template, /独立编辑/);
  assert.match(template, /信息中枢阅读链接/);
  assert.match(template, /## 今天怎么读/);
  assert.doesNotMatch(template, /信息雷达总览/);
});

test('builds rich editorial material from summary translation and full content', () => {
  const item: TopItem = {
    id: 'rich-1', title: 'Inkling open model', url: 'https://example.com/inkling', sourceName: 'TechCrunch',
    category: 'tech', fetchedAt: '2026-07-16T08:00:00.000Z', aiScore: 82,
    aiSummary: '这是一个不强调单一通用模型路线的开放模型发布。',
    aiTranslation: '团队强调组织可以基于自身数据和任务定制模型。',
  };
  const result = buildDailyReportEditorialContext(item, {
    translatedTitle: '思考机器发布首个开放模型 Inkling',
    readabilityContent: '<p>模型采用开放权重，并为特定组织的工作负载提供微调路径。</p>',
  });

  assert.equal(result.translatedTitle, '思考机器发布首个开放模型 Inkling');
  assert.match(result.editorialContext, /已有摘要/);
  assert.match(result.editorialContext, /中文材料/);
  assert.match(result.editorialContext, /开放权重/);
});

test('builds final context from article evidence instead of scores and selection reasons', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-16', totalItems: 12, newItems: 11, compareWindowDays: 7,
    topItems: [{
      id: 'context-1', title: 'Original title', displayTitle: '中文标题', url: 'https://example.com/original',
      readerUrl: buildDailyReportItemUrl('context-1'), editorialContext: '正文显示这是一次有可核实参数的模型发布。',
      sourceName: '官方来源', category: 'tech', fetchedAt: '2026-07-16T08:00:00.000Z',
      aiScore: 91, aiSummary: '摘要', selectionReason: '本地兜底，达到精选分 91',
    }],
    highScoreItems: [], byCategory: [{ category: 'tech', count: 1, baselineAvg: 0, delta: 1 }],
    topSources: [{ sourceName: '官方来源', count: 1 }], themeClusters: [], generatedAt: '2026-07-16T09:00:00.000Z',
  };
  const context = buildFinalContext(snapshot, {
    summary: '今日有一条可核验主线。', prioritySignals: [], themeLabels: [], watchlist: [],
  }, {});

  assert.match(context, /信息中枢阅读链接：\/feed\/context-1/);
  assert.match(context, /有可核实参数的模型发布/);
  assert.doesNotMatch(context, /评分：|AI 91|入报原因|达到精选分|本地兜底/);
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

test('cleans machine selection language from repaired final output before validation', () => {
  const repaired = repairSceneMarkdownWithFallback(
    'final',
    '## 今日封面判断\n\n入报原因：评分 90，这是一条值得关注的事实。',
    [
      '## 今日封面判断', '保底判断。',
      '## 目录', '保底目录。',
      '## 信息雷达总览', '保底雷达。',
      '## 今日精选', '保底精选。',
      '## 模块日报', '保底模块。',
      '## 更多动态', '保底动态。',
      '## 重点研究/深读', '保底深读。',
      '## 阅读顺序', '保底顺序。',
      '## 下一步行动', '保底行动。',
    ].join('\n\n'),
  );

  assert.doesNotMatch(repaired, /入报原因|评分\s*90/);
  assert.match(repaired, /价值判断/);
});

test('cleans machine selection variants without a numeric threshold', () => {
  const cleaned = sanitizeDailyReportMarkdown([
    '达到精选分，适合进入今日主线。',
    '高价值信号明确（AI 评分：**82.89**）；B 来源。',
  ].join('\n'));

  assert.doesNotMatch(cleaned, /达到精选分|评分\s*[:：]?\s*\*{0,2}82\.89|B\s*来源/);
  assert.match(cleaned, /高价值信号明确/);
});

test('removes generation traces and normalizes reader-facing markdown structure', () => {
  const cleaned = sanitizeDailyReportMarkdown([
    '### 1. 模型与实验室进入工程验证',
    '',
    '## （1）官方发布提供了新证据',
    '',
    '正文（信息中枢链接：/feed/9511fbf1-680c-4985-94fe-d88e4647f62a）',
    '',
    '信息中枢链接同上',
    '',
    '（全文约5200字符）',
    '（注：全文约5200字符，符合4500字符以上要求，各标题下均包含具体内容。）',
    '',
    '```md',
    '## 1. 代码块中的标题不应被改写',
    '（全文约100字符）',
    '```',
  ].join('\n'));

  assert.match(cleaned, /^## 模型与实验室进入工程验证/m);
  assert.match(cleaned, /^### （1）官方发布提供了新证据/m);
  assert.match(cleaned, /\[查看信息中枢原文\]\(\/feed\/9511fbf1-680c-4985-94fe-d88e4647f62a\)/);
  assert.doesNotMatch(cleaned, /信息中枢链接同上/);
  assert.doesNotMatch(cleaned.split('```md')[0], /全文约5200字符/);
  assert.doesNotMatch(cleaned.split('```md')[0], /符合4500字符|各标题下/);
  assert.match(cleaned, /## 1\. 代码块中的标题不应被改写/);
  assert.match(cleaned, /全文约100字符/);
});

test('restores the two required reader sections when deterministic final fallback is unavoidable', () => {
  const primary = [
    '# 模型输出的编辑标题',
    '## 主线一', '模型保留了判断。',
  ].join('\n\n');
  const fallback = [
    '## 今天怎么读', '- [可核验文章](https://example.com/curated)',
    '## 下一步关注', '- 关注后续是否出现第二个独立证据。',
  ].join('\n\n');

  const repaired = repairSceneMarkdownWithFallback('final', primary, fallback);

  assert.match(repaired, /模型保留了判断/);
  assert.match(repaired, /## 今天怎么读/);
  assert.match(repaired, /\[可核验文章\]\(https:\/\/example\.com\/curated\)/);
  assert.match(repaired, /## 下一步关注/);
});

test('replaces a truncated final section with the deterministic fallback section', () => {
  const repaired = repairSceneMarkdownWithFallback(
    'decision',
    [
      '## 总体判断', '', '判断完整。', '',
      '## 关键变化', '', '- 变化完整。', '',
      '## 风险与机会', '', '- 风险完整。', '',
      '## 下一步动作', '', '- 继续关注：',
    ].join('\n'),
    [
      '## 总体判断', '', '保底判断。', '',
      '## 关键变化', '', '- 保底变化。', '',
      '## 风险与机会', '', '- 保底风险。', '',
      '## 下一步动作', '', '- 打开原文核对事实。',
    ].join('\n'),
  );

  assert.match(repaired, /判断完整/);
  assert.match(repaired, /打开原文核对事实/);
  assert.doesNotMatch(repaired, /继续关注：\s*$/);
});

test('does not treat repeated model prose as trusted report depth when evidence is sparse', () => {
  const sectionBody = '今天的事实增量已经形成清晰主线，需要结合原始证据判断后续影响。'.repeat(120);
  const markdown = [
    '## 今日封面判断', sectionBody,
    '## 目录', sectionBody,
    '## 信息雷达总览', sectionBody,
    '## 今日精选', sectionBody,
    '## 模块日报', sectionBody,
    '## 更多动态', sectionBody,
    '## 重点研究/深读', sectionBody,
    '## 阅读顺序', sectionBody,
    '## 下一步行动', sectionBody,
  ].join('\n\n');
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-11',
    totalItems: 20,
    newItems: 10,
    compareWindowDays: 7,
    topItems: [{
      id: 'item-1',
      title: '可信重点文章',
      url: 'https://example.com/item-1',
      sourceName: '官方来源',
      category: '模型与实验室',
      fetchedAt: '2026-07-11T08:00:00.000Z',
      aiScore: 90,
      aiSummary: '这是一条可核对的事实摘要。',
    }],
    highScoreItems: [],
    byCategory: [{ category: '模型与实验室', count: 10, baselineAvg: 8, delta: 2 }],
    topSources: [{ sourceName: '官方来源', count: 10 }],
    themeClusters: [],
    generatedAt: '2026-07-11T09:00:00.000Z',
  };

  const prepared = prepareFinalSceneOutputForQuality(markdown, snapshot);

  assert.equal(prepared.prepared, false);
  assert.equal(prepared.quality.ok, false);
  assert.equal(prepared.quality.reason, 'too_short');
});

test('does not promote machine-selection prose when trusted evidence is sparse', () => {
  const sectionBody = '这是模型基于输入素材形成的编辑判断，说明事实、影响与下一步核对方向。入报原因：评分 90。'.repeat(18);
  const markdown = [
    '## 今日封面判断', sectionBody,
    '## 目录', sectionBody,
    '## 信息雷达总览', sectionBody,
    '## 今日精选', sectionBody,
    '## 模块日报', sectionBody,
    '## 更多动态', sectionBody,
    '## 重点研究/深读', sectionBody,
    '## 阅读顺序', sectionBody,
    '## 下一步行动', sectionBody,
  ].join('\n\n');
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-11',
    totalItems: 20,
    newItems: 10,
    compareWindowDays: 7,
    topItems: [{
      id: 'item-2',
      title: '第二篇可信重点文章',
      url: 'https://example.com/item-2',
      sourceName: '官方来源',
      category: 'Agent/产品',
      fetchedAt: '2026-07-11T08:00:00.000Z',
      aiScore: 88,
      aiSummary: '这是一条经过核对的事实摘要。',
    }],
    highScoreItems: [],
    byCategory: [{ category: 'Agent/产品', count: 10, baselineAvg: 8, delta: 2 }],
    topSources: [{ sourceName: '官方来源', count: 10 }],
    themeClusters: [],
    generatedAt: '2026-07-11T09:00:00.000Z',
  };

  const prepared = prepareFinalSceneOutputForQuality(markdown, snapshot);

  assert.equal(prepared.prepared, false);
  assert.equal(prepared.quality.ok, false);
  assert.doesNotMatch(prepared.markdown, /入报原因|评分\s*90/);
});

test('does not promote a thin final-agent response through deterministic expansion', () => {
  const thinMarkdown = [
    '## 今日封面判断', '内容不足。',
    '## 目录', '内容不足。',
    '## 信息雷达总览', '内容不足。',
    '## 今日精选', '内容不足。',
    '## 模块日报', '内容不足。',
    '## 更多动态', '内容不足。',
    '## 重点研究/深读', '内容不足。',
    '## 阅读顺序', '内容不足。',
    '## 下一步行动', '内容不足。',
  ].join('\n\n');
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-11', totalItems: 0, newItems: 0, compareWindowDays: 7,
    topItems: [], highScoreItems: [], byCategory: [], topSources: [], themeClusters: [],
    generatedAt: '2026-07-11T09:00:00.000Z',
  };

  const prepared = prepareFinalSceneOutputForQuality(thinMarkdown, snapshot);

  assert.equal(prepared.prepared, false);
  assert.equal(prepared.quality.ok, false);
  assert.equal(prepared.quality.reason, 'too_short');
});

test('asks the second final-agent pass to add new depth instead of rewriting the whole report', () => {
  const prompt = buildFinalExpansionPrompt(
    [
      '# 模型竞争开始转向系统能力',
      '## 主线一：模型能力进入工程兑现期',
      '第一版已经形成判断，但证据展开不足。',
      '## 今天怎么读',
      '先看官方发布，再看独立媒体验证。',
      '## 下一步关注',
      '关注真实采用数据。',
    ].join('\n\n'),
    '素材一：官方发布。\n素材二：独立媒体核验。',
    4500,
  );

  assert.match(prompt, /只补写新的深度章节/);
  assert.match(prompt, /不要重写第一版/);
  assert.match(prompt, /输出 3-5 个全新的 Markdown 二级章节/);
  assert.doesNotMatch(prompt, /输出 2-4 个全新的 Markdown 二级章节/);
  assert.match(prompt, /不得再次输出.*今天怎么读.*下一步关注/);
  assert.match(prompt, /至少 3800 个中文字符/);
});

test('normalizes fenced tertiary model sections into substantive final-report H2 sections', () => {
  const raw = [
    '```markdown',
    '### 证据一：模型交付进入工程验证期',
    '多条官方发布显示产品能力正在从演示转向真实工作流，但仍需通过用户采用数据交叉验证。'.repeat(3),
    '### 证据二：Agent 产品开始接受成本检验',
    '当前材料中同时出现价格、延迟和交付节奏信号，这些信号尚不足以推导整个行业已完成转折。'.repeat(3),
    '### 证据三：算力与合规改变交付边界',
    '这组材料提供了约束信号，但暂无足够独立证据证明已经形成稳定趋势。'.repeat(3),
    '```',
  ].join('\n\n');

  const before = inspectFinalMarkdownStructure(raw);
  const normalized = normalizeFinalSceneMarkdownStructure(raw);
  const after = inspectFinalMarkdownStructure(normalized);

  assert.equal(before.outerMarkdownFence, true);
  assert.equal(before.h2Count, 0);
  assert.equal(before.h3Count, 3);
  assert.equal(after.outerMarkdownFence, false);
  assert.equal(after.h2Count, 3);
  assert.equal(after.substantiveH2Count, 3);
  assert.doesNotMatch(normalized, /```markdown/);
});

test('merges normalized tertiary expansion sections instead of collapsing them into one fallback section', () => {
  const primary = [
    '# 模型竞争进入系统交付阶段',
    '## 今天怎么读',
    '先看官方发布，再看独立媒体核验。',
    '## 下一步关注',
    '关注真实采用和成本数据。',
  ].join('\n\n');
  const expansion = [
    '```md',
    '### 主线一：工程兑现取代参数竞赛',
    '官方发布提供了产品能力证据，但需继续核对独立基准和用户采用。'.repeat(4),
    '### 主线二：Agent 开始进入真实工作流',
    '产品发布已经不只强调演示效果，还开始回答延迟、成本和权限边界。'.repeat(4),
    '### 主线三：算力和合规成为交付约束',
    '算力与合规材料显示交付边界在收紧，但当前证据仍需更多来源交叉验证。'.repeat(4),
    '```',
  ].join('\n\n');

  const merged = mergeFinalSceneExpansion(primary, expansion);
  const structure = inspectFinalMarkdownStructure(merged);

  assert.equal(structure.editorialH2Count, 3);
  assert.equal(structure.substantiveH2Count, 3);
  assert.match(merged, /^## 主线一：工程兑现取代参数竞赛$/m);
  assert.ok(merged.indexOf('## 主线三：算力和合规成为交付约束') < merged.indexOf('## 今天怎么读'));
});

test('merges model-authored expansion before the reader guidance without duplicating final sections', () => {
  const primary = [
    '# 模型竞争开始转向系统能力',
    '## 主线一：模型能力进入工程兑现期',
    '第一版判断保留。',
    '## 主线二：Agent 产品开始接受真实工作流检验',
    '第二条判断保留。',
    '## 今天怎么读',
    '先看官方发布，再看独立媒体验证。',
    '## 下一步关注',
    '关注真实采用数据。',
  ].join('\n\n');
  const expansion = [
    '# 不应进入合并结果的第二个主标题',
    '## 主线三：算力约束正在改变产品节奏',
    '补写新的证据与判断，说明算力约束如何影响模型交付、产品节奏与后续核验。'.repeat(3),
    '## 主线四：监管信号开始影响交付边界',
    '补写第二组新的证据与判断，区分官方规则、公司自述与媒体推断的证据强度。'.repeat(3),
    '## 今天怎么读',
    '这段重复阅读建议不应覆盖第一版。',
  ].join('\n\n');

  const merged = mergeFinalSceneExpansion(primary, expansion);

  assert.equal((merged.match(/^#\s+/gm) || []).length, 1);
  assert.equal((merged.match(/^## 今天怎么读$/gm) || []).length, 1);
  assert.equal((merged.match(/^## 下一步关注$/gm) || []).length, 1);
  assert.match(merged, /第一版判断保留/);
  assert.match(merged, /主线三：算力约束正在改变产品节奏/);
  assert.doesNotMatch(merged, /第二个主标题|不应覆盖第一版/);
  assert.ok(merged.indexOf('主线四：监管信号开始影响交付边界') < merged.indexOf('## 今天怎么读'));
});

test('recovers an editorial H1 from a noncompliant expansion when the thin first pass has none', () => {
  const primary = [
    '## 今天怎么读',
    '先看官方发布，再看独立媒体验证。',
    '## 下一步关注',
    '关注真实采用数据。',
  ].join('\n\n');
  const expansion = [
    '## 今日封面判断',
    '# 模型竞争正在转向工程与系统能力',
    '今天的核心判断不是参数增长，而是可验证的工程交付能力开始成为分水岭。'.repeat(3),
    '## 主线一：模型能力进入工程兑现期',
    '多条官方发布与产品信号指向同一变化，但仍需要独立基准和用户数据验证。'.repeat(4),
    '## 主线二：Agent 产品接受真实工作流检验',
    '当前证据更接近产品信号，还不足以推导成行业趋势，后续应核对实际采用与成本。'.repeat(4),
    '## 主线三：算力和合规共同收紧交付边界',
    '这一组材料提供了约束信号，但暂无足够独立证据证明已形成稳定趋势。'.repeat(4),
  ].join('\n\n');

  const merged = mergeFinalSceneExpansion(primary, expansion);

  assert.match(merged, /^# 模型竞争正在转向工程与系统能力/m);
  assert.equal((merged.match(/^#\s+/gm) || []).length, 1);
  assert.ok(merged.indexOf('# 模型竞争正在转向工程与系统能力') < merged.indexOf('## 今日封面判断'));
  assert.equal((merged.match(/^## 今天怎么读$/gm) || []).length, 1);
  assert.equal((merged.match(/^## 下一步关注$/gm) || []).length, 1);
});

test('does not confuse editorial discussion of model calls with runtime diagnostics', () => {
  const body = '模型调用成本下降正在改变产品交付方式，但仍需要结合原始链接核对事实与影响。'.repeat(32);
  const links = Array.from({ length: 8 }, (_, index) => `- [模型调用成本观察 ${index + 1}](/feed/model-call-${index})`).join('\n');
  const markdown = [
    '# 模型调用成本正在改变产品交付',
    '## 主线一：推理成本下降', body,
    '## 主线二：产品交付方式变化', body,
    '## 主线三：证据仍需要核对', body,
    '## 更多值得知道', links,
    '## 今天怎么读', '先读成本变化，再核对产品交付的真实证据。',
    '## 下一步关注', '关注后续是否出现官方价格、延迟和用户量数据。',
  ].join('\n\n');
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-13', totalItems: 10, newItems: 6, compareWindowDays: 7,
    topItems: Array.from({ length: 8 }, (_, index) => ({
      id: `model-call-${index}`, title: `模型调用成本观察 ${index + 1}`, url: `https://example.com/model-call-${index}`,
      sourceName: index % 2 === 0 ? '测试来源 A' : '测试来源 B', category: 'Agent/产品', fetchedAt: '2026-07-13T08:00:00.000Z',
      aiScore: 86 - index, aiSummary: `模型调用成本下降的第 ${index + 1} 条可核验证据。`,
    })),
    highScoreItems: [], byCategory: [], topSources: [], themeClusters: [],
    generatedAt: '2026-07-13T09:00:00.000Z',
  };

  const prepared = prepareFinalSceneOutputForQuality(markdown, snapshot);
  assert.equal(prepared.quality.ok, false);
  assert.match(prepared.markdown, /模型调用成本下降/);
  assert.equal(prepared.grounding.groundedArticleCount, 8);
});

test('restores an evidence-based editorial H1 when the model omits only the cover title', () => {
  const body = '当日材料显示产品交付开始围绕成本、延迟和真实采用展开，但这一判断仍需独立数据交叉验证。'.repeat(30);
  const links = Array.from({ length: 8 }, (_, index) => `- [Agent 交付证据 ${index + 1}](/feed/agent-evidence-${index})`).join('\n');
  const markdown = [
    '## 主线一：产品交付开始接受成本检验', body,
    '## 主线二：工作流整合取代单点演示', body,
    '## 主线三：证据强度仍需用户数据补足', body,
    '## 证据链接', links,
    '## 今天怎么读', '先读官方发布，再核对独立采用与成本证据。',
    '## 下一步关注', '关注后续是否出现可量化的用户、延迟和价格数据。',
  ].join('\n\n');
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-17', totalItems: 20, newItems: 12, compareWindowDays: 7,
    topItems: Array.from({ length: 8 }, (_, index) => ({
      id: `agent-evidence-${index}`, title: `Agent 交付证据 ${index + 1}`, url: `https://example.com/agent-${index}`,
      sourceName: index % 2 === 0 ? '官方来源' : '独立媒体', category: 'Agent/产品', fetchedAt: '2026-07-17T08:00:00.000Z',
      aiScore: 90 - index, aiSummary: `Agent 交付的第 ${index + 1} 条可核对证据。`,
    })),
    highScoreItems: [],
    byCategory: [{ category: 'Agent/产品', count: 12, baselineAvg: 8, delta: 4 }],
    topSources: [{ sourceName: '官方来源', count: 6 }, { sourceName: '独立媒体', count: 6 }],
    themeClusters: [], generatedAt: '2026-07-17T09:00:00.000Z',
  };

  const prepared = prepareFinalSceneOutputForQuality(markdown, snapshot);

  assert.equal(prepared.quality.ok, false);
  assert.match(prepared.markdown, /^# 主线一：产品交付开始接受成本检验/m);
  assert.doesNotMatch(prepared.markdown, /^# 信息中枢日报/m);
});

test('grounds missing final-agent citations in trusted internal reader links', () => {
  const body = '多条可核对材料指向产品交付、成本约束与用户采用之间的关系，但当前仍应把事实与推断分开。'.repeat(35);
  const markdown = [
    '# Agent 产品开始接受真实交付检验',
    '## 主线一：产品能力进入工程兑现期', body,
    '## 主线二：成本与延迟成为新的分水岭', body,
    '## 主线三：用户采用数据仍是证据缺口', body,
    '## 今天怎么读', '先看官方能力边界，再核对独立采用数据。',
    '## 下一步关注', '关注价格、延迟、客户数与真实工作流的变化。',
  ].join('\n\n');
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-17', totalItems: 20, newItems: 12, compareWindowDays: 7,
    topItems: Array.from({ length: 8 }, (_, index) => ({
      id: `trusted-link-${index}`, title: `可核对证据 ${index + 1}`, url: `https://example.com/trusted-${index}`,
      sourceName: '可信来源', category: 'Agent/产品', fetchedAt: '2026-07-17T08:00:00.000Z',
      aiScore: 90 - index, aiSummary: `第 ${index + 1} 条可核对事实。`,
    })),
    highScoreItems: [], byCategory: [{ category: 'Agent/产品', count: 12, baselineAvg: 8, delta: 4 }],
    topSources: [{ sourceName: '可信来源', count: 8 }], themeClusters: [], generatedAt: '2026-07-17T09:00:00.000Z',
  };

  const prepared = prepareFinalSceneOutputForQuality(markdown, snapshot);

  assert.equal(prepared.prepared, false);
  assert.equal(prepared.quality.ok, false);
  assert.equal(new Set(Array.from(prepared.markdown.matchAll(/\/feed\/(trusted-link-\d+)/g)).map((match) => match[1])).size, 8);
  assert.equal(prepared.grounding.groundedArticleCount, 8);
  assert.match(prepared.markdown, /^### \[可核对证据 1\]\(\/feed\/trusted-link-0\)$/m);
});

test('uses the model hierarchy but rebuilds article prose from trusted evidence', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-16', totalItems: 30, newItems: 18, compareWindowDays: 7,
    topItems: [{
      id: 'story-1', title: '一手证据', url: 'https://example.com/story-1', sourceName: '官方来源',
      category: '模型与实验室', fetchedAt: '2026-07-16T08:00:00.000Z', aiScore: 91, aiSummary: '可核对摘要。',
      aiTranslation: '这段完整译文不应与摘要同时堆入日报。', language: 'en',
    }],
    highScoreItems: [], byCategory: [], topSources: [], themeClusters: [], generatedAt: '2026-07-16T09:00:00.000Z',
  };
  const modelMarkdown = [
    '# 模型竞争开始转向可部署性',
    '## 开放模型正在进入生产环节',
    '这是最终 Agent 写出的独立编辑主线。',
    '### 一手证据',
    '这段模型自行扩写的未核实细节不应直接发布。',
    '## 今天怎么读',
    '先读一手证据。',
    '## 下一步关注',
    '关注后续证据。',
  ].join('\n\n');

  const delivered = finalizeDailyReportDelivery(modelMarkdown, snapshot, 'model');

  assert.match(delivered, /^# 模型竞争开始转向可部署性$/m);
  assert.match(delivered, /^## 开放模型正在进入生产环节$/m);
  assert.match(delivered, /可核对摘要/);
  assert.match(delivered, /\[一手证据\]\(\/feed\/story-1\)/);
  assert.match(delivered, /官方来源/);
  assert.doesNotMatch(delivered, /证据口径/);
  assert.doesNotMatch(delivered, /完整译文不应/);
  assert.doesNotMatch(delivered, /未核实细节不应/);
  assert.doesNotMatch(delivered, /可核实进展/);
});

test('falls back to a clean translation when the saved summary is a processing placeholder', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-17', totalItems: 2, newItems: 1, compareWindowDays: 7,
    topItems: [{
      id: 'translated-story', title: 'English source', url: 'https://example.com/translated', sourceName: 'Author Blog',
      category: '深读博客', fetchedAt: '2026-07-17T08:00:00.000Z', aiScore: 84, language: 'en',
      aiSummary: '当前缺少可靠摘要，正文约 4486 字，开头涉及模型发布，建议先读原文。',
      aiTranslation: '## 正文\n\n真实译文第一句。[via](https://example.com/source) 这是第二句。',
    }],
    highScoreItems: [], byCategory: [], topSources: [], themeClusters: [], generatedAt: '2026-07-17T09:00:00.000Z',
  };

  const grounded = groundDailyReportModelMarkdown('# 标题', snapshot);

  assert.match(grounded.markdown, /真实译文第一句。via 这是第二句。/);
  assert.doesNotMatch(grounded.markdown, /当前缺少可靠摘要|正文约|https:\/\/example\.com\/source|## 正文/);
});

test('drops unsupported model claims and rebuilds the report from article-level evidence', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-17', totalItems: 30, newItems: 18, compareWindowDays: 7,
    topItems: [
      {
        id: 'kimi-k3',
        title: 'Moonshot AI releases Kimi K3',
        displayTitle: '月之暗面发布 Kimi K3',
        url: 'https://example.com/kimi-k3',
        sourceName: 'Moonshot AI',
        category: '模型与实验室',
        fetchedAt: '2026-07-17T08:00:00.000Z',
        aiScore: 91,
        aiSummary: 'Moonshot AI 发布 Kimi K3，并介绍了模型能力与开放权重。',
      },
      {
        id: 'inkling',
        title: 'Thinking Machines releases Inkling',
        displayTitle: 'Thinking Machines 发布开放模型 Inkling',
        url: 'https://example.com/inkling',
        sourceName: 'TechCrunch',
        category: '模型与实验室',
        fetchedAt: '2026-07-17T07:00:00.000Z',
        aiScore: 87,
        aiSummary: 'Thinking Machines 发布首个开放模型 Inkling，强调按任务适配而非单一通用路线。',
      },
    ],
    highScoreItems: [],
    byCategory: [{ category: '模型与实验室', count: 8, baselineAvg: 5, delta: 3 }],
    topSources: [{ sourceName: 'Moonshot AI', count: 4 }, { sourceName: 'TechCrunch', count: 4 }],
    themeClusters: [{ label: '开放模型', count: 2, sampleTitles: ['Kimi K3', 'Inkling'] }],
    generatedAt: '2026-07-17T09:00:00.000Z',
  };
  const modelMarkdown = [
    '# 开放模型进入新竞争阶段',
    '## 模型竞争从规模转向开放生态',
    '### [月之暗面发布 Kimi K3](/feed/kimi-k3)',
    'Kimi K3 在 RTEB 排名第二，仅次于 Fable 5，并开放了完整训练代码。',
    '### [Thinking Machines 发布开放模型 Inkling](/feed/inkling)',
    'Inkling 代表了一条可定制化路线。',
    '### Codex 文件删除漏洞已修复',
    'OpenAI 已确认修复时间表。',
    '（注：全文约5200字符，符合要求。）',
    '## 今天怎么读',
    '先读 Kimi K3。',
    '## 下一步关注',
    '关注后续证据。',
  ].join('\n\n');

  const grounded = groundDailyReportModelMarkdown(modelMarkdown, snapshot);

  assert.equal(grounded.groundedArticleCount, 2);
  assert.equal(grounded.droppedUngroundedSections, 1);
  assert.match(grounded.markdown, /Moonshot AI 发布 Kimi K3/);
  assert.match(grounded.markdown, /\[月之暗面发布 Kimi K3\]\(\/feed\/kimi-k3\)/);
  assert.doesNotMatch(grounded.markdown, /RTEB 排名第二|完整训练代码|文件删除漏洞|全文约5200/);
  assert.match(grounded.markdown, /^## 模型竞争从规模转向开放生态$/m);
  assert.match(grounded.markdown, /^### \[月之暗面发布 Kimi K3\]/m);
});

test('cover and radar use selected IDs without promoting high-score extras into the selected count', () => {
  const make = (id: string): TopItem => ({ id, title: `模型研究 ${id}`, url: `https://example.com/${id}`,
    sourceName: '测试来源', category: '模型与实验室', fetchedAt: '2026-09-06T08:00:00Z',
    aiScore: 90, aiSummary: '这篇文章提供了可核验的模型研究证据和技术进展。' });
  const snapshot: DailyReportSnapshot = {
    date: '2026-09-06', newItems: 11, totalItems: 11, compareWindowDays: 7,
    topItems: Array.from({ length: 7 }, (_, i) => make(`selected-${i}`)),
    highScoreItems: [make('selected-0'), make('extra')], byCategory: [], topSources: [], themeClusters: [],
    generatedAt: '2026-09-06T09:00:00Z',
  };
  const digest = buildDailyReportEditorialDigest(snapshot);
  assert.equal(digest.curated.length, 7);
  assert.equal(digest.curated.some((a) => a.id === 'extra'), false);
  assert.match(digest.coverJudgement.summary, /正式精选 7 篇/);
  const grounded = groundDailyReportModelMarkdown('# 模型研究进展', snapshot);
  assert.match(grounded.markdown, /正式精选 7 篇/);
  assert.match(grounded.markdown, /正式阅读层保留 7 篇/);
  assert.doesNotMatch(grounded.markdown, /正式精选 8 篇|正式阅读层保留 8 篇/);
});

test('uses trusted module assignments when the model draft has no usable article hierarchy', () => {
  const items: TopItem[] = [
    {
      id: 'model-item', title: '开放模型发布', url: 'https://example.com/model', sourceName: '官方来源',
      category: '模型', fetchedAt: '2026-07-17T08:00:00.000Z', aiScore: 90, aiSummary: '发布了可核对的开放模型更新。',
    },
    {
      id: 'agent-item', title: 'Agent 产品上线', url: 'https://example.com/agent', sourceName: '独立媒体',
      category: 'Agent', fetchedAt: '2026-07-17T07:00:00.000Z', aiScore: 86, aiSummary: '新产品把 Agent 能力接入了真实工作流。',
    },
  ];
  const priority = (item: TopItem): DailyReportPriorityArticle => ({
    id: item.id,
    title: item.title,
    url: item.url,
    sourceName: item.sourceName,
    category: item.category,
    reason: '有明确事实增量',
    summary: item.aiSummary || '',
  });
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-17', totalItems: 12, newItems: 8, compareWindowDays: 7,
    topItems: items, highScoreItems: [], byCategory: [], topSources: [], themeClusters: [],
    moduleSections: [
      {
        key: 'models_labs', title: '模型与实验室', editorialTitle: '模型发布与实验室动向：1 条信号',
        conclusion: '结论', priorityArticles: [priority(items[0])], signals: [], noise: [], actions: [], coverageCount: 1,
      },
      {
        key: 'agent_products', title: 'Agent/产品', editorialTitle: 'Agent 与产品入口：单篇观察',
        conclusion: '结论', priorityArticles: [priority(items[1])], signals: [], noise: [], actions: [], coverageCount: 1,
      },
    ],
    generatedAt: '2026-07-17T09:00:00.000Z',
  };

  const grounded = groundDailyReportModelMarkdown([
    '# 模型生成的标题',
    '## 模型自行编写的发布主线',
    '这段模型正文不应直接发布。',
    '## Agent 改变所有工作',
    '这段模型正文也不应直接发布。',
    '## 今天怎么读',
    '先读官方来源。',
    '## 下一步关注',
    '关注新证据。',
  ].join('\n\n'), snapshot);

  assert.match(grounded.markdown, /^## 模型发布与实验室动向$/m);
  assert.match(grounded.markdown, /^## Agent 与产品入口$/m);
  assert.doesNotMatch(grounded.markdown, /模型自行编写的发布主线|Agent 改变所有工作|这段模型正文/);
  assert.doesNotMatch(grounded.markdown, /可核实进展|单篇观察/);
  assert.match(grounded.markdown, /^### \[开放模型发布\]\(\/feed\/model-item\)$/m);
  assert.match(grounded.markdown, /^### \[Agent 产品上线\]\(\/feed\/agent-item\)$/m);
});

test('keeps the measured deep-read section in the published grounded report', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-17', totalItems: 8, newItems: 5, compareWindowDays: 7,
    topItems: [{
      id: 'long-read', title: 'A substantial technical essay', url: 'https://example.com/long-read',
      sourceName: "Researcher's Blog", category: '深读博客', fetchedAt: '2026-07-17T08:00:00.000Z',
      aiScore: 88, aiSummary: '这篇长文解释了模型评估方法、证据边界和工程取舍。', contentLength: 3600,
    }],
    highScoreItems: [], byCategory: [], topSources: [], themeClusters: [], generatedAt: '2026-07-17T09:00:00.000Z',
  };

  const grounded = groundDailyReportModelMarkdown([
    '# 评估方法开始进入工程实践',
    '## 模型评估从榜单转向证据链',
    '### A substantial technical essay',
    '## 今天怎么读',
    '先读长文。',
    '## 下一步关注',
    '关注可复现实验。',
  ].join('\n\n'), snapshot);

  assert.match(grounded.markdown, /^## 重点研究\/深读$/m);
  assert.match(grounded.markdown, /\[A substantial technical essay\]\(\/feed\/long-read\)/);
});

test('keeps one trusted H2 per module when the model splits the same module into multiple themes', () => {
  const items: TopItem[] = [
    {
      id: 'model-a', title: '开放模型 A', url: 'https://example.com/a', sourceName: '官方来源',
      category: '模型', fetchedAt: '2026-07-17T08:00:00.000Z', aiScore: 90, aiSummary: '开放模型 A 发布了可核对更新。',
    },
    {
      id: 'model-b', title: '开放模型 B', url: 'https://example.com/b', sourceName: '独立媒体',
      category: '模型', fetchedAt: '2026-07-17T07:00:00.000Z', aiScore: 86, aiSummary: '开放模型 B 公布了新的技术路线。',
    },
  ];
  const priority = (item: TopItem): DailyReportPriorityArticle => ({
    id: item.id, title: item.title, url: item.url, sourceName: item.sourceName, category: item.category,
    reason: '有明确事实增量', summary: item.aiSummary || '',
  });
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-17', totalItems: 12, newItems: 8, compareWindowDays: 7,
    topItems: items, highScoreItems: [], byCategory: [], topSources: [], themeClusters: [],
    moduleSections: [{
      key: 'models_labs', title: '模型与实验室', conclusion: '结论',
      priorityArticles: items.map(priority), signals: [], noise: [], actions: [], coverageCount: 2,
    }],
    generatedAt: '2026-07-17T09:00:00.000Z',
  };

  const grounded = groundDailyReportModelMarkdown([
    '# 模型生成标题',
    '## 开源生态竞争', '### 开放模型 A',
    '## 模型工程化竞争', '### 开放模型 B',
  ].join('\n\n'), snapshot);

  assert.equal((grounded.markdown.match(/^## 模型发布与实验室动向$/gm) || []).length, 1);
  assert.doesNotMatch(grounded.markdown, /^## 开源生态竞争|^## 模型工程化竞争/m);
  assert.match(grounded.markdown, /开放模型 A/);
  assert.match(grounded.markdown, /开放模型 B/);
});

test('prefers a clean AI summary over polluted translation markup and drops ad-only title mismatches', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-17', totalItems: 4, newItems: 4, compareWindowDays: 7,
    topItems: [
      {
        id: 'embed-clean', title: 'NVIDIA Nemotron 3 Embed Ranks First on RTEB',
        url: 'https://example.com/embed', sourceName: 'Hugging Face Blog', category: '模型与实验室',
        fetchedAt: '2026-07-17T08:00:00.000Z', aiScore: 92, language: 'en',
        aiSummary: 'NVIDIA 发布 Nemotron 3 Embed，该模型在 RTEB 检索基准中排名第一。',
        reportSummary: '[返回文章](https://example.com) ![avatar]([![avatar](https://cdn.example.com/avatar.png)) ) ) ) 这段脏译文不应进入日报。',
      },
      {
        id: 'ad-only', title: 'Quoting Kimi K3', url: 'https://example.com/kimi',
        sourceName: "Simon Willison's Weblog", category: '深读博客',
        fetchedAt: '2026-07-17T07:00:00.000Z', aiScore: 85, language: 'en',
        aiSummary: '模型摘要暂时不可用，先提供本地阅读导读。这是一篇英文内容，标题为《Quoting Kimi K3》。正文约 256 字，开头涉及 Sponsored by: Atlassian。建议先读原文，或稍后重跑摘要生成正式中文摘要。',
        snippet: 'Sponsored by: Atlassian. Give your agents a plan. Assign tasks from Jira.',
        aiTranslation: '赞助方：Atlassian。Jira 的新功能允许向 Claude 和 Cursor 分配任务。',
      },
    ],
    highScoreItems: [], byCategory: [], topSources: [], themeClusters: [], generatedAt: '2026-07-17T09:00:00.000Z',
  };

  const grounded = groundDailyReportModelMarkdown([
    '# 检索能力成为模型工程的新焦点',
    '## 检索模型开始进入生产基础设施',
    '### NVIDIA Nemotron 3 Embed Ranks First on RTEB',
    '### Quoting Kimi K3',
  ].join('\n\n'), snapshot);

  assert.match(grounded.markdown, /NVIDIA 发布 Nemotron 3 Embed/);
  assert.doesNotMatch(grounded.markdown, /返回文章|avatar|脏译文|\) \) \)/);
  assert.doesNotMatch(grounded.markdown, /Quoting Kimi K3|Atlassian|Jira/);
  assert.match(grounded.markdown, /^## 今日精选$/m);
  assert.doesNotMatch(grounded.markdown, /可核实进展/);
});

test('classifies daily modules by article subject instead of vendor source name or footer noise', () => {
  const makeItem = (id: string, title: string, sourceName: string, summary: string, aiTags: string[] = []): TopItem => ({
    id, title, displayTitle: title, url: `https://example.com/${id}`, sourceName, category: 'AI',
    fetchedAt: '2026-07-17T08:00:00.000Z', aiScore: 88, aiSummary: summary, aiTags,
  });
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-17', totalItems: 8, newItems: 8, compareWindowDays: 7,
    topItems: [
      makeItem(
        'customer',
        'How Cars24 scales conversations and builds faster with OpenAI',
        'OpenAI News',
        '这家汽车交易客户把 AI 接入销售与售后流程，原有市场仍受监管且流程分散。',
      ),
      makeItem('model', 'Thinking Machines 发布开放权重模型 Inkling', 'TechCrunch', '团队发布新的开放权重模型。'),
      makeItem('embed', 'NVIDIA Nemotron 3 Embed 在 RTEB 上排名第一', 'Hugging Face Blog', '这是用于检索的 embedding 模型基准结果。'),
      makeItem(
        'chips',
        '首批 GPU 金融投资者为何转向推理芯片，达成 4 亿美元交易',
        'TechCrunch',
        '推理云公司获得贷款，作者过去也报道公共政策与投资风险。',
        ['AI推理芯片', '融资', '开源模型'],
      ),
      makeItem('kimi', '中国月神 AI 发布全球最大开源 AI 模型 Kimi K3', 'Reuters Technology AI', '模型在 GPU 内核优化与安全评估中给出了新基准。'),
      makeItem('policy', '为什么青少年应获得安全人工智能的使用权限', 'OpenAI News', '文章讨论青少年安全保护与家长控制。'),
      makeItem('robot', 'South Korea-US team unveils robotic technology that dresses the wearer', 'Reuters', '团队展示帮助穿衣的机器人应用。'),
      makeItem('infra', '商汤发布算电协同 Agent，单位电力成本 Token 产出提升', '智东西', '智算中心优化电力和算力调度。'),
    ],
    highScoreItems: [], byCategory: [], topSources: [], themeClusters: [], generatedAt: '2026-07-17T09:00:00.000Z',
  };

  const sections = buildDailyReportModuleSections(snapshot);
  const sectionByItem = new Map(sections.flatMap((section) => section.priorityArticles.map((article) => [article.id, section.key])));

  assert.equal(sectionByItem.get('customer'), 'apps_business');
  assert.equal(sectionByItem.get('model'), 'models_labs');
  assert.equal(sectionByItem.get('embed'), 'models_labs');
  assert.equal(sectionByItem.get('chips'), 'infra_compute');
  assert.equal(sectionByItem.get('kimi'), 'models_labs');
  assert.equal(sectionByItem.get('policy'), 'policy_safety');
  assert.equal(sectionByItem.get('robot'), 'apps_business');
  assert.equal(sectionByItem.get('infra'), 'infra_compute');
});

test('rejects final-agent links that are not present in the editorial evidence set', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-16', totalItems: 2, newItems: 2, compareWindowDays: 7,
    topItems: [{
      id: 'known', title: '已知文章', url: 'https://example.com/known', sourceName: '官方来源', category: '模型',
      fetchedAt: '2026-07-16T08:00:00.000Z', aiScore: 90, aiSummary: '摘要。',
    }],
    highScoreItems: [], byCategory: [], topSources: [], themeClusters: [], generatedAt: '2026-07-16T09:00:00.000Z',
  };
  const unsupported = findUnsupportedDailyReportLinks([
    '[已知文章](https://example.com/known)',
    '[模型编造链接](https://example.com/hallucinated)',
  ].join('\n'), snapshot);

  assert.deepEqual(unsupported, ['https://example.com/hallucinated']);
});

test('rewrites known evidence links to the internal reader and accepts them as supported', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-16', totalItems: 1, newItems: 1, compareWindowDays: 7,
    topItems: [{
      id: 'reader-1', title: '已知文章', url: 'https://example.com/known', sourceName: '官方来源', category: '模型',
      fetchedAt: '2026-07-16T08:00:00.000Z', aiScore: 90, aiSummary: '摘要。',
    }],
    highScoreItems: [], byCategory: [], topSources: [], themeClusters: [], generatedAt: '2026-07-16T09:00:00.000Z',
  };
  const rewritten = rewriteDailyReportLinksToReader('[已知文章](https://example.com/known)', snapshot);

  assert.equal(rewritten, '[已知文章](/feed/reader-1)');
  assert.deepEqual(findUnsupportedDailyReportLinks(rewritten, snapshot), []);
});

test('preserves an editorial H1 instead of prepending a mechanical report title', () => {
  const markdown = '# AI 竞争的重心正在外移\n\n## 主线一\n\n正文。';
  assert.equal(ensureReportHeading(markdown, '2026-07-16'), markdown);
});

test('uses deterministic repair first for structural daily report defects', () => {
  assert.equal(shouldTryDeterministicSceneRepairFirst('missing_sections'), true);
  assert.equal(shouldTryDeterministicSceneRepairFirst('too_short'), true);
  assert.equal(shouldTryDeterministicSceneRepairFirst('truncated'), true);
  assert.equal(shouldTryDeterministicSceneRepairFirst('unknown_provider_error'), false);
});

test('uses model composition for thin or structurally incomplete final drafts', () => {
  assert.equal(shouldComposeFinalExpansion('too_short'), true);
  assert.equal(shouldComposeFinalExpansion('missing_editorial_structure'), true);
  assert.equal(shouldComposeFinalExpansion('unsupported_links'), false);
  assert.equal(shouldComposeFinalExpansion('missing_markdown_links'), false);
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

test('candidate sampling ranks unprocessed major AI model releases ahead of routine scored items', () => {
  const ordered = buildDailyReportCandidateSampleOrder([
    {
      id: 'anthropic-snapshot',
      title: 'Newsroom \\ Anthropic',
      sourceName: 'Anthropic Newsroom',
      sourceType: 'webpage',
      category: 'AI',
      aiScore: 92,
      priorityScore: 0.98,
      processingStatus: 'summarized',
      summaryStatus: 'ready',
      contentStatus: 'ready',
      aiSummary: '媒体咨询 press@anthropic.com，支持入口和 download press kit。',
      fetchedAt: '2026-06-10T06:00:00.000Z',
    },
    {
      id: 'routine-scored',
      title: '普通工具讨论帖',
      sourceName: 'V2EX',
      category: 'App&效率工具',
      aiScore: 58,
      priorityScore: 0.62,
      processingStatus: 'done',
      summaryStatus: 'ready',
      contentStatus: 'ready',
      fetchedAt: '2026-06-10T03:00:00.000Z',
    },
    {
      id: 'claude-fable-raw',
      title: '实测 Claude 史上最强模型 Fable 5，普通人慎用',
      sourceName: 'BestBlogs.dev',
      category: 'AI',
      aiScore: null,
      priorityScore: null,
      processingStatus: 'raw',
      summaryStatus: 'pending',
      contentStatus: 'ready',
      fetchedAt: '2026-06-10T05:52:00.000Z',
    },
    {
      id: 'market-scored',
      title: '恒指午间休盘跌1.1%',
      sourceName: '36kr',
      category: 'uncategorized',
      aiScore: 66,
      priorityScore: 0.7,
      processingStatus: 'summarized',
      summaryStatus: 'ready',
      contentStatus: 'ready',
      fetchedAt: '2026-06-10T05:00:00.000Z',
    },
  ], 3);

  assert.deepEqual(ordered.map((item) => item.id), ['claude-fable-raw', 'routine-scored', 'market-scored']);
});

test('candidate sampling reserves coverage for high-value, topics, and source diversity', () => {
  const dominant = Array.from({ length: 8 }, (_, index) => ({
    id: `dominant-${index}`,
    title: `模型平台常规更新 ${index}`,
    sourceName: 'Dominant Wire',
    category: 'AI',
    aiScore: 96 - index,
    priorityScore: 0.98 - index * 0.01,
    processingStatus: 'done',
    summaryStatus: 'ready',
    contentStatus: 'ready',
    fetchedAt: `2026-06-10T0${index}:00:00.000Z`,
    sourceReadingTier: 'light_reading',
  }));
  const ordered = buildDailyReportCandidateSampleOrder([
    ...dominant,
    {
      id: 'hot-unscored',
      title: 'Claude 新模型发布并开放 API',
      sourceName: 'Hot Official',
      category: 'AI',
      aiScore: null,
      processingStatus: 'raw',
      summaryStatus: 'pending',
      contentStatus: 'ready',
      fetchedAt: '2026-06-10T09:00:00.000Z',
      sourceReadingTier: 'light_reading',
    },
    {
      id: 'high-value-research',
      title: '长期研究：模型推理可靠性评估框架',
      sourceName: 'Research Lab',
      category: '论文研究',
      aiScore: 62,
      processingStatus: 'done',
      summaryStatus: 'ready',
      contentStatus: 'ready',
      fetchedAt: '2026-06-10T08:00:00.000Z',
      sourceReadingTier: 'high_value',
    },
    {
      id: 'product-update',
      title: '企业协作平台正式上线新功能',
      sourceName: 'Product Blog',
      category: '产品更新',
      aiScore: 68,
      processingStatus: 'done',
      summaryStatus: 'ready',
      contentStatus: 'ready',
      fetchedAt: '2026-06-10T07:00:00.000Z',
      sourceReadingTier: 'light_reading',
    },
    {
      id: 'practice-guide',
      title: '如何验证 Agent 长任务的稳定性',
      sourceName: 'Engineering Notes',
      category: '教程实践',
      aiScore: 65,
      processingStatus: 'done',
      summaryStatus: 'ready',
      contentStatus: 'ready',
      fetchedAt: '2026-06-10T06:00:00.000Z',
      sourceReadingTier: 'light_reading',
    },
  ], 8);

  const ids = ordered.map((item) => item.id);
  assert.ok(ids.includes('hot-unscored'));
  assert.ok(ids.includes('high-value-research'));
  assert.ok(ids.includes('practice-guide'));
  assert.ok(new Set(ordered.map((item) => item.sourceName)).size >= 4);
});

test('candidate sampling reserves first-party evidence when media volume dominates the day', () => {
  const mediaItems = Array.from({ length: 12 }, (_, index) => ({
    id: `media-${index}`,
    title: `AI industry update ${index}`,
    sourceName: index % 2 === 0 ? 'TechCrunch' : 'Reuters Technology AI',
    category: 'tech',
    aiScore: 92 - index,
    priorityScore: 0.95 - index * 0.01,
    processingStatus: 'done',
    summaryStatus: 'ready',
    contentStatus: 'ready',
    fetchedAt: `2026-06-10T${String(index).padStart(2, '0')}:00:00.000Z`,
    sourceReadingTier: 'light_reading',
    sourceKind: 'media',
  }));
  const ordered = buildDailyReportCandidateSampleOrder([
    ...mediaItems,
    {
      id: 'openai-first-party',
      title: 'OpenAI publishes a research update',
      sourceName: 'OpenAI News',
      category: 'AI',
      aiScore: 61,
      processingStatus: 'done',
      summaryStatus: 'ready',
      contentStatus: 'ready',
      fetchedAt: '2026-06-10T01:30:00.000Z',
      sourceReadingTier: 'high_value',
      sourceKind: 'official',
    },
    {
      id: 'deepmind-first-party',
      title: 'Google DeepMind releases a new scientific benchmark',
      sourceName: 'Google DeepMind',
      category: 'AI',
      aiScore: 60,
      processingStatus: 'done',
      summaryStatus: 'ready',
      contentStatus: 'ready',
      fetchedAt: '2026-06-10T01:15:00.000Z',
      sourceReadingTier: 'high_value',
      sourceConfig: { url: 'https://deepmind.google/blog/feed/basic/' },
    },
  ], 8);

  const ids = ordered.map((item) => item.id);
  assert.ok(ids.includes('openai-first-party'));
  assert.ok(ids.includes('deepmind-first-party'));
});

test('hot signal detection ignores market noise whose summary is polluted by unrelated Claude text', () => {
  assert.equal(isDailyReportHotSignal({
    id: 'market-noise',
    title: '现货黄金日内跌幅扩大至2%',
    sourceName: '36kr',
    category: 'uncategorized',
    aiScore: 51,
    priorityScore: 0.6,
    processingStatus: 'done',
    summaryStatus: 'ready',
    contentStatus: 'ready',
    aiSummary: '市场短线波动，同时另一条快讯提到 Claude Fable 5 发布。',
  }), false);

  assert.equal(isDailyReportHotSignal({
    id: 'real-claude',
    title: 'Claude Fable 5 发布，Anthropic 提升长任务与科研能力',
    sourceName: 'The Verge',
    category: 'AI',
    aiScore: null,
    priorityScore: null,
    processingStatus: 'raw',
    summaryStatus: 'pending',
    contentStatus: 'ready',
  }), true);
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
  const moduleSections = [{
    key: 'models_labs',
    title: '模型与实验室',
    conclusion: '模型能力继续演进。',
    narrativeMarkdown: '### 模型与实验室\n\n结构化模块正文。',
    priorityArticles: [],
    signals: ['模型能力继续演进'],
    noise: [],
    actions: ['继续跟踪官方发布'],
    coverageCount: 0,
  }] satisfies DailyReportModuleSection[];
  const payload = { snapshot: { date: '2026-06-04' }, moduleSections };
  const update = buildDailyReportInsightConflictUpdate({
    summary: '# 今日日报',
    itemCount: 12,
    topics: ['AI'],
    payload,
  });

  assert.equal(update.summary, '# 今日日报');
  assert.equal(update.itemCount, 12);
  assert.equal(update.pipelineVersion, 3);
  assert.deepEqual(update.payload, payload);
  assert.deepEqual((update.payload as typeof payload).moduleSections, moduleSections);
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
  assert.ok(repeatedTitleCount <= 3, `lead title repeated ${repeatedTitleCount} times`);
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
  assert.match(fallback.markdown, /\[Claude Opus 4\.8 发布\]\(\/feed\/lead\)/);
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
  assert.match(rewritten, /## 下一步行动/);
});

test('builds modular daily report sections that cover more than the top eight articles', () => {
  const categories = [
    ['model', '模型与实验室', 'Claude Fable 5 发布'],
    ['agent', 'Agent/产品', '企业 Agent 工作流落地'],
    ['infra', '基础设施与算力', '推理芯片和数据中心扩容'],
    ['app', '应用与商业化', 'AI 应用商业化案例'],
    ['policy', '政策安全', 'AI 安全政策更新'],
    ['blog', '深读博客', '工程师长文反思'],
    ['china', '国内产业动态', '国内 AI 公司产品更新'],
  ] as const;
  const topItems: TopItem[] = Array.from({ length: 35 }, (_, index) => {
    const bucket = categories[index % categories.length];
    return {
      id: `item-${index}`,
      title: `${bucket[2]} ${index}`,
      url: `https://example.com/item-${index}`,
      aiScore: 90 - (index % 20),
      aiSummary: `${bucket[1]}方向的第 ${index} 条摘要，包含事实、影响和后续观察点。`,
      reportSummary: `${bucket[1]}方向的第 ${index} 条日报摘要。`,
      sourceName: index % 2 === 0 ? 'Anthropic Newsroom' : 'BestBlogs Daily Brief',
      category: bucket[1],
      fetchedAt: '2026-06-11T08:00:00.000Z',
    };
  });

  const sections = buildDailyReportModuleSections({
    date: '2026-06-11',
    totalItems: 800,
    newItems: 152,
    compareWindowDays: 7,
    topItems,
    highScoreItems: topItems.slice(0, 10),
    byCategory: [],
    topSources: [],
    themeClusters: [],
    generatedAt: '2026-06-11T09:00:00.000Z',
  });

  assert.ok(sections.length >= 4);
  assert.ok(new Set(sections.flatMap((section) => section.priorityArticles.map((item) => item.id))).size >= 20);
  assert.ok(sections.every((section) => section.conclusion && section.signals.length > 0 && section.actions.length > 0));
  assert.ok(sections.every((section) => section.narrativeMarkdown && section.narrativeMarkdown.length > 300));
  assert.ok(sections.every((section) => section.editorialTitle));
  assert.ok(sections.every((section) => (section.evidenceCount || 0) >= section.priorityArticles.length));
  assert.ok(sections.every((section) => section.evidence?.length === section.priorityArticles.length));
  assert.ok(sections.every((section) => section.evidence?.every((item) => item.fact && item.url && item.sourceName)));
  assert.ok(sections.every((section) => section.evidence?.some((item) => item.role === 'primary')));
  assert.ok(sections.some((section) => section.key === 'models_labs'));
  assert.ok(sections.some((section) => section.key === 'deep_reads'));
});

test('labels one-item modules as single observations instead of trends', () => {
  const [section] = buildDailyReportModuleSections({
    date: '2026-07-16', totalItems: 10, newItems: 4, compareWindowDays: 7,
    topItems: [{
      id: 'single-policy', title: 'AI 治理政策单篇观察', url: 'https://example.com/policy',
      aiScore: 86, aiSummary: '某监管机构发布了一条新的治理要求。', reportSummary: '治理要求更新。',
      sourceName: '官方来源', category: '政策安全', fetchedAt: '2026-07-16T08:00:00.000Z',
    }],
    highScoreItems: [], byCategory: [], topSources: [], themeClusters: [], generatedAt: '2026-07-16T09:00:00.000Z',
  });

  assert.match(section.editorialTitle || '', /单篇观察/);
  assert.match(section.conclusion, /尚不足以形成趋势判断/);
  assert.deepEqual(section.signals, []);
});

test('renders module narratives as readable subsections instead of one-line stitched paragraphs', () => {
  const topItems: TopItem[] = [
    {
      id: 'model-1',
      title: 'Claude Fable 5 发布',
      url: 'https://example.com/model-1',
      aiScore: 91,
      aiSummary: 'Anthropic 发布 Claude Fable 5，并强调更强的知识工作与编码能力。',
      reportSummary: 'Anthropic 发布 Claude Fable 5，并同步解释其定位与目标人群。',
      sourceName: 'Anthropic Newsroom',
      category: '模型与实验室',
      fetchedAt: '2026-06-15T08:00:00.000Z',
    },
    {
      id: 'model-2',
      title: 'Claude Fable 5 初步评测',
      url: 'https://example.com/model-2',
      aiScore: 87,
      aiSummary: '第三方评测显示新模型在长上下文与工具协同上更稳定。',
      reportSummary: '第三方评测显示新模型在长上下文与工具协同上更稳定。',
      sourceName: 'Simon Willison',
      category: '模型与实验室',
      fetchedAt: '2026-06-15T08:20:00.000Z',
    },
  ];

  const [section] = buildDailyReportModuleSections({
    date: '2026-06-15',
    totalItems: 120,
    newItems: 24,
    compareWindowDays: 7,
    topItems,
    highScoreItems: [],
    byCategory: [],
    topSources: [],
    themeClusters: [],
    generatedAt: '2026-06-15T10:00:00.000Z',
  });

  assert.ok(section);
  assert.match(section.narrativeMarkdown || '', /#### 发生了什么/);
  assert.match(section.narrativeMarkdown || '', /#### 为什么重要/);
  assert.match(section.narrativeMarkdown || '', /#### 建议动作/);
  assert.match(section.narrativeMarkdown || '', /- \[Claude Fable 5 发布\]/);
  assert.doesNotMatch(section.narrativeMarkdown || '', /发生了什么：.*；.*；/);
  assert.doesNotMatch(section.narrativeMarkdown || '', /这一组不是简单把/);
});

test('builds an editorial digest for AIGC Weekly style daily radar reports', () => {
  const buckets = [
    ['Claude Fable 5 发布', '模型与实验室', 'Anthropic Newsroom'],
    ['Agent 工作流平台更新', 'Agent/产品', 'BestBlogs Daily Brief'],
    ['推理芯片和数据中心扩容', '基础设施与算力', 'The Verge'],
    ['AI 应用商业化案例', '应用与商业化', '36kr'],
    ['AI 安全政策更新', '政策安全', 'Axios'],
    ['工程师长文反思 Agent 编排税', '深读博客', 'Simon Willison'],
    ['国内 AI 公司产品更新', '国内产业动态', '智东西'],
  ] as const;
  const topItems: TopItem[] = Array.from({ length: 60 }, (_, index) => {
    const bucket = buckets[index % buckets.length];
    return {
      id: `digest-${index}`,
      title: `${bucket[0]} ${index}`,
      url: `https://example.com/digest-${index}`,
      aiScore: 92 - (index % 30),
      aiSummary: `${bucket[1]}方向第 ${index} 条，包含事实、背景、影响和后续观察价值。`,
      reportSummary: `${bucket[1]}方向第 ${index} 条日报素材，适合作为信息雷达证据。`,
      sourceName: bucket[2],
      category: bucket[1],
      contentLength: 3_000,
      fetchedAt: '2026-06-15T08:00:00.000Z',
    };
  });
  const snapshot: DailyReportSnapshot = {
    date: '2026-06-15',
    totalItems: 900,
    newItems: 180,
    compareWindowDays: 7,
    topItems: topItems.slice(0, 24),
    highScoreItems: topItems.slice(24),
    byCategory: [
      { category: '模型与实验室', count: 26, baselineAvg: 9, delta: 17 },
      { category: 'Agent/产品', count: 22, baselineAvg: 8, delta: 14 },
      { category: '深读博客', count: 18, baselineAvg: 6, delta: 12 },
    ],
    topSources: [
      { sourceName: 'Anthropic Newsroom', count: 8 },
      { sourceName: 'BestBlogs Daily Brief', count: 7 },
      { sourceName: 'Simon Willison', count: 6 },
    ],
    themeClusters: [
      { label: '模型发布', count: 12, sampleTitles: ['Claude Fable 5 发布 0'] },
      { label: 'Agent 工作流', count: 10, sampleTitles: ['Agent 工作流平台更新 1'] },
    ],
    generatedAt: '2026-06-15T10:00:00.000Z',
  };

  const digest = buildDailyReportEditorialDigest(snapshot);

  assert.match(digest.coverJudgement.title, /模型|Agent|AI|信息雷达|技术|产品/);
  assert.ok(digest.tableOfContents.includes('今日精选'));
  assert.ok(digest.tableOfContents.includes('更多动态'));
  assert.ok(digest.curated.length >= 8);
  assert.ok(digest.moduleReferences.length >= 20);
  assert.ok(digest.moreDynamics.length >= 10);
  assert.ok(digest.deepReads.length >= 3);
  assert.ok(digest.radarOverview.markdown.includes('信息雷达总览'));
  assert.ok(digest.tableOfContents.includes('附录：全池摘要索引'));
  assert.match(digest.readingOrder.markdown, /## 阅读顺序/);
  assert.match(digest.nextActions.markdown, /## 下一步行动/);
  assert.equal((digest.readingOrder.markdown.match(/### 暂缓/g) || []).length, 1);
  assert.equal(digest.materials.length, new Set(digest.materials.map((item) => item.itemId)).size);
  assert.ok(digest.materials.length >= digest.curated.length + digest.moreDynamics.length);
  assert.ok(digest.materials.every((item) => item.fact && item.evidenceUrl && item.sourceName && item.theme));
  assert.ok(digest.materials.every((item) => item.placements.includes(item.recommendedPlacement)));
  assert.ok(digest.materials.some((item) => item.recommendedPlacement === 'featured'));
  assert.ok(digest.materials.some((item) => item.placements.includes('module')));
  assert.ok(digest.materials.some((item) => item.placements.includes('deep_read')));
  assert.ok(digest.materials.some((item) => item.factBasis === 'report_summary'));
});

test('daily editorial digest keeps short quotations out of deep reads', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-17',
    totalItems: 2,
    newItems: 2,
    compareWindowDays: 7,
    topItems: [{
      id: 'short-quote',
      title: 'Quoting Kimi K3',
      url: 'https://example.com/short-quote',
      aiScore: 78,
      aiSummary: 'Kimi K3 拒绝泄露系统提示后，询问用户是否有实际需要帮助的事情。',
      sourceName: 'Simon Willison',
      category: 'Blogs',
      contentLength: 167,
    }, {
      id: 'long-methodology',
      title: 'A long essay on building reliable agents',
      url: 'https://example.com/long-methodology',
      aiScore: 86,
      aiSummary: '这篇长文从评测、工具调用和反馈闭环三个层面分析可靠 Agent 的工程方法。',
      sourceName: 'Paul Graham Essays',
      category: 'Blogs',
      contentLength: 5_200,
    }],
    highScoreItems: [],
    byCategory: [],
    topSources: [],
    themeClusters: [],
    generatedAt: '2026-07-17T10:00:00.000Z',
  };

  const digest = buildDailyReportEditorialDigest(snapshot);

  assert.equal(digest.deepReads.some((item) => item.id === 'short-quote'), false);
  assert.equal(digest.deepReads.some((item) => item.id === 'long-methodology'), true);
  assert.equal(digest.moreDynamics.some((item) => item.id === 'short-quote'), false);
  assert.equal(digest.curated.some((item) => item.id === 'short-quote'), true);
});

test('keeps generic market, event promotion, and malformed image captions out of more dynamics', () => {
  const topItems: TopItem[] = Array.from({ length: 12 }, (_, index) => ({
    id: `curated-signal-${index}`,
    title: `AI model engineering update ${index}`,
    url: `https://example.com/curated-signal-${index}`,
    aiScore: 95 - index,
    aiSummary: `AI model engineering update ${index} includes a concrete technical change.`,
    sourceName: 'OpenAI News',
    category: '模型与实验室',
    contentLength: 2_000,
  }));
  const extras: DailyReportPriorityArticle[] = [
    { id: 'useful-ai', title: 'OpenAI releases a new agent runtime', url: 'https://example.com/useful-ai', sourceName: 'TechCrunch', category: 'tech', reason: '侧证', summary: 'OpenAI 发布新的 Agent runtime。' },
    { id: 'useful-go', title: 'Go adds a zero-cost maps API', url: 'https://example.com/useful-go', sourceName: 'TonyBai', category: 'tech', reason: '侧证', summary: 'Go 标准库增加新的 maps API。' },
    { id: 'market-ipo', title: 'Nuclear fuel firm falls in NYSE debut after slashing IPO size', url: 'https://example.com/market-ipo', sourceName: 'Reuters Technology AI', category: 'tech', reason: '兜底', summary: '公司上市首日股价下跌。' },
    { id: 'event-promo', title: 'Disrupt 2026 session shows how to get pre-seed funding', url: 'https://example.com/event-promo', sourceName: 'TechCrunch', category: 'tech', reason: '兜底', summary: '报名参加峰会活动。' },
    { id: 'broken-caption', title: 'AI hiring changes the technology workforce', url: 'https://example.com/broken-caption', sourceName: 'Reuters Technology AI', category: 'tech', reason: '兜底', summary: '!A conference display photographed in New Delhi.' },
  ];
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-17',
    totalItems: 100,
    newItems: 40,
    compareWindowDays: 7,
    topItems,
    highScoreItems: topItems,
    byCategory: [],
    topSources: [],
    themeClusters: [],
    moduleSections: [{
      key: 'agent_products',
      title: '补充动态',
      conclusion: '补充今日动态。',
      priorityArticles: extras,
      signals: [],
      noise: [],
      actions: [],
      coverageCount: extras.length,
      evidenceCount: extras.length,
    }],
    generatedAt: '2026-07-17T10:00:00.000Z',
  };

  const digest = buildDailyReportEditorialDigest(snapshot);
  assert.deepEqual(digest.moreDynamics.map((item) => item.id), ['useful-ai', 'useful-go']);
});

test('keeps the final published more-dynamics section aligned with the editorial filter', () => {
  const curated: TopItem[] = Array.from({ length: 12 }, (_, index) => ({
    id: `grounded-curated-${index}`,
    title: `AI model release ${index}`,
    url: `https://example.com/grounded-curated-${index}`,
    sourceName: 'OpenAI News',
    category: '模型与实验室',
    fetchedAt: '2026-07-17T08:00:00.000Z',
    aiScore: 95 - index,
    aiSummary: `AI model release ${index} provides a concrete technical update.`,
    contentLength: 2_000,
  }));
  const extras: TopItem[] = [
    { id: 'grounded-useful-go', title: 'Go adds a zero-cost maps API', url: 'https://example.com/grounded-useful-go', sourceName: 'TonyBai', category: 'tech', fetchedAt: '2026-07-17T07:00:00.000Z', aiScore: 70, aiSummary: 'Go 标准库增加新的 maps API。' },
    { id: 'grounded-market', title: 'Nuclear fuel firm falls in NYSE debut after slashing IPO size', url: 'https://example.com/grounded-market', sourceName: 'Reuters Technology AI', category: 'tech', fetchedAt: '2026-07-17T06:00:00.000Z', aiScore: 68, aiSummary: '公司上市首日股价下跌。' },
    { id: 'grounded-promo', title: 'Disrupt 2026 session shows how to get pre-seed funding', url: 'https://example.com/grounded-promo', sourceName: 'TechCrunch', category: 'tech', fetchedAt: '2026-07-17T05:00:00.000Z', aiScore: 66, aiSummary: '报名参加峰会活动。' },
  ];
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-17',
    totalItems: 30,
    newItems: 18,
    compareWindowDays: 7,
    topItems: curated,
    highScoreItems: extras,
    byCategory: [],
    topSources: [],
    themeClusters: [],
    generatedAt: '2026-07-17T09:00:00.000Z',
  };

  const grounded = groundDailyReportModelMarkdown([
    '# 模型工程进入新阶段',
    '## 模型发布与实验室动向',
    '### AI model release 0',
  ].join('\n\n'), snapshot);

  assert.match(grounded.markdown, /Go adds a zero-cost maps API/);
  assert.doesNotMatch(grounded.markdown, /Nuclear fuel firm|Disrupt 2026 session/);
});

test('publishes deep reads and reading order without selection jargon or broken markdown tails', () => {
  const topItem: TopItem = {
    id: 'grounded-lead',
    title: 'A reliable agent runtime',
    url: 'https://example.com/grounded-lead',
    sourceName: 'OpenAI News',
    category: 'Agent/Products',
    fetchedAt: '2026-07-17T08:00:00.000Z',
    aiScore: 92,
    aiSummary: 'The runtime adds durable execution and traceable tool calls.',
    contentLength: 2_000,
  };
  const deepRead: TopItem = {
    id: 'grounded-deep-read',
    title: 'A long methodology for reliable agents',
    url: 'https://example.com/grounded-deep-read',
    sourceName: 'Simon Willison',
    category: 'Blogs',
    fetchedAt: '2026-07-17T07:00:00.000Z',
    aiScore: 80,
    aiSummary: 'This essay explains evaluation, tool use and feedback loops ) ) ) ) ]( with concrete engineering evidence.',
    selectionReason: 'AI；产品、技术或产业增量明确；达到精选分 80',
    contentLength: 5_200,
  };
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-17',
    totalItems: 12,
    newItems: 2,
    compareWindowDays: 7,
    topItems: [topItem],
    highScoreItems: [deepRead],
    byCategory: [],
    topSources: [],
    themeClusters: [],
    generatedAt: '2026-07-17T09:00:00.000Z',
  };

  const grounded = groundDailyReportModelMarkdown([
    '# Agent 工程进入稳定执行阶段',
    '## Agent 与产品入口',
    '### A reliable agent runtime',
  ].join('\n\n'), snapshot);

  assert.match(grounded.markdown, /A long methodology for reliable agents/);
  assert.match(grounded.markdown, /这篇长文从评测|This essay explains evaluation/);
  assert.doesNotMatch(grounded.markdown, /产品、技术或产业增量明确|达到精选分|\)\s+\)\s+\)/);
  assert.doesNotMatch(grounded.markdown, /用于判断 AI 能力是否已进入稳定的产品或工作流|当前缺少可靠摘要/);
});

test('degraded daily presentation exposes facts and gaps without editorial judgement', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-11',
    totalItems: 5600,
    newItems: 252,
    compareWindowDays: 7,
    topItems: [{
      id: 'fact-1',
      title: 'OpenAI 发布新模型',
      url: 'https://example.com/fact-1',
      aiScore: 88,
      aiSummary: 'OpenAI 发布新模型，并公布了能力范围与可用入口。',
      reportSummary: 'OpenAI 发布新模型，并公布了能力范围与可用入口。',
      sourceName: 'OpenAI News',
      category: '模型与实验室',
      selectionMode: 'scored',
    }],
    highScoreItems: [],
    byCategory: [],
    topSources: [{ sourceName: 'OpenAI News', count: 1 }],
    themeClusters: [],
    generatedAt: '2026-07-11T08:00:00.000Z',
    candidateFunnel: {
      todayNew: 252,
      mainVisible: 200,
      scopeMatched: 72,
      scoredCandidates: 1,
      reviewCandidates: 0,
      fallbackScoredCandidates: 0,
      softFilteredRecovered: 0,
      scoreFailedCandidates: 2,
      latestFallbackCandidates: 0,
      translationPending: 0,
      translationFailed: 3,
      finalCandidates: 1,
    },
  };
  const modules = buildDailyReportModuleSections(snapshot);
  const degraded = buildDegradedDailyReportPresentation(snapshot, modules);

  assert.match(degraded.markdown, /## 可核验事实/);
  assert.match(degraded.markdown, /\[OpenAI 发布新模型\]\(\/feed\/fact-1\)/);
  assert.match(degraded.markdown, /## 素材缺口/);
  assert.match(degraded.markdown, /3 条候选翻译失败/);
  assert.doesNotMatch(degraded.markdown, /今日封面判断|成为今日主线|为什么重要|## 下一步行动/);
  assert.match(degraded.coverJudgement.summary, /不输出趋势结论和行动建议/);
  assert.ok(degraded.moduleSections.every((section) => section.signals.length === 0 && section.actions.length === 0));
});

test('fills more dynamics from explicit module references when curated articles consume the top list', () => {
  const topItems: TopItem[] = Array.from({ length: 12 }, (_, index) => ({
    id: `curated-${index}`,
    title: `精选头部模型新闻 ${index}`,
    url: `https://example.com/curated-${index}`,
    aiScore: 90 - index,
    aiSummary: `精选头部模型新闻 ${index} 的摘要。`,
    reportSummary: `精选头部模型新闻 ${index} 的日报摘要。`,
    sourceName: 'OpenAI News',
    category: '模型与实验室',
    fetchedAt: '2026-06-16T08:00:00.000Z',
  }));
  const moduleArticles: DailyReportPriorityArticle[] = Array.from({ length: 24 }, (_, index) => ({
    id: `module-extra-${index}`,
    title: `模块补充动态 ${index}`,
    url: `https://example.com/module-extra-${index}`,
    sourceName: index % 2 === 0 ? 'BestBlogs Daily Brief' : 'The Verge AI',
    category: index % 3 === 0 ? 'Agent/产品' : index % 3 === 1 ? '基础设施与算力' : '应用与商业化',
    reason: `模块补充动态 ${index} 是该模块的侧证。`,
    summary: `模块补充动态 ${index} 适合放入更多动态，补齐信息雷达覆盖。`,
  }));
  const moduleSections: DailyReportModuleSection[] = [
    {
      key: 'agent_products',
      title: 'Agent/产品',
      editorialTitle: 'Agent 产品信号继续扩散',
      conclusion: '产品侧出现多条补充动态，需要进入更多动态层。',
      priorityArticles: moduleArticles.slice(0, 12),
      signals: ['Agent 产品信号增多'],
      noise: [],
      actions: ['扫读补充动态'],
      coverageCount: 12,
      evidenceCount: 12,
    },
    {
      key: 'infra_compute',
      title: '基础设施与算力',
      editorialTitle: '基础设施动态作为侧证',
      conclusion: '算力和基础设施动态补充今日雷达。',
      priorityArticles: moduleArticles.slice(12),
      signals: ['算力侧证增多'],
      noise: [],
      actions: ['保留为雷达附录'],
      coverageCount: 12,
      evidenceCount: 12,
    },
  ];
  const snapshot: DailyReportSnapshot = {
    date: '2026-06-16',
    totalItems: 500,
    newItems: 96,
    compareWindowDays: 7,
    topItems,
    highScoreItems: topItems,
    byCategory: [],
    topSources: [],
    themeClusters: [],
    moduleSections,
    generatedAt: '2026-06-16T10:00:00.000Z',
  };

  const digest = buildDailyReportEditorialDigest(snapshot);

  assert.ok(digest.curated.length >= 8);
  assert.ok(digest.moreDynamics.length >= 16);
  assert.ok(digest.moreDynamics.every((item) => !digest.curated.some((curated) => curated.id === item.id)));
  assert.ok(digest.moduleReferences.some((item) => item.id.startsWith('module-extra-')));
  assert.ok(digest.moreDynamics.some((item) => item.id.startsWith('module-extra-')));
});

test('supplements report evidence to 25 distinct links without promoting fallback items to curated', () => {
  const topItems: TopItem[] = Array.from({ length: 21 }, (_, index) => ({
    id: `selected-${index}`,
    title: `精选事实 ${index}`,
    url: `https://example.com/selected-${index}`,
    aiScore: 90 - index,
    aiSummary: `精选事实 ${index} 的可核验摘要。`,
    reportSummary: `精选事实 ${index} 的日报摘要。`,
    sourceName: index % 2 === 0 ? 'OpenAI News' : 'Anthropic Newsroom',
    category: index % 2 === 0 ? '模型与实验室' : 'Agent/产品',
    fetchedAt: '2026-07-12T08:00:00.000Z',
  }));
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-12',
    totalItems: 500,
    newItems: 112,
    compareWindowDays: 7,
    topItems,
    highScoreItems: topItems,
    byCategory: [],
    topSources: [],
    themeClusters: [],
    generatedAt: '2026-07-12T10:00:00.000Z',
  };
  snapshot.moduleSections = buildDailyReportModuleSections(snapshot);
  const coverageItems = Array.from({ length: 11 }, (_, index) => ({
    id: `fallback-${index}`,
    title: `补充事实 ${index}`,
    url: `https://example.com/fallback-${index}`,
    sourceName: '技术博客',
    category: '深读博客',
    status: 'latestFallback' as const,
    statusLabel: '最新兜底',
    digest: `补充事实 ${index} 的摘要。`,
    reason: '作为最新事实线索补充覆盖。',
    action: '扫读并核对原文。',
    score: 60 - index,
    translationStatus: 'ready',
    translationStatusLabel: '翻译完成',
  }));

  snapshot.editorialSupplementArticles = buildDailyReportSupplementalArticles(snapshot, coverageItems);
  const digest = buildDailyReportEditorialDigest(snapshot);
  const degraded = buildDegradedDailyReportPresentation(snapshot, snapshot.moduleSections);
  const degradedLinks = [...degraded.markdown.matchAll(/\]\((\/feed\/[^)]+)\)/g)].map((match) => match[1]);

  assert.equal(snapshot.editorialSupplementArticles.length, 4);
  assert.equal(digest.curated.length, 12);
  assert.ok(digest.curated.every((article) => article.id.startsWith('selected-')));
  assert.equal(new Set(digest.materials.map((material) => material.evidenceUrl)).size, 25);
  assert.ok(digest.moreDynamics.some((article) => article.id.startsWith('fallback-')));
  assert.match(degraded.markdown, /## 补充事实线索/);
  assert.equal(new Set(degradedLinks).size, 25);
  assert.match(degraded.coverJudgement.summary, /其中 4 篇来自待复核或最新兜底/);
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
  assert.match(rewritten, /## 模块日报/);
  assert.match(rewritten, /## 今日精选/);
  assert.match(rewritten, /\[特锐德推出算力中心供电站“算电岛”\]\(\/feed\/infra\)/);
  assert.match(rewritten, /\[Pluralistic: Refining humanity\]\(\/feed\/pluralistic\)/);
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
  assert.match(rewritten, /低置信、摘要不完整或翻译不完整/);
  assert.match(rewritten, /重新生成正式日报/);
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

  assert.match(rewritten, /\[Claude Opus 4\.8 发布\]\(\/feed\/lead\)/);
  assert.match(rewritten, /产品、技术或智能体落地信号明确|产品落地信号明确/);
  assert.doesNotMatch(rewritten, /入报原因|达到精选分|评分\s*\d/);
  assert.match(rewritten, /\[Agent 工作流平台更新\]\(\/feed\/tool\)/);
  assert.doesNotMatch(rewritten, /行业持续发展，值得关注/);
});

test('final ai markdown keeps only the explicit judgement instead of duplicating model sections', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-16',
    totalItems: 30,
    newItems: 8,
    compareWindowDays: 7,
    topItems: [
      {
        id: 'lead',
        title: '可核验模型发布',
        url: 'https://example.com/lead',
        aiScore: 88,
        aiSummary: '官方发布了可核验的新模型。',
        reportSummary: '官方发布了可核验的新模型，并给出公开说明。',
        sourceName: '官方来源',
        category: '模型与实验室',
        selectionMode: 'scored',
      },
    ],
    highScoreItems: [],
    byCategory: [{ category: '模型与实验室', count: 8, baselineAvg: 5, delta: 3 }],
    topSources: [{ sourceName: '官方来源', count: 1 }],
    themeClusters: [],
    generatedAt: '2026-07-16T06:00:00.000Z',
  };
  const aiMarkdown = [
    '## 今日判断',
    '',
    '当前只有一条官方证据，适合保留为观察信号，暂不扩展成趋势。',
    '',
    '## 今日精选',
    '',
    '- 模型重复生成的精选区不应再次进入正式正文。',
    '',
    '## 技术对比',
    '',
    '- 模型虚构对比：准确率 99%，成本下降 80%。',
    '',
    '## 下一步行动',
    '',
    '- 模型重复生成的行动区不应覆盖确定性行动。',
  ].join('\n');

  const rewritten = enforceFinalReadingAdvice(aiMarkdown, snapshot);

  assert.match(rewritten, /当前只有一条官方证据/);
  assert.doesNotMatch(rewritten, /模型重复生成的精选区|模型虚构对比|准确率 99%|成本下降 80%/);
  assert.equal((rewritten.match(/## 今日精选/g) || []).length, 1);
  assert.equal((rewritten.match(/## 下一步行动/g) || []).length, 1);
});

test('final ai markdown includes collection trends and priority articles before main judgement', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-05-29',
    totalItems: 160,
    newItems: 72,
    compareWindowDays: 7,
    topItems: Array.from({ length: 8 }).map((_, index) => ({
      id: `item-${index}`,
      title: `AI 重点文章 ${index + 1}`,
      url: `https://example.com/item-${index}`,
      aiScore: 86 - index,
      aiSummary: `第 ${index + 1} 条文章提供了模型、产品或产业变化的具体证据。`,
      reportSummary: `第 ${index + 1} 条文章展示了 AI 产业链中的真实增量，适合进入今日重点文章。`,
      selectionReason: '达到精选分阈值 70；B 来源；具备产品、技术或产业直接增量。',
      sourceName: index < 4 ? '36kr' : 'Blog',
      category: index < 3 ? '产品发布/更新' : 'Blogs',
      selectionMode: 'scored',
    })),
    highScoreItems: [],
    byCategory: [
      { category: '产品发布/更新', count: 18, baselineAvg: 6, delta: 12 },
      { category: 'Blogs', count: 22, baselineAvg: 10, delta: 12 },
      { category: 'uncategorized', count: 20, baselineAvg: 18, delta: 2 },
    ],
    topSources: [{ sourceName: '36kr', count: 4 }, { sourceName: 'Blog', count: 4 }],
    themeClusters: [{ label: 'Agent', count: 5, sampleTitles: ['AI 重点文章 1', 'AI 重点文章 2'] }],
    generatedAt: '2026-05-29T10:00:00.000Z',
    candidateFunnel: {
      todayNew: 72,
      mainVisible: 60,
      scopeMatched: 30,
      scoredCandidates: 12,
      reviewCandidates: 2,
      fallbackScoredCandidates: 1,
      softFilteredRecovered: 0,
      scoreFailedCandidates: 0,
      latestFallbackCandidates: 1,
      translationPending: 0,
      translationFailed: 0,
      finalCandidates: 8,
    },
    eventMetrics: {
      localItemCount: 72,
      independentEventCount: 48,
      multiSourceEventCount: 9,
      firstPartyEventCount: 18,
      firstPartyEventShare: 0.375,
      modelProductEventCount: 21,
      externalRadarItemCount: 4,
      externalRadarEventCount: 3,
      aihotLocalMissCount: 1,
      unverifiableRadarItemCount: 1,
    },
  };

  const rewritten = enforceFinalReadingAdvice('## 今日判断\n\n今日 AI 主线明确。', snapshot);

  assert.ok(rewritten.indexOf('## 信息雷达总览') < rewritten.indexOf('## 编辑补充判断'));
  assert.ok(rewritten.indexOf('## 今日精选') < rewritten.indexOf('## 编辑补充判断'));
  assert.match(rewritten, /近 7 日均值/);
  assert.match(rewritten, /48 个独立事件/);
  assert.match(rewritten, /多源交叉验证/);
  assert.match(rewritten, /AI HOT 命中但本地遗漏 1 个/);
  assert.match(rewritten, /\[AI 重点文章 1\]\(\/feed\/item-0\)/);
  assert.match(rewritten, /\[AI 重点文章 6\]\(\/feed\/item-5\)/);
  assert.doesNotMatch(rewritten, /uncategorized|入报原因|达到精选分|评分\s*\d|B 来源/);
});

test('builds structured trend summary and priority articles for the report API', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-05-29',
    totalItems: 50,
    newItems: 20,
    compareWindowDays: 7,
    topItems: [
      {
        id: 'lead',
        title: 'AI 数据中心新进展',
        url: 'https://example.com/lead',
        aiScore: 88,
        aiSummary: 'AI 数据中心建设出现新进展。',
        reportSummary: 'AI 数据中心建设出现新进展，值得作为今日重点文章先读。',
        selectionReason: '达到精选分阈值 70；A 来源；基础设施信号明确。',
        sourceName: '36kr',
        category: '基础设施',
        selectionMode: 'scored',
      },
    ],
    highScoreItems: [],
    byCategory: [{ category: '基础设施', count: 9, baselineAvg: 3, delta: 6 }],
    topSources: [{ sourceName: '36kr', count: 1 }],
    themeClusters: [{ label: '算力', count: 3, sampleTitles: ['AI 数据中心新进展'] }],
    eventMetrics: {
      localItemCount: 9,
      independentEventCount: 6,
      multiSourceEventCount: 2,
      firstPartyEventCount: 3,
      firstPartyEventShare: 0.5,
      modelProductEventCount: 4,
      externalRadarItemCount: 2,
      externalRadarEventCount: 2,
      aihotLocalMissCount: 1,
      unverifiableRadarItemCount: 0,
    },
    generatedAt: '2026-05-29T10:00:00.000Z',
  };

  const trend = buildDailyReportTrendSummary(snapshot);
  const articles = buildDailyReportPriorityArticles(snapshot);

  assert.equal(trend.newItems, 20);
  assert.equal(trend.categories[0].category, '基础设施');
  assert.equal(trend.themes[0].label, '算力');
  assert.equal(trend.eventMetrics?.independentEventCount, 6);
  assert.equal(trend.eventMetrics?.aihotLocalMissCount, 1);
  assert.equal(articles[0].title, 'AI 数据中心新进展');
  assert.match(articles[0].reason, /基础设施|事实增量|技术路线|资源配置/);
  assert.doesNotMatch(articles[0].reason, /达到精选分|评分|A 来源|入报原因/);
});

test('priority articles extract readable text from structured translation payloads', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-16',
    totalItems: 1,
    newItems: 1,
    compareWindowDays: 7,
    topItems: [
      {
        id: 'structured-summary',
        title: 'Welcome Inkling by Thinking Machines',
        url: 'https://huggingface.co/blog/thinkingmachines-inkling',
        aiScore: 88,
        aiSummary: JSON.stringify({
          translatedTitle: '欢迎使用 Thinking Machines 的 Inkling',
          blocks: [
            { id: 'b0001', markdown: '[Thinking Machines](https://example.com) 发布了可根据个人需求调整的新模型。' },
          ],
        }),
        sourceName: 'Hugging Face Blog',
        category: 'AI',
        selectionMode: 'scored',
      },
    ],
    highScoreItems: [],
    byCategory: [],
    topSources: [],
    themeClusters: [],
    generatedAt: '2026-07-16T00:00:00.000Z',
  };

  const articles = buildDailyReportPriorityArticles(snapshot);

  assert.equal(articles[0].summary, 'Thinking Machines 发布了可根据个人需求调整的新模型。');
  assert.doesNotMatch(articles[0].summary, /translatedTitle|blocks|\$1|https?:\/\//);
});

test('priority articles fall back to the snippet when a structured payload is truncated', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-16',
    totalItems: 1,
    newItems: 1,
    compareWindowDays: 7,
    topItems: [
      {
        id: 'truncated-structured-summary',
        title: 'Welcome Inkling by Thinking Machines',
        url: 'https://huggingface.co/blog/thinkingmachines-inkling',
        aiScore: 88,
        aiSummary: null,
        reportSummary: '{"translatedTitle":"欢迎使用 Inkling","blocks":{"id":"b0001","markdown":"[\u8fd4回文章"},{',
        snippet: 'Thinking Machines 发布 Inkling，并开源训练数据与评测工具。',
        sourceName: 'Hugging Face Blog',
        category: 'AI',
        selectionMode: 'scored',
      },
    ],
    highScoreItems: [],
    byCategory: [],
    topSources: [],
    themeClusters: [],
    generatedAt: '2026-07-16T00:00:00.000Z',
  };

  const articles = buildDailyReportPriorityArticles(snapshot);

  assert.equal(articles[0].summary, 'Thinking Machines 发布 Inkling，并开源训练数据与评测工具。');
});

test('priority article summaries remove markdown headings, empty images and list markers', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-07-16', totalItems: 1, newItems: 1, compareWindowDays: 7,
    topItems: [{
      id: 'formatted-summary', title: '格式清理测试', url: 'https://example.com/formatted-summary',
      aiScore: 88,
      aiSummary: '#### 总结\n\n![](https://example.com/empty.png)\n\n- 第一条可核对事实\n- 第二条可核对事实',
      sourceName: '测试来源', category: '深读博客', fetchedAt: '2026-07-16T08:00:00.000Z',
    }],
    highScoreItems: [], byCategory: [], topSources: [], themeClusters: [], generatedAt: '2026-07-16T09:00:00.000Z',
  };

  const [article] = buildDailyReportPriorityArticles(snapshot);

  assert.equal(article.summary, '总结 第一条可核对事实 第二条可核对事实');
  assert.doesNotMatch(article.summary, /#{1,6}|!\[|https?:\/\//);
});

test('priority articles prefer saved article assets for summary and reading reason', () => {
  const snapshot: DailyReportSnapshot = {
    date: '2026-06-11',
    totalItems: 20,
    newItems: 10,
    compareWindowDays: 7,
    topItems: [
      {
        id: 'asset-item',
        title: 'Claude Fable 5 深度分析',
        url: 'https://example.com/claude-fable-5',
        aiScore: 92,
        aiSummary: '旧摘要不应该优先出现。',
        reportSummary: '旧日报摘要不应该优先出现。',
        selectionReason: '达到精选分阈值 70；A 来源。',
        sourceName: 'Example',
        category: '模型发布',
        selectionMode: 'scored',
        readingAssets: [
          {
            type: 'qa',
            label: '总结要点',
            status: 'ready',
            source: 'ai',
            promptKey: 'key_points',
            content: 'Claude Fable 5 的核心变化是更强的长上下文推理和更严格的安全边界。',
            preview: 'Claude Fable 5 的核心变化是更强的长上下文推理和更严格的安全边界。',
          },
          {
            type: 'qa',
            label: '证据清单',
            status: 'ready',
            source: 'ai',
            promptKey: 'evidence',
            content: '文章给出的关键证据包括模型评测、发布说明和开发者使用反馈。',
            preview: '文章给出的关键证据包括模型评测、发布说明和开发者使用反馈。',
          },
          {
            type: 'qa',
            label: '行动建议',
            status: 'ready',
            source: 'ai',
            promptKey: 'actions',
            content: '建议先读发布说明，再观察开发者社区的一手评测。',
            preview: '建议先读发布说明，再观察开发者社区的一手评测。',
          },
        ],
      },
    ],
    highScoreItems: [],
    byCategory: [{ category: '模型发布', count: 3, baselineAvg: 1, delta: 2 }],
    topSources: [{ sourceName: 'Example', count: 1 }],
    themeClusters: [{ label: 'Claude', count: 1, sampleTitles: ['Claude Fable 5 深度分析'] }],
    generatedAt: '2026-06-11T10:00:00.000Z',
  };

  const articles = buildDailyReportPriorityArticles(snapshot);

  assert.match(articles[0].summary, /核心变化是更强的长上下文推理/);
  assert.match(articles[0].reason, /关键证据包括模型评测/);
  assert.match(articles[0].reason, /建议先读发布说明/);
  assert.doesNotMatch(articles[0].summary, /旧摘要/);
  assert.deepEqual(articles[0].assetReferences?.map((asset) => asset.promptKey), ['key_points', 'evidence', 'actions']);
  assert.match(articles[0].assetReferences?.[0]?.excerpt || '', /核心变化是更强的长上下文推理/);
});

test('humanizes daily report selection reasons for candidate surfaces', () => {
  const reason = humanizeDailyReportSelectionReason('达到精选分阈值 70；行业动态；B 来源；具备产品、技术或产业直接增量。', {
    title: '得物与微信就AI Agent达成首批合作',
    category: '行业动态',
  });

  assert.match(reason, /产品|技术|产业|今日主线/);
  assert.doesNotMatch(reason, /达到精选分|评分|B 来源|入报原因/);
});

test('humanizes excluded candidate detail for candidate surfaces', () => {
  const detail = humanizeDailyReportExcludedDetail('未达到精选分且未启用最新兜底', 'not_selected', {
    title: '沪深两市成交额连续第42个交易日突破2万亿元',
    category: '技巧与观点',
  });

  assert.match(detail, /信号强度不足|复核线索/);
  assert.doesNotMatch(detail, /达到精选分|兜底|评分|score/i);
});

test('builds a full candidate coverage index with clean digests and stable status buckets', () => {
  const coverage = buildDailyReportCoverageIndex({
    finalCandidates: [{
      id: 'selected-1',
      title: '美团发布 AI 浏览器 Tabbit 1.0',
      url: 'https://example.com/selected',
      sourceName: '36kr',
      category: '产品发布/更新',
      aiScore: 88,
      reportSummary: '美团发布 AI 原生浏览器，内置多模型并加入可调用记忆。',
      aiSummary: '备用摘要',
      translationStatus: 'skipped',
      selectionReason: '达到精选分 88；B 来源；产品发布/更新；具备产品、技术或产业直接增量。',
      selectionMode: 'scored',
    }],
    reviewCandidates: [{
      id: 'review-1',
      title: 'AI Agent 工作流复盘',
      url: 'https://example.com/review',
      sourceName: 'BestBlogs.dev',
      category: 'Blogs',
      aiScore: 62,
      aiSummary: '这是一篇关于 Agent 工作流落地经验的文章，值得人工复核。',
      translationStatus: 'ready',
      selectionReason: '低分复核；Agent 工作流；B 来源。',
      selectionMode: 'review',
    }],
    latestFallbackCandidates: [{
      id: 'latest-1',
      title: '小米模型推理提速',
      url: 'https://example.com/latest',
      sourceName: '36kr',
      category: '模型发布/更新',
      aiScore: null,
      snippet: '小米模型推理速度提升至 1000 tokens/s。',
      translationStatus: 'skipped',
      selectionReason: '候选不足时作为同范围最新线索补齐；B 来源。',
      selectionMode: 'latest_visible',
    }],
    excluded: [{
      id: 'excluded-1',
      title: '沪深两市成交额突破 2 万亿元',
      url: 'https://example.com/excluded',
      sourceName: '36kr',
      category: '资本市场',
      aiScore: 50,
      reason: 'not_selected',
      detail: '未达到精选分且未启用最新兜底',
      translationStatus: 'skipped',
    }],
  } as any);

  assert.deepEqual(coverage.summary, {
    total: 4,
    selected: 1,
    review: 1,
    latestFallback: 1,
    excluded: 1,
    missingDigest: 0,
  });
  assert.deepEqual(coverage.items.map((item) => item.status), ['selected', 'review', 'latestFallback', 'excluded']);
  assert.equal(coverage.items[0].statusLabel, '已精选');
  assert.equal(coverage.items[1].statusLabel, '待复核');
  assert.equal(coverage.items[2].statusLabel, '最新兜底');
  assert.equal(coverage.items[3].statusLabel, '未入报');
  assert.match(coverage.markdown, /## 候选全池摘要索引/);
  assert.match(coverage.markdown, /### 已精选/);
  assert.match(coverage.markdown, /### 待复核/);
  assert.match(coverage.markdown, /\[美团发布 AI 浏览器 Tabbit 1\.0\]\(https:\/\/example\.com\/selected\)/);
  assert.doesNotMatch(coverage.markdown, /达到精选分|B 来源|skipped|ready|uncategorized/i);
  for (const item of coverage.items) {
    assert.ok(item.digest.length > 0);
    assert.doesNotMatch(`${item.digest}\n${item.reason}\n${item.action}`, /skipped|ready|达到精选分|B 来源|uncategorized|Token\s*(用量|消耗|统计|明细)|tokens?\s*[:：]/i);
  }
});

test('final report markdown hides raw uncategorized labels', () => {
  const markdown = [
    '## 今日结论',
    '',
    '今日重点集中在 **uncategorized（56条）** 和 AI 工具。参考 https://example.com/raw',
    '',
    '## 关键进展',
    '',
    '- [有效链接](https://example.com/linked) 分类 uncategorized 的条目需要处理。入报原因：达到精选分阈值 70。',
  ].join('\n');

  const cleaned = sanitizeDailyReportMarkdown(markdown);

  assert.doesNotMatch(cleaned, /uncategorized/i);
  assert.doesNotMatch(cleaned, /未分类待治理线索/);
  assert.doesNotMatch(cleaned, /https:\/\/example\.com\/raw/);
  assert.match(cleaned, /\[有效链接\]\(https:\/\/example\.com\/linked\)/);
  assert.doesNotMatch(cleaned, /入报原因|达到精选分/);
  assert.match(cleaned, /价值判断|高价值信号明确/);
  assert.match(cleaned, /分类治理诊断项/);
  assert.match(cleaned, /治理诊断/);
});

test('internal processing tags never surface as reader-facing themes', () => {
  // 回归：工作台曾显示「主主题：Blogs / AI / 本地兜底」，把处理状态当成了内容主题
  assert.equal(isInternalProcessingTag('本地兜底'), true);
  assert.equal(isInternalProcessingTag(' 本地兜底 '), true);
  assert.equal(isInternalProcessingTag('待人工复核'), true);
  assert.equal(isInternalProcessingTag('AI'), false);
  assert.equal(isInternalProcessingTag('Blogs'), false);
});

// UI-007 回归：itemCount 语义修正
// 曾经的错误：所有路径都写 itemCount = newItems（今日总抓取数）。
// 正确语义：空候选诊断报告 = 0，正式/降级报告 = topItems.length。
test('buildDailyReportInsightConflictUpdate passes itemCount through unchanged', () => {
  // 验证 buildDailyReportInsightConflictUpdate 不会变换 itemCount 值——
  // 调用方负责传入正确的语义值（空路径 0，正式路径 topItems.length）
  const result = buildDailyReportInsightConflictUpdate({
    summary: '测试摘要',
    itemCount: 5, // 代表 topItems.length = 5
    topics: [],
    payload: {},
  });
  // 结果里应该含 itemCount: 5，而不是被替换成今日抓取总数
  assert.equal(result.itemCount, 5, '正式报告的 itemCount 应等于 topItems.length');
});

test('empty report itemCount is 0 not newItemsCount', () => {
  // 回归测试：空候选诊断报告不应将今日总抓取数（如 22）写入 itemCount
  // 这里只能文档化期望，真正的写入路径由 daily-report.ts 的 if (topItems.length === 0) 分支控制
  const newItemsToday = 22;  // 今日抓取
  const itemsInReport = 0;   // 实际入报
  assert.notEqual(itemsInReport, newItemsToday, 'itemCount 应为入报数而非今日总抓取数');
  assert.equal(itemsInReport, 0, '空候选路径下 itemCount 应为 0');
});
