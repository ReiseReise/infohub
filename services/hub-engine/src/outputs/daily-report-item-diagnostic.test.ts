import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDailyReportItemDiagnostic,
  buildDailyReportItemDiagnosticFromSnapshot,
  ensureDailyReportDiagnosticTargetRows,
  type DailyReportItemDiagnosticPreparation,
} from './daily-report-item-diagnostic.js';

const preparation: DailyReportItemDiagnosticPreparation = {
  finalCandidates: [{
    id: 'selected-1',
    title: 'OpenAI 发布 Agent 工作流更新',
    selectionMode: 'scored',
    selectionReason: '达到精选分 82 >= 60；分类 AI；有产品/技术/产业直接信号。',
  }],
  reviewCandidates: [{
    id: 'fallback-1',
    title: 'Running Python code in a sandbox with MicroPython and WASM',
    selectionMode: 'review',
    selectionReason: '低置信兜底评分待复核：deterministic_fallback。',
  }],
  latestFallbackCandidates: [{
    id: 'latest-1',
    title: '低分但同范围最新条目',
    selectionMode: 'latest_visible',
    selectionReason: '未达到精选分 60，作为同范围最新兜底入报。',
  }],
  excluded: [
    {
      id: 'fallback-1',
      title: 'Running Python code in a sandbox with MicroPython and WASM',
      reason: 'fallback_scored',
      detail: '低置信兜底评分只进入复核诊断，不进入最终日报候选；请先回收评分。',
    },
    {
      id: 'noise-1',
      title: '富途老虎长桥之后，华盛证券也将清理内地业务',
      reason: 'business_noise',
      detail: '泛商业、行情或公告类内容不进入日报复核/兜底候选',
    },
  ],
};

test('explains items selected into the daily report', () => {
  const diagnostic = buildDailyReportItemDiagnostic('selected-1', preparation);

  assert.equal(diagnostic.status, 'selected');
  assert.equal(diagnostic.label, '已进入日报');
  assert.equal(diagnostic.tone, 'ok');
  assert.match(diagnostic.reason, /达到精选分/);
  assert.match(diagnostic.action, /TOP 入报理由/);
});

test('prioritizes excluded fallback scoring over review candidate presence', () => {
  const diagnostic = buildDailyReportItemDiagnostic('fallback-1', preparation);

  assert.equal(diagnostic.status, 'excluded');
  assert.equal(diagnostic.excludedReason, 'fallback_scored');
  assert.equal(diagnostic.label, '未入报：低置信评分');
  assert.equal(diagnostic.tone, 'danger');
  assert.match(diagnostic.action, /重跑评分/);
});

test('explains high scoring business noise with a concrete action', () => {
  const diagnostic = buildDailyReportItemDiagnostic('noise-1', preparation);

  assert.equal(diagnostic.status, 'excluded');
  assert.equal(diagnostic.excludedReason, 'business_noise');
  assert.equal(diagnostic.label, '未入报：泛商业噪声');
  assert.equal(diagnostic.tone, 'warning');
  assert.match(diagnostic.action, /反馈/);
});

test('explains scoped candidates that are not selected into final top items', () => {
  const diagnostic = buildDailyReportItemDiagnostic('latest-1', preparation);

  assert.equal(diagnostic.status, 'latest_visible');
  assert.equal(diagnostic.label, '同范围最新兜底');
  assert.equal(diagnostic.tone, 'warning');
  assert.match(diagnostic.reason, /最新兜底/);
});

test('returns a neutral diagnostic when the item is outside the prepared report window', () => {
  const diagnostic = buildDailyReportItemDiagnostic('missing-1', preparation);

  assert.equal(diagnostic.status, 'not_in_window');
  assert.equal(diagnostic.label, '未进入本次日报候选池');
  assert.equal(diagnostic.tone, 'neutral');
  assert.match(diagnostic.action, /日报工作流/);
});

test('prepends the target row when bounded sampling misses the detail item', () => {
  const rows = [{ id: 'top-1' }, { id: 'top-2' }];
  const merged = ensureDailyReportDiagnosticTargetRows(rows, [{ id: 'target-1' }], 'target-1');

  assert.deepEqual(merged.map((row) => row.id), ['target-1', 'top-1', 'top-2']);
});

test('does not duplicate the target row when it is already sampled', () => {
  const rows = [{ id: 'top-1' }, { id: 'target-1' }];
  const merged = ensureDailyReportDiagnosticTargetRows(rows, [{ id: 'target-1' }], 'target-1');

  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((row) => row.id), ['top-1', 'target-1']);
});

test('builds diagnostics from a generated report snapshot top item', () => {
  const diagnostic = buildDailyReportItemDiagnosticFromSnapshot('snapshot-top-1', {
    topItems: [{
      id: 'snapshot-top-1',
      title: '历史快照内的 TOP 内容',
      selectionMode: 'scored',
      selectionReason: '达到精选分 82 >= 60。',
    }],
    excludedCandidates: [],
  });

  assert.equal(diagnostic?.status, 'selected');
  assert.equal(diagnostic?.diagnosticBasis, 'insight_snapshot');
  assert.match(diagnostic?.reason || '', /82 >= 60/);
});

test('builds diagnostics from generated report snapshot exclusions instead of current rules', () => {
  const diagnostic = buildDailyReportItemDiagnosticFromSnapshot('snapshot-excluded-1', {
    topItems: [],
    excludedCandidates: [{
      id: 'snapshot-excluded-1',
      title: '历史快照排除内容',
      reason: 'not_selected',
      detail: '未达到精选分且未启用最新兜底',
    }],
  });

  assert.equal(diagnostic?.status, 'excluded');
  assert.equal(diagnostic?.excludedReason, 'not_selected');
  assert.equal(diagnostic?.label, '未入报：未达到候选门槛');
  assert.equal(diagnostic?.diagnosticBasis, 'insight_snapshot');
});
