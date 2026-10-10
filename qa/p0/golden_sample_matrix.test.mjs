import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CHECK_LABELS,
  DEFAULT_SCENARIOS,
  buildGoldenRow,
  buildMarkdownDiagnostics,
  dedupeItems,
  detectSourceMappingIssue,
  renderGoldenMarkdown,
  resolveEvidenceLayer,
  resolveTranslationAction,
  resolveTokenFromLoginJson,
  resolveTokensFromEnv,
  scoreGoldenCandidate,
  selectFocusedSources,
  selectGoldenRows,
  summarizeRows,
} from './golden_sample_matrix.mjs';

const fixtureItems = [
  {
    id: 'full-1',
    title: 'Long readable post',
    sourceId: 10,
    sourceName: 'John D. Cook',
    aiScore: 78,
    contentEvidence: {
      primaryLayer: 'readableText',
      primaryLabel: '可读正文',
      translationBasis: {
        reliableForFullTranslation: true,
      },
    },
    contentReadiness: {
      fullTextAvailable: true,
      status: 'full_text',
    },
    translationStatus: 'pending',
  },
  {
    id: 'index-1',
    title: 'Anthropic Newsroom item',
    sourceId: 20,
    sourceName: 'Anthropic Newsroom',
    aiScore: 82,
    originalUrl: 'https://www.anthropic.com/news/example',
    contentEvidence: {
      primaryLayer: 'indexSummary',
      primaryLabel: '索引摘要',
      translationBasis: {
        reliableForFullTranslation: false,
      },
    },
  },
  {
    id: 'curated-1',
    title: 'BestBlogs brief',
    sourceId: 30,
    sourceName: 'BestBlogs Daily Brief',
    aiScore: 64,
    url: 'https://www.bestblogs.dev/en/explore/brief/example',
    contentEvidence: {
      primaryLayer: 'curatedSummary',
      primaryLabel: '榜单摘要',
      translationBasis: {
        reliableForFullTranslation: false,
      },
    },
  },
  {
    id: 'snippet-1',
    title: 'Thin item',
    sourceId: 40,
    sourceName: 'Low Quality Source',
    aiScore: 31,
    snippet: 'Only a short snippet.',
    translationStatus: 'failed',
  },
];

test('resolves evidence layers from explicit contentEvidence and fallbacks', () => {
  assert.equal(resolveEvidenceLayer(fixtureItems[0]), 'readableText');
  assert.equal(resolveEvidenceLayer(fixtureItems[1]), 'indexSummary');
  assert.equal(resolveEvidenceLayer({ contentReadiness: { kind: 'index_item' } }), 'indexSummary');
  assert.equal(resolveEvidenceLayer({ sourceType: 'curated_index', snippet: 'brief' }), 'curatedSummary');
  assert.equal(resolveEvidenceLayer({ sourceType: 'webpage', content: 'snapshot' }), 'snapshotText');
  assert.equal(resolveEvidenceLayer({ sourceType: 'email', snippet: 'newsletter' }), 'emailText');
  assert.equal(resolveEvidenceLayer({ snippet: 'short' }), 'snippet');
});

test('keeps a 12-scenario matrix covering source and reading risks', () => {
  assert.equal(DEFAULT_SCENARIOS.length, 12);
  assert.deepEqual(DEFAULT_SCENARIOS.map((scenario) => scenario.id), [
    'full_readable_article',
    'rss_longform_code',
    'index_summary',
    'curated_summary',
    'snapshot_or_monitor',
    'email_newsletter',
    'snippet_or_title_only',
    'translation_gap',
    'high_value_ai_signal',
    'official_source_config',
    'domestic_cn_news',
    'low_quality_noise',
  ]);
});

test('defines fixed acceptance checks for every golden scenario', () => {
  for (const scenario of DEFAULT_SCENARIOS) {
    assert.ok(Array.isArray(scenario.checks), `${scenario.id} should declare acceptance checks`);
    assert.ok(scenario.checks.length >= 3, `${scenario.id} should have enough checks to prevent shallow validation`);
    for (const check of scenario.checks) {
      assert.ok(CHECK_LABELS[check], `${scenario.id} uses unknown check ${check}`);
    }
  }

  const allChecks = new Set(DEFAULT_SCENARIOS.flatMap((scenario) => scenario.checks));
  for (const required of ['content_state', 'reader_render', 'summary_basis', 'translation_action', 'report_coverage']) {
    assert.ok(allChecks.has(required), `matrix should cover ${required}`);
  }
});

