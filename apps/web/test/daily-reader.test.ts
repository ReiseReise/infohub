import test from 'node:test';
import assert from 'node:assert/strict';

test('reader removes duplicated lead, preserves scope and counts unique published links', async () => {
  const mod = await import('../src/lib/daily-reader.ts');
  const md = '# 真实事件标题\n\n> 真实变化导读。\n\n## 今日精选\n\n[甲](/feed/a) [再引甲](/feed/a) [乙](/feed/b)';
  assert.equal(mod.stripDailyFinishedReportFrontMatter(md).startsWith('## 今日精选'), true);
  assert.equal(mod.dailyReportReadingStats(md).articles, 2);
  assert.equal(mod.dailyReportScopedPath('/daily/workflows', '2026-09-06', '1365'), '/daily/workflows?date=2026-09-06&sourceId=1365');
  assert.equal(mod.dailyReportScopedPath('/daily/reports/latest', '', '1365'), '/daily/reports/latest?sourceId=1365');
});

test('uses selected coverage count instead of raw itemCount for daily top metrics', async () => {
  const mod = await import('../src/lib/daily-reader.ts');

  const metrics = mod.buildDailyLatestTopMetrics({
    id: 1,
    date: '2026-06-16',
    type: 'daily_report',
    markdown: '## 今日封面判断\n\n内容',
    itemCount: 1192,
    generatedAt: '2026-06-16T08:19:42.000Z',
    coverageSummary: {
      total: 19,
      selected: 18,
      review: 0,
      latestFallback: 0,
      excluded: 1,
      missingDigest: 0,
    },
  }, 12);

  assert.equal(metrics[2].label, '正式入报');
  assert.equal(metrics[2].value, 18);
});

test('labels degraded candidate count without claiming formal editorial selection', async () => {
  const mod = await import('../src/lib/daily-reader.ts');
  const metrics = mod.buildDailyLatestTopMetrics({
    id: 1,
    date: '2026-07-11',
    type: 'daily_report',
    markdown: '事实汇总',
    qualityStatus: 'degraded',
    coverageSummary: {
      total: 25,
      selected: 18,
      review: 0,
      latestFallback: 0,
      excluded: 7,
      missingDigest: 0,
    },
  }, 7);

  assert.equal(metrics[2].label, '主候选');
  assert.equal(metrics[2].value, 18);
});

test('treats degraded output as an unpublished draft instead of a formal report', async () => {
  const mod = await import('../src/lib/daily-reader.ts');
  const data = {
    id: 1,
    date: '2026-07-17',
    type: 'daily_report',
    markdown: '',
    publicationStatus: 'draft',
    publishable: false,
    qualityStatus: 'degraded',
    qualityReasonLabel: '最终编辑稿未通过质量门禁。',
    draft: {
      markdown: '# 事实素材稿\n\n仅供核对。',
      generatedAt: '2026-07-17T06:06:30.000Z',
    },
    reportScope: { reportType: 'daily', label: '信息中枢日报' },
  } as any;

  assert.equal(mod.resolveDailyPublicationLabel(data), '待发布草稿');
  assert.equal(mod.resolveDailyReportTitle(data), '2026-07-17 正式日报尚未发布');
  assert.match(mod.resolveDailyReportLead(data), /没有通过质量门禁/);
  assert.equal(mod.shouldRenderPublishedDailyReport(data), false);
  assert.equal(mod.resolveDailyDraftMarkdown(data), '# 事实素材稿\n\n仅供核对。');
});

test('resolves editorial daily title before generic report labels', async () => {
  const mod = await import('../src/lib/daily-reader.ts');

  assert.equal(mod.resolveDailyReportTitle({
    id: 1,
    date: '2026-07-07',
    type: 'daily_report',
    markdown: '正文',
    reportScope: { label: '信息中枢日报' },
    coverJudgement: {
      title: '模型发布重新加速，Agent 进入基础设施阶段',
      summary: '今天的核心判断。',
    },
  }), '模型发布重新加速，Agent 进入基础设施阶段');

  assert.equal(mod.resolveDailyReportTitle({
    id: 1,
    date: '2026-07-07',
    type: 'daily_report',
    markdown: '正文',
    reportScope: { label: 'Reuters Technology AI 日报' },
    coverJudgement: {
      title: '日报',
      summary: '通用标题应回退到范围标签。',
    },
  }), 'Reuters Technology AI 日报');
});

