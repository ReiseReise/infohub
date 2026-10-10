import test from 'node:test';
import assert from 'node:assert/strict';
import type { FeedItemRecord } from '../src/lib/api/contracts.ts';
import {
  getAiStatusMeta,
  getContentReadinessMeta,
  getFeedListPreview,
  normalizeAiSummary,
} from '../src/features/feed/presentation.ts';

function feedItem(overrides: Partial<FeedItemRecord> = {}): FeedItemRecord {
  return {
    id: 'item-1',
    title: '测试文章',
    url: 'https://example.com/item-1',
    sourceType: 'rss',
    isRead: false,
    isFavorite: false,
    ...overrides,
  };
}

test('normalizes structured AI summaries before rendering feed previews', () => {
  const summary = '这是一条有完整判断的摘要，用于验证列表预览不会直接显示 JSON 包装层。它会先说明文章的核心事实，再补充这些事实对个人阅读和决策的实际意义，最后以明确结论收束，避免停在半句话、提示词或者模型自述上，让用户在打开正文之前就能准确判断是否值得继续阅读。';
  const item = feedItem({ aiSummary: JSON.stringify({ summary }), summaryStatus: 'ready' });

  assert.equal(normalizeAiSummary(item.aiSummary), summary);
  assert.equal(getFeedListPreview(item)?.text, summary);
  assert.equal(getAiStatusMeta(item).label, '已摘要');
});

test('falls back to a user-facing warning for polluted feed previews', () => {
  const item = feedItem({
    aiSummary: '作为一个AI language model，请补充需要改写的摘要文本',
    snippet: '>>>>>>>>>>>>>>>>>>>>>>>>',
  });

  assert.match(getFeedListPreview(item)?.text || '', /抓取噪声/);
});

test('keeps content readiness wording compact in feed cards', () => {
  assert.deepEqual(getContentReadinessMeta(feedItem({
    contentReadiness: {
      status: 'full_text',
      label: '全文可读',
      basis: 'content',
      fullTextAvailable: true,
      action: '可以直接阅读。',
    },
  })), {
    label: '全文',
    className: 'bg-emerald-50 text-emerald-700',
  });
});
