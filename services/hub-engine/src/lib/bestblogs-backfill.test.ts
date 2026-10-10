import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBestBlogsOriginalUrlPatch } from './bestblogs-backfill.js';

test('buildBestBlogsOriginalUrlPatch creates a provenance patch for resolved BestBlogs external links', () => {
  const patch = buildBestBlogsOriginalUrlPatch({
    itemUrl: 'https://www.bestblogs.dev/article/7689c9e4?utm_source=brief',
    curationUrl: null,
    curationSource: null,
    curationMeta: { briefDate: '2026-07-06' },
    resolvedOriginalUrl: 'https://ekinertac.com/blog/i-dont-know-rust-my-ai-is-rewriting-php-in-it/',
    resolvedAt: new Date('2026-07-06T08:00:00.000Z'),
  });

  assert.deepEqual(patch, {
    originalUrl: 'https://ekinertac.com/blog/i-dont-know-rust-my-ai-is-rewriting-php-in-it/',
    curationUrl: 'https://www.bestblogs.dev/article/7689c9e4?utm_source=brief',
    curationSource: 'BestBlogs Daily Brief',
    curationMeta: {
      briefDate: '2026-07-06',
      originalUrl: 'https://ekinertac.com/blog/i-dont-know-rust-my-ai-is-rewriting-php-in-it/',
      originalUrlBackfilledAt: '2026-07-06T08:00:00.000Z',
      originalUrlResolvedBy: 'bestblogs-backfill-detail-html',
    },
  });
});

test('buildBestBlogsOriginalUrlPatch rejects unresolved or BestBlogs-internal urls', () => {
  assert.equal(buildBestBlogsOriginalUrlPatch({
    itemUrl: 'https://www.bestblogs.dev/article/abc',
    curationUrl: null,
    curationSource: null,
    curationMeta: null,
    resolvedOriginalUrl: null,
  }), null);

  assert.equal(buildBestBlogsOriginalUrlPatch({
    itemUrl: 'https://www.bestblogs.dev/article/abc',
    curationUrl: null,
    curationSource: null,
    curationMeta: null,
    resolvedOriginalUrl: 'https://www.bestblogs.dev/en/article/abc',
  }), null);
});
