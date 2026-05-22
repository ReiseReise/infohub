export type DailyReportFunnel = {
  newItems: number;
  eligibleItems: number;
  filteredItems: number;
  filteredBucketItems: number;
  reviewItems: number;
  pendingItems: number;
  scopeMatched?: number;
  scoredCandidates?: number;
  reviewCandidates?: number;
  softFilteredRecovered?: number;
  scoreFailedCandidates?: number;
  latestFallbackCandidates?: number;
  translationPending?: number;
  translationFailed?: number;
  finalCandidates?: number;
};

export type DailyReportFilterReasonCount = {
  reason: string;
  count: number;
};

export type EmptyDailyReportDiagnosis = {
  status: 'empty_diagnosis';
  funnel: DailyReportFunnel;
  markdown: string;
  topFilterReasons: DailyReportFilterReasonCount[];
};

export function buildEmptyDailyReportDiagnosis(input: DailyReportFunnel & {
  topFilterReasons?: DailyReportFilterReasonCount[];
}): EmptyDailyReportDiagnosis {
  const topFilterReasons = (input.topFilterReasons || [])
    .filter((entry) => entry.reason && entry.count > 0)
    .slice(0, 5);
  const reasonLines = topFilterReasons.length > 0
    ? topFilterReasons.map((entry) => `- ${entry.reason}：${entry.count} 条`)
    : ['- 暂无可归因的过滤原因，请检查过滤状态字段与质量规则日志。'];

  const markdown = [
    '# 信息中枢日报空结果诊断',
    '',
    `今日新增 ${input.newItems} 条，但可入报内容为 ${input.eligibleItems} 条。`,
    '',
    '## 数据漏斗',
    '',
    `- 可入报内容：${input.eligibleItems} 条`,
    input.finalCandidates != null ? `- 最终候选：${input.finalCandidates} 条` : '',
    input.scopeMatched != null ? `- 匹配日报范围：${input.scopeMatched} 条` : '',
    input.scoredCandidates != null ? `- 高分精选：${input.scoredCandidates} 条` : '',
    input.reviewCandidates != null ? `- 低分复核候选：${input.reviewCandidates} 条` : '',
    input.softFilteredRecovered != null ? `- 软过滤恢复候选：${input.softFilteredRecovered} 条` : '',
    input.scoreFailedCandidates != null ? `- 评分失败候选：${input.scoreFailedCandidates} 条` : '',
    input.translationFailed != null ? `- 翻译失败/未中文化：${input.translationFailed} 条` : '',
    `- 主流程待复核：${input.reviewItems} 条`,
    `- 已过滤标记：${input.filteredItems} 条`,
    `- 过滤池内容：${input.filteredBucketItems} 条`,
    `- 待处理/待补全：${input.pendingItems} 条`,
    '',
    '## 主要过滤原因',
    '',
    ...reasonLines,
    '',
    '## 下一步建议',
    '',
    '- 先检查过滤字段是否一致，避免内容既不在 Feed 也不在过滤池。',
    '- 再查看最低分阈值和信源等级权重，确认是否把今日内容整体挡掉。',
  ].filter((line) => line !== '').join('\n');

  const funnel: DailyReportFunnel = {
    newItems: input.newItems,
    eligibleItems: input.eligibleItems,
    filteredItems: input.filteredItems,
    filteredBucketItems: input.filteredBucketItems,
    reviewItems: input.reviewItems,
    pendingItems: input.pendingItems,
  };
  if (input.scopeMatched != null) funnel.scopeMatched = input.scopeMatched;
  if (input.scoredCandidates != null) funnel.scoredCandidates = input.scoredCandidates;
  if (input.reviewCandidates != null) funnel.reviewCandidates = input.reviewCandidates;
  if (input.softFilteredRecovered != null) funnel.softFilteredRecovered = input.softFilteredRecovered;
  if (input.scoreFailedCandidates != null) funnel.scoreFailedCandidates = input.scoreFailedCandidates;
  if (input.latestFallbackCandidates != null) funnel.latestFallbackCandidates = input.latestFallbackCandidates;
  if (input.translationPending != null) funnel.translationPending = input.translationPending;
  if (input.translationFailed != null) funnel.translationFailed = input.translationFailed;
  if (input.finalCandidates != null) funnel.finalCandidates = input.finalCandidates;

  return {
    status: 'empty_diagnosis',
    funnel,
    markdown,
    topFilterReasons,
  };
}