test('builds compact report deck without empty placeholder chips', async () => {
  const mod = await import('../src/lib/daily-reader.ts');

  assert.deepEqual(mod.buildDailyReportDeck({
    id: 1,
    date: '2026-07-07',
    type: 'daily_report',
    markdown: '正文',
    coverageSummary: {
      total: 42,
      selected: 12,
      review: 5,
      latestFallback: 3,
      excluded: 22,
      missingDigest: 0,
    },
    moduleSections: [
      { key: 'models', title: '模型与实验室', conclusion: '结论', priorityArticles: [], signals: [], noise: [], actions: [], coverageCount: 6 },
      { key: 'agents', title: 'Agent 与产品', conclusion: '结论', priorityArticles: [], signals: [], noise: [], actions: [], coverageCount: 4 },
    ],
    moreDynamics: [
      { id: 'd1', title: '动态', url: 'https://example.com/d1', sourceName: 'Source', category: '动态', reason: '补充', summary: '摘要' },
    ],
    deepReads: [
      { id: 'r1', title: '深读', url: 'https://example.com/r1', sourceName: 'Blog', category: '深读', reason: '长文', summary: '摘要' },
    ],
  }), ['日期 2026-07-07', '精选 12 篇', '模块 2 组', '补充动态 2 条', '覆盖 42 条候选']);
});

test('uses explicit deck and lead copy for missing source daily report', async () => {
  const mod = await import('../src/lib/daily-reader.ts');

  const missingReport = {
    id: 'daily_source_1363:missing',
    date: '',
    type: 'daily_source_1363',
    markdown: '',
    missing: true,
    reportScope: {
      reportType: 'daily_source_1363',
      sourceId: 1363,
      sourceName: 'Reuters Technology AI',
      label: 'Reuters Technology AI 日报',
    },
  };

  assert.deepEqual(mod.buildDailyReportDeck(missingReport), ['来源日报', '未生成']);
  assert.match(mod.resolveDailyReportLead(missingReport), /Reuters Technology AI/);
  assert.match(mod.resolveDailyReportLead(missingReport), /还没有生成正式日报/);
});

test('falls back to coverage diagnostics when summary is unavailable', async () => {
  const mod = await import('../src/lib/daily-reader.ts');

  assert.equal(mod.resolveDailyReportEntryCount({
    id: 1,
    date: '2026-06-16',
    type: 'daily_report',
    markdown: '## 今日封面判断\n\n内容',
    itemCount: 1192,
    coverageDiagnostics: {
      totalFetched: 1280,
      sampledCandidates: 72,
      finalCandidates: 17,
      unscored: 16,
      raw: 5,
      summaryFailed: 3,
      hotSignals: 152,
      hotUnscored: 10,
      hotNotSampled: 12,
      hotNotSelected: 134,
    },
  }), 17);
});

test('uses the published editorial selection count instead of the wider coverage bucket', async () => {
  const mod = await import('../src/lib/daily-reader.ts');
  const curated = Array.from({ length: 12 }, (_, index) => ({
    id: `item-${index}`,
    title: `精选 ${index + 1}`,
    url: `/feed/item-${index}`,
    sourceName: '测试来源',
    category: '模型与实验室',
    reason: '有明确事实增量',
    summary: '可核验摘要',
  }));
  const report = {
    id: 1,
    date: '2026-07-17',
    type: 'daily_report',
    markdown: '# 编辑标题\n\n## 主线\n\n正文',
    publicationStatus: 'published' as const,
    coverageSummary: {
      total: 58,
      selected: 13,
      review: 8,
      latestFallback: 4,
      excluded: 33,
      missingDigest: 0,
    },
    editorialDigest: {
      coverJudgement: { title: '编辑标题', summary: '正式精选 12 篇。' },
      radarOverview: { markdown: '' },
      tableOfContents: [],
      curated,
      moduleReferences: [],
      moreDynamics: [],
      deepReads: [],
      moduleNarratives: [],
      materials: [],
      readingOrder: { markdown: '' },
      nextActions: { markdown: '' },
    },
  };

  assert.equal(mod.resolveDailyReportEntryCount(report), 12);
  assert.ok(mod.buildDailyReportDeck(report).includes('精选 12 篇'));
  assert.ok(!mod.buildDailyReportDeck(report).includes('精选 13 篇'));
});

