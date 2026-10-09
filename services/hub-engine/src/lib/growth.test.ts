import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCE_TIERS,
  normalizeSourceTier,
  resolveItemGrowthAxis,
} from './growth.js';

test('authority tiers expose only the current S-to-D scale', () => {
  assert.deepEqual(SOURCE_TIERS, ['S', 'A', 'B', 'C', 'D']);
});

test('legacy T tiers are read-compatible but normalize into S-to-D', () => {
  assert.equal(normalizeSourceTier('T1'), 'S');
  assert.equal(normalizeSourceTier('T1.5'), 'A');
  assert.equal(normalizeSourceTier('T2'), 'B');
  assert.equal(normalizeSourceTier('invalid'), 'B');
});

test('explicit growth axes keep one stable primary axis and the rest as secondary tags', () => {
  assert.deepEqual(resolveItemGrowthAxis({
    growthAxes: ['商业判断', '认知升级', '商业判断'],
    title: '新模型工程发布',
  }), {
    primaryAxis: '商业判断',
    secondaryAxes: ['认知升级'],
    allAxes: ['商业判断', '认知升级'],
    mappingSource: 'explicit',
  });
});

test('inferred growth axes choose the strongest weighted signal as primary', () => {
  const result = resolveItemGrowthAxis({
    title: 'Agent API 工程框架与模型部署',
    aiSummary: '这也会影响公司的商业定价和市场策略。',
  });
  assert.equal(result.primaryAxis, '技术能力');
  assert.deepEqual(result.secondaryAxes, ['认知升级', '商业判断']);
  assert.equal(result.mappingSource, 'inferred');
});

test('items without explicit or keyword evidence are visible as fallback mappings', () => {
  assert.deepEqual(resolveItemGrowthAxis({ title: '今日简讯' }), {
    primaryAxis: '认知升级',
    secondaryAxes: [],
    allAxes: ['认知升级'],
    mappingSource: 'fallback',
  });
});

test('legacy cognitive-only defaults yield to stronger article evidence', () => {
  const result = resolveItemGrowthAxis({
    growthAxes: ['认知升级'],
    title: 'LLM Agent API 工程部署实践',
  });
  assert.equal(result.primaryAxis, '技术能力');
  assert.ok(result.secondaryAxes.includes('认知升级'));
  assert.equal(result.mappingSource, 'inferred');
});
