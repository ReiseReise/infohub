import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContentReadiness,
  buildRankContext,
  buildReadingItemContext,
  buildReadingAssets,
  buildReportContext,
  buildContentEvidence,
} from './reading-context.js';

test('classifies readable full text separately from RSS summaries and snippets', () => {
  assert.deepEqual(buildContentReadiness({
    title: 'Claude Fable 5 发布',
    contentStatus: 'ready',
    content: 'Anthropic released Claude Fable 5. '.repeat(20),
    snippet: '短摘要',
  }), {
    status: 'full_text',
    label: '全文可读',
    basis: 'content',
    kind: 'article',
    isFullText: true,
    fullTextAvailable: true,
    originalTextStatus: 'ready',
    action: '可以直接阅读正文，并基于全文生成摘要、翻译和日报判断。',
  });

  assert.deepEqual(buildContentReadiness({
    title: 'BestBlogs 今日精选',
    contentStatus: 'degraded',
    snippet: '这是一段榜单摘要，能够支持扫读，但还没有原站全文。',
  }), {
    status: 'rss_summary',
    label: '摘要可读',
    basis: 'snippet',
    fullTextAvailable: false,
    action: '可以先扫读摘要；重要内容建议补抓原文。',
  });

  assert.deepEqual(buildContentReadiness({
    title: '只有标题',
    contentStatus: 'failed',
    contentError: 'timeout',
  }), {
    status: 'fetch_failed',
    label: '补抓失败',
    basis: 'title',
    fullTextAvailable: false,
    action: '重新补抓正文，或检查来源是否需要登录、渲染或反爬处理。',
  });
});

test('labels webpage monitor entries as snapshots instead of full articles', () => {
  const readiness = buildContentReadiness({
    title: 'Newsroom \\ Anthropic',
    contentStatus: 'ready',
    content: 'Anthropic Newsroom media inquiries press support download press kit '.repeat(15),
    snippet: 'Anthropic Newsroom media inquiries press support',
    sourceType: 'webpage',
    sourceCollectorType: 'webpage',
  });

  assert.equal(readiness.label, '网页监控快照');
  assert.equal(readiness.kind, 'snapshot');
  assert.equal(readiness.isFullText, false);
  assert.equal(readiness.fullTextAvailable, false);
  assert.equal(readiness.originalTextStatus, 'not_applicable');
});

test('does not label curated index summaries without original links as full text', () => {
  assert.deepEqual(buildContentReadiness({
    title: 'BestBlogs 今日精选',
    contentStatus: 'ready',
    content: '## BestBlogs Daily Brief\n\n## 榜单摘要\n\n这是一条榜单摘要。'.repeat(12),
    snippet: '这是一条榜单摘要。',
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
    originalUrl: null,
  }), {
    status: 'rss_summary',
    label: '榜单摘要可读',
    basis: 'content',
    kind: 'curated_summary',
    isFullText: false,
    fullTextAvailable: false,
    originalTextStatus: 'missing_original_url',
    action: '可以先读榜单摘要；如需深读，需要先解析原站链接并补抓正文。',
  });
});

test('does not label index summaries with original links as full text until article body is fetched', () => {
  const readiness = buildContentReadiness({
    title: 'Claude Fable 5 and Claude Mythos 5',
    content: '## Anthropic Newsroom\n\n## 摘要\n\nOur next generation of intelligence for hard work.\n\n## 原文待补抓\n\n当前条目来自 Anthropic 新闻索引页，已拆成单篇新闻；如需完整正文，可在详情页触发正文补抓。'.repeat(3),
    contentStatus: 'ready',
    contentBasis: 'content',
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
    originalUrl: 'https://www.anthropic.com/news/claude-fable-5-mythos-5',
  });

  assert.equal(readiness.status, 'rss_summary');
  assert.equal(readiness.label, '索引摘要可读');
  assert.equal(readiness.kind, 'index_item');
  assert.equal(readiness.isFullText, false);
  assert.equal(readiness.originalTextStatus, 'pending_fetch');
});

