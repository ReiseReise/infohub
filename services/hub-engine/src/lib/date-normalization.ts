const DATE_KEYS = [
  'isoDate',
  'pubDate',
  'publishedAt',
  'published_at',
  'published',
  'dc:date',
  'dcDate',
  'date',
  'created_at',
  'createdAt',
  'created',
  'updated_at',
  'updatedAt',
  'updated',
] as const;

const MIN_YEAR = 1990;
const MAX_FUTURE_MS = 3 * 24 * 60 * 60 * 1000;

function parseDateValue(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (typeof value === 'number') {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}

export function isReasonablePublishedDate(date?: Date | null): date is Date {
  if (!date || Number.isNaN(date.getTime())) return false;
  if (date.getUTCFullYear() < MIN_YEAR) return false;
  if (date.getTime() > Date.now() + MAX_FUTURE_MS) return false;
  return true;
}

export function normalizePublishedDate(value: unknown): Date | undefined {
  const parsed = parseDateValue(value);
  if (!isReasonablePublishedDate(parsed)) return undefined;
  return parsed;
}

export function resolvePublishedDate(raw: Record<string, unknown>): Date | undefined {
  for (const key of DATE_KEYS) {
    const parsed = normalizePublishedDate(raw[key]);
    if (parsed) return parsed;
  }
  return undefined;
}
