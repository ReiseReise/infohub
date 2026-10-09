import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceConfig } from './base.js';
import {
  fetchOrigin12Provider,
  meaningfulModelChanges,
  mergeResearchPapers,
  parseAiNewsIssue,
  parseArxivAtom,
  parseModelLeaderboard,
  parseOpenRouterModels,
  parseResearchCandidates,
  parseSemiAnalysisFeed,
  parseTheBatchIssue,
  type ModelRealitySnapshot,
} from './origin12-providers.js';

function source(config: Record<string, unknown>): SourceConfig {
  return {
    id: 912,
    name: '源头信息员测试',
    sourceType: 'curated_index',
    collectorType: 'custom',
    sourceTier: 'A',
    processingProfile: 'brief',
    sourceRole: 'reference',
    config,
    category: 'AI',
    priority: 4,
    fetchInterval: 360,
    status: 'active',
  };
}

const AI_NEWS_HTML = `
  <main>
    <article><time datetime="2026-08-10T06:00:00Z"></time><a href="/issues/2026-08-10-agent-news">Agent news for August 10</a><p>Links to the official release and paper.</p></article>
    <article><a href="/issues/2026-08-09">Older issue</a></article>
  </main>`;

const THE_BATCH_HTML = `
  <section><article><time datetime="2026-08-06"></time><a href="/the-batch/issue-312/">The Batch issue 312</a><p>Why the change matters.</p></article></section>`;

const HF_HTML = `
  <main>
    <article><a href="https://huggingface.co/papers/2608.01234">Paper One</a></article>
    <article><a href="https://huggingface.co/papers/no-arxiv-id">Unidentified Paper</a></article>
  </main>`;

const ALPHAXIV_HTML = `
  <main>
    <article><a href="https://alphaxiv.org/abs/2608.01234">Paper One discussion</a></article>
    <article><a href="https://alphaxiv.org/paper/local-only">Local discussion without id</a></article>
  </main>`;