test('does not label index list rows as full text when full content is not selected', () => {
  const readiness = buildContentReadiness({
    title: 'Claude Fable 5 and Claude Mythos 5',
    contentStatus: 'ready',
    contentBasis: 'content',
    contentLength: 520,
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
    originalUrl: 'https://www.anthropic.com/news/claude-fable-5-mythos-5',
    fetchEngine: 'webpage-index',
    renderMode: 'index',
  });

  assert.equal(readiness.label, '索引摘要可读');
  assert.equal(readiness.fullTextAvailable, false);
});

test('labels curated index items as full articles after original body is fetched', () => {
  const readiness = buildContentReadiness({
    title: 'Claude Fable 5 and Claude Mythos 5',
    contentStatus: 'ready',
    content: 'Anthropic introduces a new class of Claude models for long-running coding, research, and professional work. '.repeat(20),
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
    originalUrl: 'https://www.anthropic.com/news/claude-fable-5-mythos-5',
    fetchEngine: 'readability',
    renderMode: 'article',
  });

  assert.equal(readiness.label, '全文可读');
  assert.equal(readiness.kind, 'article');
  assert.equal(readiness.isFullText, true);
  assert.equal(readiness.originalTextStatus, 'ready');
});

test('exposes one fullTextReady flag derived from the shared readiness decision', () => {
  const fullArticle = buildReadingItemContext({
    title: 'Complete RSS article',
    contentStatus: 'ready',
    content: '<p>Complete RSS article body with enough detail for deep reading.</p>'.repeat(12),
    sourceType: 'rss',
    sourceCollectorType: 'rss',
  });
  const indexSummary = buildReadingItemContext({
    title: 'Index summary',
    contentStatus: 'ready',
    content: '## Anthropic Newsroom\n\n## 摘要\n\nIndex summary only.\n\n## 原文待补抓\n\nPending.',
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
    originalUrl: 'https://www.anthropic.com/news/index-summary',
  });

  assert.equal(fullArticle.fullTextReady, true);
  assert.equal(indexSummary.fullTextReady, false);
});

test('builds reading assets from existing AI outputs without inventing content', () => {
  const assets = buildReadingAssets({
    aiSummary: '这篇文章说明 Claude Fable 5 的发布意义。',
    summaryStatus: 'ready',
    summaryBasis: 'content',
    aiTranslation: '',
    translationStatus: 'pending',
    transcript: '播客转写正文',
    knowledge: '',
    latestFeedbackType: 'must_read',
    dailyReportDiagnostic: {
      status: 'selected',
      label: '已入报',
      reason: '关键模型发布，值得优先阅读。',
      action: '在日报重点文章中阅读。',
      tone: 'ok',
    },
  });

  assert.equal(assets.find((asset) => asset.type === 'summary')?.status, 'ready');
  assert.equal(assets.find((asset) => asset.type === 'summary')?.basis, 'content');
  assert.equal(assets.find((asset) => asset.type === 'translation')?.status, 'pending');
  assert.equal(assets.find((asset) => asset.type === 'transcript')?.status, 'ready');
  assert.equal(assets.find((asset) => asset.type === 'feedback')?.preview, '已标记：值得重点关注');
  assert.equal(assets.find((asset) => asset.type === 'report_reference')?.preview, '已入报：关键模型发布，值得优先阅读。');
});

test('builds user-facing rank and report contexts for Feed and daily report surfaces', () => {
  const readiness = buildContentReadiness({
    title: 'Claude Fable 5 发布',
    contentStatus: 'ready',
    content: 'Claude Fable 5 full article. '.repeat(20),
  });
  const rank = buildRankContext({
    view: 'recommended',
    sortBy: 'priority',
    aiScore: 86,
    priorityScore: 91,
    sourceTier: 'A',
    qualityDecision: 'pass',
    latestFeedbackType: 'must_read',
    contentReadiness: readiness,
  });

  assert.equal(rank.strategy, 'feed_recommended_v1');
  assert.equal(rank.version, '2026-06-11');
  assert.equal(rank.fallback, false);
  assert.deepEqual(rank.reasons.slice(0, 4), [
    '高分内容，值得优先阅读',
    '来源等级较高',
    '已有全文，可支撑深读',
    '你标记过值得重点关注',
  ]);

  const report = buildReportContext({
    date: '2026-06-11',
    dailyReportDiagnostic: {
      status: 'review',
      label: '待复核',
      reason: '命中 AI 模型发布，但摘要未完成。',
      action: '先补摘要再决定是否精选。',
      tone: 'warning',
      selectionMode: 'review',
    },
  });

  assert.equal(report.strategy, 'daily_report_selection_v2');
  assert.equal(report.selectionMode, 'review');
  assert.equal(report.reason, '命中 AI 模型发布，但摘要未完成。');
  assert.equal(report.window, '2026-06-11');
});

