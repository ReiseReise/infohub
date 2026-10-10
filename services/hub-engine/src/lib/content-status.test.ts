import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyCollectedContentStatus,
  classifyCollectedReadabilityState,
  classifyContentBasisFromLengths,
  contentStatusMessage,
} from './content-status.js';

test('classifies short RSS excerpts as degraded instead of ready', () => {
  const status = classifyCollectedContentStatus({
    content: 'AI startup announces a new product for developers with limited details in this RSS excerpt.',
    snippet: 'AI startup announces a new product for developers with limited details in this RSS excerpt.',
  });

  assert.equal(status, 'degraded');
  assert.match(contentStatusMessage(status) || '', /摘要片段/);
});

test('classifies substantial collected article text as ready', () => {
  const status = classifyCollectedContentStatus({
    content: '这是一段足够长的正文内容，用来模拟 RSS 或网页采集阶段已经拿到了完整文章。'.repeat(8),
    snippet: null,
  });

  assert.equal(status, 'ready');
  assert.equal(contentStatusMessage(status), null);
});

test('classifies empty collected text as missing', () => {
  const status = classifyCollectedContentStatus({ content: '', snippet: '' });

  assert.equal(status, 'missing');
  assert.match(contentStatusMessage(status) || '', /未获得正文缓存/);
});

test('classifies list content basis from stored text lengths without selecting full content', () => {
  assert.equal(classifyContentBasisFromLengths({ contentLength: 58073, snippetLength: 120 }), 'content');
  assert.equal(classifyContentBasisFromLengths({ contentLength: 172, snippetLength: 80 }), 'snippet');
  assert.equal(classifyContentBasisFromLengths({ contentLength: 0, snippetLength: 8 }), 'title');
});

test('marks collected items as readability ready when readable markdown is present', () => {
  const state = classifyCollectedReadabilityState({
    readabilityContent: 'This article has real readable markdown paragraphs. '.repeat(10),
    contentStatus: 'ready',
  });

  assert.deepEqual(state, {
    readabilityStatus: 'ready',
    readabilityReason: null,
  });
});

test('does not mark short readable excerpts as readability ready', () => {
  const state = classifyCollectedReadabilityState({
    readabilityContent: 'Short readable excerpt from a feed item. '.repeat(3),
    contentStatus: 'ready',
  });

  assert.deepEqual(state, {
    readabilityStatus: 'missing',
    readabilityReason: 'readability_not_available',
  });
});

test('keeps readiness but explains when collected article lacks readability layer', () => {
  const state = classifyCollectedReadabilityState({
    readabilityContent: null,
    contentStatus: 'ready',
  });

  assert.deepEqual(state, {
    readabilityStatus: 'missing',
    readabilityReason: 'readability_not_available',
  });
});
