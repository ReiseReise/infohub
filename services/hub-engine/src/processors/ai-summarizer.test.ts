import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeterministicChineseSummary,
  buildModelFailureFallbackSummary,
  assessSummaryQuality,
  assessTranslationCompleteness,
  cleanTranslationChunkOutput,
  buildChineseSummaryRepairPrompt,
  parseSummaryResponse,
  parseStructuredTranslationResponse,
  isMostlyChineseSummary,
  isUsableChineseSummary,
  isUsableChineseTranslation,
  resolveTranslationPolicySkipReason,
  resolveTranslationSource,
  resolveSummarySkipReason,
  isRetryableTranslationFailure,
  translateSourceTextWithFallback,
  translateSourceTextWithRecovery,
} from './ai-summarizer.js';
import { buildAiStageResult } from './ai-scorer.js';

test('parses Chinese summary from JSON wrapped rewrite responses', () => {
  const parsed = parseSummaryResponse(JSON.stringify({
    summary: '这篇文章说明 OpenRouter 年处理量已经超过一千万亿 tokens，反映出多模型路由正在成为 AI 应用基础设施的重要入口。',
    tags: ['OpenRouter', 'AI infra'],
  }));

  assert.equal(parsed.summary, '这篇文章说明 OpenRouter 年处理量已经超过一千万亿 tokens，反映出多模型路由正在成为 AI 应用基础设施的重要入口。');
  assert.deepEqual(parsed.tags, ['OpenRouter', 'AI infra']);
  assert.equal(isMostlyChineseSummary(parsed.summary), true);
});

test('keeps plain Chinese summary responses valid', () => {
  const parsed = parseSummaryResponse('摘要：这是一条中文摘要，保留 Claude Code、RAG 和 MCP 等英文专名，但主体仍然是中文。');

  assert.equal(parsed.summary, '这是一条中文摘要，保留 Claude Code、RAG 和 MCP 等英文专名，但主体仍然是中文。');
  assert.deepEqual(parsed.tags, []);
  assert.equal(isMostlyChineseSummary(parsed.summary), true);
});

test('rejects summaries that are too short or stop in the middle of a sentence', () => {
  const source = 'TSMC reported record second-quarter profit, explained the AI demand drivers, compared analyst expectations, and described the implications for chip supply. '.repeat(12);
  const truncated = '台积电第二季度利润同比增长77%，创历史新高，业绩远超市场预期。财报显示';
  const complete = '台积电第二季度净利润同比增长77%，创历史新高，并明显超过分析师预期。增长主要来自全球人工智能处理器需求持续上升，英伟达和苹果等核心客户的订单进一步强化了台积电在先进芯片供应链中的关键地位。';

  assert.equal(assessSummaryQuality(truncated, source).complete, false);
  assert.match(assessSummaryQuality(truncated, source).reason || '', /过短|截断/);
  assert.equal(assessSummaryQuality(complete, source).complete, true);
});

test('builds a simple Chinese repair prompt without json output requirements', () => {
  const prompt = buildChineseSummaryRepairPrompt(
    '5 Things Broke When I Shipped a RAG + MCP Agent to Production.',
    'The system routes knowledge requests through hybrid search and reranking, then exposes production failures around null MCP tool responses.',
  );

  assert.match(prompt, /只输出一个完整中文自然段/);
  assert.match(prompt, /不要 JSON/);
  assert.match(prompt, /RAG \+ MCP Agent/);
  assert.match(prompt, /hybrid search/);
});

test('builds deterministic Chinese fallback summaries for short Chinese news flashes', () => {
  const summary = buildDeterministicChineseSummary({
    title: '三星考虑新建先进芯片封装厂，以满足全球芯片需求',
    sourceText: [
      '三星电子考虑在韩国光州建设先进半导体封装工厂，以满足全球芯片需求。',
      '三星正扩大HBM市场布局，以加强其在AI芯片供应链中的地位。',
      '预计三星将在6月29日韩国总统与企业集团负责人会议上公布投资计划。',
    ].join('\n'),
  });

  assert.ok(summary);
  assert.match(summary || '', /三星电子考虑/);
  assert.match(summary || '', /AI芯片供应链/);
  assert.equal(isUsableChineseSummary(summary || ''), true);
});