test('requires fetch-then-translate for index or curated summaries', () => {
  assert.equal(resolveTranslationAction(fixtureItems[0]), 'translate');
  assert.equal(resolveTranslationAction(fixtureItems[1]), 'fetch_then_translate');
  assert.equal(resolveTranslationAction(fixtureItems[2]), 'fetch_then_translate');
  assert.equal(resolveTranslationAction(fixtureItems[3]), 'retry_translation');
});

test('keeps repaired news index sources in the golden matrix', () => {
  const scenario = DEFAULT_SCENARIOS.find((item) => item.id === 'index_summary');
  const repairedIndexItem = {
    id: 'anthropic-readable',
    title: 'TCS and Anthropic partner to bring Claude to regulated industries',
    sourceId: 1354,
    sourceName: 'Anthropic Newsroom',
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
    originalUrl: 'https://www.anthropic.com/news/tcs-anthropic-partnership',
    contentEvidence: {
      primaryLayer: 'readableText',
      primaryLabel: '可读正文',
      translationBasis: {
        reliableForFullTranslation: true,
      },
    },
    contentReadiness: {
      kind: 'article',
      fullTextAvailable: true,
    },
  };

  assert.equal(scenario.match(repairedIndexItem), true);
  const [row] = selectGoldenRows([repairedIndexItem], [scenario], { baseWebUrl: 'http://localhost' });
  assert.equal(row.itemId, 'anthropic-readable');
  assert.equal(row.status, 'pass');
  assert.match(row.acceptanceChecks, /原站补抓/);
});

test('keeps correctly mapped official sources in the golden matrix', () => {
  const scenario = DEFAULT_SCENARIOS.find((item) => item.id === 'official_source_config');
  const officialItem = {
    id: 'openai-official',
    title: 'Introducing LifeSciBench',
    sourceId: 1360,
    sourceName: 'OpenAI News',
    sourceKind: 'official',
    url: 'https://openai.com/index/introducing-life-sci-bench',
    contentEvidence: {
      primaryLayer: 'readableText',
      primaryLabel: '可读正文',
    },
  };

  assert.equal(detectSourceMappingIssue(officialItem), '');
  assert.equal(scenario.match(officialItem), true);
  const [row] = selectGoldenRows([officialItem], [scenario], { baseWebUrl: 'http://localhost' });
  assert.equal(row.itemId, 'openai-official');
  assert.equal(row.status, 'pass');
});

test('does not mark curated summaries with open-original action as broken', () => {
  const row = buildGoldenRow({
    id: 'curated-open',
    title: 'BestBlogs brief without original link',
    sourceId: 1358,
    sourceName: 'BestBlogs Daily Brief',
    sourceType: 'curated_index',
    url: 'https://www.bestblogs.dev/article/example',
    contentEvidence: {
      primaryLayer: 'curatedSummary',
      primaryLabel: '榜单摘要',
      translationBasis: {
        reliableForFullTranslation: false,
      },
    },
    translationAction: 'open_original',
  }, DEFAULT_SCENARIOS.find((item) => item.id === 'curated_summary'), 'http://localhost');

  assert.equal(row.status, 'pass');
  assert.equal(row.translationAction, 'open_original');
});

test('builds golden rows with user-facing review issues', () => {
  const row = buildGoldenRow(fixtureItems[1], DEFAULT_SCENARIOS[1], 'http://localhost');

  assert.equal(row.status, 'pass');
  assert.equal(row.evidenceLabel, '索引摘要');
  assert.equal(row.translationAction, 'fetch_then_translate');
  assert.match(row.acceptanceChecks, /正文状态/);
  assert.match(row.acceptanceChecks, /原文排版/);
  assert.match(row.feedUrl, /\/feed\/index-1\?sourceId=20/);
});

