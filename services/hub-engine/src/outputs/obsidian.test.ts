import test from 'node:test';
import assert from 'node:assert/strict';

import { formatObsidianMarkdown } from './obsidian.js';

test('exports capture inbox content to Obsidian notes', () => {
  const markdown = formatObsidianMarkdown({
    title: 'Zotero Paper',
    url: 'zotero://select/library/items/ABC123',
    sourceName: 'Capture Inbox',
    category: 'capture',
    publishedAt: null,
    aiScore: null,
    aiTags: ['reference'],
    sourceType: 'custom',
    aiSummary: null,
    aiTranslation: null,
    transcript: null,
    knowledge: null,
    snippet: 'Manual highlight',
    content: '## 用户笔记\n\n重点看引用链。\n\n## 附件\n\n- /Zotero/storage/ABC123/paper.pdf\n',
  });

  assert.match(markdown, /## 人工摘录/);
  assert.match(markdown, /Manual highlight/);
  assert.match(markdown, /## 剪藏正文/);
  assert.match(markdown, /\/Zotero\/storage\/ABC123\/paper\.pdf/);
});