test('keeps translation action visible when saved translation is clearly incomplete', () => {
  const context = buildReadingItemContext({
    title: 'Quaternion Rotations, Claude, and Lean',
    contentStatus: 'ready',
    content: 'This is a long technical article about quaternions and Lean theorem proving. '.repeat(140),
    aiTranslation: '这是一段很短的译文，只覆盖文章开头。',
    translationStatus: 'ready',
  });

  assert.equal(context.contentReadiness.fullTextAvailable, true);
  assert.equal(context.translationCompleteness?.complete, false);
  assert.equal(context.translationAction, 'translate');
});

test('checks translation completeness against readability text, not only stored content', () => {
  const context = buildReadingItemContext({
    title: 'Quaternion Rotations, Claude, and Lean',
    contentStatus: 'ready',
    content: 'Short feed-level article text. '.repeat(50),
    readabilityContent: 'This is the actual long readable article with code and theorem proof details. '.repeat(130),
    readabilityStatus: 'ready',
    aiTranslation: '这是一段只覆盖开头的短译文。',
    translationStatus: 'ready',
  });

  assert.equal(context.contentEvidence.primaryLayer, 'readableText');
  assert.ok(context.translationCompleteness);
  assert.equal(context.translationCompleteness.basisLength > 6000, true);
  assert.equal(context.translationCompleteness?.complete, false);
  assert.equal(context.translationAction, 'translate');
});

test('translation completeness counts readability text instead of html markup bytes', () => {
  const articleText = 'Hiring for AI roles outpaced overall recruitment and companies continued investing in specialised talent. '.repeat(12);
  const context = buildReadingItemContext({
    title: 'AI hiring report',
    content: articleText,
    contentStatus: 'ready',
    readabilityContent: `<article class="${'layout-token '.repeat(120)}"><p>${articleText}</p></article>`,
    readabilityStatus: 'ready',
    aiTranslation: '人工智能岗位招聘增速超过整体招聘，企业继续投资专业人才。'.repeat(16),
    translationStatus: 'ready',
    language: 'en',
  });

  assert.ok(context.translationCompleteness);
  assert.equal(context.translationCompleteness?.basisLength < 1600, true);
  assert.equal(context.translationCompleteness?.complete, true);
});

test('marks a translation incomplete when it loses article structure even if the text is long enough', () => {
  const readabilityContent = [
    '<p>Opening context for the article and its central claim.</p>',
    '<p>Second paragraph with supporting evidence.</p>',
    '<p>Third paragraph links to <a href="https://example.com/evidence">the primary evidence</a>.</p>',
    '<figure><img src="https://example.com/figure.png" alt="Evidence chart"></figure>',
    '<p>Fourth paragraph explains the method.</p>',
    '<p>Fifth paragraph adds limitations.</p>',
    '<p>Sixth paragraph gives the conclusion.</p>',
  ].join('');
  const context = buildReadingItemContext({
    title: 'Structured source article',
    contentStatus: 'ready',
    readabilityContent,
    readabilityStatus: 'ready',
    aiTranslation: '这是一篇长度看起来足够、但所有段落和链接都被压平的中文译文。'.repeat(50),
    translationStatus: 'ready',
    language: 'en',
  });

  assert.equal(context.translationCompleteness?.complete, false);
  assert.match(context.translationCompleteness?.reason || '', /段落|链接|图片/);
  assert.equal(context.translationAction, 'translate');
});

test('marks a short Reuters translation incomplete even when it was stored as ready', () => {
  const context = buildReadingItemContext({
    title: 'TSMC Q2 profit jumps 77% to record',
    language: 'en',
    content: '<p>TSMC posted record profit as AI demand accelerated.</p>'.repeat(24),
    contentStatus: 'ready',
    aiTranslation: '台积电第二季度利润创下纪录，人工智能需求继续增长。'.repeat(11).slice(0, 317),
    translationStatus: 'ready',
  });

  assert.equal(context.translationCompleteness?.complete, false);
  assert.equal(context.translationAction, 'translate');
});