test('builds structured right-rail nav from report sections before falling back to markdown headings', async () => {
  const mod = await import('../src/lib/daily-reader.ts');

  const nav = mod.buildDailyReaderNav({
    id: 1,
    date: '2026-06-16',
    type: 'daily_report',
    markdown: '## 今日封面判断\n\n内容',
    coverJudgement: { title: '模型发布重新加速', summary: '今天的核心判断。' },
    radarOverview: { markdown: '雷达总览' },
    priorityArticles: [{
      id: 'a',
      title: 'Claude Fable 5',
      url: 'https://example.com/a',
      sourceName: 'Anthropic',
      category: '模型发布',
      reason: '高价值',
      summary: '摘要',
    }],
    moduleSections: [{
      key: 'models',
      title: '模型与实验室',
      editorialTitle: '模型发布重新加速',
      conclusion: '模型侧继续升温。',
      narrativeMarkdown: '模块正文',
      priorityArticles: [],
      signals: [],
      noise: [],
      actions: [],
      coverageCount: 6,
    }],
    moreDynamics: [{
      id: 'd',
      title: '更多动态',
      url: 'https://example.com/d',
      sourceName: '36kr',
      category: '行业动态',
      reason: '补全覆盖',
      summary: '动态',
    }],
    deepReads: [{
      id: 'r',
      title: '深读文章',
      url: 'https://example.com/r',
      sourceName: 'Blogs',
      category: '深读',
      reason: '长文',
      summary: '深读',
    }],
    readingOrder: { markdown: '## 阅读顺序\n\n先读重点文章。' },
    nextActions: { markdown: '## 下一步行动\n\n继续核对证据。' },
    coverageItems: [{
      id: 'c',
      title: '覆盖条目',
      url: 'https://example.com/c',
      sourceName: 'Source',
      category: '分类',
      status: 'selected',
      digest: '摘要',
      reason: '原因',
      action: '动作',
      score: 88,
      translationStatus: 'ready',
    }],
  });

  assert.deepEqual(nav.map((item) => item.label), [
    '今日封面判断',
    '今日重点文章',
    '信息雷达总览',
    '模块日报',
    '模型发布重新加速',
    '更多动态',
    '重点研究/深读',
    '阅读顺序',
    '下一步行动',
    '附录：全池摘要索引',
  ]);
});

