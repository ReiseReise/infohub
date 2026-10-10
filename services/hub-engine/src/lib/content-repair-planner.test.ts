import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContentRepairApplyPatch,
  buildContentRepairPlan,
  summarizeContentRepairPlan,
  validateContentRepairApplyOptions,
} from './content-repair-planner.js';

test('plans a conservative downgrade for short readability rows marked ready', () => {
  const plan = buildContentRepairPlan([{
    id: 'item-short-readable',
    title: 'Short readable false ready',
    sourceName: 'Example Source',
    sourceType: 'rss',
    sourceKind: 'rss',
    collectorType: 'rss',
    contentStatus: 'ready',
    readabilityStatus: 'ready',
    readabilityReason: null,
    readabilityContent: 'Too short to be treated as a real full article.',
    content: 'This feed item has a longer content field that may still be usable as an RSS summary. '.repeat(4),
    snippet: 'Short summary.',
  }]);

  assert.equal(plan.length, 1);
  assert.equal(plan[0].action, 'downgrade_short_readability');
  assert.equal(plan[0].severity, 'high');
  assert.equal(plan[0].plannedPatch.readabilityStatus, 'missing');
  assert.equal(plan[0].plannedPatch.readabilityReason, 'readability_too_short');
  assert.equal(plan[0].metrics.readabilityLength < 180, true);
});

test('plans malformed feed continuation trimming without changing unrelated rows', () => {
  const dirty = [
    '36氪获悉，算力芯片概念震荡走强，寒武纪涨超10%创历史新高。',
    '```###',
    '[沪深两市成交额突破1.5万亿元](https://36kr.com/newsflashes/next)',
    '36氪获悉，沪深两市成交额突破1.5万亿元。',
  ].join('\n');

  const plan = buildContentRepairPlan([
    {
      id: 'item-dirty',
      title: '算力芯片概念震荡走强',
      sourceName: '36kr',
      sourceType: 'rss',
      sourceKind: 'rss',
      collectorType: 'rss',
      contentStatus: 'ready',
      readabilityStatus: 'missing',
      readabilityReason: null,
      readabilityContent: null,
      content: dirty,
      snippet: dirty,
    },
    {
      id: 'item-clean',
      title: 'Clean article',
      sourceName: 'Clean Source',
      sourceType: 'rss',
      sourceKind: 'rss',
      collectorType: 'rss',
      contentStatus: 'ready',
      readabilityStatus: 'missing',
      readabilityReason: null,
      readabilityContent: null,
      content: 'This is a normal article body without malformed continuation markers. '.repeat(8),
      snippet: 'Normal article.',
    },
  ]);

  assert.equal(plan.length, 1);
  assert.equal(plan[0].itemId, 'item-dirty');
  assert.equal(plan[0].action, 'trim_malformed_feed_continuation');
  assert.equal(plan[0].plannedPatch.content, '36氪获悉，算力芯片概念震荡走强，寒武纪涨超10%创历史新高。');
  assert.equal(plan[0].plannedPatch.snippet, '36氪获悉，算力芯片概念震荡走强，寒武纪涨超10%创历史新高。');
});

test('summarizes planned repairs by action and severity for dry-run output', () => {
  const plan = buildContentRepairPlan([
    {
      id: 'item-short-readable',
      title: 'Short readable false ready',
      sourceName: 'Example Source',
      sourceType: 'rss',
      sourceKind: 'rss',
      collectorType: 'rss',
      contentStatus: 'ready',
      readabilityStatus: 'ready',
      readabilityReason: null,
      readabilityContent: 'short',
      content: 'Long enough article text. '.repeat(20),
      snippet: 'summary',
    },
    {
      id: 'item-dirty',
      title: 'Dirty RSS continuation',
      sourceName: '36kr',
      sourceType: 'rss',
      sourceKind: 'rss',
      collectorType: 'rss',
      contentStatus: 'ready',
      readabilityStatus: 'missing',
      readabilityReason: null,
      readabilityContent: null,
      content: '第一条短讯。\n```###\n第二条短讯。',
      snippet: '第一条短讯。\n```###\n第二条短讯。',
    },
  ]);

  const summary = summarizeContentRepairPlan(plan);

  assert.equal(summary.total, 2);
  assert.equal(summary.byAction.downgrade_short_readability, 1);
  assert.equal(summary.byAction.trim_malformed_feed_continuation, 1);
  assert.equal(summary.bySeverity.high, 1);
  assert.equal(summary.bySeverity.medium, 1);
});

test('rejects unsafe apply without a narrow item or source scope', () => {
  assert.deepEqual(validateContentRepairApplyOptions({
    apply: true,
    itemId: null,
    sourceId: null,
    limit: 20,
  }), {
    ok: false,
    reason: 'apply_requires_item_or_source_scope',
  });
});

test('rejects unsafe apply when limit is too broad', () => {
  assert.deepEqual(validateContentRepairApplyOptions({
    apply: true,
    itemId: null,
    sourceId: 743,
    limit: 80,
  }), {
    ok: false,
    reason: 'apply_limit_too_large',
    maxLimit: 50,
  });
});

test('allows scoped apply within the safe batch limit', () => {
  assert.deepEqual(validateContentRepairApplyOptions({
    apply: true,
    itemId: null,
    sourceId: 743,
    limit: 25,
  }), {
    ok: true,
  });
});

test('builds an apply patch that invalidates stale AI outputs after content repair', () => {
  const planItem = buildContentRepairPlan([{
    id: 'item-dirty',
    title: 'Dirty RSS continuation',
    sourceName: '36kr',
    sourceType: 'rss',
    sourceKind: 'rss',
    collectorType: 'rss',
    contentStatus: 'ready',
    readabilityStatus: 'ready',
    readabilityReason: null,
    readabilityContent: '第一条短讯。\n```###\n第二条短讯。',
    content: '第一条短讯。\n```###\n第二条短讯。',
    snippet: '第一条短讯。\n```###\n第二条短讯。',
  }]).find((item) => item.action === 'trim_malformed_feed_continuation');

  assert.ok(planItem);

  const patch = buildContentRepairApplyPatch(planItem);

  assert.equal(patch.content, '第一条短讯。');
  assert.equal(patch.snippet, '第一条短讯。');
  assert.equal(patch.readabilityContent, '第一条短讯。');
  assert.equal(patch.readabilityStatus, 'missing');
  assert.equal(patch.readabilityReason, 'readability_too_short');
  assert.equal(patch.contentStatus, 'degraded');
  assert.equal(patch.summaryStatus, 'pending');
  assert.equal(patch.summaryBasis, null);
  assert.equal(patch.summaryReason, 'content_repaired');
  assert.equal(patch.translationStatus, 'pending');
  assert.equal(patch.translationReason, 'content_repaired');
  assert.equal(patch.processingStatus, 'raw');
});