test('does not fabricate Chinese summaries for English-only snippets', () => {
  const summary = buildDeterministicChineseSummary({
    title: 'AI - Business Insider',
    sourceText: 'Why Anthropic safe Mythos-class model will not answer questions about cancer 4 min read',
  });

  assert.equal(summary, null);
});

test('builds an honest Chinese reading guide when the summary model is unavailable for English long text', () => {
  const summary = buildModelFailureFallbackSummary({
    title: 'Initial impressions of Claude Fable 5',
    sourceText: "I did not have early access to today's Claude Fable 5 release, but I have spent the past hours putting it through its paces. My initial impressions are that this is something of a beast.",
    error: 'fetch failed',
  });

  assert.ok(summary);
  assert.match(summary || '', /模型摘要暂时不可用/);
  assert.match(summary || '', /英文内容/);
  assert.match(summary || '', /Initial impressions of Claude Fable 5/);
  assert.match(summary || '', /稍后重跑摘要/);
  assert.equal(isUsableChineseSummary(summary || ''), true);
});

test('rejects malformed json and model meta replies as usable summaries', () => {
  assert.equal(isUsableChineseSummary('{"summary":"微软计划将 Copilot 订阅转为 token 计费，但 JSON 没有闭合'), false);
  assert.equal(isUsableChineseSummary('请提供待改写的摘要内容，以便我进行忠实改写。'), false);
  assert.equal(isUsableChineseSummary('请您提供具体的待改写摘要内容，以便我按照要求进行忠实改写。'), false);
  assert.equal(isUsableChineseSummary('这篇文章说明 Claude Code 在生产部署中需要处理鉴权、流式响应和错误恢复，适合继续阅读。'), true);
});

test('rejects title-only or very short translations for long English source text', () => {
  const source = [
    'A bit over a year ago I wrote How I use LLMs as a staff engineer.',
    'Here is a brief summary of what I used AI for last year.',
    'Smart autocomplete with Copilot.',
    'Short tactical changes in areas I do not know well.',
    'Writing lots of use-once-and-throwaway research code.',
    'Asking lots of questions to learn about new topics.',
  ].join('\n');

  assert.equal(isUsableChineseTranslation('标题：2026年我作为资深工程师如何使用大语言模型\n\n一年多以前，我写过一篇文章。', source), false);
  assert.equal(isUsableChineseTranslation('这篇文章系统梳理作者在 2026 年作为资深工程师使用大语言模型的方式，包括用 Copilot 做智能补全、在陌生领域进行短小战术修改、编写一次性研究代码、通过提问学习新主题，以及把模型作为最后兜底的调试和长文校对工具。作者同时说明不会让模型代写熟悉领域的完整 PR，也不会把架构决策交给模型。', source), true);
});

test('rejects historical short translations for full-length English articles', () => {
  const longSource = Array.from({ length: 36 }, (_, index) => (
    `Paragraph ${index + 1}: ppclp.ai announced a landmark productivity initiative with several operational details, workflow claims, adoption notes, and implementation caveats that require full translation rather than a short headline summary.`
  )).join('\n\n');
  const shortHistoricalTranslation = [
    '### ppclp.ai宣布生产力提升100倍',
    '',
    'ppclp.ai是北美第三大原生AI办公紧固件制造商。该公司宣布组织生产力指数实现100倍提升，这一成果源于为期18个月的项目。公司称新流程覆盖 Jira 工单、员工培训和外部方法论，能够减少协作摩擦并提升运营效率，但这段译文明显只覆盖文章开头，后续论证、背景、反讽语气和具体段落都没有被翻译，仍然不能作为完整译文展示给读者，也无法支撑长文阅读、引用和复盘，必须重新翻译后再展示为完成状态。',
  ].join('\n');

  assert.ok(longSource.length > 5600);
  assert.ok(shortHistoricalTranslation.length >= 220);
  assert.ok(shortHistoricalTranslation.length < 320);
  assert.equal(isUsableChineseTranslation(shortHistoricalTranslation, longSource), false);
});