test('selects rows and makes missing scenarios visible', () => {
  const rows = selectGoldenRows(fixtureItems, DEFAULT_SCENARIOS, { baseWebUrl: 'http://localhost' });
  const summary = summarizeRows(rows);

  assert.equal(rows.length, DEFAULT_SCENARIOS.length);
  assert.ok(summary.missing >= 1);
  assert.ok(rows.some((row) => row.status === 'missing' && row.issue.includes('没有命中')));
  assert.ok(rows.some((row) => row.scenarioId === 'snippet_or_title_only' && row.status === 'review'));
});

test('marks optional snapshot monitor scenario as skipped when no source is enabled', () => {
  const scenario = DEFAULT_SCENARIOS.find((item) => item.id === 'snapshot_or_monitor');
  const [row] = selectGoldenRows([], [scenario], { baseWebUrl: 'http://localhost' });

  assert.equal(row.status, 'skipped');
  assert.match(row.title, /未启用/);
  assert.match(row.issue, /不影响 RSS 主链路验收/);
});

test('treats 36kr newsflash snippets as accepted shallow-reading items', () => {
  const row = buildGoldenRow({
    id: '36kr-newsflash',
    title: '腾讯混元Hy3正式发布',
    sourceId: 743,
    sourceName: '36kr',
    sourceTier: 'B',
    sourceReadingTier: 'light_reading',
    url: 'https://36kr.com/newsflashes/123456789',
    aiScore: 90.41,
    snippet: '腾讯混元3D生成模型发布，适合放入快扫动态，不应伪装成长文深读。',
    contentReadiness: {
      status: 'degraded',
      label: '摘要片段',
    },
    translationAction: 'open_original',
  }, DEFAULT_SCENARIOS.find((item) => item.id === 'snippet_or_title_only'), 'http://localhost');

  assert.equal(row.status, 'pass');
  assert.match(row.issue, /浅阅读短讯/);
  assert.match(row.acceptanceChecks, /噪声降级/);
});

test('keeps non-flash snippets as content debt', () => {
  const row = buildGoldenRow({
    id: 'thin-longform',
    title: 'A longform post that lost its body',
    sourceId: 789,
    sourceName: 'Daring Fireball',
    url: 'https://daringfireball.net/2026/07/example',
    aiScore: 76,
    snippet: 'Only the RSS lead survived.',
    translationAction: 'fetch_then_translate',
  }, DEFAULT_SCENARIOS.find((item) => item.id === 'snippet_or_title_only'), 'http://localhost');

  assert.equal(row.status, 'review');
  assert.match(row.issue, /正文不足/);
});

