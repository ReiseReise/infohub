import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildSourceFingerprint } from './source-normalization.js';

export type ReferenceSourceProvider = 'qmreader' | 'follow_builders' | 'aihot' | 'origin12';
export type ReferenceSourceImportMode = 'rss' | 'podcast' | 'adapter_required' | 'reference_only';
export type ReferenceSourceReadingTier = 'high_value' | 'light_reading' | 'explore' | 'paused';
export type ReferenceSourceObservationStatus = 'current' | 'historical';

export type ReferenceSourceCatalogItem = {
  key: string;
  name: string;
  provider: ReferenceSourceProvider;
  providerLabel: string;
  providerSourceId: string;
  channel: string;
  feedUrl: string | null;
  feedCandidates: string[];
  siteUrl: string | null;
  category: string;
  sourceKind: string;
  sourceTier: 'S' | 'A' | 'B' | 'C' | 'D';
  readingTier: ReferenceSourceReadingTier;
  recommended: boolean;
  defaultEnabled: false;
  importMode: ReferenceSourceImportMode;
  providerEnabled: boolean;
  providerStatus: string;
  observationStatus: ReferenceSourceObservationStatus;
  firstObservedAt: string;
  lastObservedAt: string;
  description: string;
  notes: string;
  manualNotes?: string;
  refreshMinutes?: number;
  logicalSites?: Array<{ name: string; url: string; required: boolean }>;
  provenance: {
    sourceUrl: string;
    observedAt: string;
    license?: string;
    attributionRequired?: boolean;
  };
};

export type ReferenceSourceCatalog = {
  version: number;
  updatedAt: string;
  description: string;
  sourcePolicy: {
    defaultEnabled: false;
    maxImportPerRequest: number;
    notes: string;
  };
  stats: {
    total: number;
    byProvider: Record<string, number>;
    importable: number;
    recommended: number;
    current?: number;
    historical?: number;
    aihotObservedItems?: number;
    aihotObservedPages?: number;
  };
  sources: ReferenceSourceCatalogItem[];
};

export type ReferenceSourceExisting = {
  id: number;
  name: string;
  collectorType: string;
  config: unknown;
  status?: string | null;
};

export type ReferenceSourceCatalogItemView = ReferenceSourceCatalogItem & {
  alreadyAdded: boolean;
  existingSourceId: number | null;
  canImport: boolean;
  importReason: string;
};

export type ReferenceSourceCatalogQuery = {
  q?: string;
  provider?: string;
  channel?: string;
  recommended?: boolean;
  importable?: boolean;
};

export type ReferenceSourcePayload = {
  name: string;
  sourceType: string;
  collectorType: string;
  config: Record<string, unknown>;
  category: string;
  priority: number;
  fetchInterval: number;
  autoTranscribe: boolean;
  status: string;
  tags: string[];
  sourceRole: string;
  sourceKind: string;
  sourceTier: string;
  processingProfile: string;
  growthAxes: string[];
  trustScore: number;
  noiseScore: number;
  upgradeRules: Record<string, unknown>;
};

const FILE_NAME = 'reference-source-catalog.json';

function catalogCandidatePaths(): string[] {
  return [
    process.env.INFOHUB_REFERENCE_SOURCE_CATALOG_PATH || '',
    `/app/fixtures/${FILE_NAME}`,
    path.resolve(process.cwd(), `docs/source-registry/${FILE_NAME}`),
    path.resolve(process.cwd(), `../docs/source-registry/${FILE_NAME}`),
    path.resolve(process.cwd(), `../../docs/source-registry/${FILE_NAME}`),
    path.resolve(process.cwd(), `../../../docs/source-registry/${FILE_NAME}`),
  ];
}

async function findCatalogPath(candidates = catalogCandidatePaths()): Promise<string | null> {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next supported runtime path.
    }
  }
  return null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isImportMode(value: unknown): value is ReferenceSourceImportMode {
  return value === 'rss' || value === 'podcast' || value === 'adapter_required' || value === 'reference_only';
}