test('reports translation completeness for long sources instead of only returning ready or failed', () => {
  const longSource = Array.from({ length: 45 }, (_, index) => (
    `Paragraph ${index + 1}: Anthropic described Claude Fable 5, enterprise safeguards, model release details, deployment caveats, pricing implications, and research context that should be translated as a full article.`
  )).join('\n\n');
  const shortTranslation = 'Anthropic 发布 Claude Fable 5，并介绍企业安全、部署和研究相关内容。';
  const fullTranslation = Array.from({ length: 45 }, (_, index) => (
    `第 ${index + 1} 段译文：Anthropic 介绍 Claude Fable 5 的模型发布、企业安全边界、部署注意事项、价格影响和研究背景，并保留了原文的关键论证。`
  )).join('\n\n');

  assert.deepEqual(assessTranslationCompleteness(shortTranslation, longSource), {
    basisLength: longSource.length,
    translatedLength: shortTranslation.length,
    chunkCount: Math.ceil(longSource.length / 1800),
    complete: false,
    reason: '译文明显短于原文，可能只覆盖了开头部分。',
  });
  assert.equal(assessTranslationCompleteness(fullTranslation, longSource).complete, true);
  assert.deepEqual(assessTranslationCompleteness('完整译文。'.repeat(140), 'Long source paragraph. '.repeat(330)), {
    basisLength: 'Long source paragraph. '.repeat(330).trim().length,
    translatedLength: '完整译文。'.repeat(140).length,
    chunkCount: Math.ceil('Long source paragraph. '.repeat(330).trim().length / 1800),
    complete: false,
    reason: '译文明显短于原文，可能只覆盖了开头部分。',
  });
});

test('rejects a Reuters-sized translation that only covers the opening paragraphs', () => {
  const source = 'TSMC posted a record quarterly profit as AI processor demand accelerated across the semiconductor market. '.repeat(13);
  const partialTranslation = '台积电公布创纪录的季度利润，人工智能处理器需求继续增长。'.repeat(20).slice(0, 317);

  assert.ok(source.length >= 1200);
  assert.equal(partialTranslation.length, 317);
  assert.equal(assessTranslationCompleteness(partialTranslation, source).complete, false);
});

test('accepts repeated source links when every distinct destination is preserved', () => {
  const source = [
    '[Overview](https://example.com/article#overview)',
    '',
    '[Details](https://example.com/article#details)',
    '',
    '[Overview again](https://example.com/article#overview)',
    '',
    'A sufficiently detailed source paragraph. '.repeat(30),
  ].join('\n');
  const translation = [
    '[概览](https://example.com/article#overview)',
    '',
    '[详情](https://example.com/article#details)',
    '',
    '重复出现的目录链接无需重复输出。',
    '',
    '这是完整译文段落。'.repeat(80),
  ].join('\n');

  assert.equal(assessTranslationCompleteness(translation, source).complete, true);
});

test('still rejects a genuinely missing distinct link destination', () => {
  const source = [
    '[Overview](https://example.com/article#overview)',
    '',
    '[Details](https://example.com/article#details)',
    '',
    'A sufficiently detailed source paragraph. '.repeat(30),
  ].join('\n');
  const translation = [
    '[概览](https://example.com/article#overview)',
    '',
    '这是完整译文段落。'.repeat(80),
  ].join('\n');
  const assessment = assessTranslationCompleteness(translation, source);

  assert.equal(assessment.complete, false);
  assert.equal(assessment.reason, '译文没有完整保留原文链接结构。');
});

