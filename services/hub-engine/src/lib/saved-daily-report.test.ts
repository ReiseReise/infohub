import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSavedDailyReportMarkdown, resolveSavedDailyReportMarkdownExport } from './saved-daily-report.js';

test('exports the persisted markdown without regenerating a daily report', () => {
  assert.equal(resolveSavedDailyReportMarkdown({
    payload: { markdown: '# 已保存日报\n\n正文。' },
    summary: '摘要',
  }), '# 已保存日报\n\n正文。');
});

test('falls back to the saved summary for legacy report rows', () => {
  assert.equal(resolveSavedDailyReportMarkdown({
    payload: {},
    summary: '旧版日报摘要',
  }), '旧版日报摘要');
});

test('allows Markdown export for a recomputed full saved report', () => {
  assert.deepEqual(resolveSavedDailyReportMarkdownExport({
    payload: {
      generationMode: 'full',
      qualityStatus: 'full',
      final: { meta: { status: 'ai', deliveryMode: 'model' } },
      markdown: '# 正式日报',
    },
  }), {
    status: 'full',
    httpStatus: 200,
    markdown: '# 正式日报',
  });
});

test('rejects degraded Markdown export with a conflict response contract', () => {
  const result = resolveSavedDailyReportMarkdownExport({
    payload: {
      generationMode: 'full',
      qualityStatus: 'degraded',
      qualityReasons: ['final_deterministic_fallback'],
      final: { meta: { status: 'ai', deliveryMode: 'deterministic' } },
      markdown: '# 降级草稿',
    },
  });

  assert.equal(result.status, 'degraded');
  assert.equal(result.httpStatus, 409);
  assert.match(result.error, /不能导出为正式 Markdown/);
});
