export type CollectorFetchResultLike = {
  items?: unknown[] | null;
  error?: string | null;
};

export type CollectorFetchResultStatus = 'success' | 'degraded_success' | 'error';

export function classifyCollectorFetchResult(result: CollectorFetchResultLike): CollectorFetchResultStatus {
  const hasError = Boolean(String(result.error || '').trim());
  if (!hasError) return 'success';
  return (result.items?.length || 0) > 0 ? 'degraded_success' : 'error';
}