test('uses factual section labels and hides recommendation sections for degraded reports', async () => {
  const mod = await import('../src/lib/daily-reader.ts');
  const nav = mod.buildDailyReaderNav({
    id: 1,
    date: '2026-07-11',
    type: 'daily_report',
    markdown: '## 可核验事实\n\n事实内容',
    qualityStatus: 'degraded',
    coverJudgement: { title: '2026-07-11 信息事实汇总', summary: '仅保留事实。' },
    priorityArticles: [{
      id: 'fact-1',
      title: '事实材料',
      url: 'https://example.com/fact-1',
      sourceName: 'Source',
      category: '模型',
      reason: '事实材料',
      summary: '已核验事实。',
    }],
    moduleSections: [{
      key: 'models',
      title: '模型与实验室',
      conclusion: '保留一条事实。',
      narrativeMarkdown: '### 模型与实验室\n\n事实。',
      priorityArticles: [],
      signals: [],
      noise: [],
      actions: [],
      coverageCount: 1,
    }],
    trendSummary: {
      newItems: 20,
      totalItems: 100,
      compareWindowDays: 7,
      categories: [],
      sources: [],
      themes: [],
    },
    moreDynamics: [{
      id: 'dynamic-1',
      title: '不应出现的动态',
      url: 'https://example.com/dynamic-1',
      sourceName: 'Source',
      category: '动态',
      reason: '机器理由',
      summary: '动态摘要',
    }],
    deepReads: [{
      id: 'deep-1',
      title: '不应出现的深读',
      url: 'https://example.com/deep-1',
      sourceName: 'Source',
      category: '深读',
      reason: '机器理由',
      summary: '深读摘要',
    }],
    readingOrder: null,
    nextActions: null,
  });

  assert.deepEqual(nav.slice(0, 4).map((item) => item.label), ['可核验事实', '可核验重点材料', '采集事实', '分模块事实']);
  assert.ok(nav.some((item) => item.label === '素材缺口'));
  assert.ok(!nav.some((item) => ['今日封面判断', '今日重点文章', '模块日报', '更多动态', '重点研究/深读', '阅读顺序', '下一步行动'].includes(item.label)));
});

test('labels degraded deck as an unpublished quality-gate result', async () => {
  const mod = await import('../src/lib/daily-reader.ts');
  const deck = mod.buildDailyReportDeck({
    id: 1,
    date: '2026-07-11',
    type: 'daily_report',
    markdown: '事实汇总',
    qualityStatus: 'degraded',
    coverageSummary: {
      total: 25,
      selected: 18,
      review: 0,
      latestFallback: 0,
      excluded: 7,
      missingDigest: 0,
    },
    priorityArticles: Array.from({ length: 8 }, (_, index) => ({
      id: `fact-${index}`,
      title: `事实 ${index}`,
      url: `https://example.com/${index}`,
      sourceName: 'Source',
      category: '模型',
      reason: '事实材料',
      summary: '可核验事实',
    })),
    moduleSections: [{
      key: 'models',
      title: '模型与实验室',
      conclusion: '事实',
      priorityArticles: [],
      signals: [],
      noise: [],
      actions: [],
      coverageCount: 8,
    }],
    moreDynamics: [{ id: 'd', title: '动态', url: 'https://example.com/d', sourceName: 'Source', category: '动态', reason: '原因', summary: '摘要' }],
  });

  assert.deepEqual(deck, ['日期 2026-07-11', '质量门禁未通过', '无可用草稿']);
  assert.ok(!deck.some((item) => item.includes('精选') || item.includes('补充动态') || item.includes('可核验材料')));
});

test('exposes only unrendered editorial materials as supplemental facts in degraded reports', async () => {
  const mod = await import('../src/lib/daily-reader.ts');
  const data = {
    id: 1,
    date: '2026-07-12',
    type: 'daily',
    markdown: '事实汇总',
    qualityStatus: 'degraded',
    priorityArticles: [{ id: 'lead', title: '重点事实', url: 'https://example.com/lead', sourceName: 'Source', category: '模型', reason: '', summary: '' }],
    moduleSections: [{
      key: 'models',
      title: '模型与实验室',
      conclusion: '事实',
      priorityArticles: [{ id: 'module', title: '模块事实', url: 'https://example.com/module', sourceName: 'Source', category: '模型', reason: '', summary: '' }],
      signals: [], noise: [], actions: [], coverageCount: 1,
    }],
    editorialMaterials: [
      { itemId: 'lead', title: '重点事实', fact: '已展示', factBasis: 'ai_summary', evidenceUrl: 'https://example.com/lead', sourceName: 'Source', theme: '模型', recommendedPlacement: 'featured', placements: ['featured'], reason: '', score: 90 },
      { itemId: 'module', title: '模块事实', fact: '已展示', factBasis: 'ai_summary', evidenceUrl: 'https://example.com/module', sourceName: 'Source', theme: '模型', recommendedPlacement: 'module', placements: ['module'], reason: '', score: 80 },
      { itemId: 'extra', title: '补充事实', fact: '尚未在其它结构化区域展示', factBasis: 'snippet', evidenceUrl: 'https://example.com/extra', sourceName: 'Blog', theme: '深读', recommendedPlacement: 'more_dynamics', placements: ['more_dynamics'], reason: '', score: 60 },
      { itemId: 'invalid', title: '无链接', fact: '不应展示', factBasis: 'title', evidenceUrl: '', sourceName: 'Blog', theme: '深读', recommendedPlacement: 'coverage_index', placements: ['coverage_index'], reason: '', score: null },
    ],
  } as any;

  const supplemental = mod.buildDailySupplementalMaterials(data);
  const nav = mod.buildDailyReaderNav(data);

  assert.deepEqual(supplemental.map((item: any) => item.itemId), ['extra']);
  assert.ok(nav.some((item: any) => item.label === '补充事实线索'));
});

