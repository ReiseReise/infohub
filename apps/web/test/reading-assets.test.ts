import test from 'node:test';
import assert from 'node:assert/strict';

test('orders reading assets for reader-first tabs and hides missing assets from badges', async () => {
  const mod = await import('../src/lib/reading-assets.ts');
  const assets = mod.getVisibleReadingAssets([
    { type: 'translation', label: '翻译', status: 'pending', source: 'ai', preview: '等待翻译' },
    { type: 'summary', label: '摘要', status: 'ready', source: 'ai', preview: '一段摘要' },
    { type: 'knowledge', label: '知识', status: 'missing', source: 'system' },
    { type: 'feedback', label: '人类反馈', status: 'ready', source: 'human', preview: '已标记：值得重点关注' },
  ]);

  assert.deepEqual(assets.map((asset) => asset.type), ['summary', 'translation', 'feedback']);
  assert.equal(mod.describeReadingAssetStatus(assets[0]), '已生成');
  assert.equal(mod.describeReadingAssetStatus(assets[1]), '待生成');
});

test('provides fixed article agent prompts with copyable user-facing wording', async () => {
  const mod = await import('../src/lib/reading-assets.ts');

  assert.deepEqual(mod.ARTICLE_AGENT_PROMPTS.map((prompt) => prompt.key), [
    'key_points',
    'evidence',
    'assumptions',
    'actions',
    'angles',
  ]);
  assert.equal(mod.ARTICLE_AGENT_PROMPTS[0].title, '总结要点');
  assert.match(mod.buildArticleAgentPrompt('actions', 'How I use LLMs', '这篇文章讨论工程师如何使用 LLM。'), /行动建议/);
  assert.match(mod.buildArticleAgentPrompt('actions', 'How I use LLMs', '这篇文章讨论工程师如何使用 LLM。'), /How I use LLMs/);
});

test('orders saved QA assets by article agent prompt and finds them by prompt key', async () => {
  const mod = await import('../src/lib/reading-assets.ts');
  const assets = mod.getVisibleReadingAssets([
    { type: 'qa', promptKey: 'actions', label: '行动建议', status: 'ready', source: 'ai', preview: '建议先读' },
    { type: 'qa', promptKey: 'key_points', label: '总结要点', status: 'ready', source: 'ai', preview: '核心变化' },
    { type: 'qa', promptKey: 'evidence', label: '证据清单', status: 'failed', source: 'ai', preview: '模型失败' },
  ]);

  assert.deepEqual(assets.map((asset) => asset.promptKey), ['key_points', 'evidence', 'actions']);
  assert.equal(mod.findArticleAgentAsset(assets, 'actions')?.label, '行动建议');
});

test('formats daily report article asset references as user-facing labels', async () => {
  const mod = await import('../src/lib/reading-assets.ts');

  assert.equal(mod.formatArticleAssetReferenceLabel({ promptKey: 'key_points', label: '' }), '总结要点');
  assert.equal(mod.formatArticleAssetReferenceLabel({ promptKey: 'evidence', label: '证据清单' }), '证据清单');
  assert.equal(mod.formatArticleAssetReferenceLabel({ promptKey: 'actions', label: '' }), '行动建议');
});
