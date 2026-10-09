import { JevPanel } from '../../components/JevPanel';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Plus, Upload } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type DiscoveryCandidate, type SourceRecord, type SubscriptionPackageMeta } from '../../lib/api';
import {
  filterSourcesForBrowser,
  mergeSourceBrowserQueryParams,
  resolveSourceBrowserQueryState,
} from '../../lib/source-browser-filters.ts';
import { resolveInitialSourcesViewMode, type SourceViewMode } from '../../lib/sources-view';
import {
  SOURCE_READING_TIER_OPTIONS,
  resolveSourceReadingTier,
  type SourceReadingTierValue,
} from '../../lib/source-reading-tier';
import {
  SOURCE_CONTENT_STRATEGY_OPTIONS,
  SOURCE_HEALTH_FILTER_OPTIONS,
  type SourceContentStrategy,
  type SourceHealthFilter,
} from '../../lib/source-governance-ui';
import {
  SOURCE_GOVERNANCE_ROLE_OPTIONS,
  SOURCE_GOVERNANCE_STATUS_OPTIONS,
  SOURCE_TOPIC_GROUP_OPTIONS,
  type SourceGovernanceRole,
  type SourceGovernanceStatus,
  type SourceTopicGroup,
} from '../../lib/source-governance-classification';
import { SourceCard } from './source-card';
import { SourceIntakeCenter, type DiscoverMode } from './source-intake-center';
import { qualityGradeLabel, SourceTable } from './source-table';
import {
  BROWSER_PROVIDER_OPTIONS,
  GROWTH_AXIS_OPTIONS,
  PROCESSING_PROFILE_OPTIONS,
  SOURCE_KIND_OPTIONS,
  SOURCE_TIER_OPTIONS,
  WEB_CAPTURE_MODE_OPTIONS,
  type BrowserAssistProvider,
  type GrowthAxis,
  type ProcessingProfile,
  type SourceKind,
  type SourceTier,
  type WebCaptureRenderMode,
} from './source-options';

type CollectorType = 'rss' | 'rsshub' | 'youtube' | 'changedetection' | 'webpage' | 'webpage_index' | 'custom' | 'podcast';
type SourceSortMode = 'latest' | 'unread' | 'health' | 'quality' | 'content' | 'ai' | 'noise' | 'readingTier' | 'name';
type SourceFocusMode = 'all' | 'high-signal' | 'monitor' | 'stale';
const SOURCE_CARD_BATCH_SIZE = 18;

interface SourceFormState {
  name: string;
  sourceType: string;
  collectorType: CollectorType;
  category: string;
  sourceKind: SourceKind;
  sourceTier: SourceTier;
  readingTier: SourceReadingTierValue;
  authorityWeight: number;
  processingProfile: ProcessingProfile;
  contentStrategy: SourceContentStrategy;
  growthAxes: GrowthAxis[];
  url: string;
  route: string;
  channelId: string;
  endpoint: string;
  podcastUrl: string;
  renderMode: WebCaptureRenderMode;
  browserProvider: BrowserAssistProvider;
  fetchInterval: number;
  autoFetchEnabled: boolean;
  autoTranscribe: boolean;
}

function toggleGrowthAxis(axes: GrowthAxis[], axis: GrowthAxis) {
  if (axes.includes(axis)) {
    const nextAxes = axes.filter((entry) => entry !== axis);
    return (nextAxes.length > 0 ? nextAxes : ['认知升级']) as GrowthAxis[];
  }
  return [...axes, axis].slice(0, 4) as GrowthAxis[];
}

function parsePodcastUrl(url: string): { route?: string; directUrl?: string; platform?: string } {
  try {
    const u = new URL(url.trim());
    // 小宇宙
    if (u.hostname.includes('xiaoyuzhoufm.com')) {
      const m = u.pathname.match(/\/podcast\/([a-f0-9]+)/);
      if (m) return { route: `/xiaoyuzhoufm/podcast/${m[1]}`, platform: '小宇宙' };
    }
    // Apple Podcasts
    if (u.hostname.includes('podcasts.apple.com')) {
      const m = u.pathname.match(/\/id(\d+)/);
      if (m) return { route: `/applepodcasts/podcast/${m[1]}`, platform: 'Apple Podcasts' };
    }
    // Spotify
    if (u.hostname.includes('open.spotify.com')) {
      const m = u.pathname.match(/\/show\/([A-Za-z0-9]+)/);
      if (m) return { route: `/spotify/podcast/${m[1]}`, platform: 'Spotify' };
    }
    // 直接 RSS/Atom URL
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return { directUrl: url.trim(), platform: 'RSS' };
    }
  } catch {
    return {};
  }
  return {};
}

const initialForm: SourceFormState = {
  name: '',
  sourceType: 'rss',
  collectorType: 'rss',
  category: '',
  sourceKind: 'rss',
  sourceTier: 'B',
  readingTier: 'high_value',
  authorityWeight: 1,
  processingProfile: 'brief',
  contentStrategy: 'smart',
  growthAxes: ['认知升级'],
  url: '',
  route: '',
  channelId: '',
  endpoint: '',
  podcastUrl: '',
  renderMode: 'auto',
  browserProvider: 'generic',
  fetchInterval: 60,
  autoFetchEnabled: true,
  autoTranscribe: false,
};

function toTimeValue(value?: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value);
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : 0;
}

function SourceTableSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="正在加载信源" className="overflow-hidden rounded-[24px] border border-zinc-200 bg-white shadow-[0_20px_56px_-48px_rgba(15,23,42,0.45)]">
      <div className="animate-pulse divide-y divide-zinc-100">
        <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr_0.7fr_0.8fr_1.4fr] gap-4 bg-zinc-50 px-5 py-3">
          {Array.from({ length: 7 }, (_, index) => <div key={index} className="h-3 rounded bg-zinc-200" />)}
        </div>
        {Array.from({ length: 7 }, (_, row) => (
          <div key={row} className="grid grid-cols-[1.3fr_1fr_1fr_1fr_0.7fr_0.8fr_1.4fr] items-center gap-4 px-5 py-5">
            <div className="space-y-2"><div className="h-4 w-32 rounded bg-zinc-200" /><div className="h-3 w-24 rounded bg-zinc-100" /></div>
            <div className="space-y-2"><div className="h-4 w-20 rounded bg-zinc-200" /><div className="h-3 w-16 rounded bg-zinc-100" /></div>
            <div className="h-5 w-16 rounded-full bg-zinc-100" />
            <div className="h-5 w-20 rounded-full bg-zinc-100" />
            <div className="h-4 w-10 rounded bg-zinc-200" />
            <div className="h-4 w-12 rounded bg-zinc-200" />
            <div className="flex gap-2"><div className="h-7 w-14 rounded-full bg-zinc-100" /><div className="h-7 w-14 rounded-full bg-zinc-100" /></div>
          </div>
        ))}
      </div>
      <span className="sr-only">正在加载信源列表</span>
    </div>
  );
}

