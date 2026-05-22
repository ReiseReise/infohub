export type RuleRoutingInput = {
  passed: boolean;
  reason?: string | null;
  contentStatus?: string | null;
  aiScore?: number | null;
};

export type RuleRoutingState = {
  isFiltered: boolean;
  filterBucket: 'main' | 'filtered';
  qualityDecision: 'pass' | 'review' | 'filter';
  filterReason: string | null;
  priorityScoreMode: 'calculated' | 'provisional' | 'clear';
};

export function resolveRuleRoutingState(input: RuleRoutingInput): RuleRoutingState {
  if (input.passed) {
    return {
      isFiltered: false,
      filterBucket: 'main',
      qualityDecision: 'pass',
      filterReason: null,
      priorityScoreMode: 'calculated',
    };
  }

  const reason = input.reason || '命中过滤规则';
  if (input.contentStatus !== 'ready') {
    return {
      isFiltered: false,
      filterBucket: 'main',
      qualityDecision: 'review',
      filterReason: `待复核：${reason}`,
      priorityScoreMode: input.aiScore != null ? 'provisional' : 'clear',
    };
  }

  return {
    isFiltered: true,
    filterBucket: 'filtered',
    qualityDecision: 'filter',
    filterReason: reason,
    priorityScoreMode: 'clear',
  };
}
