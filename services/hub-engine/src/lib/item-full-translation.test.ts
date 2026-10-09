import assert from 'node:assert/strict';
import test from 'node:test';
import { humanizeFullTranslationError, shouldContinueFullTranslationWithExistingContent } from './item-full-translation.js';

test('continues full translation from long RSS content when webpage refetch fails', () => {
  const shouldContinue = shouldContinueFullTranslationWithExistingContent({
    title: 'AI hiring outpaces overall IT recruitment in India, report shows',
    content: '<p>Hiring for AI roles within India IT sector outpaced overall recruitment.</p>'.repeat(40),
    snippet: 'Hiring for AI roles within India IT sector outpaced overall recruitment.',
    readabilityContent: null,
    readabilityStatus: 'failed',
    sourceType: 'rss',
    sourceCollectorType: 'rss',
  }, '正文抓取未命中，当前仅保留摘要片段');

  assert.equal(shouldContinue, true);
});

test('does not continue full translation from index summaries when original refetch fails', () => {
  const shouldContinue = shouldContinueFullTranslationWithExistingContent({
    title: 'BestBlogs index item',
    content: '## 榜单摘要\n\nThis is a curated index summary. '.repeat(80),
    snippet: 'This is a curated index summary.',
    readabilityContent: null,
    readabilityStatus: 'failed',
    sourceType: 'curated_index',
    sourceCollectorType: 'webpage_index',
  }, '正文抓取未命中，当前仅保留摘要片段');

  assert.equal(shouldContinue, false);
});

test('turns provider and queue failures into actionable translation messages', () => {
  assert.equal(
    humanizeFullTranslationError('primary_translation_failed: Audio internal LLM API error: 500; fallback_translation_failed: model_request_timeout'),
    '翻译模型暂时不可用，系统已尝试备用模型但仍未完成。请稍后重试，或检查翻译模型配置。',
  );
  assert.equal(
    humanizeFullTranslationError('译文没有完整保留原文链接结构。'),
    '模型返回的译文不完整，系统没有把它当作完整译文保存。请重新翻译或更换模型。',
  );
});
