import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSubscriptionPackageSourcePayload,
  listSubscriptionPackages,
  loadSubscriptionPackage,
} from './subscription-packages.js';

test('lists follow and hn popular blogs subscription packages from git-tracked fixtures', async () => {
  const packages = await listSubscriptionPackages();
  const bySlug = new Map(packages.map((pkg) => [pkg.slug, pkg]));

  assert.equal(bySlug.get('follow')?.sourceCount, 452);
  assert.equal(bySlug.get('hn-popular-blogs')?.sourceCount, 92);
  assert.deepEqual(bySlug.get('follow')?.tierSummary, { A: 43, B: 375, C: 34 });
  assert.deepEqual(bySlug.get('hn-popular-blogs')?.tierSummary, { A: 92 });
  assert.equal(bySlug.get('follow')?.categoryDefault, 'follow');
  assert.equal(bySlug.get('hn-popular-blogs')?.categoryDefault, 'hn-popular-blogs');
});

test('loads the follow package and keeps OPML categories intact', async () => {
  const feeds = await loadSubscriptionPackage('follow');

  assert.equal(feeds.length, 452);
  assert.equal(feeds[0].title, 'Arlmy | 素生');
  assert.equal(feeds[0].category, 'Blog');
});

test('maps bundled package feeds to conservative tiered source payloads', () => {
  const followAi = buildSubscriptionPackageSourcePayload('follow', {
    title: 'AI Sample',
    xmlUrl: 'https://example.com/ai.xml',
    htmlUrl: 'https://example.com',
    category: 'AI',
    type: 'rss',
  });
  const followSkim = buildSubscriptionPackageSourcePayload('follow', {
    title: 'Skim Sample',
    xmlUrl: 'https://example.com/skim.xml',
    htmlUrl: 'https://example.com',
    category: '浅阅读 | 扫读',
    type: 'rss',
  });
  const hn = buildSubscriptionPackageSourcePayload('hn-popular-blogs', {
    title: 'simonwillison.net',
    xmlUrl: 'https://simonwillison.net/atom/everything/',
    htmlUrl: 'https://simonwillison.net',
    category: 'Blogs',
    type: 'rss',
  });

  assert.equal(followAi.sourceTier, 'A');
  assert.equal(followAi.processingProfile, 'smart');
  assert.equal(followAi.priority, 4);
  assert.equal(followAi.fetchInterval, 90);
  assert.deepEqual(followAi.tags, ['follow', 'follow:AI']);

  assert.equal(followSkim.sourceTier, 'C');
  assert.equal(followSkim.processingProfile, 'brief');
  assert.equal(followSkim.priority, 2);
  assert.equal(followSkim.fetchInterval, 360);

  assert.equal(hn.sourceTier, 'A');
  assert.equal(hn.category, 'hn-popular-blogs');
  assert.deepEqual(hn.growthAxes, ['技术能力', '认知升级']);
  assert.deepEqual(hn.tags, ['hn-popular-blogs']);
});
