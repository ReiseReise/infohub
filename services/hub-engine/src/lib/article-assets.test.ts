import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARTICLE_ASSET_PROMPTS,
  buildArticleAssetPrompt,
  buildReadingAssetRecords,
  normalizeArticleAssetGenerationRequest,
  resolveArticleAssetSource,
  type ItemReadingAssetRecord,
} from './article-assets.js';

test('normalizes article asset requests to the five supported QA prompts', () => {
  assert.deepEqual(normalizeArticleAssetGenerationRequest({ type: 'qa', promptKey: 'key_points' }), {
    assetType: 'qa',
    promptKey: 'key_points',
    force: false,
  });
  assert.equal(ARTICLE_ASSET_PROMPTS.map((prompt) => prompt.key).join(','), 'key_points,evidence,assumptions,actions,angles');
  assert.throws(
    () => normalizeArticleAssetGenerationRequest({ type: 'qa', promptKey: 'unknown' }),
    /不支持的文章问题/,
  );
});

test('builds grounded article agent prompts from the best readable source', () => {
  const source = resolveArticleAssetSource({
    title: 'How I use LLMs',
    aiSummary: '这篇文章总结了资深工程师如何在日常工作中使用 LLM。',
    aiTranslation: '翻译内容',
    content: 'Long original content',
    snippet: 'Snippet',
  });
  const prompt = buildArticleAssetPrompt({
    promptKey: 'evidence',
    title: 'How I use LLMs',
    url: 'https://example.com/article',
    sourceName: 'Example Blog',
    source,
  });

  assert.equal(source.basis, 'summary');
  assert.match(prompt, /证据清单/);
  assert.match(prompt, /How I use LLMs/);
  assert.match(prompt, /只基于给定文章内容/);
  assert.match(prompt, /这篇文章总结了资深工程师如何在日常工作中使用 LLM/);
});

test('rejects asset generation when only a short title is available', () => {
  const source = resolveArticleAssetSource({
    title: '短标题',
    aiSummary: '',
    aiTranslation: '',
    content: '',
    snippet: '',
  });

  assert.equal(source.basis, 'title');
  assert.equal(source.canGenerate, false);
  assert.match(source.reason || '', /内容太短/);
});

test('maps saved item reading assets into reading asset records without exposing raw states', () => {
  const saved: ItemReadingAssetRecord[] = [
    {
      id: 2,
      itemId: 'item-1',
      assetType: 'qa',
      promptKey: 'actions',
      label: '行动建议',
      status: 'ready',
      basis: 'content',
      content: '1. 把这篇文章加入今日重点阅读。',
      preview: '把这篇文章加入今日重点阅读。',
      source: 'ai',
      modelName: 'test-model',
      createdAt: new Date('2026-06-11T08:00:00.000Z'),
      updatedAt: new Date('2026-06-11T08:00:00.000Z'),
      errorReason: null,
    },
  ];

  const assets = buildReadingAssetRecords(saved);

  assert.equal(assets[0].type, 'qa');
  assert.equal(assets[0].promptKey, 'actions');
  assert.equal(assets[0].label, '行动建议');
  assert.equal(assets[0].status, 'ready');
  assert.equal(assets[0].content, '1. 把这篇文章加入今日重点阅读。');
});