export function parseReferenceSourceCatalog(value: unknown): ReferenceSourceCatalog {
  const raw = asObject(value);
  const rawPolicy = asObject(raw.sourcePolicy);
  const rawStats = asObject(raw.stats);
  const rawSources = Array.isArray(raw.sources) ? raw.sources : [];
  const seen = new Set<string>();
  const sources: ReferenceSourceCatalogItem[] = [];

  for (const candidate of rawSources) {
    const source = asObject(candidate);
    const key = String(source.key || '').trim();
    const name = String(source.name || '').trim();
    const provider = String(source.provider || '').trim() as ReferenceSourceProvider;
    const importMode = source.importMode;
    if (!key || !name || seen.has(key)) continue;
    if (!['qmreader', 'follow_builders', 'aihot', 'origin12'].includes(provider)) continue;
    if (!isImportMode(importMode)) continue;
    seen.add(key);

    sources.push({
      key,
      name,
      provider,
      providerLabel: String(source.providerLabel || provider).trim(),
      providerSourceId: String(source.providerSourceId || key).trim(),
      channel: String(source.channel || 'unknown').trim(),
      feedUrl: typeof source.feedUrl === 'string' && source.feedUrl.trim() ? source.feedUrl.trim() : null,
      feedCandidates: Array.isArray(source.feedCandidates)
        ? source.feedCandidates.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [],
      siteUrl: typeof source.siteUrl === 'string' && source.siteUrl.trim() ? source.siteUrl.trim() : null,
      category: String(source.category || 'AI').trim() || 'AI',
      sourceKind: String(source.sourceKind || 'other').trim() || 'other',
      sourceTier: ['S', 'A', 'B', 'C', 'D'].includes(String(source.sourceTier))
        ? source.sourceTier as ReferenceSourceCatalogItem['sourceTier']
        : 'B',
      readingTier: ['high_value', 'light_reading', 'explore', 'paused'].includes(String(source.readingTier))
        ? source.readingTier as ReferenceSourceReadingTier
        : 'explore',
      recommended: Boolean(source.recommended),
      defaultEnabled: false,
      importMode,
      providerEnabled: Boolean(source.providerEnabled),
      providerStatus: String(source.providerStatus || 'unknown').trim(),
      observationStatus: source.observationStatus === 'historical' ? 'historical' : 'current',
      firstObservedAt: String(source.firstObservedAt || asObject(source.provenance).observedAt || raw.updatedAt || '').trim(),
      lastObservedAt: String(source.lastObservedAt || asObject(source.provenance).observedAt || raw.updatedAt || '').trim(),
      description: String(source.description || '').trim(),
      notes: String(source.notes || '').trim(),
      ...(Number.isFinite(Number(source.refreshMinutes)) && Number(source.refreshMinutes) > 0
        ? { refreshMinutes: Number(source.refreshMinutes) }
        : {}),
      ...(Array.isArray(source.logicalSites)
        ? {
          logicalSites: source.logicalSites.flatMap((entry) => {
            const site = asObject(entry);
            const name = String(site.name || '').trim();
            const url = String(site.url || '').trim();
            return name && url ? [{ name, url, required: site.required !== false }] : [];
          }),
        }
        : {}),
      ...(typeof source.manualNotes === 'string' && source.manualNotes.trim()
        ? { manualNotes: source.manualNotes.trim() }
        : {}),
      provenance: {
        sourceUrl: String(asObject(source.provenance).sourceUrl || '').trim(),
        observedAt: String(asObject(source.provenance).observedAt || raw.updatedAt || '').trim(),
        ...(typeof asObject(source.provenance).license === 'string'
          ? { license: String(asObject(source.provenance).license) }
          : {}),
        ...(typeof asObject(source.provenance).attributionRequired === 'boolean'
          ? { attributionRequired: Boolean(asObject(source.provenance).attributionRequired) }
          : {}),
      },
    });
  }

  const byProvider = sources.reduce<Record<string, number>>((summary, source) => {
    summary[source.provider] = (summary[source.provider] || 0) + 1;
    return summary;
  }, {});

  return {
    version: Number(raw.version || 1),
    updatedAt: String(raw.updatedAt || '').trim(),
    description: String(raw.description || '').trim(),
    sourcePolicy: {
      defaultEnabled: false,
      maxImportPerRequest: Math.max(1, Math.min(Number(rawPolicy.maxImportPerRequest || 5), 20)),
      notes: String(rawPolicy.notes || '').trim(),
    },
    stats: {
      total: sources.length,
      byProvider,
      importable: sources.filter(isReferenceSourceImportable).length,
      recommended: sources.filter((source) => source.recommended).length,
      current: sources.filter((source) => source.observationStatus === 'current').length,
      historical: sources.filter((source) => source.observationStatus === 'historical').length,
      ...(Number.isFinite(Number(rawStats.aihotObservedItems))
        ? { aihotObservedItems: Number(rawStats.aihotObservedItems) }
        : {}),
      ...(Number.isFinite(Number(rawStats.aihotObservedPages))
        ? { aihotObservedPages: Number(rawStats.aihotObservedPages) }
        : {}),
    },
    sources,
  };
}

export async function loadReferenceSourceCatalog(filePath?: string): Promise<ReferenceSourceCatalog> {
  const resolvedPath = filePath || await findCatalogPath();
  if (!resolvedPath) throw new Error(`${FILE_NAME} not found`);
  return parseReferenceSourceCatalog(JSON.parse(await readFile(resolvedPath, 'utf8')));
}

