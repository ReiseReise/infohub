import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDailyReportState,
  canViewSystemAiUsage,
  summarizeDailyUsageRows,
} from './daily-workbench-metrics.js';

test('allows only admins to view system-wide AI usage', () => {
  assert.equal(canViewSystemAiUsage('admin'), true);
  assert.equal(canViewSystemAiUsage('user'), false);
  assert.equal(canViewSystemAiUsage(null), false);
  assert.equal(canViewSystemAiUsage(undefined), false);
});

test('summarizes daily report agent usage without mixing system-wide usage', () => {
  const summary = summarizeDailyUsageRows([
    { status: 'success', calls: 2, inputTokens: 100, outputTokens: 40, estimatedCost: 0.01, errorMessage: null },
    { status: 'error', calls: 1, inputTokens: 10, outputTokens: 0, estimatedCost: 0, errorMessage: 'model 500' },
  ]);

  assert.equal(summary.calls, 3);
  assert.equal(summary.totalTokens, 150);
  assert.equal(summary.estimatedCost, 0.01);
  assert.deepEqual(summary.byStatus, [
    { key: 'success', count: 2 },
    { key: 'error', count: 1 },
  ]);
  assert.deepEqual(summary.hotspotErrors, [{ key: 'model 500', count: 1 }]);
});

test('marks saved report stale when candidate preview is newer than the report', () => {
  const state = buildDailyReportState({
    generatedAt: '2026-06-11T08:00:00.000Z',
    previewGeneratedAt: '2026-06-11T09:30:00.000Z',
    itemCount: 12,
  });

  assert.equal(state.status, 'stale');
  assert.equal(state.label, '日报已过期');
  assert.equal(state.itemCount, 12);
});

test('does not mark a report stale merely because the preview was computed later', () => {
  const state = buildDailyReportState({
    generatedAt: '2026-06-11T09:00:00.000Z',
    previewGeneratedAt: '2026-06-11T09:30:00.000Z',
    candidateDataUpdatedAt: '2026-06-11T08:45:00.000Z',
    itemCount: 12,
    qualityStatus: 'full',
  });

  assert.equal(state.status, 'full');
  assert.equal(state.label, '高质量日报');
});

test('marks a report stale when candidate data actually changed after generation', () => {
  const state = buildDailyReportState({
    generatedAt: '2026-06-11T09:00:00.000Z',
    previewGeneratedAt: '2026-06-11T09:30:00.000Z',
    candidateDataUpdatedAt: '2026-06-11T09:15:00.000Z',
    itemCount: 12,
    qualityStatus: 'full',
  });

  assert.equal(state.status, 'stale');
  assert.match(state.reason, /候选数据晚于已保存日报/);
});

test('keeps degraded quality visible even when the report also needs refresh', () => {
  const state = buildDailyReportState({
    generatedAt: '2026-06-11T08:00:00.000Z',
    previewGeneratedAt: '2026-06-11T09:30:00.000Z',
    itemCount: 12,
    qualityStatus: 'degraded',
    qualityReason: '最终融合原始输出未通过质量门禁，当前内容经过自动修补。',
  });

  assert.equal(state.status, 'degraded');
  assert.equal(state.label, '降级日报（需刷新）');
  assert.match(state.reason, /质量门禁/);
  assert.match(state.reason, /建议重新生成/);
});
