export type FetchTriggerMode = 'sync' | 'queue';

export type FetchJobTimeoutContext = {
  processingProfile?: string | null;
  sourceTier?: string | null;
  config?: Record<string, unknown> | null;
};

export function resolveFetchTriggerMode(input: {
  collectorType?: string | null;
  requestedMode?: string | null;
}): FetchTriggerMode {
  const requested = String(input.requestedMode || '').trim().toLowerCase();
  if (requested === 'async' || requested === 'queue' || requested === 'queued') return 'queue';
  if (requested === 'sync') return 'sync';

  const collectorType = String(input.collectorType || '').trim().toLowerCase();
  if (collectorType === 'webpage' || collectorType === 'webpage_index' || collectorType === 'changedetection') return 'queue';
  return 'sync';
}

export function resolveFetchJobTimeoutMs(
  collectorType?: string | null,
  context: FetchJobTimeoutContext = {},
): number {
  const normalized = String(collectorType || '').trim().toLowerCase();
  if (normalized === 'webpage' || normalized === 'webpage_index' || normalized === 'changedetection') return 60_000;
  if (normalized === 'rsshub') return 45_000;
  if (normalized !== 'rss') return 30_000;

  const profile = String(context.processingProfile || '').trim().toLowerCase();
  const tier = String(context.sourceTier || '').trim().toUpperCase();
  const feedUrl = String(context.config?.url || '').trim().toLowerCase();

  // RSS parsing has its own 30s guard. High-value feeds then prefetch several
  // article bodies, each with a bounded native/rendered extraction attempt.
  // The outer job guard must cover that whole bounded batch or it will report
  // a false timeout while the collector is still finishing in the background.
  if (feedUrl.includes('bestblogs.dev')) return 240_000;
  if (profile === 'full' || tier === 'S') return 240_000;
  if (profile === 'smart' || tier === 'A') return 180_000;
  return 60_000;
}