test('uses structure-preserving Reuters HTML as the translation source', () => {
  const source = resolveTranslationSource({
    title: 'TSMC Q2 profit jumps 77% to record, far surpasses expectations',
    url: 'https://www.reuters.com/technology/artificial-intelligence/tsmc-q2-profit-jumps/',
    contentStatus: 'ready',
    readabilityStatus: 'failed',
    content: `
      <figure>
        <img src="/resizer/v2/tsmc.jpg" alt="TSMC headquarters">
        <figcaption>TSMC headquarters in Hsinchu. REUTERS/File Photo</figcaption>
      </figure>
      <p>TSMC posted a record second-quarter profit as artificial intelligence demand accelerated.</p>
      <p>The company supplies advanced processors to
        <a href="/markets/companies/NVDA.O">Nvidia</a> and
        <a href="/markets/companies/AAPL.O">Apple</a>.
      </p>
      <p>Management said demand remained strong and raised its full-year outlook.</p>
    `,
  });

  assert.equal(source.basis, 'content');
  assert.match(source.text, /!\[TSMC headquarters\]\(https:\/\/www\.reuters\.com\/resizer\/v2\/tsmc\.jpg\)/);
  assert.match(source.text, /\[Nvidia\]\(https:\/\/www\.reuters\.com\/markets\/companies\/NVDA\.O\)/);
  assert.match(source.text, /\[Apple\]\(https:\/\/www\.reuters\.com\/markets\/companies\/AAPL\.O\)/);
  assert.match(source.text, /Management said demand remained strong/);
  assert.ok(source.text.split(/\n{2,}/).filter(Boolean).length >= 5);
});

test('removes internal chunk headings before saving a full translation', () => {
  assert.equal(
    cleanTranslationChunkOutput('介绍一种反思你如何使用 Claude 的方法（第 1/8 段）\n\n今天，我们推出了一项测试版功能。\n\nIntroducing a way to reflect on how you use Claude（第 2/8 段）\n\n用户可以选择回顾周期。'),
    '今天，我们推出了一项测试版功能。\n\n用户可以选择回顾周期。',
  );
  assert.equal(
    cleanTranslationChunkOutput('第 2/8 段：这段译文从正文直接开始，并保留完整事实。'),
    '这段译文从正文直接开始，并保留完整事实。',
  );
  assert.equal(
    cleanTranslationChunkOutput('第 3/8 段：短句。\n\n下一段。'),
    '短句。\n\n下一段。',
  );
  assert.equal(
    cleanTranslationChunkOutput('这是一段没有技术编号的正常译文。'),
    '这是一段没有技术编号的正常译文。',
  );
});

test('rebuilds structured translations in source order and preserves links, images, and code', () => {
  const expected = [
    { id: 'b0001', markdown: '## Release notes' },
    { id: 'b0002', markdown: 'Read the [full announcement](https://example.com/release).' },
    { id: 'b0003', markdown: '![Architecture](https://example.com/diagram.png)' },
    { id: 'b0004', markdown: '```ts\nconst version = "5.0";\n```' },
  ];
  const parsed = parseStructuredTranslationResponse(JSON.stringify({
    translatedTitle: '模型发布说明',
    blocks: [
      { id: 'b0001', markdown: '## 发布说明' },
      { id: 'b0002', markdown: '阅读[完整公告](https://wrong.example/release)。' },
      { id: 'b0003', markdown: '![架构图](https://wrong.example/image.png)' },
      { id: 'b0004', markdown: '```ts\nconst version = "translated";\n```' },
    ],
  }), expected);

  assert.ok(parsed);
  assert.equal(parsed?.translatedTitle, '模型发布说明');
  assert.match(parsed?.text || '', /\[完整公告\]\(https:\/\/example\.com\/release\)/);
  assert.match(parsed?.text || '', /!\[Architecture\]\(https:\/\/example\.com\/diagram\.png\)/);
  assert.match(parsed?.text || '', /const version = "5\.0"/);
  assert.equal(assessTranslationCompleteness(parsed?.text, expected.map((block) => block.markdown).join('\n\n')).complete, true);
});

test('rejects missing, duplicate, extra, or reordered structured translation blocks', () => {
  const expected = [
    { id: 'b0001', markdown: 'First paragraph.' },
    { id: 'b0002', markdown: 'Second paragraph.' },
  ];

  assert.equal(parseStructuredTranslationResponse(JSON.stringify({
    translatedTitle: '测试标题',
    blocks: [{ id: 'b0001', markdown: '第一段。' }],
  }), expected), null);
  assert.equal(parseStructuredTranslationResponse(JSON.stringify({
    translatedTitle: '测试标题',
    blocks: [
      { id: 'b0001', markdown: '第一段。' },
      { id: 'b0001', markdown: '重复第一段。' },
    ],
  }), expected), null);
  assert.equal(parseStructuredTranslationResponse(JSON.stringify({
    translatedTitle: '测试标题',
    blocks: [
      { id: 'b0002', markdown: '第二段。' },
      { id: 'b0001', markdown: '第一段。' },
    ],
  }), expected), null);
  assert.equal(parseStructuredTranslationResponse(JSON.stringify({
    translatedTitle: '测试标题',
    blocks: [
      { id: 'b0001', markdown: '第一段。' },
      { id: 'b0002', markdown: '第二段。' },
      { id: 'b0003', markdown: '额外段落。' },
    ],
  }), expected), null);
});

