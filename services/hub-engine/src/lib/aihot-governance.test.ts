import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AIHOT_DAILY_BUCKET_LABELS,
  classifyAihotDailyBucket,
  classifySourceKind,
  normalizeAuthorityWeight,
} from './aihot-governance.js';

test('classifies official first-party sources separately from generic rss', () => {
  assert.equal(classifySourceKind({
    name: 'OpenAI：官网动态',
    collectorType: 'rss',
    config: { url: 'https://openai.com/news/rss.xml' },
  }), 'official');

  assert.equal(classifySourceKind({
    name: 'Hugging Face：Blog',
    collectorType: 'rss',
    config: { url: 'https://huggingface.co/blog/feed.xml' },
  }), 'blog');
});

test('classifies x and wechat sources as candidate-only social signals', () => {
  assert.equal(classifySourceKind({
    name: 'X：Claude Devs (@ClaudeDevs)',
    sourceType: 'rsshub',
    collectorType: 'rsshub',
    config: { route: '/twitter/user/ClaudeDevs' },
  }), 'x');

  assert.equal(classifySourceKind({
    name: '机器之心',
    sourceType: 'wechat',
    collectorType: 'custom',
    category: '公众号爆文',
  }), 'wechat');
});

test('normalizes authority weight from AIHOT-style tiers', () => {
  assert.equal(normalizeAuthorityWeight(null, 'T1', 'official'), 1.28);
  assert.equal(normalizeAuthorityWeight(undefined, 'T1.5', 'x'), 1.08);
  assert.equal(normalizeAuthorityWeight(undefined, 'T2', 'wechat'), 0.88);
  assert.equal(normalizeAuthorityWeight(3, 'T1', 'official'), 2);
  assert.equal(normalizeAuthorityWeight(0.1, 'T2', 'media'), 0.35);
});

test('classifies daily report items into AIHOT five buckets', () => {
  assert.equal(classifyAihotDailyBucket({
    title: 'GPT-5.5 Instant 发布，推理速度提升',
    category: '产品更新',
    aiTags: ['模型发布'],
  }), 'model_releases');

  assert.equal(classifyAihotDailyBucket({
    title: 'Grok Web 正式推出 Connectors 功能',
    category: '产品更新',
    aiTags: ['MCP/工具'],
  }), 'product_updates');

  assert.equal(classifyAihotDailyBucket({
    title: 'OpenSearch-VL：多模态搜索智能体开源方案',
    category: '论文/研究',
    aiTags: ['arXiv'],
  }), 'research');

  assert.equal(classifyAihotDailyBucket({
    title: '如何让 Claude Code 更稳定地完成长任务',
    category: '教程/实践',
    aiTags: ['编码'],
  }), 'tips');

  assert.equal(AIHOT_DAILY_BUCKET_LABELS.industry, '行业动态');
});