export function isReferenceSourceImportable(source: ReferenceSourceCatalogItem): boolean {
  return Boolean(source.feedUrl) && (source.importMode === 'rss' || source.importMode === 'podcast');
}

export function filterReferenceSourceCatalog(
  sources: ReferenceSourceCatalogItemView[],
  query: ReferenceSourceCatalogQuery,
): ReferenceSourceCatalogItemView[] {
  const normalizedQuery = String(query.q || '').trim().toLocaleLowerCase('zh-CN');
  return sources.filter((source) => {
    if (query.provider && query.provider !== 'all' && source.provider !== query.provider) return false;
    if (query.channel && query.channel !== 'all' && source.channel !== query.channel) return false;
    if (typeof query.recommended === 'boolean' && source.recommended !== query.recommended) return false;
    if (typeof query.importable === 'boolean' && source.canImport !== query.importable) return false;
    if (!normalizedQuery) return true;
    return [source.name, source.providerLabel, source.channel, source.description, source.notes, source.siteUrl]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('zh-CN')
      .includes(normalizedQuery);
  });
}

function itemFingerprint(source: ReferenceSourceCatalogItem): string | null {
  if (!isReferenceSourceImportable(source)) return null;
  return buildSourceFingerprint('rss', { url: source.feedUrl });
}

function normalizedName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}

export function enrichReferenceSourceCatalog(
  sources: ReferenceSourceCatalogItem[],
  existingSources: ReferenceSourceExisting[],
): ReferenceSourceCatalogItemView[] {
  const existingByFingerprint = new Map<string, ReferenceSourceExisting>();
  const existingByName = new Map(existingSources.map((source) => [normalizedName(source.name), source]));
  for (const source of existingSources) {
    const fingerprint = buildSourceFingerprint(source.collectorType, asObject(source.config));
    if (fingerprint && !existingByFingerprint.has(fingerprint)) existingByFingerprint.set(fingerprint, source);
  }

  return sources.map((source) => {
    const fingerprint = itemFingerprint(source);
    const existing = (fingerprint ? existingByFingerprint.get(fingerprint) : null)
      || existingByName.get(normalizedName(source.name))
      || null;
    const importable = isReferenceSourceImportable(source);
    const alreadyAdded = Boolean(existing);
    let importReason = '可以选择导入';
    if (alreadyAdded) importReason = '已在当前信源库';
    else if (source.importMode === 'adapter_required') importReason = '需要专用采集适配器';
    else if (source.importMode === 'reference_only') importReason = '仅记录来源名，缺少独立订阅地址';
    else if (!source.feedUrl) importReason = '缺少可验证的订阅地址';

    return {
      ...source,
      alreadyAdded,
      existingSourceId: existing?.id || null,
      canImport: importable && !alreadyAdded,
      importReason,
    };
  });
}

export function buildReferenceSourcePayload(source: ReferenceSourceCatalogItem): ReferenceSourcePayload {
  if (!isReferenceSourceImportable(source)) {
    throw new Error(`Reference source ${source.key} is not directly importable`);
  }
  const isPodcast = source.importMode === 'podcast';
  const collectorType = 'rss';
  const highValue = source.readingTier === 'high_value';
  const lightReading = source.readingTier === 'light_reading';
  const processingProfile = highValue ? 'full' : lightReading ? 'smart' : 'brief';

  return {
    name: source.name,
    sourceType: isPodcast ? 'audio' : 'rss',
    collectorType,
    config: {
      url: source.feedUrl,
      ...(source.siteUrl ? { htmlUrl: source.siteUrl } : {}),
      readingTier: source.readingTier,
      contentStrategy: highValue ? 'full' : 'smart',
      referenceCatalogKey: source.key,
      referenceProvider: source.provider,
    },
    category: source.category,
    priority: source.sourceTier === 'S' ? 5 : source.sourceTier === 'A' ? 4 : 3,
    fetchInterval: isPodcast ? 720 : highValue ? 90 : 180,
    autoTranscribe: false,
    status: 'active',
    tags: [
      `reference:${source.provider}`,
      `channel:${source.channel}`,
      source.readingTier,
    ],
    sourceRole: 'normal',
    sourceKind: source.sourceKind,
    sourceTier: source.sourceTier,
    processingProfile,
    growthAxes: highValue ? ['技术能力', '认知升级'] : ['认知升级'],
    trustScore: source.sourceTier === 'S' ? 94 : source.sourceTier === 'A' ? 84 : source.sourceTier === 'B' ? 70 : 50,
    noiseScore: highValue ? 14 : lightReading ? 30 : 55,
    upgradeRules: {},
  };
}