test('restores source links, images, and code when the translation model omits them', () => {
  const expected = [
    {
      id: 'b0001',
      markdown: 'Read the [full announcement](https://example.com/release) and [technical notes](https://example.com/notes).',
    },
    { id: 'b0002', markdown: '![Architecture](https://example.com/diagram.png)' },
    { id: 'b0003', markdown: '```ts\nconst version = "5.0";\n```' },
  ];
  const parsed = parseStructuredTranslationResponse(JSON.stringify({
    translatedTitle: '模型发布说明',
    blocks: [
      { id: 'b0001', markdown: '阅读完整公告和技术说明。' },
      { id: 'b0002', markdown: '这里展示了系统架构图。' },
      { id: 'b0003', markdown: '这里给出了版本代码。' },
    ],
  }), expected);

  assert.ok(parsed);
  assert.match(parsed?.text || '', /\[full announcement\]\(https:\/\/example\.com\/release\)/);
  assert.match(parsed?.text || '', /\[technical notes\]\(https:\/\/example\.com\/notes\)/);
  assert.match(parsed?.text || '', /!\[Architecture\]\(https:\/\/example\.com\/diagram\.png\)/);
  assert.match(parsed?.text || '', /const version = "5\.0"/);
  assert.equal(assessTranslationCompleteness(parsed?.text, expected.map((block) => block.markdown).join('\n\n')).complete, true);
});

