import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDibaoOpml, checkDibaoStatus } from './dibao-integration.js';

test('buildDibaoOpml exports enabled RSS-like sources with escaping and dedupe', () => {
  const opml = buildDibaoOpml([
    {
      id: 1,
      name: 'AI & RSS <精选>',
      sourceType: 'rss',
      collectorType: 'rss',
      category: 'AI',
      sourceTier: 'A',
      status: 'active',
      config: {
        url: 'https://example.com/feed.xml?x=1&lang=zh',
        htmlUrl: 'https://example.com/blog?a=1&b=2',
      },
    },
    {
      id: 2,
      name: 'Duplicate Feed',
      sourceType: 'rss',
      collectorType: 'rss',
      category: 'AI',
      sourceTier: 'B',
      status: 'active',
      config: {
        url: 'https://example.com/feed.xml?x=1&lang=zh',
      },
    },
    {
      id: 3,
      name: 'RSSHub Route',
      sourceType: 'rsshub',
      collectorType: 'rsshub',
      category: '监控',
      sourceTier: 'B',
      status: 'active',
      config: {
        route: '/anthropic/news',
      },
    },
    {
      id: 4,
      name: 'Disabled',
      sourceType: 'rss',
      collectorType: 'rss',
      category: 'Other',
      sourceTier: 'C',
      status: 'paused',
      config: {
        url: 'https://disabled.example/rss',
      },
    },
    {
      id: 5,
      name: 'Web Snapshot',
      sourceType: 'webpage',
      collectorType: 'webpage',
      category: 'Other',
      sourceTier: 'C',
      status: 'active',
      config: {
        url: 'https://example.com',
      },
    },
  ], {
    ownerName: 'Reise 信息中枢',
    rsshubBaseUrl: 'http://rsshub:1200',
    generatedAt: new Date('2026-06-15T08:00:00.000Z'),
  });

  assert.match(opml, /<title>Reise 信息中枢 → Dibao<\/title>/);
  assert.match(opml, /text="AI &amp; RSS &lt;精选&gt;"/);
  assert.match(opml, /xmlUrl="https:\/\/example.com\/feed.xml\?x=1&amp;lang=zh"/);
  assert.match(opml, /htmlUrl="https:\/\/example.com\/blog\?a=1&amp;b=2"/);
  assert.match(opml, /xmlUrl="http:\/\/rsshub:1200\/anthropic\/news"/);
  assert.equal((opml.match(/example.com\/feed.xml/g) || []).length, 1);
  assert.doesNotMatch(opml, /Disabled/);
  assert.doesNotMatch(opml, /Web Snapshot/);
});

test('checkDibaoStatus returns unavailable instead of throwing when service is down', async () => {
  const status = await checkDibaoStatus({
    baseUrl: 'http://dibao.invalid.local',
    publicUrl: '/reader-lab/',
    fetchImpl: async () => {
      throw new Error('connection refused');
    },
  });

  assert.equal(status.available, false);
  assert.equal(status.publicUrl, '/reader-lab/');
  assert.equal(status.healthUrl, 'http://dibao.invalid.local/api/system/health');
  assert.match(status.message, /暂时无法访问/);
  assert.match(status.error || '', /connection refused/);
});

test('checkDibaoStatus reads nested Dibao health payload version', async () => {
  const status = await checkDibaoStatus({
    baseUrl: 'http://dibao-reader:8080',
    publicUrl: 'http://localhost:8082',
    fetchImpl: async () => new Response(JSON.stringify({
      data: {
        ok: true,
        database: 'ok',
        fts: 'ok',
        vectorStore: 'ok',
        version: '0.1.3',
      },
    }), { status: 200 }),
  });

  assert.equal(status.available, true);
  assert.equal(status.version, '0.1.3');
});
