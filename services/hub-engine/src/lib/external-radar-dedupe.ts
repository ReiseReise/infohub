const TRACKING_KEYS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'ref',
  'source',
  'fbclid',
  'gclid',
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeRadarArticleUrl(input?: string | null): string | null {
  const raw = String(input || '').trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_KEYS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return null;
  }
}

export function radarComparableUrl(input?: string | null): { normalized: string; queryless: string | null } | null {
  const normalized = normalizeRadarArticleUrl(input);
  if (!normalized) return null;
  const parsed = new URL(normalized);
  const queryless = parsed.search ? null : `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
  return { normalized, queryless };
}

export function mergeExternalRadarMetadata(input: {
  existing?: unknown;
  incoming?: unknown;
  provider: string;
  observedAt?: Date;
}): Record<string, unknown> {
  const existing = asRecord(input.existing);
  const incoming = asRecord(input.incoming);
  const currentRadars = asRecord(existing.externalRadars);
  return {
    ...existing,
    externalRadars: {
      ...currentRadars,
      [input.provider]: incoming,
    },
    externalRadarUpdatedAt: (input.observedAt || new Date()).toISOString(),
  };
}