test('hides duplicated longform markdown when structured report sections are already rendered', async () => {
  const mod = await import('../src/lib/daily-reader.ts');

  assert.equal(mod.shouldRenderDailyLongformArticle({
    id: 1,
    date: '2026-06-16',
    type: 'daily_report',
    markdown: '## 今日封面判断\n\n内容',
    moduleSections: [{
      key: 'models',
      title: '模型与实验室',
      conclusion: '结论',
      priorityArticles: [],
      signals: [],
      noise: [],
      actions: [],
      coverageCount: 4,
    }],
  }, '## 今日封面判断\n\n内容'.repeat(20)), false);

  assert.equal(mod.shouldRenderDailyLongformArticle({
    id: 1,
    date: '2026-06-16',
    type: 'daily_report',
    markdown: '## 正文\n\n只有正文',
  }, '## 正文\n\n只有正文'.repeat(20)), true);
});

test('strips duplicated leading markdown heading from structured daily sections', async () => {
  const mod = await import('../src/lib/daily-reader.ts');

  assert.equal(
    mod.stripLeadingDuplicateMarkdownHeading('## 信息雷达总览\n\n今日新增 22 条。', '信息雷达总览'),
    '今日新增 22 条。',
  );
  assert.equal(
    mod.stripLeadingDuplicateMarkdownHeading('### Agent 与产品入口：2 条信号\n\n发生了什么。', 'Agent 与产品入口：2 条信号'),
    '发生了什么。',
  );
  assert.equal(
    mod.stripLeadingDuplicateMarkdownHeading('## 不同标题\n\n保留标题。', '信息雷达总览'),
    '## 不同标题\n\n保留标题。',
  );
});

