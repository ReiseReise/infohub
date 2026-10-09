import test from 'node:test';
import assert from 'node:assert/strict';

import { auditItemDetail, auditItemListRecord } from './audit_rss_link_content_matrix.mjs';

test('does not flag expected BestBlogs non-article curated summaries as medium link defects', () => {
  const source = {
    id: 1358,
    name: 'BestBlogs Daily Brief',
    sourceType: 'curated_index',
    collectorType: 'webpage_index',
  };
  const item = {
    id: 'bestblogs-video',
    sourceId: 1358,
    sourceName: 'BestBlogs Daily Brief',
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
    title: 'AI 智能体的持续学习：把失败转化为可验证、可持久的改进',
    url: 'https://www.bestblogs.dev/video/f7af312?utm_source=brief',
    originalUrl: '',
    contentEvidence: {
      primaryLayer: 'curatedSummary',
      primaryLabel: '榜单摘要',
    },
    contentReadiness: {
      label: '榜单摘要可读',
      status: 'rss_summary',
      fullTextAvailable: false,
      originalTextStatus: 'missing_original_url',
    },
    translationAction: 'open_original',
    translationStatus: 'pending',
  };

  const audit = auditItemListRecord(item, source, 'http://localhost');
  assert.deepEqual(audit.issues, []);
});

test('still flags BestBlogs article entries missing original links', () => {
  const source = {
    id: 1358,
    name: 'BestBlogs Daily Brief',
    sourceType: 'curated_index',
    collectorType: 'webpage_index',
  };
  const item = {
    id: 'bestblogs-article',
    sourceId: 1358,
    sourceName: 'BestBlogs Daily Brief',
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
    title: 'Article without resolved original link',
    url: 'https://www.bestblogs.dev/article/abc123?utm_source=brief',
    originalUrl: '',
    contentEvidence: {
      primaryLayer: 'curatedSummary',
      primaryLabel: '榜单摘要',
    },
    contentReadiness: {
      label: '榜单摘要可读',
      status: 'rss_summary',
      fullTextAvailable: false,
      originalTextStatus: 'missing_original_url',
    },
    translationAction: 'open_original',
    translationStatus: 'pending',
  };

  const audit = auditItemListRecord(item, source, 'http://localhost');
  assert.deepEqual(audit.issues.map((issue) => issue.type), [
    'item.original_url_missing_for_index',
    'display.index_metadata_reader_noise',
  ]);
});

test('does not flag RSS external-link summaries as host mismatch defects', () => {
  const source = {
    id: 786,
    name: 'daringfireball.net',
    sourceType: 'rss',
    collectorType: 'rss',
    config: {
      url: 'https://daringfireball.net/feeds/main',
    },
  };
  const item = {
    id: 'df-linked',
    sourceId: 786,
    sourceName: 'daringfireball.net',
    sourceType: 'rss',
    sourceCollectorType: 'rss',
    title: 'Fantastical 4.1.15 Adds Calendar Mirroring',
    url: 'https://flexibits.com/blog/example',
    contentEvidence: {
      primaryLayer: 'externalLinkSummary',
      primaryLabel: '外链摘要',
      translationBasis: {
        reliableForFullTranslation: false,
      },
    },
    contentReadiness: {
      label: '外链摘要可读',
      kind: 'external_link_summary',
      fullTextAvailable: false,
      originalTextStatus: 'pending_fetch',
    },
    translationAction: 'fetch_then_translate',
  };

  const audit = auditItemListRecord(item, source, 'http://localhost');
  assert.deepEqual(audit.issues, []);
});

test('does not flag convertible external-link HTML as raw reader risk', () => {
  const issues = auditItemDetail({
    id: 'df-linked',
    title: 'Fantastical 4.1.15 Adds Calendar Mirroring',
    sourceType: 'rss',
    content: '<p>Flexibits:</p><blockquote><p>Calendar Mirroring allows you to connect two calendars.</p></blockquote>',
    contentEvidence: {
      primaryLayer: 'externalLinkSummary',
    },
    contentReadiness: {
      kind: 'external_link_summary',
      fullTextAvailable: false,
    },
    translationStatus: 'skipped',
    translationAction: 'fetch_then_translate',
  });

  assert.deepEqual(issues, []);
});