test('restores raw model urls as inline markdown links without duplicating a reference appendix', () => {
  const expected = [{
    id: 'b0001',
    markdown: 'Taiwan Semiconductor Manufacturing [Co (2330.TW)](https://www.reuters.com/markets/companies/2330.TW) supplies [Nvidia (NVDA.O)](https://www.reuters.com/markets/companies/NVDA.O).',
  }];
  const parsed = parseStructuredTranslationResponse(JSON.stringify({
    translatedTitle: '台积电季度业绩',
    blocks: [{
      id: 'b0001',
      markdown: '台湾半导体制造公司（股票代码 2330.TW，网址：https://www.reuters.com/markets/companies/2330.TW）向英伟达（网址：https://www.reuters.com/markets/companies/NVDA.O）供应芯片。',
    }],
  }), expected);

  assert.ok(parsed);
  assert.match(parsed?.text || '', /\[Co \(2330\.TW\)\]\(https:\/\/www\.reuters\.com\/markets\/companies\/2330\.TW\)/);
  assert.match(parsed?.text || '', /\[Nvidia \(NVDA\.O\)\]\(https:\/\/www\.reuters\.com\/markets\/companies\/NVDA\.O\)/);
  assert.doesNotMatch(parsed?.text || '', /网址：https?:\/\//);
  assert.doesNotMatch(parsed?.text || '', /原文链接：/);
});

test('allows explicit full translation to bypass score and brief-profile policy gates', () => {
  assert.equal(resolveTranslationPolicySkipReason({
    language: 'en',
    processingProfile: 'brief',
    aiScore: 61,
  }), '轻处理档位仅翻译高分内容');

  assert.equal(resolveTranslationPolicySkipReason({
    language: 'en',
    processingProfile: 'brief',
    aiScore: 61,
  }, { force: true }), null);

  assert.equal(resolveTranslationPolicySkipReason({
    language: 'zh',
    processingProfile: 'brief',
    aiScore: 95,
  }, { force: true }), '原文已是中文');
});

test('retries long full-article translation with stricter smaller chunks when the first pass is too short', async () => {
  const source = Array.from({ length: 42 }, (_, index) => (
    `Paragraph ${index + 1}: The author discusses quaternion rotations, Lean theorem proving, Claude-generated proof attempts, matrix notation, code snippets, verification mistakes, and detailed debugging observations that must be translated rather than summarized.`
  )).join('\n\n');
  const calls: Array<{
    prompt: string;
    maxTokens?: number;
    responseFormat?: 'json_object';
    thinking?: 'enabled' | 'disabled';
  }> = [];

  const result = await translateSourceTextWithRecovery({
    promptTemplate: '请翻译：\n{content}',
    title: 'Quaternion Rotations, Claude, and Lean',
    sourceText: source,
  }, async (prompt, options) => {
    calls.push({
      prompt,
      maxTokens: options.maxTokens,
      responseFormat: options.responseFormat,
      thinking: options.thinking,
    });
    if (!/二次补全|禁止概括/.test(prompt)) {
      return { text: '这是一段过短的摘要式译文，只覆盖了开头。' };
    }
    const payloadMatch = prompt.match(/(\[\{"id":"b\d{4}","markdown":[\s\S]*?\}\])\n\n翻译质量与输出格式硬要求/);
    assert.ok(payloadMatch);
    const blocks = JSON.parse(payloadMatch?.[1] || '[]') as Array<{ id: string; markdown: string }>;
    return {
      text: JSON.stringify({
        translatedTitle: '四元数旋转、Claude 与 Lean',
        blocks: blocks.map((block) => ({
          id: block.id,
          markdown: '作者逐句说明四元数旋转、Lean 证明、Claude 生成代码、矩阵记号和调试观察，保留原文证据、段落与结构。译文继续说明验证错误如何被发现、不同实现如何比较，以及作者最终采用了哪些修正。',
        })),
      }),
      inputTokens: 100,
      outputTokens: 300,
      totalTokens: 400,
    };
  });

  const firstPassChunks = Math.ceil(source.length / 1800);
  assert.equal(result.text.includes('过短的摘要式译文'), false);
  assert.match(result.text, /保留原文证据、段落与结构/);
  assert.equal(calls.length > firstPassChunks, true);
  assert.equal(calls.some((call) => (call.maxTokens || 0) >= 2400), true);
  assert.equal(calls.some((call) => /二次补全/.test(call.prompt)), true);
  assert.equal(calls.every((call) => call.responseFormat === 'json_object'), true);
  assert.equal(calls.every((call) => call.thinking === 'disabled'), true);
  assert.equal(assessTranslationCompleteness(result.text, source).complete, true);
});

test('restores a markdown link split across translation chunk boundaries after merging', async () => {
  const destination = 'https://example.com/research/critical-evidence';
  const source = `${'A'.repeat(1760)} [critical evidence](${destination}) ${'B'.repeat(900)}`;

  const result = await translateSourceTextWithRecovery({
    promptTemplate: '请翻译：\n{content}',
    title: 'Research evidence',
    sourceText: source,
  }, async (prompt) => {
    const payloadMatch = prompt.match(/(\[\{"id":"b\d{4}","markdown":[\s\S]*?\}\])\n\n翻译质量与输出格式硬要求/);
    assert.ok(payloadMatch);
    const blocks = JSON.parse(payloadMatch?.[1] || '[]') as Array<{ id: string; markdown: string }>;
    return {
      text: JSON.stringify({
        translatedTitle: '研究证据',
        blocks: blocks.map((block) => ({
          id: block.id,
          markdown: `这是忠实逐句翻译后的正文内容。${'译文'.repeat(Math.max(80, Math.ceil(block.markdown.length / 3)))}`,
        })),
      }),
    };
  });

  assert.match(result.text, new RegExp(`\\(${destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
  assert.equal(assessTranslationCompleteness(result.text, source).complete, true);
});

test('keeps a language-neutral release title without failing an otherwise complete translation', async () => {
  const source = [
    'uv 0.12.0 changes the default project layout and documents the migration path.',
    'The release notes explain the new build backend and compatibility implications.',
  ].join('\n\n');

  const result = await translateSourceTextWithFallback({
    promptTemplate: '请翻译：\n{content}',
    title: 'uv 0.12.0',
    sourceText: source,
  }, async (prompt) => {
    const payloadMatch = prompt.match(/(\[\{"id":"b\d{4}","markdown":[\s\S]*?\}\])\n\n翻译质量与输出格式硬要求/);
    assert.ok(payloadMatch);
    const blocks = JSON.parse(payloadMatch?.[1] || '[]') as Array<{ id: string; markdown: string }>;
    return {
      text: JSON.stringify({
        blocks: blocks.map((block, index) => ({
          id: block.id,
          markdown: index === 0
            ? 'uv 0.12.0 调整了默认项目布局，并说明了迁移路径。'
            : '发布说明介绍了新的构建后端及其兼容性影响。',
        })),
      }),
    };
  });

  assert.equal(result.translatedTitle, 'uv 0.12.0');
  assert.equal(assessTranslationCompleteness(result.text, source).complete, true);
});

test('uses a configured fallback model when the primary translation provider is unavailable', async () => {
  const source = [
    'The first paragraph explains the model release and links the decision to enterprise adoption.',
    'The second paragraph describes implementation evidence, limitations, and the next experiment.',
  ].join('\n\n');
  let primaryCalls = 0;
  let fallbackCalls = 0;

  const result = await translateSourceTextWithFallback({
    promptTemplate: '请翻译：\n{content}',
    title: 'A practical model release review',
    sourceText: source,
  }, async () => {
    primaryCalls += 1;
    throw new Error('Audio internal LLM API error: 500 Internal Server Error');
  }, async (prompt) => {
    fallbackCalls += 1;
    const payloadMatch = prompt.match(/(\[\{"id":"b\d{4}","markdown":[\s\S]*?\}\])\n\n翻译质量与输出格式硬要求/);
    assert.ok(payloadMatch);
    const blocks = JSON.parse(payloadMatch?.[1] || '[]') as Array<{ id: string; markdown: string }>;
    return {
      text: JSON.stringify({
        translatedTitle: '一份务实的模型发布评估',
        blocks: blocks.map((block, index) => ({
          id: block.id,
          markdown: index === 0
            ? '第一段解释了模型发布，并把这一决策与企业采用联系起来。'
            : '第二段描述了实施证据、局限性以及下一步实验。',
        })),
      }),
      provider: 'dashscope',
      model: 'qwen-flash',
    };
  });

  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 1);
  assert.equal(result.usedFallback, true);
  assert.equal(result.translatedTitle, '一份务实的模型发布评估');
  assert.match(result.text, /企业采用/);
  assert.equal(result.provider, 'dashscope');
});

test('does not hide non-retryable translation configuration errors behind fallback calls', async () => {
  let fallbackCalls = 0;
  await assert.rejects(() => translateSourceTextWithFallback({
    promptTemplate: '请翻译：\n{content}',
    title: 'Missing model',
    sourceText: 'A source paragraph that cannot be translated without a configured model.',
  }, async () => {
    throw new Error('missing_translation_config');
  }, async () => {
    fallbackCalls += 1;
    return { text: '不应调用备用模型。', translatedTitle: '错误' };
  }), /missing_translation_config/);

  assert.equal(isRetryableTranslationFailure(new Error('missing_translation_config')), false);
  assert.equal(fallbackCalls, 0);
});

test('counts skipped AI stage items separately from processed and failed', () => {
  const result = buildAiStageResult(1, 4, ['timeout', 'timeout', 'bad_json'], 2);

  assert.equal(result.processed, 1);
  assert.equal(result.attempted, 4);
  assert.equal(result.skipped, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.errors, ['timeout', 'bad_json']);
});

test('explains summary skips with user-facing policy reasons', () => {
  assert.equal(resolveSummarySkipReason({ processingProfile: 'monitor', aiScore: 90 }), '监控档位默认不做摘要');
  assert.equal(resolveSummarySkipReason({ processingProfile: 'brief', aiScore: 39.9 }), 'AI 评分过低，跳过摘要');
  assert.equal(resolveSummarySkipReason({ processingProfile: 'smart', aiScore: 40 }), null);
});