test('offers fetch then translate when an RSS item only has a summary but an article URL exists', () => {
  const context = buildReadingItemContext({
    title: 'How engineers at Nextdoor use Codex to build without limits',
    contentStatus: 'degraded',
    content: 'OpenAI short feed excerpt.',
    snippet: 'OpenAI short feed excerpt about a longer customer story.',
    url: 'https://openai.com/news/how-engineers-at-nextdoor-use-codex-to-build-without-limits',
    originalUrl: null,
    sourceType: 'rss',
    sourceCollectorType: 'rss',
  });

  assert.equal(context.contentReadiness.label, '摘要可读');
  assert.equal(context.translationAction, 'fetch_then_translate');
});

test('opens original after content fetch already failed and only a short snippet remains', () => {
  const context = buildReadingItemContext({
    title: '因AI安全隐患遭监管，Anthropic承诺加强与美政府沟通',
    contentStatus: 'degraded',
    contentError: '正文抓取未命中，当前仅保留摘要片段',
    blockedReason: 'content_unavailable',
    content: 'Anthropic承诺加强与美国政府沟通，并就AI安全问题接受监管关注。',
    snippet: 'Anthropic承诺加强与美国政府沟通，并就AI安全问题接受监管关注。',
    readabilityStatus: 'failed',
    readabilityReason: '正文抓取未命中，当前仅保留摘要片段',
    url: 'https://36kr.com/newsflashes/3859408242004996?f=rss',
    sourceType: 'rss',
    sourceCollectorType: 'rss',
  });

  assert.equal(context.contentReadiness.label, '摘要片段可读');
  assert.equal(context.contentReadiness.fullTextAvailable, false);
  assert.equal(context.translationAction, 'open_original');
});

test('opens original instead of auto-fetching when source strategy is feed-only', () => {
  const context = buildReadingItemContext({
    title: 'How engineers at Nextdoor use Codex to build without limits',
    contentStatus: 'degraded',
    content: 'OpenAI short feed excerpt.',
    snippet: 'OpenAI short feed excerpt about a longer customer story.',
    url: 'https://openai.com/news/how-engineers-at-nextdoor-use-codex-to-build-without-limits',
    sourceType: 'rss',
    sourceCollectorType: 'rss',
    sourceContentStrategy: 'feed_only',
  });

  assert.equal(context.translationAction, 'open_original');
});

test('does not expose translation action for monitor-only sources', () => {
  const context = buildReadingItemContext({
    title: 'Anthropic Newsroom 快照',
    contentStatus: 'ready',
    content: 'Anthropic Newsroom media inquiries press support download press kit '.repeat(8),
    url: 'https://www.anthropic.com/news',
    sourceType: 'webpage',
    sourceCollectorType: 'webpage',
    sourceContentStrategy: 'monitor_only',
  });

  assert.equal(context.contentReadiness.label, '网页监控快照');
  assert.equal(context.translationAction, 'none');
});

test('keeps historical webpage snapshots classified as snapshots after the source switches to webpage_index', () => {
  const context = buildReadingItemContext({
    title: 'Newsroom \\ Anthropic',
    contentStatus: 'ready',
    content: 'Anthropic Newsroom media inquiries press support download press kit '.repeat(8),
    url: 'https://www.anthropic.com/news#snapshot-2026-06-01',
    sourceType: 'webpage',
    sourceCollectorType: 'webpage_index',
  });

  assert.equal(context.contentReadiness.label, '网页监控快照');
  assert.equal(context.contentReadiness.kind, 'snapshot');
  assert.equal(context.contentReadiness.fullTextAvailable, false);
  assert.equal(context.fullTextReady, false);
  assert.equal(context.contentEvidence.primaryLayer, 'snapshotText');
  assert.equal(context.contentEvidence.translationBasis.reliableForFullTranslation, false);
});

test('offers open original when a curated summary has no original article link', () => {
  const context = buildReadingItemContext({
    title: 'BestBlogs 今日精选',
    url: 'https://www.bestblogs.dev/explore/brief',
    contentStatus: 'ready',
    content: '这是一段中文榜单摘要。',
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
    translationStatus: 'skipped',
    translationReason: '原文已是中文',
  });

  assert.equal(context.contentReadiness.label, '榜单摘要可读');
  assert.equal(context.translationAction, 'open_original');
});

