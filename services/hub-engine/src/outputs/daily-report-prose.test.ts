import test from 'node:test';
import assert from 'node:assert/strict';
import { containsDailyPlaceholder, dailyProseIssue, hasUnsupportedEditorialNumbers, preserveEditorialProse } from './daily-report-prose.js';

const body = '**发生了什么**：模型开放了工具调用接口，开发者可以将检索与执行放进同一条工作流。\n\n**编辑判断**：价值不只在接口数量，而在失败恢复和权限控制能否一起验证。现有报道还不能证明无人值守的可靠性，应先在受控任务中评估。\n\n**继续关注**：核对官方文档中的权限边界与失败恢复示例。';
test('preserves structured Chinese editorial prose rather than replacing it with a snippet', () => {
  assert.equal(preserveEditorialProse(body, '模型开放工具调用接口', new Set(['a'])), body);
});
test('rejects unsupported numeric claims and unknown evidence links', () => {
  assert.equal(preserveEditorialProse(`${body}\n性能提升 99%。`, '提升 5%', new Set(['a'])), '');
  assert.equal(preserveEditorialProse(`${body}\n[证据](/feed/other)`, '', new Set(['a'])), '');
  assert.equal(preserveEditorialProse(`${body}\n[证据](https://invented.test)`, '', new Set(['a'])), '');
});
test('compares numeric tokens, not substrings; ignores IDs and list ordinals', () => {
  assert.equal(hasUnsupportedEditorialNumbers('提升 9%', '提升 99%'), true);
  assert.equal(hasUnsupportedEditorialNumbers('1. [报道](/feed/123-ab) 包含 13,000 条记录', '13000 条记录'), false);
  assert.equal(hasUnsupportedEditorialNumbers('10月投入74亿美元', 'October investment of $7.4 billion'), false);
  assert.equal(hasUnsupportedEditorialNumbers('投资74亿美元', 'investment of $74 billion'), true);
});
test('detects intermediate prose even when it appears in a deep-read appendix', () => {
  assert.equal(containsDailyPlaceholder('当前缺少可靠摘要，请优先核对原文'), true);
  assert.equal(dailyProseIssue('# 正式日报\n## 深读\n模型摘要暂时不可用'), 'placeholder_content');
  assert.equal(dailyProseIssue('正文 [![作者 avata'), 'broken_editorial_markup');
  assert.equal(dailyProseIssue('REUTERS/John Smith/File Photo A logo is seen...'), 'photo_caption_as_summary');
});

test('keeps article analysis across both preparation and final delivery', async () => {
  const { groundDailyReportModelMarkdown, finalizeDailyReportDelivery } = await import('./daily-report.js');
  const snapshot = { date: '2026-09-06', newItems: 1, totalItems: 1, compareWindowDays: 7,
    generatedAt: '2026-09-06T08:00:00Z', highScoreItems: [], byCategory: [], topSources: [], themeClusters: [],
    topItems: [{ id: 'agent', title: '工具调用接口开放', url: 'https://example.com/agent', sourceName: '官方', category: 'Agent', aiScore: 90, aiSummary: '模型开放工具调用接口，提供权限控制和失败恢复示例。' }] };
  const model = `# 工具调用进入可控工作流\n\n## 开发者工具\n\n### [工具调用接口开放](/feed/agent)\n\n${body}`;
  const first = groundDailyReportModelMarkdown(model, snapshot);
  assert.equal(first.preservedArticleCount, 1);
  const final = finalizeDailyReportDelivery(first.markdown, snapshot, 'model');
  assert.ok(final.includes(body));
  assert.equal(final, first.markdown);
  assert.doesNotMatch(final, /明天先检查今天的头部主题|今天模型侧的增量/);
});

test('persisted full reports with placeholder appendices cannot pass publication gate', async () => {
  const { resolvePersistedDailyReportQuality } = await import('../lib/daily-report-quality.js');
  const quality = resolvePersistedDailyReportQuality({ qualityStatus: 'full', generationMode: 'full',
    markdown: '# 新闻\n\n## 深读\n模型摘要暂时不可用', final: { meta: { status: 'ai', deliveryMode: 'model' } } });
  assert.equal(quality.status, 'degraded');
  assert.ok(quality.reasons.includes('final_content:placeholder_content'));
});

