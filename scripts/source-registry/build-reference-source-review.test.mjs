import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReferenceSourceReviewCsv } from './build-reference-source-review.mjs';

test('review csv keeps every catalog source, evidence URL, and manual decision', () => {
  const csv = buildReferenceSourceReviewCsv({
    sources: [
      {
        key: 'qmreader:example',
        name: 'Example, "quoted"',
        providerLabel: 'QMReader',
        channel: 'blog',
        sourceTier: 'A',
        readingTier: 'high_value',
        recommended: true,
        importMode: 'rss',
        observationStatus: 'current',
        feedUrl: 'https://example.com/feed.xml',
        siteUrl: 'https://example.com',
        provenance: { sourceUrl: 'https://github.com/example/source' },
        description: 'Line one\nLine two',
        notes: 'manual review',
      },
      {
        key: 'aihot:observed:example',
        name: 'Observed only',
        providerLabel: 'AI HOT',
        channel: 'wechat',
        recommended: false,
        importMode: 'reference_only',
        observationStatus: 'historical',
        provenance: { sourceUrl: 'https://aihot.example/items' },
      },
    ],
  }, {
    decisions: [{
      catalogKey: 'qmreader:example',
      decision: 'observing',
      runtimeStatus: 'shadow',
      formalSubscription: false,
      reason: 'seven-day observation',
    }],
  });

  const lines = csv.trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /"Example, ""quoted"""/);
  assert.match(lines[1], /"https:\/\/github.com\/example\/source"/);
  assert.match(lines[1], /"Line one Line two"/);
  assert.match(lines[1], /"observing","shadow","\u5426","seven-day observation"/);
  assert.match(lines[2], /"Observed only"/);
  assert.match(lines[2], /"undecided","","\u5426",""/);
});

test('review csv returns a header-only file for an empty catalog', () => {
  const csv = buildReferenceSourceReviewCsv({ sources: [] });
  assert.equal(csv.trimEnd().split('\n').length, 1);
  assert.match(csv, /"候选键","来源名称"/);
});