test('renders markdown matrix without raw enum as the primary user explanation', () => {
  const rows = selectGoldenRows(fixtureItems, DEFAULT_SCENARIOS, { baseWebUrl: 'http://localhost' });
  const markdown = renderGoldenMarkdown({
    rows,
    generatedAt: '2026-06-17T00:00:00.000Z',
    apiBaseUrl: 'fixture',
    itemCount: fixtureItems.length,
  });

  assert.match(markdown, /# 信息中枢 V3 黄金样本验收矩阵/);
  assert.match(markdown, /固定验收/);
  assert.match(markdown, /补正文后翻译/);
  assert.match(markdown, /缺样本/);
  assert.doesNotMatch(markdown, /translationBasis/);
});

test('selects focused sources for user-relevant golden samples', () => {
  const sources = [
    { id: 1, name: 'Anthropic Newsroom' },
    { id: 2, name: 'BestBlogs Daily Brief' },
    { id: 3, name: 'V2EX - 交易' },
    { id: 4, name: 'John D. Cook' },
    { id: 5, name: 'Email Inbox', sourceType: 'email' },
    { id: 6, name: 'Changedetection AI', sourceType: 'webpage' },
  ];

  assert.deepEqual(selectFocusedSources(sources).map((source) => source.id), [1, 2, 4, 5, 6]);
});

test('dedupes focused and latest item pools by stable id', () => {
  assert.deepEqual(dedupeItems([
    { id: 'a', title: 'first' },
    { id: 'a', title: 'duplicate' },
    { id: 'b', title: 'second' },
  ]).map((item) => item.title), ['first', 'second']);
});

test('prioritizes focused AI sources over noisy generic items for translation gaps', () => {
  const scenario = DEFAULT_SCENARIOS.find((item) => item.id === 'translation_gap');
  const noisy = {
    id: 'v2ex',
    title: '出售一个小玩具',
    sourceName: 'V2EX - 交易',
    aiScore: 42,
    snippet: '短文本',
  };
  const focused = {
    id: 'anthropic',
    title: 'Introducing Claude example',
    sourceName: 'anthropic_news',
    aiScore: 62,
    snippet: 'Short official news snippet',
    url: 'https://www.anthropic.com/news/example',
    contentEvidence: {
      primaryLayer: 'snippet',
      primaryLabel: '摘要片段',
      translationBasis: {
        reliableForFullTranslation: false,
      },
    },
  };

  assert.ok(scoreGoldenCandidate(focused, scenario) > scoreGoldenCandidate(noisy, scenario));
  const [row] = selectGoldenRows([noisy, focused], [scenario], { baseWebUrl: 'http://localhost' });
  assert.equal(row.itemId, 'anthropic');
});

test('selects email samples even when their evidence layer is readable text', () => {
  const scenario = DEFAULT_SCENARIOS.find((item) => item.id === 'email_newsletter');
  const emailItem = {
    id: 'email-readable',
    title: 'Long newsletter',
    sourceId: 1359,
    sourceName: 'Email Inbox',
    sourceType: 'email',
    contentEvidence: {
      primaryLayer: 'readableText',
      primaryLabel: '可读正文',
    },
  };

  assert.equal(scenario.match(emailItem), true);
  const [row] = selectGoldenRows([emailItem], [scenario], { baseWebUrl: 'http://localhost' });
  assert.equal(row.itemId, 'email-readable');
});

test('detects source-name to URL host mismatches', () => {
  const issue = detectSourceMappingIssue({
    sourceName: 'OpenAI',
    url: 'https://www.v2ex.com/t/1221000',
  });
  assert.match(issue, /来源映射异常/);
  assert.match(issue, /v2ex.com/);

  assert.equal(detectSourceMappingIssue({
    sourceName: 'OpenAI News',
    url: 'https://openai.com/news/example',
  }), '');
});

test('allows BestBlogs curated entries to point to external original hosts', () => {
  assert.equal(detectSourceMappingIssue({
    sourceName: 'BestBlogs Daily Brief',
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
    originalUrl: 'https://mp.weixin.qq.com/s/example',
    url: 'https://www.bestblogs.dev/article/example',
  }), '');
});

test('renders automatic diagnostics for missing samples and source mapping issues', () => {
  const diagnostics = buildMarkdownDiagnostics([
    { status: 'missing', scenario: '索引摘要条目', issue: '当前数据集中没有命中该场景的样本。' },
    { status: 'review', sourceName: 'OpenAI', title: 'bad source', issue: '来源映射异常：OpenAI 源实际指向 v2ex.com。' },
    { status: 'review', sourceName: '36kr', title: 'thin', issue: '正文不足，必须先补正文。' },
    { status: 'pass', sourceName: '36kr', title: 'flash', issue: '浅阅读短讯：保留为快扫动态。' },
  ]);

  assert.match(diagnostics.join('\n'), /黄金样本缺口/);
  assert.match(diagnostics.join('\n'), /来源映射异常/);
  assert.match(diagnostics.join('\n'), /正文债务/);
  assert.match(diagnostics.join('\n'), /浅阅读短讯/);
});

test('accepts multiple API tokens for cross-user golden samples', () => {
  const tokens = resolveTokensFromEnv({
    INFOHUB_TOKEN: 'single',
    INFOHUB_TOKENS: 'alpha, beta\\ngamma',
  });

  assert.deepEqual(tokens, ['single', 'alpha', 'beta', 'gamma']);
});

test('can load an access token from the shared Playwright login json', async () => {
  const tokenPath = join(tmpdir(), `infohub-golden-token-${Date.now()}.json`);
  await writeFile(tokenPath, JSON.stringify({ accessToken: 'token-from-login-json' }), 'utf8');
  try {
    assert.equal(await resolveTokenFromLoginJson(tokenPath), 'token-from-login-json');
  } finally {
    await rm(tokenPath, { force: true });
  }

  assert.equal(await resolveTokenFromLoginJson('/path/that/does/not/exist.json'), '');
});