test('unfinished evidence is not spliced back into a model-written publication', async () => {
  const { groundDailyReportModelMarkdown } = await import('./daily-report.js');
  const snapshot = { date: '2026-09-06', newItems: 2, totalItems: 2, compareWindowDays: 7,
    generatedAt: '2026-09-06T08:00:00Z', highScoreItems: [], byCategory: [], topSources: [], themeClusters: [],
    topItems: [
      { id: 'agent', title: '工具调用接口开放', url: 'https://example.com/a', sourceName: '官方', category: 'Agent', aiScore: 90, aiSummary: '模型开放工具调用接口，并提供权限控制与失败恢复示例。' },
      { id: 'photo', title: 'AI IPO', url: 'https://example.com/p', sourceName: 'Reuters', category: 'AI', aiScore: 80, aiSummary: null, snippet: 'A logo is seen. REUTERS/John/File Photo' },
    ] };
  const result = groundDailyReportModelMarkdown(`## 工作流进入可控执行阶段\n\n### [工具调用接口开放](/feed/agent)\n\n${body}`, snapshot);
  assert.ok(result.markdown.includes(body));
  assert.equal(result.groundedArticleCount, 1);
  assert.doesNotMatch(result.markdown, /REUTERS\/|File Photo|当前只确认/);
  assert.match(result.markdown, /^# 工作流进入可控执行阶段/);
});

test('numbered article headings inside a real topic are not promoted into topics', async () => {
  const { normalizeFinalSceneMarkdownStructure, sanitizeDailyReportMarkdown } = await import('./daily-report.js');
  const input = `# 日报\n\n## 1. 工程工作流\n\n### 1. [接口更新](/feed/a)\n\n${body}\n\n### 2. [可靠性评估](/feed/b)\n\n${body}\n\n### 3. [权限策略](/feed/c)\n\n${body}\n\n## 研究方法\n\n正文。`;
  const result = normalizeFinalSceneMarkdownStructure(sanitizeDailyReportMarkdown(input));
  assert.match(result, /^## 工程工作流$/m);
  assert.match(result, /^### \[接口更新\]/m);
  assert.match(result, /^## 研究方法$/m);
  assert.doesNotMatch(result, /^## \[接口更新\]/m);
});

test('binds a Chinese heading to an English article through its explicit body citation', async () => {
  const { groundDailyReportModelMarkdown } = await import('./daily-report.js');
  const snapshot = { date: '2026-09-06', newItems: 1, totalItems: 1, compareWindowDays: 7,
    generatedAt: '2026-09-06T08:00:00Z', highScoreItems: [], byCategory: [], topSources: [], themeClusters: [],
    topItems: [{ id: 'agent', title: 'A new tool calling API', url: 'https://example.com/agent', sourceName: 'Official', category: 'Agent', aiScore: 90, aiSummary: '模型开放工具调用接口，并说明权限控制和失败恢复。' }] };
  const result = groundDailyReportModelMarkdown(`## 工程工具\n\n### 可控执行成为产品边界\n\n${body}\n\n[阅读原文](/feed/agent)`, snapshot);
  assert.equal(result.preservedArticleCount, 1);
  assert.ok(result.markdown.includes('可控执行成为产品边界'));
  assert.ok(result.markdown.includes(body));
});

test('a substantive cited model report can pass the complete publication path', async () => {
  const { prepareFinalSceneOutputForQuality, finalizeDailyReportDelivery } = await import('./daily-report.js');
  const topItems = Array.from({ length: 4 }, (_, index) => ({ id: `a${index}`, title: `工具更新 ${index}`, url: `https://example.com/${index}`,
    sourceName: '官方来源', category: 'Agent', aiScore: 90, aiSummary: `工具更新 ${index}。${body}` }));
  const snapshot = { date: '2026-09-06', newItems: 4, totalItems: 4, compareWindowDays: 7, generatedAt: '2026-09-06T08:00:00Z', highScoreItems: [], byCategory: [], topSources: [], themeClusters: [], topItems };
  const md = '# 工具调用进入可靠性验证阶段\n\n## 接口与权限\n\n' + topItems.map((item) => `### [${item.title}](/feed/${item.id})\n\n${body}\n\n${body}`).join('\n\n');
  const prepared = prepareFinalSceneOutputForQuality(md, snapshot);
  assert.equal(prepared.grounding.preservedArticleCount, 4);
  assert.deepEqual(prepared.quality, { ok: true });
  assert.equal(finalizeDailyReportDelivery(prepared.markdown, snapshot, 'model'), prepared.markdown);
});

test('final output contract requires the article body, not only the two closing sections', async () => {
  const { appendSceneMarkdownContract, buildSceneRepairPrompt } = await import('./daily-report.js');
  assert.match(appendSceneMarkdownContract('final', '素材'), /完整顺序：H1.*今日精选.*主题章节/);
  const context = '事实材料。'.repeat(2000) + '\n末尾文章的证据和原文 ID';
  assert.ok(buildSceneRepairPrompt('final', '原始模型稿', '污染草稿', context).includes('末尾文章的证据和原文 ID'));
  assert.ok(!buildSceneRepairPrompt('final', '原始模型稿', '污染草稿', context).includes('污染草稿'));
});
