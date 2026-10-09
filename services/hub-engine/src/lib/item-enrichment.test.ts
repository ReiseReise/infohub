import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRejectedContentFetchPatch,
  buildContentRefetchAiResetPatch,
  resolveContentFetchCandidates,
  resolveContentFetchTarget,
  resolveItemText,
  shouldAcceptFetchedContent,
  shouldFetchContentBeforeFullTranslation,
} from './item-enrichment.js';

test('resolveItemText returns cleaned readable text instead of raw html', () => {
  const resolved = resolveItemText({
    title: 'Claude code 云端部署教程',
    content: '<div style="font-family: sans-serif"><nav>菜单</nav><article><h1>Claude code 云端部署</h1><p>'
      + '这篇文章介绍如何通过 SDK 改造实现 HTTP 流式调用，并说明部署中的关键注意事项、鉴权方式、长连接保持、错误恢复和生产环境观测指标。文章还补充了服务端转发、模型配置、日志排查和前端消费流式响应的完整步骤，适合用于生产环境落地参考。部署时还需要关注鉴权隔离、请求限流、模型降级、失败重试和日志审计，确保前端看到的是稳定的事件流而不是一次性阻塞响应。'.repeat(3)
      + '</p></article></div>',
    snippet: null,
  });

  assert.equal(resolved.basis, 'content');
  assert.match(resolved.text, /HTTP 流式调用/);
  assert.doesNotMatch(resolved.text, /<div|style=|<article/i);
});

test('resolveItemText prefers readability content over noisy raw content when readability is ready', () => {
  const resolved = resolveItemText({
    title: 'Quaternion Rotations, Claude, and Lean',
    content: [
      'Jun 15, 2026 · Share · Subscribe',
      'How to get support',
      'press@anthropic.com',
      'Download press kit',
      'Menus and footer boilerplate should not become translation basis.',
    ].join('\n'),
    readabilityContent: [
      'A year after writing about quaternions, the author revisits the topic with Claude and Lean.',
      '',
      'He uses Lean to verify two rotation-matrix theorems and checks the generated SVG labels against the original Python implementation.',
      '',
      'The interesting part is not just the proof attempt, but how Claude notices the label collision between the LaTeX rendering and the actual Python code.',
    ].join('\n'),
    readabilityStatus: 'ready',
    snippet: 'A year after writing about quaternions.',
  });

  assert.equal(resolved.basis, 'content');
  assert.match(resolved.text, /rotation-matrix theorems/);
  assert.doesNotMatch(resolved.text, /press kit|How to get support|Menus and footer boilerplate/i);
});

test('resolveItemText keeps long readability text when cleanup would truncate code-heavy articles', () => {
  const intro = 'I got an email message this afternoon reporting a typo in a blog post about converting between quaternions and rotation matrices. '.repeat(8);
  const theoremBody = [
    'theorem col0_norm (h : q0 ^ 2 + q1 ^ 2 + q2 ^ 2 + q3 ^ 2 = 1) :',
    '(2 * (q0 ^ 2 + q1 ^ 2) - 1) ^ 2 + (2 * (q1 * q2 + q0 * q3)) ^ 2 = 1 := by nlinarith',
    '',
    'theorem col1_norm (h : q0 ^ 2 + q1 ^ 2 + q2 ^ 2 + q3 ^ 2 = 1) :',
    '(2 * (q1 * q2 - q0 * q3)) ^ 2 + (2 * (q0 ^ 2 + q2 ^ 2) - 1) ^ 2 = 1 := by nlinarith',
  ].join('\n').repeat(18);
  const resolved = resolveItemText({
    title: 'Quaternion Rotations, Claude, and Lean',
    content: intro,
    readabilityContent: `${intro}\n\n${theoremBody}`,
    readabilityStatus: 'ready',
    snippet: intro.slice(0, 220),
  });

  assert.equal(resolved.basis, 'content');
  assert.ok(resolved.text.length > 4000);
  assert.match(resolved.text, /theorem col1_norm/);
});

test('resolveItemText treats short RSS excerpts as snippet basis', () => {
  const excerpt = 'Asana acquires Stack AI and plans to integrate agent workflows into its work management product.';
  const resolved = resolveItemText({
    title: 'Asana acquires no-code agent-builder Stack AI',
    content: excerpt,
    snippet: excerpt,
  });

  assert.equal(resolved.basis, 'snippet');
  assert.match(resolved.text, /Stack AI/);
});

