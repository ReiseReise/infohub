import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chooseBestFeedContent,
  mergePrefetchedFullText,
  resolveBestBlogsRssOriginalUrlFromHtml,
  resolveFeedEntryUrl,
  resolveRssFeedTimeoutMs,
} from './rss.js';

test('uses a bounded source-aware timeout for RSS feed parsing', () => {
  assert.equal(resolveRssFeedTimeoutMs({ sourceTier: 'B', processingProfile: 'brief', config: {} }), 30_000);
  assert.equal(resolveRssFeedTimeoutMs({ sourceTier: 'A', processingProfile: 'smart', config: {} }), 60_000);
  assert.equal(resolveRssFeedTimeoutMs({ sourceTier: 'S', processingProfile: 'full', config: {} }), 90_000);
  assert.equal(resolveRssFeedTimeoutMs({
    sourceTier: 'A',
    processingProfile: 'smart',
    config: { url: 'https://www.bestblogs.dev/rss' },
  }), 120_000);
  assert.equal(resolveRssFeedTimeoutMs({
    sourceTier: 'B',
    processingProfile: 'brief',
    config: { feedTimeoutMs: 500_000 },
  }), 180_000);
});

test('prefers the article link over an enclosure when both are present', () => {
  const result = resolveFeedEntryUrl({
    link: 'https://example.com/episodes/42',
    enclosure: {
      url: 'https://cdn.example.com/episodes/42.mp3',
      type: 'audio/mpeg',
    },
  });

  assert.deepEqual(result, {
    url: 'https://example.com/episodes/42',
    basis: 'entry_link',
  });
});

test('uses the audio enclosure for podcast feeds without item links', () => {
  const result = resolveFeedEntryUrl({
    guid: '1c09f3a7-5b2a-4ac5-aa68-3def19bd64c2',
    enclosure: {
      url: 'https://traffic.megaphone.fm/episode-42.mp3?updated=1',
      type: 'audio/mpeg',
    },
  });

  assert.deepEqual(result, {
    url: 'https://traffic.megaphone.fm/episode-42.mp3?updated=1',
    basis: 'media_enclosure',
  });
});

test('does not turn a non-http guid into a fake article url', () => {
  const result = resolveFeedEntryUrl({ guid: 'episode-42' });

  assert.deepEqual(result, {
    url: '',
    basis: 'missing',
  });
});

test('chooses Atom summary when it is the only substantial article body', () => {
  const result = chooseBestFeedContent({
    contentEncoded: undefined,
    content: '',
    contentSnippet: '',
    summary: '<p>Claude Fable 5 release notes with concrete developer observations and safety caveats.</p>'.repeat(80),
  });

  assert.equal(result.field, 'summary');
  assert.match(result.content, /Claude Fable 5 release notes/);
  assert.ok(result.textLength > 2000);
});

test('prefers clean article summary over sponsored page chrome', () => {
  const result = chooseBestFeedContent({
    contentEncoded: undefined,
    content: 'Sponsored by: Cloud provider identity platform. Register here. '.repeat(80),
    contentSnippet: '',
    summary: '<p>After two days of experience with Claude Fable 5, the model behaves proactively and uses tools aggressively.</p>'.repeat(45),
  });

  assert.equal(result.field, 'summary');
  assert.doesNotMatch(result.content, /^Sponsored by:/);
});

test('keeps content:encoded when it carries the richest structured body', () => {
  const result = chooseBestFeedContent({
    contentEncoded: '<p>Compilers operate on one function at a time.</p><pre><code>class Point</code></pre>'.repeat(60),
    content: '<p>Short duplicate excerpt.</p>',
    contentSnippet: 'Short duplicate excerpt.',
    summary: '<p>Compilers operate on one function at a time.</p>'.repeat(5),
  });

  assert.equal(result.field, 'contentEncoded');
  assert.match(result.content, /<pre><code>class Point/);
});

test('trims malformed RSS continuation blocks before scoring feed content', () => {
  const result = chooseBestFeedContent({
    description: [
      '36氪获悉，算力芯片概念震荡走强，寒武纪涨超10%创历史新高。',
      '```###',
      '[沪深两市成交额突破1.5万亿元](https://36kr.com/newsflashes/next)',
      '36氪获悉，沪深两市成交额突破1.5万亿元。',
    ].join('\n'),
    contentSnippet: '36氪获悉，算力芯片概念震荡走强。',
  });

  assert.equal(result.field, 'description');
  assert.match(result.content, /寒武纪涨超10%/);
  assert.doesNotMatch(result.content, /沪深两市成交额|newsflashes\/next|```###/);
});

test('preserves readability content when prefetched full text wins over short RSS excerpt', () => {
  const longReadableArticle = [
    'A year after writing about quaternions, the author revisits the topic with Claude and Lean.',
    '',
    'He uses Lean to verify two rotation-matrix theorems and compare the generated proof artifacts with the original Python implementation.',
    '',
    'The important detail is that the article mixes ordinary prose, list structure, and formal theorem snippets, which makes readability preservation critical for downstream translation and summarization.',
    '',
    '- Column norms equal 1.',
    '- Column orthogonality equals 0.',
    '',
    '```lean',
    'theorem col0_norm : Rᵀ * R = I := by',
    '  nlinarith',
    '```',
  ].join('\n');
  const merged = mergePrefetchedFullText(
    '<p>Short feed excerpt.</p>',
    {
      title: 'Quaternion Rotations, Claude, and Lean',
      content: longReadableArticle,
      readabilityContent: longReadableArticle,
      fetchEngine: 'readability',
      renderMode: 'article',
      blockedReason: null,
    },
  );

  assert.match(merged.content, /quaternions, the author revisits the topic/i);
  assert.match(merged.readabilityContent || '', /```lean/);
  assert.equal(merged.fetchEngine, 'readability');
  assert.equal(merged.renderMode, 'article');
});

test('resolves BestBlogs RSS detail pages to the original article url', () => {
  const html = `
    <script>
      self.__next_f.push([1, "12:[\\"$\\",\\"article\\",null,{\\"resource\\":{\\"articleUrl\\":\\"https:\\\\/\\\\/www.theverge.com\\\\/ai-artificial-intelligence\\\\/946725\\\\/anthropic-releases-claude-fable-5\\"}}]"]);
    </script>
  `;

  const resolved = resolveBestBlogsRssOriginalUrlFromHtml(
    html,
    'https://www.bestblogs.dev/article/3c377648?utm_source=rss&utm_medium=feed',
  );

  assert.equal(resolved, 'https://www.theverge.com/ai-artificial-intelligence/946725/anthropic-releases-claude-fable-5');
});
