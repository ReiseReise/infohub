export interface SourceScopeLike {
  id: number;
  name: string;
  category?: string | null;
  sourceTier?: string | null;
  config?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getSourceScopeUrl(source: Pick<SourceScopeLike, 'config'>): string | null {
  const config = asRecord(source.config);
  const candidates = [
    config.url,
    config.feedUrl,
    config.rssUrl,
    config.xmlUrl,
    config.webUrl,
    config.originalUrl,
  ];
  for (const candidate of candidates) {
    const text = cleanText(candidate);
    if (text) return text;
  }
  return null;
}

function sameName(a: string, b: string): boolean {
  return cleanText(a).toLowerCase() === cleanText(b).toLowerCase();
}

export function findEquivalentSourceScope<T extends SourceScopeLike>(
  requested: SourceScopeLike | null | undefined,
  candidates: T[],
): T | null {
  if (!requested) return null;
  const requestedUrl = getSourceScopeUrl(requested);
  if (requestedUrl) {
    return candidates.find((candidate) => getSourceScopeUrl(candidate) === requestedUrl) || null;
  }
  return candidates.find((candidate) => sameName(candidate.name, requested.name)) || null;
}