test('keeps the finished editorial body while removing only duplicated masthead sections', async () => {
  const mod = await import('../src/lib/daily-reader.ts');
  const markdown = [
    '# 编辑主标题',
    '',
    '## 今日封面判断',
    '',
    '封面导语已在页面头部展示。',
    '',
    '## 目录',
    '',
    '- 信息雷达总览',
    '',
    '## 信息雷达总览',
    '',
    '这是应该被保留的成品正文。',
    '',
    '## 今日精选',
    '',
    '精选正文也应保留。',
  ].join('\n');

  const body = mod.stripDailyFinishedReportFrontMatter(markdown);

  assert.doesNotMatch(body, /封面导语|信息雷达总览\n\n- 信息雷达总览/);
  assert.match(body, /## 信息雷达总览/);
  assert.match(body, /## 今日精选/);
  assert.match(body, /成品正文/);
});

test('builds finished-report navigation from the actual saved markdown headings', async () => {
  const mod = await import('../src/lib/daily-reader.ts');
  const nav = mod.buildDailyFinishedReaderNav({
    id: 1,
    date: '2026-07-16',
    type: 'daily_report',
    markdown: '正文',
    coverJudgement: { title: '今日主线', summary: '导语' },
    moduleSections: [{
      key: 'models', title: '旧结构标题', conclusion: '结论', priorityArticles: [], signals: [], noise: [], actions: [], coverageCount: 1,
    }],
  } as any, '## 信息雷达总览\n\n正文\n\n### 模型竞争进入新阶段\n\n分析');

  assert.deepEqual(nav.map((item: any) => item.label), [
    '今日封面判断',
    '信息雷达总览',
    '模型竞争进入新阶段',
  ]);
  assert.ok(!nav.some((item: any) => item.label === '旧结构标题'));
});

test('keeps the finished-report side navigation focused on main sections', async () => {
  const mod = await import('../src/lib/daily-reader.ts');
  const nav = mod.buildDailyFinishedReaderNav({
    id: 2,
    date: '2026-07-17',
    type: 'daily_report',
    markdown: '正文',
    coverJudgement: { title: '今日主线', summary: '导语' },
  } as any, [
    '## 信息雷达总览',
    '### [Kimi K3](/feed/kimi)',
    '## 开放模型进入工程竞争',
    '### [Inkling](/feed/inkling)',
    '### [Claude Code](/feed/claude-code)',
    '## 今天怎么读',
    '### 先读',
    '## 下一步关注',
  ].join('\n\n'));

  assert.deepEqual(nav.map((item: any) => item.label), [
    '今日封面判断',
    '信息雷达总览',
    '开放模型进入工程竞争',
    '今天怎么读',
    '下一步关注',
  ]);
  assert.ok(!nav.some((item: any) => /Kimi|Inkling|Claude Code|先读/.test(item.label)));
});

test('keeps late report sections after many article headings in the side navigation', async () => {
  const mod = await import('../src/lib/daily-reader.ts');
  const articleHeadings = Array.from({ length: 20 }, (_, index) => `### 文章 ${index + 1}`).join('\n\n');
  const nav = mod.buildDailyFinishedReaderNav({
    id: 3,
    date: '2026-07-17',
    type: 'daily_report',
    markdown: '正文',
    coverJudgement: { title: '今日主线', summary: '导语' },
  } as any, [
    '## 信息雷达总览',
    articleHeadings,
    '## 政策、安全与治理边界',
    '## 更多值得知道',
    '## 今天怎么读',
    '## 下一步关注',
  ].join('\n\n'));

  assert.deepEqual(nav.map((item: any) => item.label), [
    '今日封面判断',
    '信息雷达总览',
    '政策、安全与治理边界',
    '更多值得知道',
    '今天怎么读',
    '下一步关注',
  ]);
});

test('routes coverage cards through the local Feed when an item id exists', async () => {
  const mod = await import('../src/lib/daily-reader.ts');
  assert.equal(mod.resolveDailyCoverageItemHref({ id: 'item with space', url: 'https://example.com/article' } as any), '/feed/item%20with%20space');
  assert.equal(mod.resolveDailyCoverageItemHref({ id: '', url: 'https://example.com/article' } as any), 'https://example.com/article');
  assert.equal(mod.resolveDailyCoverageItemHref({ id: '', url: 'javascript:alert(1)' } as any), null);
});

test('merges daily module evidence links by editorial priority and removes duplicates', async () => {
  const mod = await import('../src/lib/daily-reader.ts');

  const links = mod.mergeDailyModuleEvidenceLinks({
    key: 'models',
    title: '模型与实验室',
    conclusion: '结论',
    primaryLinks: [
      { id: 'p1', title: '主链接', url: 'https://example.com/a', sourceName: 'Source A', category: '模型', reason: '主证据', summary: '摘要' },
    ],
    priorityArticles: [
      { id: 'dup', title: '重复链接', url: 'https://example.com/a', sourceName: 'Source A', category: '模型', reason: '重复', summary: '摘要' },
      { id: 'p2', title: '重点文章', url: 'https://example.com/b', sourceName: 'Source B', category: '产品', reason: '重点', summary: '摘要' },
    ],
    secondaryLinks: [
      { id: 's1', title: '补充链接', url: 'https://example.com/c', sourceName: 'Source C', category: '研究', reason: '补充', summary: '摘要' },
    ],
    signals: [],
    noise: [],
    actions: [],
    coverageCount: 3,
  }, 3);

  assert.deepEqual(links.map((item) => item.title), ['主链接', '重点文章', '补充链接']);
});