test('offers fetch then translate for Chinese index summaries with an original article url', () => {
  const context = buildReadingItemContext({
    title: 'How engineers at Nextdoor use Codex to build without limits',
    url: 'https://openai.com/news',
    originalUrl: 'https://openai.com/news/how-engineers-at-nextdoor-use-codex-to-build-without-limits',
    contentStatus: 'ready',
    content: '这是一段来自索引页的中文摘要，能支持快扫，但不是原站正文。'.repeat(8),
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
    fetchEngine: 'webpage-index',
    renderMode: 'index',
    translationStatus: 'skipped',
    translationReason: '原文已是中文',
  });

  assert.equal(context.contentReadiness.label, '索引摘要可读');
  assert.equal(context.contentReadiness.originalTextStatus, 'pending_fetch');
  assert.equal(context.translationAction, 'fetch_then_translate');
});

test('does not offer translation for Chinese items that were intentionally skipped', () => {
  const context = buildReadingItemContext({
    title: '36kr 中文短讯',
    url: 'https://36kr.com/newsflashes/1',
    contentStatus: 'ready',
    content: '这是一条已经是中文的短讯，正文很短，但足够支持快扫阅读和判断。'.repeat(6),
    sourceType: 'rss',
    sourceCollectorType: 'rss',
    translationStatus: 'skipped',
    translationReason: '原文已是中文',
  });

  assert.equal(context.contentReadiness.label, '全文可读');
  assert.equal(context.translationAction, 'none');
});

test('treats cross-site RSS entries without readability as external-link summaries, not full articles', () => {
  const context = buildReadingItemContext({
    title: 'Meta Reportedly Has a Slew of New Smart Glasses Planned for This Year',
    sourceName: 'daringfireball.net',
    url: 'https://gizmodo.com/meta-has-a-ridiculous-amount-of-smart-glasses-planned-for-this-year-2000765741',
    contentStatus: 'ready',
    content: '<p>James Pero, summarizing for Gizmodo this paywalled report by Jyoti Mann for The Information:</p><blockquote>Meta has several smart glasses planned.</blockquote>'.repeat(8),
    sourceType: 'rss',
    sourceCollectorType: 'rss',
    readabilityStatus: 'missing',
    readabilityContent: null,
    translationStatus: 'ready',
    aiTranslation: '标题：Meta据报道计划今年推出多款新型智能眼镜。内容：这是很短的译文。',
  });

  assert.equal(context.contentReadiness.label, '外链摘要可读');
  assert.equal(context.contentReadiness.kind, 'external_link_summary');
  assert.equal(context.contentReadiness.fullTextAvailable, false);
  assert.equal(context.contentReadiness.originalTextStatus, 'pending_fetch');
  assert.equal(context.contentEvidence.translationBasis.reliableForFullTranslation, false);
  assert.equal(context.translationAction, 'fetch_then_translate');
});

test('still offers translation when a long English readable layer was previously mis-skipped as Chinese', () => {
  const context = buildReadingItemContext({
    title: 'Quaternion Rotations, Claude, and Lean',
    url: 'https://www.johndcook.com/blog/2026/06/15/quaternions-claude-lean/',
    contentStatus: 'ready',
    content: '作者收到一封关于四元数与旋转矩阵转换的拼写错误邮件。',
    readabilityContent: 'This is a long English article about quaternions, Claude, Lean theorem proving, and a rotation matrix proof. '.repeat(90),
    readabilityStatus: 'ready',
    language: 'en',
    sourceType: 'rss',
    sourceCollectorType: 'rss',
    translationStatus: 'skipped',
    translationReason: '原文已是中文',
  });

  assert.equal(context.contentReadiness.label, '全文可读');
  assert.equal(context.contentEvidence.primaryLayer, 'readableText');
  assert.equal(context.translationAction, 'translate');
});

