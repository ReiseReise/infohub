import test from 'node:test';
import assert from 'node:assert/strict';

test('builds full daily report snapshot funnel cards from candidate and report funnel evidence', async () => {
  const mod = await import('../src/lib/insights-report-funnel.ts').catch(() => ({}));
  const buildDailyReportSnapshotFunnelCards = (mod as {
    buildDailyReportSnapshotFunnelCards?: (snapshot: unknown, itemCount?: number) => Array<{ label: string; value: number; tone: string }>;
  }).buildDailyReportSnapshotFunnelCards;

  assert.equal(typeof buildDailyReportSnapshotFunnelCards, 'function');

  const cards = buildDailyReportSnapshotFunnelCards({
    candidateFunnel: {
      todayNew: 223,
      mainVisible: 194,
      scopeMatched: 65,
      scoredCandidates: 18,
      reviewCandidates: 0,
      fallbackScoredCandidates: 0,
      scoreFailedCandidates: 2,
      latestFallbackCandidates: 12,
      translationFailed: 0,
      finalCandidates: 18,
    },
    reportFunnel: {
      newItems: 223,
      eligibleItems: 18,
      filteredItems: 29,
      filteredBucketItems: 24,
      reviewItems: 3,
      pendingItems: 4,
    },
  }, 223);

  assert.deepEqual(cards.map((card) => [card.label, card.value]), [
    ['今日新增', 223],
    ['主流程可见', 194],
    ['匹配范围', 65],
    ['高分候选', 18],
    ['低分复核', 0],
    ['低置信兜底', 0],
    ['评分失败', 2],
    ['最新兜底', 12],
    ['翻译失败', 0],
    ['被过滤', 24],
    ['待处理', 4],
    ['最终入报', 18],
  ]);
  assert.equal(cards.find((card) => card.label === '主流程可见')?.tone, 'ok');
  assert.equal(cards.find((card) => card.label === '评分失败')?.tone, 'warning');
});

test('falls back to legacy report funnel when generated report has no candidate funnel', async () => {
  const { buildDailyReportSnapshotFunnelCards } = await import('../src/lib/insights-report-funnel.ts');

  const cards = buildDailyReportSnapshotFunnelCards({
    reportFunnel: {
      newItems: 32,
      eligibleItems: 5,
      filteredItems: 7,
      filteredBucketItems: 6,
      reviewItems: 2,
      pendingItems: 1,
    },
  }, 32);

  assert.deepEqual(cards.map((card) => [card.label, card.value]), [
    ['今日新增', 32],
    ['主流程可见', 26],
    ['匹配范围', 5],
    ['高分候选', 5],
    ['低分复核', 2],
    ['低置信兜底', 0],
    ['评分失败', 0],
    ['最新兜底', 0],
    ['翻译失败', 0],
    ['被过滤', 6],
    ['待处理', 1],
    ['最终入报', 5],
  ]);
});
