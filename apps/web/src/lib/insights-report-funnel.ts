import type { InsightRecord } from './api/contracts';

type DailyReportSnapshot = NonNullable<NonNullable<InsightRecord['payload']>['snapshot']>;

export type DailyReportFunnelCard = {
  key: string;
  label: string;
  value: number;
  tone: 'ok' | 'warning' | 'neutral';
  description: string;
};

function asCount(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toneForDebt(value: number): DailyReportFunnelCard['tone'] {
  return value > 0 ? 'warning' : 'neutral';
}

export function buildDailyReportSnapshotFunnelCards(snapshot?: DailyReportSnapshot | null, itemCount = 0): DailyReportFunnelCard[] {
  const candidateFunnel = snapshot?.candidateFunnel;
  const reportFunnel = snapshot?.reportFunnel;
  const todayNew = asCount(candidateFunnel?.todayNew, asCount(reportFunnel?.newItems, asCount(snapshot?.newItems, itemCount)));
  const filteredBucketItems = asCount(reportFunnel?.filteredBucketItems, asCount(reportFunnel?.filteredItems));
  const mainVisible = asCount(candidateFunnel?.mainVisible, Math.max(todayNew - filteredBucketItems, 0));
  const scopeMatched = asCount(candidateFunnel?.scopeMatched, asCount(reportFunnel?.eligibleItems));
  const scoredCandidates = asCount(candidateFunnel?.scoredCandidates, asCount(reportFunnel?.eligibleItems));
  const reviewCandidates = asCount(candidateFunnel?.reviewCandidates, asCount(reportFunnel?.reviewItems));
  const fallbackScoredCandidates = asCount(candidateFunnel?.fallbackScoredCandidates);
  const scoreFailedCandidates = asCount(candidateFunnel?.scoreFailedCandidates);
  const latestFallbackCandidates = asCount(candidateFunnel?.latestFallbackCandidates);
  const translationFailed = asCount(candidateFunnel?.translationFailed);
  const pendingItems = asCount(reportFunnel?.pendingItems);
  const finalCandidates = asCount(candidateFunnel?.finalCandidates, asCount(reportFunnel?.eligibleItems));

  return [
    {
      key: 'todayNew',
      label: '今日新增',
      value: todayNew,
      tone: 'neutral',
      description: '本地自然日内进入系统的全部条目。',
    },
    {
      key: 'mainVisible',
      label: '主流程可见',
      value: mainVisible,
      tone: 'ok',
      description: '通过硬过滤后仍留在主流程的全天内容池。',
    },
    {
      key: 'scopeMatched',
      label: '匹配范围',
      value: scopeMatched,
      tone: 'neutral',
      description: '命中日报分类、关键词、信源等级和候选策略的条目。',
    },
    {
      key: 'scoredCandidates',
      label: '高分候选',
      value: scoredCandidates,
      tone: 'ok',
      description: '达到精选分并可作为日报主体的候选。',
    },
    {
      key: 'reviewCandidates',
      label: '低分复核',
      value: reviewCandidates,
      tone: toneForDebt(reviewCandidates),
      description: '低分但仍需要人工复核的候选。',
    },
    {
      key: 'fallbackScoredCandidates',
      label: '低置信兜底',
      value: fallbackScoredCandidates,
      tone: toneForDebt(fallbackScoredCandidates),
      description: '只有确定性兜底或模型熔断评分的质量债。',
    },
    {
      key: 'scoreFailedCandidates',
      label: '评分失败',
      value: scoreFailedCandidates,
      tone: toneForDebt(scoreFailedCandidates),
      description: '仍未拿到可信评分的候选。',
    },
    {
      key: 'latestFallbackCandidates',
      label: '最新兜底',
      value: latestFallbackCandidates,
      tone: toneForDebt(latestFallbackCandidates),
      description: '高分不足时按最新可见内容补位的候选。',
    },
    {
      key: 'translationFailed',
      label: '翻译失败',
      value: translationFailed,
      tone: toneForDebt(translationFailed),
      description: '入报前未成功中文化的条目。',
    },
    {
      key: 'filteredBucketItems',
      label: '被过滤',
      value: filteredBucketItems,
      tone: toneForDebt(filteredBucketItems),
      description: '进入过滤池的条目数量。',
    },
    {
      key: 'pendingItems',
      label: '待处理',
      value: pendingItems,
      tone: toneForDebt(pendingItems),
      description: '正文、质检或 AI 阶段尚未准备好的条目。',
    },
    {
      key: 'finalCandidates',
      label: '最终入报',
      value: finalCandidates,
      tone: finalCandidates > 0 ? 'ok' : 'warning',
      description: '最终进入本次日报正文的候选。',
    },
  ];
}
