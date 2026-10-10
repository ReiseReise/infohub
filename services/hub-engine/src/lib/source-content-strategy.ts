export type SourceContentStrategy = 'feed_only' | 'smart' | 'full' | 'monitor_only';

const ALLOWED_SOURCE_CONTENT_STRATEGIES: SourceContentStrategy[] = ['feed_only', 'smart', 'full', 'monitor_only'];

export function normalizeSourceContentStrategy(value: unknown): SourceContentStrategy | null {
  const normalized = String(value || '').trim().toLowerCase();
  return ALLOWED_SOURCE_CONTENT_STRATEGIES.includes(normalized as SourceContentStrategy)
    ? normalized as SourceContentStrategy
    : null;
}

export function deriveSourceContentStrategy(input: {
  contentStrategy?: unknown;
  collectorType?: string | null;
  sourceType?: string | null;
  sourceRole?: string | null;
  processingProfile?: string | null;
}): SourceContentStrategy {
  const explicit = normalizeSourceContentStrategy(input.contentStrategy);
  if (explicit) return explicit;

  const collectorType = String(input.collectorType || '').trim().toLowerCase();
  const sourceRole = String(input.sourceRole || '').trim().toLowerCase();
  const processingProfile = String(input.processingProfile || '').trim().toLowerCase();
  const sourceType = String(input.sourceType || '').trim().toLowerCase();

  if (sourceRole === 'monitor' || collectorType === 'webpage' || collectorType === 'changedetection') {
    return 'monitor_only';
  }
  if (processingProfile === 'monitor') return 'monitor_only';
  if (processingProfile === 'full') return 'full';
  if (collectorType === 'webpage_index') return 'smart';
  if (processingProfile === 'smart') return 'smart';
  if (sourceType === 'curated_index') return 'smart';
  return 'smart';
}

export function withDerivedSourceContentStrategy<T extends Record<string, unknown>>(input: {
  config?: T | null;
  collectorType?: string | null;
  sourceType?: string | null;
  sourceRole?: string | null;
  processingProfile?: string | null;
  contentStrategy?: unknown;
}): T & { contentStrategy: SourceContentStrategy } {
  const baseConfig = { ...(input.config || {}) } as T & { contentStrategy?: unknown };
  const strategy = deriveSourceContentStrategy({
    contentStrategy: input.contentStrategy ?? baseConfig.contentStrategy,
    collectorType: input.collectorType,
    sourceType: input.sourceType,
    sourceRole: input.sourceRole,
    processingProfile: input.processingProfile,
  });
  return {
    ...baseConfig,
    contentStrategy: strategy,
  };
}

export function sourceContentStrategyLabel(strategy: SourceContentStrategy | string | null | undefined): string {
  switch (strategy) {
    case 'feed_only':
      return '仅信任订阅正文';
    case 'smart':
      return '智能补全文';
    case 'full':
      return '优先补全原文';
    case 'monitor_only':
      return '仅监控不补正文';
    default:
      return '内容策略';
  }
}
