export type DibaoExportSource = {
  id: number;
  name: string;
  sourceType: string;
  collectorType: string;
  category?: string | null;
  sourceTier?: string | null;
  status?: string | null;
  config: unknown;
};

export type DibaoOpmlOptions = {
  ownerName?: string;
  rsshubBaseUrl?: string;
  generatedAt?: Date;
};

export type DibaoStatus = {
  available: boolean;
  publicUrl: string;
  healthUrl: string;
  message: string;
  version: string | null;
  checkedAt: string;
  error: string | null;
  raw?: unknown;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type DibaoStatusOptions = {
  baseUrl: string;
  publicUrl: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

function resolveFeedUrl(source: DibaoExportSource, rsshubBaseUrl: string): string | null {
  const config = asRecord(source.config);
  const directUrl = typeof config.url === 'string' ? config.url.trim() : '';
  if (/^https?:\/\//i.test(directUrl)) return directUrl;

  const route = typeof config.route === 'string' ? config.route.trim() : '';
  const rssLike = ['rsshub', 'youtube'].includes(source.collectorType) || source.sourceType === 'rsshub';
  if (rssLike && route) return joinUrl(rsshubBaseUrl, route);

  return null;
}

function resolveHtmlUrl(source: DibaoExportSource): string | null {
  const config = asRecord(source.config);
  const htmlUrl = typeof config.htmlUrl === 'string' ? config.htmlUrl.trim() : '';
  if (/^https?:\/\//i.test(htmlUrl)) return htmlUrl;
  return null;
}

function isExportableSource(source: DibaoExportSource): boolean {
  if (source.status && source.status !== 'active') return false;
  const rssLikeSource = ['rss', 'rsshub'].includes(source.sourceType);
  const rssLikeCollector = ['rss', 'rsshub', 'youtube'].includes(source.collectorType);
  return rssLikeSource || rssLikeCollector;
}

export function buildDibaoOpml(sources: DibaoExportSource[], options: DibaoOpmlOptions = {}): string {
  const ownerName = options.ownerName || '信息中枢 V3';
  const rsshubBaseUrl = options.rsshubBaseUrl || 'http://rsshub:1200';
  const generatedAt = options.generatedAt || new Date();
  const seen = new Set<string>();
  const grouped = new Map<string, Array<{ source: DibaoExportSource; xmlUrl: string; htmlUrl: string | null }>>();

  for (const source of sources) {
    if (!isExportableSource(source)) continue;
    const xmlUrl = resolveFeedUrl(source, rsshubBaseUrl);
    if (!xmlUrl) continue;
    const dedupeKey = xmlUrl.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const category = String(source.category || 'uncategorized').trim() || 'uncategorized';
    const rows = grouped.get(category) || [];
    rows.push({ source, xmlUrl, htmlUrl: resolveHtmlUrl(source) });
    grouped.set(category, rows);
  }

  const outlines: string[] = [];
  for (const [category, rows] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))) {
    outlines.push(`    <outline text="${escapeXml(category)}" title="${escapeXml(category)}">`);
    for (const row of rows.sort((a, b) => a.source.name.localeCompare(b.source.name, 'zh-CN'))) {
      const attrs = [
        'type="rss"',
        `text="${escapeXml(row.source.name)}"`,
        `title="${escapeXml(row.source.name)}"`,
        `xmlUrl="${escapeXml(row.xmlUrl)}"`,
      ];
      if (row.htmlUrl) attrs.push(`htmlUrl="${escapeXml(row.htmlUrl)}"`);
      if (row.source.sourceTier) attrs.push(`category="${escapeXml(row.source.sourceTier)}"`);
      outlines.push(`      <outline ${attrs.join(' ')} />`);
    }
    outlines.push('    </outline>');
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${escapeXml(ownerName)} → Dibao</title>`,
    `    <dateCreated>${escapeXml(generatedAt.toUTCString())}</dateCreated>`,
    '  </head>',
    '  <body>',
    ...outlines,
    '  </body>',
    '</opml>',
    '',
  ].join('\n');
}

export async function checkDibaoStatus(options: DibaoStatusOptions): Promise<DibaoStatus> {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const healthUrl = `${baseUrl}/api/system/health`;
  const fetchImpl = options.fetchImpl || fetch;
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 3000);

  try {
    const response = await fetchImpl(healthUrl, { signal: controller.signal });
    const raw = await response.json().catch(() => null);
    const rawRecord = asRecord(raw);
    const dataRecord = asRecord(rawRecord.data);
    const okValue = rawRecord.ok ?? dataRecord.ok;
    const available = response.ok && (okValue === undefined || okValue === true);
    const versionValue = rawRecord.version ?? dataRecord.version;
    return {
      available,
      publicUrl: options.publicUrl,
      healthUrl,
      message: available ? 'Dibao 阅读实验室可访问。' : 'Dibao 已响应，但健康检查未通过。',
      version: typeof versionValue === 'string' ? versionValue : null,
      checkedAt,
      error: available ? null : `HTTP ${response.status}`,
      raw,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      publicUrl: options.publicUrl,
      healthUrl,
      message: 'Dibao 阅读实验室暂时无法访问；请先启动 dibao-reader 服务。',
      version: null,
      checkedAt,
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}
