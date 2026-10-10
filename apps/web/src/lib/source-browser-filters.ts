import type { SourceRecord } from './api/contracts';
import { resolveSourceReadingTier } from './source-reading-tier.ts';

export type SourceBrowserFilterState = {
  q?: string;
  category?: string;
  collector?: string;
  readingTier?: string;
  topicGroup?: string;
  governanceRole?: string;
  governanceStatus?: string;
  tier?: string;
  health?: string;
  focus?: string;
  sort?: string;
  view?: string;
  status?: string;
};

const VALID_SORTS = new Set(['latest', 'unread', 'health', 'quality', 'content', 'ai', 'noise', 'readingTier', 'name']);
const VALID_FOCUS = new Set(['all', 'high-signal', 'monitor', 'stale']);

function normalizeValue(value?: string | null) {
  const normalized = String(value || '').trim();
  return normalized && normalized !== 'all' ? normalized : '';
}

export function resolveSourceBrowserQueryState(params: URLSearchParams): Required<SourceBrowserFilterState> {
  const sort = params.get('sort') || 'latest';
  const focus = params.get('focus') || 'all';
  return {
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    collector: params.get('collector') || 'all',
    readingTier: params.get('readingTier') || 'all',
    topicGroup: params.get('topic') || 'all',
    governanceRole: params.get('role') || 'all',
    governanceStatus: params.get('governance') || 'all',
    tier: params.get('tier') || 'all',
    health: params.get('health') || 'all',
    focus: VALID_FOCUS.has(focus) ? focus : 'all',
    sort: VALID_SORTS.has(sort) ? sort : 'latest',
    view: params.get('view') || '',
    status: params.get('status') === 'paused' ? 'paused' : 'active',
  };
}

export function mergeSourceBrowserQueryParams(current: URLSearchParams, patch: SourceBrowserFilterState) {
  const next = new URLSearchParams(current);
  const entries: Array<[string, string | undefined]> = [
    ['q', patch.q],
    ['category', patch.category],
    ['collector', patch.collector],
    ['readingTier', patch.readingTier],
    ['topic', patch.topicGroup],
    ['role', patch.governanceRole],
    ['governance', patch.governanceStatus],
    ['tier', patch.tier],
    ['health', patch.health],
    ['focus', patch.focus],
    ['sort', patch.sort],
    ['view', patch.view],
    ['status', patch.status === 'paused' ? 'paused' : 'all'],
  ];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    const normalized = normalizeValue(value);
    if (!normalized || (key === 'sort' && normalized === 'latest')) {
      next.delete(key);
    } else {
      next.set(key, normalized);
    }
  }
  return next;
}

export function filterSourcesForBrowser<T extends Pick<SourceRecord, 'name' | 'category' | 'collectorType' | 'sourceTier' | 'sourceHost' | 'latestItemTitle' | 'lastChangeSummary' | 'sourceRole' | 'freshnessState' | 'sourceHealth' | 'healthStatus' | 'config' | 'topicGroup' | 'topicGroupLabel' | 'governanceRole' | 'governanceRoleLabel' | 'classificationSource' | 'needsGovernanceReview'>>(sources: T[], state: SourceBrowserFilterState): T[] {
  const q = String(state.q || '').trim().toLowerCase();
  const category = normalizeValue(state.category);
  const collector = normalizeValue(state.collector);
  const tier = normalizeValue(state.tier);
  const readingTierFilter = normalizeValue(state.readingTier);
  const topicGroup = normalizeValue(state.topicGroup);
  const governanceRole = normalizeValue(state.governanceRole);
  const governanceStatus = normalizeValue(state.governanceStatus);
  const health = normalizeValue(state.health);
  const focus = state.focus || 'all';

  return sources.filter((source) => {
    if (category && source.category !== category) return false;
    if (collector && source.collectorType !== collector) return false;
    if (tier && source.sourceTier !== tier) return false;
    const readingTier = resolveSourceReadingTier(source);
    if (readingTierFilter && readingTier.value !== readingTierFilter) return false;
    if (topicGroup && source.topicGroup !== topicGroup) return false;
    if (governanceRole && source.governanceRole !== governanceRole) return false;
    if (governanceStatus === 'pending' && source.needsGovernanceReview === false) return false;
    if (governanceStatus === 'manual' && source.needsGovernanceReview !== false && source.classificationSource !== 'manual') return false;
    if (health && (source.sourceHealth?.healthStatus || source.healthStatus) !== health) return false;
    if (focus === 'high-signal' && readingTier.value !== 'high_value') return false;
    if (focus === 'monitor' && source.collectorType !== 'changedetection' && source.collectorType !== 'webpage' && source.collectorType !== 'webpage_index' && source.sourceRole !== 'monitor') return false;
    if (focus === 'stale' && source.freshnessState !== 'stale' && source.freshnessState !== 'error') return false;
    if (!q) return true;

    const haystack = [
      source.name,
      source.sourceHost,
      source.category,
      source.latestItemTitle,
      source.lastChangeSummary,
      source.collectorType,
      source.sourceTier,
      readingTier.label,
      readingTier.value,
      source.topicGroup,
      source.topicGroupLabel,
      source.governanceRole,
      source.governanceRoleLabel,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(q);
  });
}