test('resolveItemText does not promote short degraded readability excerpts to full content', () => {
  const resolved = resolveItemText({
    title: '算力芯片概念震荡走强，寒武纪涨超10%创历史新高',
    contentStatus: 'degraded',
    content: [
      '36氪获悉，算力芯片概念震荡走强，寒武纪涨超10%创历史新高。',
      '```###',
      '[沪深两市成交额突破1.5万亿元](https://36kr.com/newsflashes/next)',
      '36氪获悉，沪深两市成交额突破1.5万亿元。',
    ].join('\n'),
    readabilityStatus: 'ready',
    readabilityContent: '36氪获悉，算力芯片概念震荡走强，寒武纪涨超10%创历史新高。',
    snippet: [
      '36氪获悉，算力芯片概念震荡走强，寒武纪涨超10%创历史新高。',
      '```###',
      '[沪深两市成交额突破1.5万亿元](https://36kr.com/newsflashes/next)',
    ].join('\n'),
  });

  assert.equal(resolved.basis, 'snippet');
  assert.match(resolved.text, /寒武纪涨超10%/);
  assert.doesNotMatch(resolved.text, /沪深两市成交额|newsflashes\/next|```###/);
});

test('resolveContentFetchTarget prefers original url for curated index items', () => {
  const target = resolveContentFetchTarget({
    url: 'https://www.bestblogs.dev/article/abc',
    originalUrl: 'https://example.com/original',
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
  });

  assert.equal(target.url, 'https://example.com/original');
  assert.equal(target.kind, 'original');
});

test('resolveContentFetchTarget keeps curated index readable when original url is missing', () => {
  const target = resolveContentFetchTarget({
    url: 'https://www.bestblogs.dev/article/abc',
    originalUrl: null,
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
  });

  assert.equal(target.url, null);
  assert.equal(target.kind, 'curated_index_missing_original');
});

test('resolveContentFetchCandidates prefers the original article and keeps the item url as fallback', () => {
  assert.deepEqual(resolveContentFetchCandidates({
    url: 'https://feed.example.com/posts/42',
    originalUrl: 'https://publisher.example.com/articles/42',
    sourceType: 'rss',
    sourceCollectorType: 'rss',
  }), [
    { url: 'https://publisher.example.com/articles/42', kind: 'original' },
    { url: 'https://feed.example.com/posts/42', kind: 'url' },
  ]);
});

test('resolveContentFetchCandidates removes duplicate original and item urls', () => {
  assert.deepEqual(resolveContentFetchCandidates({
    url: 'https://publisher.example.com/articles/42',
    originalUrl: 'https://publisher.example.com/articles/42',
    sourceType: 'rss',
    sourceCollectorType: 'rss',
  }), [
    { url: 'https://publisher.example.com/articles/42', kind: 'original' },
  ]);
});

test('resets stale AI assets when curated index original content is refetched', () => {
  assert.deepEqual(buildContentRefetchAiResetPatch('original'), {
    processingStatus: 'raw',
    aiSummary: null,
    summaryStatus: 'pending',
    summaryReason: 'original_content_refetched',
    aiTranslation: null,
    translatedTitle: null,
    translationStatus: 'pending',
    translationReason: 'original_content_refetched',
    priorityScore: null,
  });
  assert.deepEqual(buildContentRefetchAiResetPatch('url'), {});
  assert.deepEqual(buildContentRefetchAiResetPatch('url', true), {
    processingStatus: 'raw',
    aiSummary: null,
    summaryStatus: 'pending',
    summaryReason: 'content_refetched',
    aiTranslation: null,
    translatedTitle: null,
    translationStatus: 'pending',
    translationReason: 'content_refetched',
    priorityScore: null,
  });
});

test('accepts a shorter clean quotation when it replaces sponsor-only page chrome', () => {
  assert.equal(shouldAcceptFetchedContent({
    currentContent: 'Sponsored by: Atlassian. Give your agents a plan. Assign tasks from Jira.'.repeat(4),
    snippet: 'Sponsored by: Atlassian. Give your agents a plan.',
    extractedContent: 'Is there something I can actually help you with today? Kimi K3, after refusing to leak its system prompt.',
  }), true);
  assert.equal(shouldAcceptFetchedContent({
    currentContent: 'A complete existing article body. '.repeat(20),
    snippet: 'A complete existing article body.',
    extractedContent: 'A short replacement.',
  }), false);
});

test('full translation first fetches original content for index summaries with original urls', () => {
  assert.equal(shouldFetchContentBeforeFullTranslation({
    contentStatus: 'degraded',
    content: '## Anthropic Newsroom\n\n## 摘要\n\n这是新闻索引摘要。\n\n## 原文待补抓',
    snippet: '这是新闻索引摘要。',
    originalUrl: 'https://www.anthropic.com/news/tcs-anthropic-partnership',
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
    fetchEngine: 'webpage-index',
    renderMode: 'index',
  }), true);

  assert.equal(shouldFetchContentBeforeFullTranslation({
    url: 'https://openai.com/news/how-engineers-at-nextdoor-use-codex-to-build-without-limits',
    contentStatus: 'degraded',
    content: 'Short feed excerpt.',
    snippet: 'Short feed excerpt about a longer customer story.',
    sourceType: 'rss',
    sourceCollectorType: 'rss',
  }), true);

  assert.equal(shouldFetchContentBeforeFullTranslation({
    contentStatus: 'ready',
    content: 'This is a real long article body with enough paragraphs for reading. '.repeat(20),
    readabilityStatus: 'missing',
    readabilityContent: null,
    snippet: 'This is a real long article body.',
    url: 'https://www.johndcook.com/blog/2026/06/15/quaternions-claude-lean/',
    sourceType: 'rss',
    sourceCollectorType: 'rss',
    fetchEngine: null,
    renderMode: null,
  }), true);

  assert.equal(shouldFetchContentBeforeFullTranslation({
    contentStatus: 'ready',
    content: 'This is a real long article body with enough paragraphs for reading. '.repeat(20),
    readabilityStatus: 'ready',
    readabilityContent: 'This is a cleaned readability layer with enough paragraphs for reading. '.repeat(12),
    snippet: 'This is a real long article body.',
    originalUrl: 'https://example.com/article',
    sourceType: 'rss',
    sourceCollectorType: 'rss',
    fetchEngine: 'readability',
    renderMode: 'article',
  }), false);
});

test('feed-only sources do not auto fetch original content before translation', () => {
  assert.equal(shouldFetchContentBeforeFullTranslation({
    url: 'https://openai.com/news/how-engineers-at-nextdoor-use-codex-to-build-without-limits',
    contentStatus: 'degraded',
    content: 'Short feed excerpt.',
    snippet: 'Short feed excerpt about a longer customer story.',
    sourceType: 'rss',
    sourceCollectorType: 'rss',
    sourceContentStrategy: 'feed_only',
  }), false);

  assert.equal(shouldFetchContentBeforeFullTranslation({
    url: 'https://www.johndcook.com/blog/2026/06/15/quaternions-claude-lean/',
    contentStatus: 'ready',
    content: 'This is a real long article body with enough paragraphs for reading. '.repeat(20),
    readabilityStatus: 'missing',
    readabilityContent: null,
    snippet: 'This is a real long article body.',
    sourceType: 'rss',
    sourceCollectorType: 'rss',
    sourceContentStrategy: 'feed_only',
  }), false);
});

test('full-strategy rss sources fetch original content before translation when only excerpts are available', () => {
  assert.equal(shouldFetchContentBeforeFullTranslation({
    url: 'https://openai.com/news/how-engineers-at-nextdoor-use-codex-to-build-without-limits',
    contentStatus: 'degraded',
    content: 'Short feed excerpt.',
    snippet: 'Short feed excerpt about a longer customer story.',
    sourceType: 'rss',
    sourceCollectorType: 'rss',
    sourceContentStrategy: 'full',
  }), true);
});

test('rejected content fetch does not leave short readability marked ready', () => {
  const patch = buildRejectedContentFetchPatch({
    fallbackStatus: 'degraded',
    warning: '正文抓取未命中，当前仅保留摘要片段',
    extractedReadabilityContent: '短正文',
    extractedFetchEngine: 'readability',
    extractedRenderMode: 'article',
    extractedBlockedReason: 'content_unavailable',
  });

  assert.equal(patch.contentStatus, 'degraded');
  assert.equal(patch.readabilityStatus, 'failed');
  assert.equal(patch.readabilityReason, '正文抓取未命中，当前仅保留摘要片段');
  assert.equal(patch.blockedReason, 'content_unavailable');
});

test('rejected content fetch never marks readability ready without storing accepted article content', () => {
  const patch = buildRejectedContentFetchPatch({
    fallbackStatus: 'degraded',
    warning: '正文抓取未命中，当前仅保留摘要片段',
    extractedReadabilityContent: '这是一段抓取返回的候选正文，但当前分支已经判定它没有超过原摘要或没有达到可接受标准。'.repeat(10),
    extractedFetchEngine: 'readability',
    extractedRenderMode: 'article',
    extractedBlockedReason: 'content_unavailable',
  });

  assert.equal(patch.readabilityStatus, 'failed');
  assert.equal(patch.readabilityReason, '正文抓取未命中，当前仅保留摘要片段');
});