test('builds content evidence that separates readable article text from summaries and snapshots', () => {
  const fullArticle = buildContentEvidence({
    title: 'A survey of inlining heuristics',
    contentStatus: 'ready',
    content: '<p>This is a long feed article with code examples.</p>'.repeat(20),
    readabilityContent: 'This is a clean readability article with code examples. '.repeat(20),
    readabilityStatus: 'ready',
    sourceType: 'rss',
    sourceCollectorType: 'rss',
  });

  assert.equal(fullArticle.primaryLayer, 'readableText');
  assert.equal(fullArticle.readableHtml.available, true);
  assert.equal(fullArticle.readableText.available, true);
  assert.equal(fullArticle.translationBasis.layer, 'readableText');
  assert.equal(fullArticle.translationBasis.reliableForFullTranslation, true);

  const indexItem = buildContentEvidence({
    title: 'Claude Fable 5',
    contentStatus: 'ready',
    content: '## Anthropic Newsroom\n\n## 摘要\n\n这是一条从新闻索引拆出的摘要。\n\n## 原文待补抓\n\n当前条目来自索引页。'.repeat(3),
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
    originalUrl: 'https://www.anthropic.com/news/claude-fable-5',
    fetchEngine: 'webpage-index',
    renderMode: 'index',
  });

  assert.equal(indexItem.primaryLayer, 'indexSummary');
  assert.equal(indexItem.indexSummary.available, true);
  assert.equal(indexItem.readableText.available, false);
  assert.equal(indexItem.translationBasis.layer, 'indexSummary');
  assert.equal(indexItem.translationBasis.reliableForFullTranslation, false);

  const curatedSummary = buildContentEvidence({
    title: 'BestBlogs Daily Brief',
    contentStatus: 'ready',
    content: '## BestBlogs Daily Brief\n\n## 榜单摘要\n\n今天的榜单摘要。'.repeat(5),
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
  });

  assert.equal(curatedSummary.primaryLayer, 'curatedSummary');
  assert.equal(curatedSummary.curatedSummary.available, true);
  assert.equal(curatedSummary.translationBasis.layer, 'curatedSummary');
  assert.equal(curatedSummary.translationBasis.reliableForFullTranslation, false);

  const snapshot = buildContentEvidence({
    title: 'Newsroom \\ Anthropic',
    contentStatus: 'ready',
    content: 'Anthropic Newsroom media inquiries press support download press kit '.repeat(12),
    sourceType: 'webpage',
    sourceCollectorType: 'webpage',
  });

  assert.equal(snapshot.primaryLayer, 'snapshotText');
  assert.equal(snapshot.snapshotText.available, true);
  assert.equal(snapshot.translationBasis.layer, 'snapshotText');
  assert.equal(snapshot.translationBasis.reliableForFullTranslation, false);
});

test('does not expose short readability excerpts as a ready readable layer', () => {
  const evidence = buildContentEvidence({
    title: 'Short newsflash item',
    contentStatus: 'degraded',
    content: 'Short readable excerpt from a feed item. '.repeat(3),
    snippet: 'Short readable excerpt from a feed item. '.repeat(3),
    readabilityContent: 'Short readable excerpt from a feed item. '.repeat(3),
    readabilityStatus: 'ready',
    readabilityReason: null,
    sourceType: 'rss',
    sourceCollectorType: 'rss',
  });

  assert.equal(evidence.primaryLayer, 'snippet');
  assert.equal(evidence.readableHtml.available, false);
  assert.equal(evidence.readableHtml.status, 'missing');
  assert.equal(evidence.readableText.available, false);
  assert.equal(evidence.readableText.status, 'missing');
  assert.equal(evidence.translationBasis.reliableForFullTranslation, false);
});

test('marks legacy ready translations with leaked JSON as invalid at read time', () => {
  const context = buildReadingItemContext({
    title: 'Model release details',
    contentStatus: 'ready',
    content: 'A detailed source paragraph about a model release. '.repeat(40),
    language: 'en',
    sourceType: 'rss',
    sourceCollectorType: 'rss',
    translationStatus: 'ready',
    aiTranslation: [
      '这是一段已有中文译文，但其中混入了模型返回的结构化数据。'.repeat(8),
      '{"blocks":[{"id":"b0002","markdown":"不应展示的内部数据"}]}',
      '后续中文内容不能掩盖这个错误。'.repeat(8),
    ].join('\n\n'),
  });

  assert.equal(context.translationUsability, 'invalid');
  assert.equal(context.translationCompleteness?.usable, false);
  assert.equal(context.translationCompleteness?.reasonCode, 'structured_output_leak');
  assert.equal(context.translationAction, 'translate');
});
