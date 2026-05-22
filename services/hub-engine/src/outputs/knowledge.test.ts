import test from 'node:test';
import assert from 'node:assert/strict';

import { formatKnowledgeMarkdown } from './knowledge.js';

test('exports capture inbox content so highlights, notes, and attachments reach the knowledge hub', () => {
  const markdown = formatKnowledgeMarkdown({
    title: 'QA Capture',
    url: 'https://example.com/qa-capture',
    sourceName: 'Capture Inbox',
    category: 'capture',
    publishedAt: new Date('2026-05-19T10:00:00.000Z'),
    aiScore: 88,
    aiTags: ['capture'],
    sourceType: 'custom',
    aiSummary: 'AI 摘要不覆盖人工摘录。',
    aiTranslation: null,
    snippet: 'Manual highlight',
    content: '# 原文\n\n正文。\n\n## 用户笔记\n\n我的判断。\n\n## 附件\n\n- /vault/capture.md\n',
  });

  assert.match(markdown, /## 人工摘录/);
  assert.match(markdown, /Manual highlight/);
  assert.match(markdown, /## 剪藏正文/);
  assert.match(markdown, /## 用户笔记/);
  assert.match(markdown, /\/vault\/capture\.md/);
});

test('does not dump full non-capture article content into knowledge export', () => {
  const markdown = formatKnowledgeMarkdown({
    title: 'RSS Item',
    url: 'https://example.com/rss',
    sourceName: 'RSS',
    category: 'news',
    publishedAt: null,
    aiScore: null,
    aiTags: [],
    sourceType: 'rss',
    aiSummary: null,
    aiTranslation: null,
    snippet: 'RSS snippet',
    content: 'Long RSS body should stay out of the export.',
  });

  assert.doesNotMatch(markdown, /Long RSS body should stay out of the export/);
  assert.match(markdown, /RSS snippet/);
});
