type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const keys = Object.keys(value).sort();
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key] as JsonValue)}`);
  return `{${pairs.join(',')}}`;
}

function normalizeSearch(searchParams: URLSearchParams): string {
  const pairs = [...searchParams.entries()]
    .filter(([, v]) => v !== '')
    .sort(([aKey, aValue], [bKey, bValue]) => {
      if (aKey === bKey) return aValue.localeCompare(bValue);
      return aKey.localeCompare(bKey);
    });

  if (pairs.length === 0) return '';
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

export function normalizeHttpUrl(raw: string): string | undefined {
  if (!raw) return undefined;

  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const input = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(input);
    if (!parsed.hostname) return undefined;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;

    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port ? `:${parsed.port}` : '';
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    const qs = normalizeSearch(parsed.searchParams);
    return `${protocol}//${hostname}${port}${pathname}${qs ? `?${qs}` : ''}`;
  } catch {
    return undefined;
  }
}

export function normalizeRoute(route: string): string | undefined {
  if (!route) return undefined;
  const trimmed = route.trim();
  if (!trimmed) return undefined;

  const noSchema = trimmed.startsWith('rsshub://')
    ? trimmed.slice('rsshub://'.length)
    : trimmed;

  const normalized = `/${noSchema.replace(/^\/+/, '').replace(/\/{2,}/g, '/')}`;
  return normalized === '/' ? undefined : normalized;
}

export function normalizeCollectorType(value: string | undefined): string {
  const raw = (value || '').trim().toLowerCase();
  if (!raw) return 'rss';
  if (raw === 'atom') return 'rss';
  return raw;
}

export function buildSourceFingerprint(
  collectorTypeInput: string | undefined,
  configInput: unknown,
): string | null {
  const collectorType = normalizeCollectorType(collectorTypeInput);
  const config = (configInput && typeof configInput === 'object')
    ? (configInput as Record<string, unknown>)
    : {};

  if (collectorType === 'rss' || collectorType === 'changedetection' || collectorType === 'webpage') {
    const normalizedUrl = normalizeHttpUrl(String(config.url || ''));
    return normalizedUrl ? `${collectorType}:${normalizedUrl}` : null;
  }

  if (collectorType === 'rsshub') {
    const route = normalizeRoute(String(config.route || ''));
    return route ? `rsshub:${route}` : null;
  }

  if (collectorType === 'youtube') {
    const route = normalizeRoute(String(config.route || ''));
    if (route) return `youtube:route:${route}`;
    const channelId = String(config.channelId || '').trim().toLowerCase();
    return channelId ? `youtube:channel:${channelId}` : null;
  }

  if (collectorType === 'custom') {
    const endpoint = normalizeHttpUrl(String(config.endpoint || '')) || String(config.endpoint || '').trim();
    return endpoint ? `custom:${endpoint}` : null;
  }

  const stable = stableStringify(config as JsonValue);
  return stable ? `${collectorType}:${stable}` : null;
}