const ARXIV_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <id>http://arxiv.org/abs/2608.01234v2</id>
      <updated>2026-08-09T00:00:00Z</updated>
      <published>2026-08-08T00:00:00Z</published>
      <title>Paper One: A Source-Grounded Method</title>
      <summary>This is the abstract, not the full paper.</summary>
      <author><name>A. Researcher</name></author>
      <link href="https://arxiv.org/abs/2608.01234v2" rel="alternate" type="text/html"/>
      <link href="https://arxiv.org/pdf/2608.01234v2" title="pdf" type="application/pdf"/>
    </entry>
  </feed>`;

const ARENA_TABLE = `
  <table><thead><tr><th>Rank</th><th>Model</th><th>Elo score</th></tr></thead>
  <tbody><tr><td>1</td><td>Model A</td><td>1300</td></tr><tr><td>4</td><td>Model B</td><td>1260</td></tr></tbody></table>`;

const SEMIANALYSIS_FEED = `<?xml version="1.0"?><rss><channel>
  <item><title>Inside the next AI cluster</title><link>https://semianalysis.com/2026/08/cluster</link><description>Public feed summary. Subscribe for the full analysis.</description><pubDate>Sun, 09 Aug 2026 00:00:00 GMT</pubDate></item>
  </channel></rss>`;

test('AI News and The Batch adapters emit one stable issue item and label it as index material', () => {
  const aiNews = parseAiNewsIssue(AI_NEWS_HTML);
  const batch = parseTheBatchIssue(THE_BATCH_HTML);
  assert.ok(aiNews);
  assert.ok(batch);
  assert.equal(aiNews.guid, parseAiNewsIssue(AI_NEWS_HTML)?.guid);
  assert.equal(aiNews.curationMeta?.isPrimaryEvidence, false);
  assert.equal(batch.curationMeta?.contentKind, 'weekly_issue');
});

test('issue parsers ignore navigation, lookalike hosts and choose the newest issue', () => {
  const ai = parseAiNewsIssue(`
    <nav><a href="/issues/">issues</a><a href="https://not-smol.ai/issues/2026-09-07-fake">Fake issue</a></nav>
    <article><a href="/issues/2026-08-09-old">Earlier issue</a></article>
    <article><a href="/issues/2026-09-06-agents">Agent development</a></article>
  `);
  assert.equal(ai?.url, 'https://news.smol.ai/issues/2026-09-06-agents');
  const batch = parseTheBatchIssue(`
    <nav><a href="/the-batch/tag/letters">Andrew's Letter</a><a href="/the-batch/page/2/">Next</a></nav>
    <a href="https://not-deeplearning.ai/the-batch/issue-999/">Imitation</a>
    <article><a href="/the-batch/issue-312/">The Batch issue 312</a></article>
    <article><a href="/the-batch/issue-313/">The Batch issue 313</a></article>
  `);
  assert.equal(batch?.url, 'https://www.deeplearning.ai/the-batch/issue-313/');
  assert.equal(parseAiNewsIssue('<a href="/issues/">issues</a>'), null);
  assert.equal(parseTheBatchIssue('<a href="/the-batch/tag/letters">Letters</a>'), null);
});

test('research candidates only admit paper detail links and never borrow IDs from neighboring text', () => {
  const alpha = parseResearchCandidates(`
    <article>Related paper 2609.01234
      <a href="/@researcher">A Researcher</a>
      <a href="/pdf/2609.01234">View PDF10</a>
      <a href="/replicate/2609.01234">Autoresearch</a>
      <a href="https://not-alphaxiv.org/abs/2609.01234">Imitation</a>
      <a href="/abs/2609.01234?utm_source=home">A concrete research result</a>
      <a href="/abs/2609.01234v2">A concrete research result v2</a>
      <a href="/paper/local-only">Independent discussion</a>
    </article>`, 'alphaxiv', 'https://alphaxiv.org/');
  assert.deepEqual(alpha.map(({ title, arxivId }) => ({ title, arxivId })), [
    { title: 'A concrete research result', arxivId: '2609.01234' },
    { title: 'Independent discussion', arxivId: null },
  ]);
  const hf = parseResearchCandidates(`
    <a href="/papers/date/2026-09-03">Previous</a>
    <a href="/papers/trending">Trending</a>
    <a href="/papers/2609.01234#community">A concrete research result</a>
    <a href="https://example.org/papers/2609.04567">External</a>
  `, 'huggingface', 'https://huggingface.co/papers');
  assert.equal(hf.length, 1);
  assert.equal(hf[0].url, 'https://huggingface.co/papers/2609.01234');
});

test('The Batch reads accessible overlay links instead of returning the About menu', () => {
  const item = parseTheBatchIssue(`
    <nav><a href="/the-batch/about">About</a></nav>
    <article><div><a href="/the-batch/tag/sep-04-2026">Sep 04, 2026</a>
      <h2>Inside Key Changes in Data Policies</h2><p>A key AI engineering skill is using coding agents.</p></div>
      <a href="/the-batch/issue-369" aria-label="Inside Key Changes in Data Policies"></a>
    </article>`);
  assert.equal(item?.url, 'https://www.deeplearning.ai/the-batch/issue-369');
  assert.equal(item?.title, 'Inside Key Changes in Data Policies');
  assert.equal(item?.publishedAt?.toISOString().slice(0, 10), '2026-09-04');
});

test('an HTML page containing only navigation is a parse failure, not a successful article', async () => {
  const result = await fetchOrigin12Provider(source({ provider: 'origin12_ai_news' }), {
    fetchImpl: (async () => new Response('<nav><a href="/issues/">issues</a></nav>')) as typeof fetch,
  });
  assert.equal(result?.items.length, 0);
  assert.match(result?.error || '', /no_supported_issue_found/);
});

test('research radar merges the same arXiv paper across sites and never fuzzy-merges missing IDs', () => {
  const hf = parseResearchCandidates(HF_HTML, 'huggingface', 'https://huggingface.co/papers');
  const alpha = parseResearchCandidates(ALPHAXIV_HTML, 'alphaxiv', 'https://alphaxiv.org/');
  const papers = mergeResearchPapers([...hf, ...alpha], parseArxivAtom(ARXIV_ATOM));
  const merged = papers.find((item) => item.guid === 'origin12:paper:2608.01234');
  const unidentified = papers.filter((item) => String(item.guid).includes('2608.01234') === false);
  assert.ok(merged);
  assert.equal(papers.filter((item) => item.guid === 'origin12:paper:2608.01234').length, 1);
  assert.equal((merged.curationMeta?.researchEvidence as Record<string, unknown>).arxivId, '2608.01234');
  assert.equal(merged.curationMeta?.contentKind, 'abstract');
  assert.equal(merged.curationMeta?.isFullText, false);
  assert.equal(unidentified.length, 2);
  assert.equal(unidentified.every((item) => item.curationMeta?.contentKind === 'discovery_only'), true);
});

test('leaderboard parsers preserve metric provenance inputs without requiring API keys', () => {
  const arena = parseModelLeaderboard(ARENA_TABLE);
  const openRouter = parseOpenRouterModels(JSON.stringify({
    data: [
      { id: 'vendor/model-a', pricing: { prompt: '0.000001', completion: '0.000002' } },
      { id: 'vendor/model-b', pricing: { prompt: '0', completion: '0' } },
    ],
  }));
  assert.deepEqual(arena[0], { model: 'Model A', rank: 1, score: 1300, price: null, speed: null });
  assert.equal(openRouter[0].rank, 1);
  assert.equal(openRouter[0].price, 3);
});

test('model reality monitor ignores small changes and reports only locked thresholds', () => {
  const before: ModelRealitySnapshot = {
    capturedAt: '2026-08-09T00:00:00.000Z',
    arena: [{ model: 'Model A', rank: 1, score: 1300 }],
    artificialAnalysis: [{ model: 'Model A', rank: 1, score: 70, price: 2, speed: 100 }],
    openRouter: [{ model: 'Model A', rank: 1, price: 2 }],
  };
  const small: ModelRealitySnapshot = {
    capturedAt: '2026-08-10T00:00:00.000Z',
    arena: [{ model: 'Model A', rank: 2, score: 1301 }],
    artificialAnalysis: [{ model: 'Model A', rank: 2, score: 71, price: 2.1, speed: 110 }],
    openRouter: [{ model: 'Model A', rank: 2, price: 2.1 }],
  };
  assert.deepEqual(meaningfulModelChanges(before, small), []);

  const significant: ModelRealitySnapshot = {
    capturedAt: '2026-08-10T00:00:00.000Z',
    arena: [{ model: 'Model A', rank: 4, score: 1301 }, { model: 'Model B', rank: 1 }],
    artificialAnalysis: [{ model: 'Model A', rank: 4, score: 72, price: 2.2, speed: 120 }],
    openRouter: [{ model: 'Model A', rank: 4, price: 2.2 }],
  };
  const changes = meaningfulModelChanges(before, significant);
  assert.equal(changes.some((change) => change.kind === 'rank'), true);
  assert.equal(changes.some((change) => change.kind === 'top10_enter' && change.model === 'Model B'), true);
  assert.equal(changes.some((change) => change.kind === 'price'), true);
  assert.equal(changes.some((change) => change.kind === 'speed'), true);
  assert.equal(changes.some((change) => change.kind === 'score'), true);
});

test('SemiAnalysis adapter keeps only public feed metadata and an explicit paywall boundary', () => {
  const items = parseSemiAnalysisFeed(SEMIANALYSIS_FEED);
  assert.equal(items.length, 1);
  assert.equal(items[0].curationMeta?.paywallPolicy, 'public_metadata_only');
  assert.equal(items[0].curationMeta?.isFullText, false);
  assert.match(items[0].content || '', /Public feed summary/);
});

test('origin12 fetch persists ETag, component health and does not replay an unchanged issue', async () => {
  const first = await fetchOrigin12Provider(source({
    provider: 'origin12_ai_news',
    endpoints: { aiNews: 'https://news.smol.ai/' },
  }), {
    now: () => new Date('2026-08-10T08:00:00.000Z'),
    fetchImpl: (async () => new Response(AI_NEWS_HTML, { status: 200, headers: { etag: '"issue-1"' } })) as typeof fetch,
  });
  assert.ok(first);
  assert.equal(first.items.length, 1);
  const state = first.sourceConfigPatch?.componentState as Record<string, Record<string, unknown>>;
  const health = first.sourceConfigPatch?.componentHealth as Record<string, Record<string, unknown>>;
  assert.equal(state.aiNews.etag, '"issue-1"');
  assert.equal(health.aiNews.successRate, 1);

  const second = await fetchOrigin12Provider(source({
    provider: 'origin12_ai_news',
    endpoints: { aiNews: 'https://news.smol.ai/' },
    ...first.sourceConfigPatch,
  }), {
    now: () => new Date('2026-08-10T14:00:00.000Z'),
    fetchImpl: (async (_url, init) => {
      assert.equal(new Headers(init?.headers).get('if-none-match'), '"issue-1"');
      return new Response(null, { status: 304 });
    }) as typeof fetch,
  });
  assert.ok(second);
  assert.equal(second.items.length, 0);
  assert.equal(second.outcomeHint, 'no_change');
});

test('one failed component is retained as degraded health and cannot look fully healthy', async () => {
  const result = await fetchOrigin12Provider(source({
    provider: 'origin12_research_radar',
    endpoints: {
      huggingface: 'https://example.test/hf',
      alphaxiv: 'https://example.test/alpha',
      arxiv: 'https://example.test/arxiv',
    },
  }), {
    now: () => new Date('2026-08-10T08:00:00.000Z'),
    fetchImpl: (async (input) => {
      const url = String(input);
      if (url.includes('/alpha')) return new Response(null, { status: 429, headers: { 'retry-after': '60' } });
      if (url.includes('/arxiv')) return new Response(ARXIV_ATOM, { status: 200 });
      return new Response(HF_HTML, { status: 200 });
    }) as typeof fetch,
  });
  assert.ok(result);
  assert.match(result.error || '', /origin12_component_degraded/);
  const health = result.sourceConfigPatch?.componentHealth as Record<string, Record<string, unknown>>;
  assert.equal(health.alphaxiv.successRate, 0);
  assert.equal(health.huggingface.successRate, 1);
});

test('oversized cache entries discard old bodies and do not send unusable validators', async () => {
  const large = AI_NEWS_HTML.replace('2026-08-10-agent-news', '2026-09-06-agent-news') + ' '.repeat(513 * 1024);
  const first = await fetchOrigin12Provider(source({
    provider: 'origin12_ai_news',
    componentState: { aiNews: { requestUrl: 'https://news.smol.ai/', cachedBody: AI_NEWS_HTML, etag: 'old' } },
  }), { fetchImpl: (async () => new Response(large, { headers: { etag: 'new' } })) as typeof fetch });
  const states = first?.sourceConfigPatch?.componentState as Record<string, Record<string, unknown>>;
  assert.equal(states.aiNews.cachedBody, null);
  const second = await fetchOrigin12Provider(source({ provider: 'origin12_ai_news', ...first?.sourceConfigPatch }), {
    fetchImpl: (async (_input, init) => {
      assert.equal(new Headers(init?.headers).has('if-none-match'), false);
      return new Response(large);
    }) as typeof fetch,
  });
  assert.equal(second?.error, undefined);
  assert.equal(second?.outcomeHint, 'no_change');
});

test('a changed endpoint cannot reuse another resource body or validators', async () => {
  const result = await fetchOrigin12Provider(source({
    provider: 'origin12_ai_news',
    componentState: { aiNews: { requestUrl: 'https://news.smol.ai/old', cachedBody: AI_NEWS_HTML, etag: 'old' } },
  }), {
    fetchImpl: (async (_input, init) => {
      assert.equal(new Headers(init?.headers).has('if-none-match'), false);
      return new Response(null, { status: 304 });
    }) as typeof fetch,
  });
  assert.equal(result?.items.length, 0);
  assert.match(result?.error || '', /without_cache/);
});