export function Sources() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQueryState = resolveSourceBrowserQueryState(searchParams);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showIntakeCenter, setShowIntakeCenter] = useState(false);
  const [form, setForm] = useState<SourceFormState>(initialForm);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discoverMode, setDiscoverMode] = useState<DiscoverMode>('search');
  const [discoverQuery, setDiscoverQuery] = useState('');
  const [discoverCategory, setDiscoverCategory] = useState('uncategorized');
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverResults, setDiscoverResults] = useState<DiscoveryCandidate[]>([]);
  const [subscribingKey, setSubscribingKey] = useState<string | null>(null);
  const [subscriptionPackages, setSubscriptionPackages] = useState<SubscriptionPackageMeta[]>([]);
  const [packageImportingSlug, setPackageImportingSlug] = useState<string | null>(null);
  const [sourceSearch, setSourceSearch] = useState(initialQueryState.q);
  const [sourceSort, setSourceSort] = useState<SourceSortMode>(initialQueryState.sort as SourceSortMode);
  const [sourceStatusView, setSourceStatusView] = useState<'active' | 'paused'>(initialQueryState.status === 'paused' ? 'paused' : 'active');
  const [focusMode, setFocusMode] = useState<SourceFocusMode>(initialQueryState.focus as SourceFocusMode);
  const [categoryFilter, setCategoryFilter] = useState(initialQueryState.category);
  const [collectorFilter, setCollectorFilter] = useState<'all' | CollectorType>(initialQueryState.collector as 'all' | CollectorType);
  const [tierFilter, setTierFilter] = useState<'all' | SourceTier>(initialQueryState.tier as 'all' | SourceTier);
  const [readingTierFilter, setReadingTierFilter] = useState<'all' | SourceReadingTierValue>(initialQueryState.readingTier as 'all' | SourceReadingTierValue);
  const [topicGroupFilter, setTopicGroupFilter] = useState<'all' | SourceTopicGroup>(initialQueryState.topicGroup as 'all' | SourceTopicGroup);
  const [governanceRoleFilter, setGovernanceRoleFilter] = useState<'all' | SourceGovernanceRole>(initialQueryState.governanceRole as 'all' | SourceGovernanceRole);
  const [governanceStatusFilter, setGovernanceStatusFilter] = useState<SourceGovernanceStatus>(initialQueryState.governanceStatus as SourceGovernanceStatus);
  const [healthFilter, setHealthFilter] = useState<SourceHealthFilter>(() => {
    const value = initialQueryState.health as SourceHealthFilter | null;
    return SOURCE_HEALTH_FILTER_OPTIONS.some((option) => option.value === value) ? value as SourceHealthFilter : 'all';
  });
  const [viewMode, setViewMode] = useState<SourceViewMode>(() => (
    initialQueryState.view === 'table' || initialQueryState.view === 'cards'
      ? initialQueryState.view
      : resolveInitialSourcesViewMode()
  ));
  const [visibleSourceCardCount, setVisibleSourceCardCount] = useState(SOURCE_CARD_BATCH_SIZE);
  const [selectedSourceIds, setSelectedSourceIds] = useState<number[]>([]);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [reprocessingSourceId, setReprocessingSourceId] = useState<number | null>(null);
  const [emailTab, setEmailTab] = useState<'paste' | 'eml'>('paste');
  const [emailSourceLabel, setEmailSourceLabel] = useState('手动邮件');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailFrom, setEmailFrom] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailFiles, setEmailFiles] = useState<File[]>([]);
  const [emailImporting, setEmailImporting] = useState(false);
  const [emailInboxSourceId, setEmailInboxSourceId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const collectorOptions: Array<{ value: CollectorType; label: string }> = [
    { value: 'rss', label: 'RSS/Atom' },
    { value: 'podcast', label: '播客订阅 🎙️' },
    { value: 'rsshub', label: 'RSSHub 路由' },
    { value: 'youtube', label: 'YouTube' },
    { value: 'changedetection', label: '网页变更监控' },
    { value: 'webpage', label: '网页正文快照' },
    { value: 'webpage_index', label: '精选榜单页' },
    { value: 'custom', label: '自定义 API' },
  ];

  const sourceTypeByCollector: Record<CollectorType, string> = useMemo(() => ({
    rss: 'rss',
    podcast: 'audio',
    rsshub: 'rsshub',
    youtube: 'rsshub',
    changedetection: 'webpage',
    webpage: 'webpage',
    webpage_index: 'curated_index',
    custom: 'custom',
  }), []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, pkg] = await Promise.all([
        api.sources.list({ sortBy: sourceSort, status: sourceStatusView, sourceType: 'rss' }),
        api.subscriptions.packages().catch(() => ({ data: [] })),
      ]);
      setSources(s.data);
      setSubscriptionPackages(pkg.data || []);
    } catch (err) {
      setError((err as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [sourceSort, sourceStatusView]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    setSelectedSourceIds([]);
  }, [sourceStatusView]);

  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const source of sources) {
      const category = String(source.category || '未分类').trim() || '未分类';
      counts.set(category, (counts.get(category) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
      .map(([value, count]) => ({ value, label: `${value} · ${count}` }));
  }, [sources]);

  const filteredSources = useMemo(() => {
    const next = filterSourcesForBrowser(sources, {
      q: sourceSearch,
      category: categoryFilter,
      collector: collectorFilter,
      tier: tierFilter,
      readingTier: readingTierFilter,
      topicGroup: topicGroupFilter,
      governanceRole: governanceRoleFilter,
      governanceStatus: governanceStatusFilter,
      health: healthFilter,
      focus: focusMode,
    });

    return [...next].sort((a, b) => {
      if (sourceSort === 'unread') {
        const unreadDiff = Number(b.unreadCount || 0) - Number(a.unreadCount || 0);
        if (unreadDiff !== 0) return unreadDiff;
      }
      if (sourceSort === 'health') {
        const healthDiff = Number(b.healthScore || 0) - Number(a.healthScore || 0);
        if (healthDiff !== 0) return healthDiff;
      }
      if (sourceSort === 'quality') {
        const qualityDiff = Number(b.sourceQuality?.qualityScore || 0) - Number(a.sourceQuality?.qualityScore || 0);
        if (qualityDiff !== 0) return qualityDiff;
      }
      if (sourceSort === 'content') {
        const contentDiff = Number(b.sourceQuality?.contentReadyRate || 0) - Number(a.sourceQuality?.contentReadyRate || 0);
        if (contentDiff !== 0) return contentDiff;
      }
      if (sourceSort === 'ai') {
        const aiDiff = Number(b.sourceQuality?.aiReadyRate || 0) - Number(a.sourceQuality?.aiReadyRate || 0);
        if (aiDiff !== 0) return aiDiff;
      }
      if (sourceSort === 'noise') {
        const noiseDiff = Number(a.sourceQuality?.noiseRate || 0) - Number(b.sourceQuality?.noiseRate || 0);
        if (noiseDiff !== 0) return noiseDiff;
      }
      if (sourceSort === 'readingTier') {
        const rank: Record<SourceReadingTierValue, number> = { high_value: 4, light_reading: 3, explore: 2, paused: 1 };
        const tierDiff = rank[resolveSourceReadingTier(b).value] - rank[resolveSourceReadingTier(a).value];
        if (tierDiff !== 0) return tierDiff;
      }
      if (sourceSort === 'name') {
        return a.name.localeCompare(b.name, 'zh-CN');
      }
      const latestDiff = toTimeValue(b.latestItemAt || b.lastFetchedAt || b.createdAt) - toTimeValue(a.latestItemAt || a.lastFetchedAt || a.createdAt);
      if (latestDiff !== 0) return latestDiff;
      return Number(b.unreadCount || 0) - Number(a.unreadCount || 0);
    });
  }, [categoryFilter, collectorFilter, focusMode, governanceRoleFilter, governanceStatusFilter, healthFilter, readingTierFilter, sourceSearch, sourceSort, sources, tierFilter, topicGroupFilter]);

  const selectedSources = useMemo(
    () => filteredSources.filter((source) => selectedSourceIds.includes(source.id)),
    [filteredSources, selectedSourceIds],
  );

  useEffect(() => {
    setVisibleSourceCardCount(SOURCE_CARD_BATCH_SIZE);
  }, [categoryFilter, collectorFilter, focusMode, governanceRoleFilter, governanceStatusFilter, healthFilter, readingTierFilter, sourceSearch, sourceSort, tierFilter, topicGroupFilter, viewMode]);

  useEffect(() => {
    const next = mergeSourceBrowserQueryParams(searchParams, {
      q: sourceSearch,
      category: categoryFilter,
      collector: collectorFilter,
      tier: tierFilter,
      readingTier: readingTierFilter,
      topicGroup: topicGroupFilter,
      governanceRole: governanceRoleFilter,
      governanceStatus: governanceStatusFilter,
      health: healthFilter,
      focus: focusMode,
      sort: sourceSort,
      view: viewMode,
      status: sourceStatusView,
    });
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [categoryFilter, collectorFilter, focusMode, governanceRoleFilter, governanceStatusFilter, healthFilter, readingTierFilter, searchParams, setSearchParams, sourceSearch, sourceSort, sourceStatusView, tierFilter, topicGroupFilter, viewMode]);

  const displayedCardSources = useMemo(
    () => filteredSources.slice(0, visibleSourceCardCount),
    [filteredSources, visibleSourceCardCount],
  );
  const hiddenCardCount = Math.max(filteredSources.length - displayedCardSources.length, 0);

  const toggleSourceSelection = (sourceId: number) => {
    setSelectedSourceIds((current) => (
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId]
    ));
  };

  const toggleAllVisibleSources = () => {
    setSelectedSourceIds((current) => {
      const visibleIds = filteredSources.map((source) => source.id);
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => current.includes(id));
      if (allSelected) return current.filter((id) => !visibleIds.includes(id));
      return Array.from(new Set([...current, ...visibleIds]));
    });
  };

  const handleBulkUpdate = async (
    patch: Partial<Omit<SourceRecord, 'config'>> & { config?: Record<string, unknown> },
    successMessage: string,
  ) => {
    if (selectedSources.length === 0) {
      setNotice('请先在表格中选择要批量管理的信源');
      return;
    }
    setBulkUpdating(true);
    setError(null);
    try {
      for (const source of selectedSources) {
        await api.sources.update(source.id, patch);
      }
      setNotice(`${successMessage}：${selectedSources.length} 个信源`);
      setSelectedSourceIds([]);
      await fetchData();
    } catch (err) {
      setError((err as Error).message || '批量更新信源失败');
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleBulkReadingTierUpdate = async (readingTier: SourceReadingTierValue) => {
    if (selectedSources.length === 0) {
      setNotice('请先在表格中选择要批量标记的信源');
      return;
    }
    setBulkUpdating(true);
    setError(null);
    try {
      for (const source of selectedSources) {
        await api.sources.update(source.id, { readingTier });
      }
      const label = SOURCE_READING_TIER_OPTIONS.find((option) => option.value === readingTier)?.label || readingTier;
      setNotice(`已批量标为「${label}」：${selectedSources.length} 个信源`);
      setSelectedSourceIds([]);
      await fetchData();
    } catch (err) {
      setError((err as Error).message || '批量标记阅读层级失败');
    } finally {
      setBulkUpdating(false);
    }
  };

  const buildConfig = (): Record<string, unknown> => {
    switch (form.collectorType) {
      case 'rss':
        return { url: form.url.trim() };
      case 'webpage':
      case 'webpage_index':
        return {
          url: form.url.trim(),
          renderMode: form.renderMode,
          browserProvider: form.browserProvider,
          ...(form.collectorType === 'webpage_index' ? { indexKind: 'generic_index', itemMode: 'article_cards' } : {}),
        };
      case 'podcast': {
        const parsed = parsePodcastUrl(form.podcastUrl);
        if (parsed.route) return { route: parsed.route };
        if (parsed.directUrl) return { url: parsed.directUrl };
        return { url: form.podcastUrl.trim() };
      }
      case 'rsshub':
        return { route: form.route.trim() };
      case 'youtube':
        return form.route.trim()
          ? { route: form.route.trim() }
          : { channelId: form.channelId.trim() };
      case 'changedetection':
        return { url: form.url.trim() };
      case 'custom':
        return { endpoint: form.endpoint.trim() };
      default:
        return {};
    }
  };

  const validateForm = (): string | null => {
    if (!form.name.trim()) return '请填写信源名称';
    switch (form.collectorType) {
      case 'rss':
      case 'webpage':
      case 'webpage_index':
      case 'changedetection':
        if (!form.url.trim()) return '请填写 URL';
        break;
      case 'podcast':
        if (!form.podcastUrl.trim()) return '请填写播客页面链接或 RSS 地址';
        break;
      case 'rsshub':
        if (!form.route.trim()) return '请填写 RSSHub 路由';
        break;
      case 'youtube':
        if (!form.route.trim() && !form.channelId.trim()) return '请填写 YouTube Channel ID 或 RSSHub 路由';
        break;
      case 'custom':
        if (!form.endpoint.trim()) return '请填写自定义 API Endpoint';
        break;
    }
    return null;
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      const builtConfig = buildConfig();
      let effectiveCollectorType = form.collectorType;
      if (form.collectorType === 'podcast') {
        effectiveCollectorType = 'route' in builtConfig ? 'rsshub' : 'rss';
      }
      await api.sources.create({
        name: form.name.trim(),
        sourceType: sourceTypeByCollector[form.collectorType],
        collectorType: effectiveCollectorType,
        config: builtConfig,
        category: form.category.trim() || 'uncategorized',
        sourceTier: form.sourceTier,
        readingTier: form.readingTier,
        processingProfile: form.processingProfile,
        contentStrategy: form.contentStrategy,
        growthAxes: form.growthAxes,
        sourceKind: form.sourceKind,
        authorityWeight: form.authorityWeight,
        fetchInterval: form.fetchInterval,
        autoFetchEnabled: form.autoFetchEnabled,
        autoTranscribe: form.autoTranscribe,
      });
      setNotice('信源创建成功');
      setShowAdd(false);
      setForm(initialForm);
      await fetchData();
    } catch (err) {
      setError((err as Error).message || '创建信源失败');
    }
  };

  const handleSourceStrategyUpdate = async (
    source: SourceRecord,
    patch: Partial<SourceRecord> & { config?: Record<string, unknown> },
    successMessage?: string,
  ) => {
    setError(null);
    try {
      await api.sources.update(source.id, patch);
      if (successMessage) setNotice(successMessage);
      await fetchData();
    } catch (err) {
      setError((err as Error).message || '更新信源策略失败');
    }
  };

  const handleToggleSourceAxis = async (source: SourceRecord, axis: GrowthAxis) => {
    const nextAxes = toggleGrowthAxis((source.growthAxes || []) as GrowthAxis[], axis);
    await handleSourceStrategyUpdate(source, { growthAxes: nextAxes }, `已更新「${source.name}」的成长维度`);
  };

  const handleDiscover = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = discoverQuery.trim();
    if (!query) {
      setDiscoverError('请输入关键词、URL 或 RSSHub 路由');
      return;
    }

    setDiscoverLoading(true);
    setDiscoverError(null);
    setNotice(null);
    try {
      const resp = await api.discovery.search({
        q: query,
        type: discoverMode,
        limit: 8,
      });
      setDiscoverResults(resp.data || []);
      if ((resp.data || []).length === 0) {
        setNotice('未找到可订阅信源，可切换模式重试或直接使用下方手动添加。');
      }
    } catch (err) {
      setDiscoverError((err as Error).message || '发现失败');
    } finally {
      setDiscoverLoading(false);
    }
  };

  const handleSubscribeCandidate = async (candidate: DiscoveryCandidate) => {
    setSubscribingKey(candidate.discoveryKey);
    setError(null);
    setNotice(null);
    try {
      const resp = await api.subscriptions.create({
        name: candidate.title,
        sourceType: candidate.sourceType,
        collectorType: candidate.collectorType,
        config: candidate.config,
        category: discoverCategory.trim() || 'uncategorized',
      });
      if (resp.duplicate) {
        setNotice(`“${candidate.title}” 已在订阅列表中`);
      } else {
        setNotice(`已订阅：${candidate.title}`);
      }
      setDiscoverResults((prev) => prev.map((item) => (
        item.discoveryKey === candidate.discoveryKey ? { ...item, alreadySubscribed: true } : item
      )));
      await fetchData();
    } catch (err) {
      setError((err as Error).message || '订阅失败');
    } finally {
      setSubscribingKey(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此信源？')) return;
    try {
      await api.sources.delete(id);
      setNotice('信源已删除');
      await fetchData();
    } catch (err) {
      setError((err as Error).message || '删除失败');
    }
  };

  const handleToggleStatus = async (id: number, current: string) => {
    try {
      const newStatus = current === 'active' ? 'paused' : 'active';
      await api.sources.update(id, { status: newStatus });
      await fetchData();
    } catch (err) {
      setError((err as Error).message || '状态更新失败');
    }
  };

  const handleToggleAutoTranscribe = async (source: SourceRecord) => {
    try {
      const nextValue = !source.autoTranscribe;
      await api.sources.update(source.id, { autoTranscribe: nextValue });
      setNotice(nextValue ? `已开启「${source.name}」自动转写` : `已关闭「${source.name}」自动转写`);
      await fetchData();
    } catch (err) {
      setError((err as Error).message || '自动转写开关更新失败');
    }
  };

  const handleToggleAutoFetch = async (source: SourceRecord) => {
    try {
      const nextValue = !(source.autoFetchEnabled ?? true);
      await api.sources.update(source.id, { autoFetchEnabled: nextValue });
      setNotice(nextValue ? `已开启「${source.name}」自动抓取` : `已关闭「${source.name}」自动抓取`);
      await fetchData();
    } catch (err) {
      setError((err as Error).message || '自动抓取开关更新失败');
    }
  };

  const handleWebCaptureConfig = async (
    source: SourceRecord,
    patch: { renderMode?: WebCaptureRenderMode; browserProvider?: BrowserAssistProvider },
    successMessage: string,
  ) => {
    const currentConfig = (source.config || {}) as Record<string, unknown>;
    await handleSourceStrategyUpdate(source, {
      config: {
        ...currentConfig,
        ...patch,
      },
    }, successMessage);
  };

  const openSourceFeed = (source: SourceRecord, unreadOnly = false) => {
    const params = new URLSearchParams();
    params.set('sourceId', String(source.id));
    if (unreadOnly && Number(source.unreadCount || 0) > 0) {
      params.set('filter', 'unread');
    }
    navigate(`/feed?${params.toString()}`);
  };

  const handleFetch = async (id: number) => {
    try {
      const resp = await api.fetch.triggerSource(id, { contentLimit: 20, aiLimit: 30, translationLimit: 15 });
      if (resp.mode === 'sync') {
        const ai = resp.aiProcessed;
        const contentStats = resp.contentStats;
        const qualityFunnel = resp.qualityFunnel;
        const aiErrors = resp.aiErrors;
        const errorParts = [
          aiErrors?.scoring?.[0] ? `评分失败：${aiErrors.scoring[0]}` : null,
          aiErrors?.summary?.[0] ? `摘要失败：${aiErrors.summary[0]}` : null,
          aiErrors?.translation?.[0] ? `翻译失败：${aiErrors.translation[0]}` : null,
        ].filter(Boolean).join('；');
        setNotice(
          `抓取完成：found ${resp.itemsFound ?? 0} · new ${resp.itemsNew ?? 0} · filtered ${resp.itemsFiltered ?? 0} · duplicate ${resp.itemsDuplicate ?? 0}` +
          (contentStats ? ` · 内容 ${contentStats.withContent}/${contentStats.withoutContent}` : '') +
          (ai ? ` · AI ${ai.scored}/${ai.summarized}/${ai.translated}` : '') +
          (qualityFunnel ? ` · 质量 ${qualityFunnel.qualityScore}分/${qualityGradeLabel(qualityFunnel.grade)}` : '') +
          (errorParts ? ` · ${errorParts}` : ''),
        );
      } else if (resp.enqueued === false) {
        setNotice(`该信源已有进行中的采集任务（jobId: ${resp.jobId || '-'}）`);
      } else {
        setNotice(`已触发单源采集（jobId: ${resp.jobId || '-'}）`);
      }
      setTimeout(() => {
        void fetchData();
      }, 2500);
    } catch (err) {
      setError((err as Error).message || '触发采集失败');
    }
  };

  const handleSourceReprocess = async (source: SourceRecord) => {
    setReprocessingSourceId(source.id);
    setError(null);
    setNotice(null);
    try {
      const resp = await api.items.reprocessBatch({ sourceId: source.id, stage: 'all', limit: 20 });
      const skippedSummary = (resp.skipped?.summary || 0) + (resp.skipped?.translation || 0);
      setNotice(
        `批量修复完成：命中 ${resp.matched} 条 · 正文 ${resp.content} · 质检 ${resp.quality} · 评分 ${resp.scored} · 摘要 ${resp.summarized} · 翻译 ${resp.translated}` +
        (skippedSummary > 0 ? ` · 策略跳过 摘要 ${resp.skipped?.summary || 0}/翻译 ${resp.skipped?.translation || 0}` : ''),
      );
      await fetchData();
    } catch (err) {
      setError((err as Error).message || '批量修复失败');
    } finally {
      setReprocessingSourceId(null);
    }
  };

  const handleHealthAction = async (source: SourceRecord, action: string) => {
    if (action === 'fetch') {
      await handleFetch(source.id);
      return;
    }
    if (action === 'repair_content' || action === 'repair_ai') {
      await handleSourceReprocess(source);
      return;
    }
    if (action === 'review_daily_coverage') {
      navigate(`/daily/reports/latest?sourceId=${source.id}`);
      return;
    }
    if (action === 'check_config') {
      setNotice(`请检查「${source.name}」的 URL、抓取器和渲染模式；系统不会自动改配置或停用来源。`);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.sources.importOpml(file);
      setNotice(`OPML 导入完成：总计 ${result.total}，新增 ${result.imported}，跳过 ${result.skipped}`);
      await fetchData();
    } catch (err) {
      setError((err as Error).message || 'OPML 导入失败');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const handleEmailPasteImport = async () => {
    const bodyText = emailBody.trim();
    if (!bodyText && !emailSubject.trim()) {
      setError('请先粘贴邮件正文或填写邮件标题');
      return;
    }
    setEmailImporting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.hooks.emailIngest({
        subject: emailSubject.trim() || '邮件：无标题',
        from: emailFrom.trim() || undefined,
        bodyText,
        sourceLabel: emailSourceLabel.trim() || '手动邮件',
      });
      setEmailInboxSourceId(result.sourceId);
      setNotice(`邮件导入完成：新增 ${result.ingested}，重复 ${result.duplicates}`);
      setEmailSubject('');
      setEmailBody('');
      await fetchData();
    } catch (err) {
      setError((err as Error).message || '邮件导入失败');
    } finally {
      setEmailImporting(false);
    }
  };

  const handleEmailEmlImport = async () => {
    if (emailFiles.length === 0) {
      setError('请选择 .eml 文件');
      return;
    }
    setEmailImporting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.hooks.emailIngestEml(emailFiles, emailSourceLabel.trim() || '手动邮件');
      setEmailInboxSourceId(result.sourceId);
      setNotice(`EML 导入完成：新增 ${result.ingested}，重复 ${result.duplicates}`);
      setEmailFiles([]);
      await fetchData();
    } catch (err) {
      setError((err as Error).message || 'EML 导入失败');
    } finally {
      setEmailImporting(false);
    }
  };

  const handleImportPackage = async (pkg: SubscriptionPackageMeta) => {
    setPackageImportingSlug(pkg.slug);
    setError(null);
    setNotice(null);
    try {
      const result = await api.subscriptions.importPackage(pkg.slug, {
        categoryDefault: pkg.categoryDefault || pkg.slug,
        limit: pkg.sourceCount,
      });
      setNotice(`${pkg.title} 导入完成：新增 ${result.summary.created}，重复 ${result.summary.duplicates}，失败 ${result.summary.failed}`);
      await fetchData();
    } catch (err) {
      setError((err as Error).message || '订阅包导入失败');
    } finally {
      setPackageImportingSlug(null);
    }
  };

  return (
    <div className="w-full p-3 sm:p-4 lg:p-5 xl:p-6">
      <JevPanel scene="source" management />
      <JevPanel scene="monitor" />
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] tracking-[0.28em] text-teal-700/70">RSS CORE</div>
          <h1 className="mt-1 text-2xl font-bold text-zinc-900">RSS 信源管理</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {sourceStatusView === 'active' ? '高价值阅读池' : 'RSS 归档库'} · {loading ? '正在读取信源' : `当前 ${filteredSources.length} 个`}
          </p>
        </div>
        <div className="flex shrink-0 gap-1 sm:gap-2">
          <button
            onClick={handleImportClick}
            disabled={importing}
            aria-label={importing ? 'OPML 导入中' : '导入 OPML'}
            title={importing ? 'OPML 导入中' : '导入 OPML'}
            className="flex h-10 w-10 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 sm:w-auto sm:px-4"
          >
            <Upload size={16} />
            <span className="hidden sm:inline">{importing ? '导入中...' : '导入 OPML'}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".opml,.xml,text/xml,application/xml"
            className="hidden"
            onChange={handleImportFile}
          />

          <button
            type="button"
            onClick={() => {
              setShowAdd(false);
              setShowIntakeCenter(true);
            }}
            aria-label="打开候选源"
            title="打开候选源"
            className="flex h-10 w-10 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white text-sm text-zinc-700 hover:bg-zinc-50 sm:w-auto sm:px-4"
          >
            <Compass size={16} /> <span className="hidden sm:inline">候选源</span>
          </button>

          <button
            onClick={() => setShowAdd(!showAdd)}
            aria-label="添加 RSS"
            title="添加 RSS"
            className="flex h-10 w-10 items-center justify-center gap-1.5 rounded-lg bg-zinc-900 text-sm text-white hover:bg-zinc-800 sm:w-auto sm:px-4"
          >
            <Plus size={16} /> <span className="hidden sm:inline">添加 RSS</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <SourceIntakeCenter
        open={showIntakeCenter}
        onClose={() => setShowIntakeCenter(false)}
        onSourcesChanged={fetchData}
        email={{
          tab: emailTab,
          sourceLabel: emailSourceLabel,
          subject: emailSubject,
          from: emailFrom,
          body: emailBody,
          files: emailFiles,
          importing: emailImporting,
          inboxSourceId: emailInboxSourceId,
        }}
        emailActions={{
          setTab: setEmailTab,
          setSourceLabel: setEmailSourceLabel,
          setSubject: setEmailSubject,
          setFrom: setEmailFrom,
          setBody: setEmailBody,
          setFiles: setEmailFiles,
          importPaste: handleEmailPasteImport,
          importEml: handleEmailEmlImport,
          openInbox: (sourceId) => navigate(`/feed?sourceId=${sourceId}`),
        }}
        packages={{
          packages: subscriptionPackages,
          importingSlug: packageImportingSlug,
        }}
        onImportPackage={handleImportPackage}
        discovery={{
          mode: discoverMode,
          query: discoverQuery,
          category: discoverCategory,
          loading: discoverLoading,
          error: discoverError,
          results: discoverResults,
          subscribingKey,
        }}
        discoveryActions={{
          setMode: setDiscoverMode,
          setQuery: setDiscoverQuery,
          setCategory: setDiscoverCategory,
          submit: handleDiscover,
          subscribe: handleSubscribeCandidate,
        }}
      />
      {showAdd && (
        <form onSubmit={handleAdd} className="mb-6 p-4 bg-zinc-50 rounded-xl border border-zinc-200 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">添加高价值 RSS</h2>
            <p className="mt-1 text-xs text-zinc-500">这里只接收 RSS/Atom。邮箱、网页监控、榜单和私有 API 将由独立渠道管理。</p>
          </div>

          {/* 快速添加：4个基础字段 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="信源名称"
              required
              className="px-3 py-2 border border-zinc-200 rounded-lg text-sm"
            />
            <div className="flex items-center rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
              RSS / Atom
            </div>
          </div>

          {(form.collectorType === 'rss' || form.collectorType === 'changedetection' || form.collectorType === 'webpage' || form.collectorType === 'webpage_index') && (
            <input
              value={form.url}
              onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
              placeholder={form.collectorType === 'rss' ? 'RSS URL' : form.collectorType === 'webpage_index' ? '榜单页 URL' : '网页 URL'}
              required
              className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
            />
          )}

          {(form.collectorType === 'webpage' || form.collectorType === 'webpage_index') && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-medium text-zinc-600">网页抓取策略</span>
                <select
                  value={form.renderMode}
                  onChange={(e) => setForm((prev) => ({ ...prev, renderMode: e.target.value as WebCaptureRenderMode }))}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                >
                  {WEB_CAPTURE_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-zinc-600">Browser Assist Provider</span>
                <select
                  value={form.browserProvider}
                  onChange={(e) => setForm((prev) => ({ ...prev, browserProvider: e.target.value as BrowserAssistProvider }))}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                >
                  {BROWSER_PROVIDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {form.collectorType === 'podcast' && (() => {
            const parsed = form.podcastUrl ? parsePodcastUrl(form.podcastUrl) : {};
            return (
              <div className="space-y-1.5">
                <input
                  value={form.podcastUrl}
                  onChange={(e) => setForm((prev) => ({ ...prev, podcastUrl: e.target.value }))}
                  placeholder="粘贴播客页面链接（小宇宙 / Apple Podcasts / Spotify）或直接 RSS URL"
                  required
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
                />
                {parsed.platform && (
                  <p className="text-xs text-emerald-600 px-1">
                    ✓ 识别为 {parsed.platform}
                    {parsed.route ? `，将使用 RSSHub 路由：${parsed.route}` : ''}
                    {parsed.directUrl ? '，直接使用 RSS 地址' : ''}
                  </p>
                )}
                {form.podcastUrl && !parsed.platform && (
                  <p className="text-xs text-amber-600 px-1">⚠ 未识别平台，将尝试直接作为 RSS 地址使用</p>
                )}
              </div>
            );
          })()}

          {form.collectorType === 'rsshub' && (
            <input
              value={form.route}
              onChange={(e) => setForm((prev) => ({ ...prev, route: e.target.value }))}
              placeholder="RSSHub 路由，如 /jike/topic/xxxx"
              required
              className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
            />
          )}

          {form.collectorType === 'youtube' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                value={form.channelId}
                onChange={(e) => setForm((prev) => ({ ...prev, channelId: e.target.value }))}
                placeholder="YouTube Channel ID（可选）"
                className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
              />
              <input
                value={form.route}
                onChange={(e) => setForm((prev) => ({ ...prev, route: e.target.value }))}
                placeholder="RSSHub 路由（可选）"
                className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
              />
            </div>
          )}

          {form.collectorType === 'custom' && (
            <input
              value={form.endpoint}
              onChange={(e) => setForm((prev) => ({ ...prev, endpoint: e.target.value }))}
              placeholder="自定义 API Endpoint"
              required
              className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
            />
          )}

          <input
            value={form.category}
            onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
            placeholder="分类（可选）"
            className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
          />

          {/* 高级配置：折叠隐藏 */}
          <details className="rounded-lg border border-zinc-200 bg-white">
            <summary className="px-3 py-2.5 text-sm font-medium text-zinc-700 cursor-pointer hover:bg-zinc-50 select-none">
              高级设置
            </summary>
            <div className="px-3 pb-3 space-y-4">
              {/* 采集策略 */}
              <div className="space-y-2 pt-2">
                <div className="text-xs font-semibold text-zinc-600 uppercase tracking-wide">采集策略</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-zinc-200 bg-zinc-50">
                    <div>
                      <div className="text-sm font-medium text-zinc-800">自动抓取</div>
                      <div className="text-xs text-zinc-500 mt-0.5">关闭后不参加 cron，但仍可手动点"立即采集"。</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={form.autoFetchEnabled}
                      onChange={(e) => setForm((prev) => ({ ...prev, autoFetchEnabled: e.target.checked }))}
                      className="mt-1"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-zinc-200 bg-zinc-50">
                    <div>
                      <div className="text-sm font-medium text-zinc-800">抓取周期（分钟）</div>
                      <div className="text-xs text-zinc-500 mt-0.5">当前已接入混合调度：调度器每 5 分钟挑选到期信源，这里定义单源的目标周期。</div>
                    </div>
                    <input
                      type="number"
                      min={5}
                      max={1440}
                      value={form.fetchInterval}
                      onChange={(e) => setForm((prev) => ({ ...prev, fetchInterval: Number(e.target.value || 60) }))}
                      className="w-24 px-2 py-1 border border-zinc-200 rounded"
                    />
                  </label>
                </div>
                <label className="flex items-start justify-between gap-3 px-3 py-2 rounded-lg border border-zinc-200 bg-zinc-50">
                  <div>
                    <div className="text-sm font-medium text-zinc-800">抓到新音频后自动转写</div>
                    <div className="text-xs text-zinc-500 mt-0.5">只对新抓到的音频条目生效，还需要在设置页开启全局自动转写。</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={form.autoTranscribe}
                    onChange={(e) => setForm((prev) => ({ ...prev, autoTranscribe: e.target.checked }))}
                    className="mt-1"
                  />
                </label>
              </div>

              {/* 质量分级 */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-zinc-600 uppercase tracking-wide">质量分级</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-zinc-600">资讯等级</span>
                    <select
                      value={form.sourceTier}
                      onChange={(e) => setForm((prev) => ({ ...prev, sourceTier: e.target.value as SourceTier }))}
                      className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
                    >
                      {SOURCE_TIER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-zinc-600">阅读层级（消费方式）</span>
                    <select
                      value={form.readingTier}
                      onChange={(e) => setForm((prev) => ({ ...prev, readingTier: e.target.value as SourceReadingTierValue }))}
                      className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
                    >
                      {SOURCE_READING_TIER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <span className="block text-[11px] leading-4 text-zinc-400">决定怎么读，不改变来源权威性。</span>
                  </label>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3">
                  <div className="text-sm font-medium text-zinc-800">成长维度</div>
                  <div className="mt-1 text-xs text-zinc-500">决定这类信息优先进入哪一个成长象限，可多选。</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {GROWTH_AXIS_OPTIONS.map((axis) => {
                      const active = form.growthAxes.includes(axis);
                      return (
                        <button
                          key={axis}
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, growthAxes: toggleGrowthAxis(prev.growthAxes, axis) }))}
                          className={`min-h-9 rounded-full border px-3 py-2 text-xs transition-colors ${
                            active
                              ? 'border-zinc-900 bg-zinc-900 text-white'
                              : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
                          }`}
                        >
                          {axis}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 处理配置 */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-zinc-600 uppercase tracking-wide">处理配置</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-zinc-600">处理档位</span>
                    <select
                      value={form.processingProfile}
                      onChange={(e) => setForm((prev) => ({ ...prev, processingProfile: e.target.value as ProcessingProfile }))}
                      className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
                    >
                      {PROCESSING_PROFILE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-zinc-600">正文策略</span>
                    <select
                      value={form.contentStrategy}
                      onChange={(e) => setForm((prev) => ({ ...prev, contentStrategy: e.target.value as SourceContentStrategy }))}
                      className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
                    >
                      {SOURCE_CONTENT_STRATEGY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-zinc-600">信源类型</span>
                    <select
                      value={form.sourceKind}
                      onChange={(e) => setForm((prev) => ({ ...prev, sourceKind: e.target.value as SourceKind }))}
                      className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
                    >
                      {SOURCE_KIND_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-zinc-600">权威权重</span>
                    <input
                      type="number"
                      min={0.35}
                      max={2}
                      step={0.01}
                      value={form.authorityWeight}
                      onChange={(e) => setForm((prev) => ({ ...prev, authorityWeight: Number(e.target.value || 1) }))}
                      className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
                    />
                  </label>
                </div>
              </div>
            </div>
          </details>

          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-800">添加</button>
            <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700">取消</button>
          </div>
        </form>
      )}

      <div className="mb-4 rounded-2xl border border-zinc-200 bg-white p-3 shadow-[0_18px_40px_-42px_rgba(15,23,42,0.4)]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <input
              value={sourceSearch}
              onChange={(e) => setSourceSearch(e.target.value)}
              placeholder="搜索信源、域名、最新条目标题或变化摘要"
              className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-teal-600/10"
            />
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="flex rounded-xl border border-zinc-200 bg-zinc-50 p-1" aria-label="来源状态">
              {([
                { value: 'active', label: '使用中' },
                { value: 'paused', label: '归档' },
              ] as const).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSourceStatusView(option.value)}
                  className={`min-h-9 rounded-lg px-3 text-xs font-medium transition-colors ${
                    sourceStatusView === option.value ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-white'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <select
              aria-label="来源排序"
              value={sourceSort}
              onChange={(e) => setSourceSort(e.target.value as SourceSortMode)}
              className="min-h-11 rounded-xl border border-zinc-200 bg-white px-3 text-xs text-zinc-700"
            >
              <option value="latest">最近更新</option>
              <option value="quality">质量优先</option>
              <option value="unread">未读优先</option>
              <option value="name">按名称</option>
            </select>
            <div className="flex rounded-xl border border-zinc-200 bg-zinc-50 p-1">
              {([
                { value: 'table', label: '紧凑' },
                { value: 'cards', label: '详情' },
              ] as Array<{ value: 'table' | 'cards'; label: string }>).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setViewMode(option.value)}
                  className={`min-h-9 rounded-lg px-3 text-xs transition-colors ${viewMode === option.value ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 px-1 text-xs text-zinc-500">
          <span>{sourceStatusView === 'active' ? '只显示高价值 RSS 核心池；独特渠道不在这里混合管理。' : '这里只查看 RSS 归档；历史数据保留，可随时恢复。'}</span>
          <span className="shrink-0 font-medium text-zinc-700">{sources.length} 个来源</span>
        </div>
        <details className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 py-2">
          <summary className="cursor-pointer select-none text-xs font-medium text-zinc-600">高级筛选</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {([
              { value: 'all', label: '全部' },
              { value: 'high-signal', label: '高价值' },
              { value: 'monitor', label: '网页监控' },
              { value: 'stale', label: '待修复' },
            ] as Array<{ value: SourceFocusMode; label: string }>).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFocusMode(option.value)}
                className={`min-h-9 rounded-lg px-3 text-xs ${focusMode === option.value ? 'bg-zinc-900 text-white' : 'border border-zinc-200 bg-white text-zinc-600'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <label>
              <span className="mb-1 block text-[11px] font-medium text-zinc-500">主题方向</span>
              <select value={topicGroupFilter} onChange={(e) => setTopicGroupFilter(e.target.value as 'all' | SourceTopicGroup)} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
                <option value="all">全部主题</option>
                {SOURCE_TOPIC_GROUP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium text-zinc-500">来源角色</span>
              <select value={governanceRoleFilter} onChange={(e) => setGovernanceRoleFilter(e.target.value as 'all' | SourceGovernanceRole)} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
                <option value="all">全部角色</option>
                {SOURCE_GOVERNANCE_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium text-zinc-500">阅读层级</span>
              <select value={readingTierFilter} onChange={(e) => setReadingTierFilter(e.target.value as 'all' | SourceReadingTierValue)} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
                <option value="all">全部层级</option>
                {SOURCE_READING_TIER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium text-zinc-500">治理状态</span>
              <select value={governanceStatusFilter} onChange={(e) => setGovernanceStatusFilter(e.target.value as SourceGovernanceStatus)} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
                {SOURCE_GOVERNANCE_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium text-zinc-500">原始频道</span>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
                <option value="all">全部频道</option>
                {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium text-zinc-500">资讯等级</span>
              <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value as 'all' | SourceTier)} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
                <option value="all">全部分级</option>
                {SOURCE_TIER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium text-zinc-500">技术健康</span>
              <select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value as SourceHealthFilter)} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
                {SOURCE_HEALTH_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
        </details>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-zinc-700">命中 {filteredSources.length} / {sources.length}</span>
          {topicGroupFilter !== 'all' ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">主题：{SOURCE_TOPIC_GROUP_OPTIONS.find((option) => option.value === topicGroupFilter)?.label || topicGroupFilter}</span> : null}
          {governanceRoleFilter !== 'all' ? <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-700">角色：{SOURCE_GOVERNANCE_ROLE_OPTIONS.find((option) => option.value === governanceRoleFilter)?.label || governanceRoleFilter}</span> : null}
          {governanceStatusFilter !== 'all' ? <span className="rounded-full bg-orange-50 px-3 py-1 text-orange-700">治理：{SOURCE_GOVERNANCE_STATUS_OPTIONS.find((option) => option.value === governanceStatusFilter)?.label || governanceStatusFilter}</span> : null}
          {categoryFilter !== 'all' ? <span className="rounded-full bg-teal-50 px-3 py-1 text-teal-700">频道：{categoryFilter}</span> : null}
          {collectorFilter !== 'all' ? <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-700">渠道：{collectorOptions.find((option) => option.value === collectorFilter)?.label || collectorFilter}</span> : null}
          {readingTierFilter !== 'all' ? <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">想看：{SOURCE_READING_TIER_OPTIONS.find((option) => option.value === readingTierFilter)?.label || readingTierFilter}</span> : null}
          {sourceSearch.trim() ? <span className="rounded-full bg-zinc-100 px-3 py-1 text-zinc-700">搜索：{sourceSearch.trim()}</span> : null}
          {(categoryFilter !== 'all' || collectorFilter !== 'all' || tierFilter !== 'all' || readingTierFilter !== 'all' || topicGroupFilter !== 'all' || governanceRoleFilter !== 'all' || governanceStatusFilter !== 'all' || healthFilter !== 'all' || focusMode !== 'all' || sourceSearch.trim()) ? (
            <button
              type="button"
              onClick={() => {
                setSourceSearch('');
                setCategoryFilter('all');
                setCollectorFilter('all');
                setTierFilter('all');
                setReadingTierFilter('all');
                setTopicGroupFilter('all');
                setGovernanceRoleFilter('all');
                setGovernanceStatusFilter('all');
                setHealthFilter('all');
                setFocusMode('all');
              }}
              className="rounded-full border border-zinc-200 px-3 py-1 text-zinc-600 hover:bg-zinc-50"
            >
              清空筛选
            </button>
          ) : null}
        </div>
        {viewMode === 'table' && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            <span>已选 {selectedSources.length} 个信源</span>
            <button
              type="button"
              onClick={toggleAllVisibleSources}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 hover:bg-zinc-100"
            >
              全选/取消当前列表
            </button>
            {selectedSources.length > 0 ? (
              <>
            <select
              disabled={bulkUpdating || selectedSources.length === 0}
              defaultValue=""
              onChange={(event) => {
                const value = event.target.value as SourceTopicGroup;
                if (value) void handleBulkUpdate({ topicGroup: value }, '已批量确认主题方向');
                event.target.value = '';
              }}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 disabled:opacity-50"
            >
              <option value="">批量确认主题</option>
              {SOURCE_TOPIC_GROUP_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select
              disabled={bulkUpdating || selectedSources.length === 0}
              defaultValue=""
              onChange={(event) => {
                const value = event.target.value as SourceGovernanceRole;
                if (value) void handleBulkUpdate({ governanceRole: value }, '已批量确认来源角色');
                event.target.value = '';
              }}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 disabled:opacity-50"
            >
              <option value="">批量确认角色</option>
              {SOURCE_GOVERNANCE_ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select
              disabled={bulkUpdating || selectedSources.length === 0}
              defaultValue=""
              onChange={(event) => {
                const value = event.target.value as SourceTier;
                if (value) void handleBulkUpdate({ sourceTier: value }, '已批量更新信源等级');
                event.target.value = '';
              }}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 disabled:opacity-50"
            >
              <option value="">批量改资讯等级</option>
	              {SOURCE_TIER_OPTIONS.map((option) => (
	                <option key={option.value} value={option.value}>{option.label}</option>
	              ))}
	            </select>
	            <select
	              disabled={bulkUpdating || selectedSources.length === 0}
	              defaultValue=""
	              onChange={(event) => {
	                const value = event.target.value as SourceReadingTierValue;
	                if (value) void handleBulkReadingTierUpdate(value);
	                event.target.value = '';
	              }}
	              className="rounded-full border border-zinc-200 bg-white px-3 py-1 disabled:opacity-50"
	            >
	              <option value="">批量标阅读层级</option>
	              {SOURCE_READING_TIER_OPTIONS.map((option) => (
	                <option key={option.value} value={option.value}>{option.label}</option>
	              ))}
	            </select>
	            <select
	              disabled={bulkUpdating || selectedSources.length === 0}
	              defaultValue=""
              onChange={(event) => {
                const value = event.target.value as SourceKind;
                if (value) void handleBulkUpdate({ sourceKind: value }, '已批量更新信源类型');
                event.target.value = '';
              }}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 disabled:opacity-50"
            >
              <option value="">批量改类型</option>
              {SOURCE_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select
              disabled={bulkUpdating || selectedSources.length === 0}
              defaultValue=""
              onChange={(event) => {
                const value = event.target.value as ProcessingProfile;
                if (value) void handleBulkUpdate({ processingProfile: value }, '已批量更新处理档位');
                event.target.value = '';
              }}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 disabled:opacity-50"
            >
              <option value="">批量改处理档位</option>
              {PROCESSING_PROFILE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select
              disabled={bulkUpdating || selectedSources.length === 0}
              defaultValue=""
              onChange={(event) => {
                const value = event.target.value as SourceContentStrategy;
                if (value) void handleBulkUpdate({ contentStrategy: value }, '已批量更新正文策略');
                event.target.value = '';
              }}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 disabled:opacity-50"
            >
              <option value="">批量改正文策略</option>
              {SOURCE_CONTENT_STRATEGY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={bulkUpdating || selectedSources.length === 0}
              onClick={() => void handleBulkUpdate({ status: 'paused' }, '已批量暂停')}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 hover:bg-zinc-100 disabled:opacity-50"
            >
              批量暂停
            </button>
            <button
              type="button"
              disabled={bulkUpdating || selectedSources.length === 0}
              onClick={() => void handleBulkUpdate({ status: 'active' }, '已批量启用')}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 hover:bg-zinc-100 disabled:opacity-50"
            >
              批量启用
            </button>
              </>
            ) : (
              <span className="text-zinc-400">选中来源后再显示批量管理工具</span>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <SourceTableSkeleton />
      ) : filteredSources.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-zinc-300 bg-zinc-50/80 px-6 py-14 text-center text-sm text-zinc-500">
          当前筛选条件下没有信源。可以放宽筛选，或者直接添加 / 导入一批新源。
        </div>
      ) : viewMode === 'table' ? (
        <SourceTable
          sources={filteredSources}
          selectedSourceIds={selectedSourceIds}
          reprocessingSourceId={reprocessingSourceId}
          onToggleAll={toggleAllVisibleSources}
          onToggleSelection={toggleSourceSelection}
          onOpenFeed={openSourceFeed}
          onToggleStatus={handleToggleStatus}
          onOpenRules={(sourceId) => navigate(`/rules?source=${sourceId}`)}
          onReprocess={handleSourceReprocess}
        />
      ) : (
        <div className="space-y-2">
          {displayedCardSources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              reprocessing={reprocessingSourceId === source.id}
              onOpenFeed={openSourceFeed}
              onOpenRules={(sourceId) => navigate(`/rules?source=${sourceId}`)}
              onHealthAction={handleHealthAction}
              onStrategyUpdate={handleSourceStrategyUpdate}
              onWebCaptureConfig={handleWebCaptureConfig}
              onToggleAxis={handleToggleSourceAxis}
              onToggleAutoFetch={handleToggleAutoFetch}
              onToggleAutoTranscribe={handleToggleAutoTranscribe}
              onFetch={handleFetch}
              onReprocess={handleSourceReprocess}
              onToggleStatus={handleToggleStatus}
              onDelete={handleDelete}
            />
          ))}
          {hiddenCardCount > 0 && (
            <div className="rounded-[24px] border border-dashed border-zinc-300 bg-zinc-50/80 px-4 py-5 text-center">
              <div className="text-sm font-medium text-zinc-800">
                已显示 {displayedCardSources.length} / {filteredSources.length} 个信源
              </div>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                手机端先展示当前排序下最需要处理的信源，避免列表过长。继续展开不会改变筛选条件。
              </p>
              <button
                type="button"
                onClick={() => setVisibleSourceCardCount((count) => count + SOURCE_CARD_BATCH_SIZE)}
                className="mt-3 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                再显示 {Math.min(SOURCE_CARD_BATCH_SIZE, hiddenCardCount)} 个
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
