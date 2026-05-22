import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasCaptureMetadata,
  normalizeCaptureIngestItem,
  resolveIngestSourceDefaults,
} from './capture-inbox.js';

test('normalizes Obsidian article captures without losing highlights and notes', () => {
  const normalized = normalizeCaptureIngestItem({
    title: 'Agent 工程长文',
    url: 'https://example.com/agent-engineering',
    guid: 'capture:obsidian:agent-engineering',
    content: '# Agent 工程长文\n\n原文 Markdown 正文。',
    snippet: '这是我手动标出的关键段落。',
    author: 'Example Author',
    publishedAt: '2026-05-19T09:00:00.000Z',
    captureTool: 'obsidian',
    captureKind: 'article_capture',
    userNotes: '我的判断：这篇适合进入 Agent 专题。',
    attachmentPaths: ['/vault/clips/agent-engineering.md'],
  });

  assert.equal(normalized.title, 'Agent 工程长文');
  assert.equal(normalized.url, 'https://example.com/agent-engineering');
  assert.equal(normalized.guid, 'capture:obsidian:agent-engineering');
  assert.equal(normalized.sourceType, 'custom');
  assert.equal(normalized.snippet, '这是我手动标出的关键段落。');
  assert.equal(normalized.author, 'Example Author');
  assert.equal(normalized.publishedAt?.toISOString(), '2026-05-19T09:00:00.000Z');
  assert.match(normalized.content || '', /## 用户笔记/);
  assert.match(normalized.content || '', /我的判断：这篇适合进入 Agent 专题。/);
  assert.match(normalized.content || '', /## 附件/);
  assert.match(normalized.content || '', /\/vault\/clips\/agent-engineering\.md/);
  assert.match(normalized.content || '', /capture_tool: obsidian/);
  assert.match(normalized.content || '', /capture_kind: article_capture/);
});

test('normalizes Zotero references as reference captures with attachment paths', () => {
  const normalized = normalizeCaptureIngestItem({
    title: 'Attention Is All You Need',
    url: 'zotero://select/library/items/ABC123',
    content: '论文笔记正文。',
    captureTool: 'zotero',
    captureKind: 'reference_capture',
    userNotes: '重点看 Transformer 架构和引用链。',
    attachmentPaths: ['/Zotero/storage/ABC123/paper.pdf'],
  });

  assert.equal(normalized.guid, 'capture:zotero:zotero-select-library-items-abc123');
  assert.equal(normalized.sourceType, 'custom');
  assert.match(normalized.content || '', /capture_kind: reference_capture/);
  assert.match(normalized.content || '', /\/Zotero\/storage\/ABC123\/paper\.pdf/);
  assert.equal(normalized.snippet, '重点看 Transformer 架构和引用链。');
});

test('resolves Capture Inbox source defaults only for capture payloads', () => {
  assert.equal(hasCaptureMetadata({ title: '普通 webhook', url: 'https://example.com' }), false);
  assert.equal(hasCaptureMetadata({ title: '剪藏', url: 'https://example.com', captureTool: 'manual' }), true);

  assert.deepEqual(resolveIngestSourceDefaults(true), {
    name: 'Capture Inbox',
    category: 'capture',
    config: { inboxKind: 'capture' },
  });
  assert.deepEqual(resolveIngestSourceDefaults(false), {
    name: 'Webhook Ingest',
    category: 'webhook',
    config: {},
  });
});
