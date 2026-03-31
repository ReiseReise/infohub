import { useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Headphones, Pause, Play, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { api, type DiscoveryCandidate, type SourceRecord, type SourceStats, type SubscriptionPackageMeta } from '../../lib/api';

type CollectorType = 'rss' | 'rsshub' | 'youtube' | 'changedetection' | 'custom' | 'podcast';
type DiscoverMode = 'search' | 'rss' | 'rsshub';
type SourceTier = 'S' | 'A' | 'B' | 'C' | 'D';
type ProcessingProfile = 'full' | 'smart' | 'brief' | 'monitor';
type GrowthAxis = '认知升级' | '技术能力' | '商业判断' | '表达输出';

const SOURCE_TIER_OPTIONS: Array<{ value: SourceTier; label: string }> = [
  { value: 'S', label: 'S级信号' },
  { value: 'A', label: 'A级分析' },
  { value: 'B', label: 'B级资讯' },
  { value: 'C', label: 'C级噪声观察' },
  { value: 'D', label: 'D级哨兵' },
];

const PROCESSING_PROFILE_OPTIONS: Array<{ value: ProcessingProfile; label: string }> = [
  { value: 'full', label: '深加工' },
  { value: 'smart', label: '智能加工' },
  { value: 'brief', label: '轻摘要' },
  { value: 'monitor', label: '仅监控' },
];

const GROWTH_AXIS_OPTIONS: GrowthAxis[] = ['认知升级', '技术能力', '商业判断', '表达输出'];

interface SourceFormState {
  name: string;
  sourceType: string;
  collectorType: CollectorType;
  category: string;
  sourceTier: SourceTier;
  processingProfile: ProcessingProfile;
  growthAxes: GrowthAxis[];
  url: string;
  route: string;
  channelId: string;
  endpoint: string;
  podcastUrl: string;
  fetchInterval: number;
  autoFetchEnabled: boolean;
  autoTranscribe: boolean;
}

function getRecommendedProfile(collectorType: CollectorType): Pick<SourceFormState, 'sourceTier' | 'processingProfile' | 'growthAxes'> {
  if (collectorType === 'changedetection') {
    return { sourceTier: 'D', processingProfile: 'monitor', growthAxes: ['认知升级'] };
  }
  if (collectorType === 'podcast' || collectorType === 'youtube') {
    return { sourceTier: 'A', processingProfile: 'smart', growthAxes: ['认知升级'] };
  }
  if (collectorType === 'custom') {
    return { sourceTier: 'S', processingProfile: 'full', growthAxes: ['认知升级'] };
  }
  return { sourceTier: 'B', processingProfile: 'brief', growthAxes: ['认知升级'] };
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
  sourceTier: 'B',
  processingProfile: 'brief',
  growthAxes: ['认知升级'],
  url: '',
  route: '',
  channelId: '',
  endpoint: '',
  podcastUrl: '',
  fetchInterval: 60,
  autoFetchEnabled: true,
  autoTranscribe: false,
};

function scheduleLabel(source: SourceRecord) {
  const outcome = source.lastOutcome || '';
  if (!(source.autoFetchEnabled ?? true)) return { label: '已关闭自动抓取', className: 'bg-zinc-100 text-zinc-500' };
  if (source.status !== 'active') return { label: '信源未激活', className: 'bg-zinc-100 text-zinc-500' };
  if (outcome === 'error') return { label: '退避中', className: 'bg-red-100 text-red-700' };
  if (outcome === 'paused') return { label: '已暂停', className: 'bg-zinc-100 text-zinc-500' };
  if (outcome === 'scheduled') return { label: '已纳入调度', className: 'bg-sky-100 text-sky-700' };
  if (outcome === 'no_items' || outcome === 'all_duplicate') return { label: '低频巡检', className: 'bg-amber-100 text-amber-700' };
  if (outcome === 'ai_queued' || outcome === 'new_items') return { label: '活跃抓取', className: 'bg-emerald-100 text-emerald-700' };
  return { label: '混合调度中', className: 'bg-zinc-100 text-zinc-600' };
}

function freshnessLabel(source: SourceRecord) {
  switch (source.freshnessState) {
    case 'healthy':
      return { label: '新鲜', className: 'bg-emerald-100 text-emerald-700' };
    case 'due':
      return { label: '待补抓', className: 'bg-amber-100 text-amber-700' };
    case 'stale':
      return { label: '已过期', className: 'bg-red-100 text-red-700' };
    case 'paused':
      return { label: '已暂停', className: 'bg-zinc-100 text-zinc-500' };
    case 'error':
      return { label: '错误', className: 'bg-rose-100 text-rose-700' };
    default:
      return null;
  }
}

export function Sources() {
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [stats, setStats] = useState<SourceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const collectorOptions: Array<{ value: CollectorType; label: string }> = [
    { value: 'rss', label: 'RSS/Atom' },
    { value: 'podcast', label: '播客订阅 🎙️' },
    { value: 'rsshub', label: 'RSSHub 路由' },
    { value: 'youtube', label: 'YouTube' },
    { value: 'changedetection', label: '网页变更监控' },
    { value: 'custom', label: '自定义 API' },
  ];

  const sourceTypeByCollector: Record<CollectorType, string> = useMemo(() => ({
    rss: 'rss',
    podcast: 'audio',
    rsshub: 'rsshub',
    youtube: 'rsshub',
    changedetection: 'webpage',
    custom: 'custom',
  }), []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, st, pkg] = await Promise.all([api.sources.list(), api.sources.stats(), api.subscriptions.packages().catch(() => ({ data: [] }))]);
      setSources(s.data);
      setStats(st);
      setSubscriptionPackages(pkg.data || []);
    } catch (err) {
      setError((err as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, []);

  const buildConfig = (): Record<string, unknown> => {
    switch (form.collectorType) {
      case 'rss':
        return { url: form.url.trim() };
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
        processingProfile: form.processingProfile,
        growthAxes: form.growthAxes,
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

  const handleFetch = async (id: number) => {
    try {
      const resp = await api.fetch.triggerSource(id);
      if (resp.mode === 'sync') {
        const ai = resp.aiProcessed;
        const contentStats = resp.contentStats;
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

  const handleImportPackage = async (pkg: SubscriptionPackageMeta) => {
    setPackageImportingSlug(pkg.slug);
    setError(null);
    setNotice(null);
    try {
      const result = await api.subscriptions.importPackage(pkg.slug, {
        categoryDefault: 'hn-popular-blogs',
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
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">信源管理</h1>
          {stats && <p className="text-sm text-zinc-500 mt-1">共 {stats.total} 个信源</p>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleImportClick}
            disabled={importing}
            className="flex items-center gap-1.5 px-4 py-2 text-sm border border-zinc-300 text-zinc-700 rounded-lg hover:bg-zinc-50 disabled:opacity-50"
          >
            <Upload size={14} />
            {importing ? '导入中...' : '导入 OPML'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".opml,.xml,text/xml,application/xml"
            className="hidden"
            onChange={handleImportFile}
          />

          <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-800">
            <Plus size={14} /> 添加信源
          </button>
        </div>
      </div>

      {notice && (
        <div className="mb-4 px-3 py-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg">
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-4 px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      )}

      {subscriptionPackages.length > 0 && (
        <div className="mb-6 grid gap-3">
          {subscriptionPackages.map((pkg) => (
            <div key={pkg.slug} className="rounded-xl border border-amber-200 bg-[linear-gradient(135deg,_rgba(254,243,199,0.55),_rgba(255,255,255,0.96))] p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-amber-700/80">Bundled Test Package</div>
                  <h2 className="mt-1 text-base font-semibold text-zinc-900">{pkg.title}</h2>
                  <p className="mt-1 text-sm text-zinc-600">{pkg.description}</p>
                  <p className="mt-1 text-xs text-zinc-500">内置 {pkg.sourceCount} 个真实博客源，适合验证 RSS 抓取、AI 评分、摘要、翻译与规则过滤。</p>
                </div>
                <button
                  onClick={() => void handleImportPackage(pkg)}
                  disabled={packageImportingSlug === pkg.slug}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-amber-900 hover:bg-amber-50 disabled:opacity-50"
                >
                  <Upload size={14} />
                  {packageImportingSlug === pkg.slug ? '导入中...' : '导入测试包'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-6 border border-zinc-200 rounded-xl bg-white p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-800 flex items-center gap-1.5">
              <Compass size={14} /> 快速发现订阅
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">借鉴成熟订阅流程：关键词/URL 探测 → 预览候选 → 一键订阅</p>
          </div>
          <input
            value={discoverCategory}
            onChange={(e) => setDiscoverCategory(e.target.value)}
            placeholder="默认分类"
            className="w-36 px-2.5 py-1.5 text-xs border border-zinc-200 rounded-lg"
          />
        </div>

        <form onSubmit={handleDiscover} className="space-y-2">
          <div className="flex bg-zinc-100 rounded-lg p-0.5 w-fit">
            {(['search', 'rss', 'rsshub'] as DiscoverMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDiscoverMode(mode)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${discoverMode === mode ? 'bg-white shadow-sm font-medium' : 'text-zinc-500 hover:text-zinc-700'}`}
              >
                {mode === 'search' ? '搜索' : mode === 'rss' ? 'RSS URL' : 'RSSHub 路由'}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={discoverQuery}
              onChange={(e) => setDiscoverQuery(e.target.value)}
              placeholder={discoverMode === 'rsshub' ? 'rsshub://github/trending/daily' : '关键词、站点 URL 或 RSS 链接'}
              className="flex-1 px-3 py-2 text-sm border border-zinc-200 rounded-lg"
            />
            <button
              type="submit"
              disabled={discoverLoading}
              className="px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {discoverLoading ? '发现中...' : '发现'}
            </button>
          </div>
        </form>

        {discoverError && (
          <p className="mt-2 text-xs text-red-600">{discoverError}</p>
        )}

        {discoverResults.length > 0 && (
          <div className="mt-3 space-y-2 max-h-72 overflow-y-auto">
            {discoverResults.map((candidate) => (
              <div key={candidate.discoveryKey} className="border border-zinc-100 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-zinc-800 truncate">{candidate.title}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">
                        {candidate.collectorType}
                      </span>
                      {candidate.alreadySubscribed && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                          已订阅
                        </span>
                      )}
                    </div>
                    {candidate.feedUrl && (
                      <p className="text-xs text-zinc-500 truncate mt-0.5">{candidate.feedUrl}</p>
                    )}
                    {candidate.sampleItems[0]?.title && (
                      <p className="text-xs text-zinc-400 truncate mt-0.5">示例：{candidate.sampleItems[0].title}</p>
                    )}
                  </div>
                  <button
                    onClick={() => void handleSubscribeCandidate(candidate)}
                    disabled={Boolean(candidate.alreadySubscribed) || subscribingKey === candidate.discoveryKey}
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-200 hover:bg-zinc-50 disabled:opacity-40"
                  >
                    {subscribingKey === candidate.discoveryKey ? '订阅中...' : candidate.alreadySubscribed ? '已订阅' : '订阅'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="mb-6 p-4 bg-zinc-50 rounded-xl border border-zinc-200 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="信源名称"
              required
              className="px-3 py-2 border border-zinc-200 rounded-lg text-sm"
            />
            <select
              value={form.collectorType}
              onChange={(e) => {
                const collectorType = e.target.value as CollectorType;
                const recommended = getRecommendedProfile(collectorType);
                setForm((prev) => ({
                  ...prev,
                  collectorType,
                  sourceType: sourceTypeByCollector[collectorType],
                  sourceTier: recommended.sourceTier,
                  processingProfile: recommended.processingProfile,
                  growthAxes: recommended.growthAxes,
                }));
              }}
              className="px-3 py-2 border border-zinc-200 rounded-lg text-sm"
            >
              {collectorOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {(form.collectorType === 'rss' || form.collectorType === 'changedetection') && (
            <input
              value={form.url}
              onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
              placeholder={form.collectorType === 'rss' ? 'RSS URL' : '网页 URL'}
              required
              className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm"
            />
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs font-medium text-zinc-600">信源分级</span>
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
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3">
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
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-zinc-200 bg-white">
              <div>
                <div className="text-sm font-medium text-zinc-800">自动抓取</div>
                <div className="text-xs text-zinc-500 mt-0.5">关闭后不参加 cron，但仍可手动点“立即采集”。</div>
              </div>
              <input
                type="checkbox"
                checked={form.autoFetchEnabled}
                onChange={(e) => setForm((prev) => ({ ...prev, autoFetchEnabled: e.target.checked }))}
                className="mt-1"
              />
            </label>
            <label className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-zinc-200 bg-white">
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

          <label className="flex items-start justify-between gap-3 px-3 py-2 rounded-lg border border-zinc-200 bg-white">
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

          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-800">添加</button>
            <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700">取消</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-center py-20 text-zinc-400">加载中...</div>
      ) : (
        <div className="space-y-2">
          {sources.map((source) => {
            const schedule = scheduleLabel(source);
            const freshness = freshnessLabel(source);
            return (
              <div key={source.id} className="flex items-center gap-3 p-3 rounded-lg border border-zinc-100 hover:border-zinc-200 transition-colors">
              <div className={`w-2 h-2 rounded-full ${source.status === 'active' ? 'bg-emerald-500' : source.status === 'error' ? 'bg-red-500' : 'bg-zinc-300'}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-900 truncate">{source.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded">{source.collectorType}</span>
                  {source.sourceTier && <span className="text-[10px] px-1.5 py-0.5 bg-sky-100 text-sky-700 rounded">{SOURCE_TIER_OPTIONS.find((option) => option.value === source.sourceTier)?.label || source.sourceTier}</span>}
                  {source.processingProfile && <span className="text-[10px] px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded">{PROCESSING_PROFILE_OPTIONS.find((option) => option.value === source.processingProfile)?.label || source.processingProfile}</span>}
                  <span className="text-[10px] text-zinc-400">{source.category}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${(source.autoFetchEnabled ?? true) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {(source.autoFetchEnabled ?? true) ? '自动抓取开' : '自动抓取关'}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${source.autoTranscribe ? 'bg-sky-100 text-sky-700' : 'bg-zinc-100 text-zinc-500'}`}>
                    {source.autoTranscribe ? '自动转写开' : '自动转写关'}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${schedule.className}`}>
                    {schedule.label}
                  </span>
                  {freshness && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${freshness.className}`}>
                      {freshness.label}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-[10px] text-zinc-400">健康: {source.healthScore}%</span>
                  {typeof source.trustScore === 'number' && <span className="text-[10px] text-zinc-300">可信 {source.trustScore}</span>}
                  {typeof source.noiseScore === 'number' && <span className="text-[10px] text-zinc-300">噪音 {source.noiseScore}</span>}
                  <span className="text-[10px] text-zinc-300">周期: {source.fetchInterval ?? 60} 分钟</span>
                  {source.lastFetchedAt && <span className="text-[10px] text-zinc-300">上次采集: {new Date(source.lastFetchedAt).toLocaleString()}</span>}
                  {source.lastSuccessAt && <span className="text-[10px] text-zinc-300">上次成功: {new Date(source.lastSuccessAt).toLocaleString()}</span>}
                  {source.nextFetchAt && <span className="text-[10px] text-zinc-300">下次调度: {new Date(source.nextFetchAt).toLocaleString()}</span>}
                  {source.lastOutcome && <span className="text-[10px] text-zinc-300">结果: {source.lastOutcome}</span>}
                  {source.staleReason && <span className="text-[10px] text-amber-500 truncate max-w-60">{source.staleReason}</span>}
                  {source.lastError && <span className="text-[10px] text-red-400 truncate max-w-60">{source.lastError}</span>}
                </div>
                <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={source.sourceTier || 'B'}
                      onChange={(e) => {
                        void handleSourceStrategyUpdate(
                          source,
                          { sourceTier: e.target.value as SourceTier },
                          `已更新「${source.name}」的信源分级`,
                        );
                      }}
                      className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[11px] text-zinc-700"
                    >
                      {SOURCE_TIER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <select
                      value={source.processingProfile || 'brief'}
                      onChange={(e) => {
                        void handleSourceStrategyUpdate(
                          source,
                          { processingProfile: e.target.value as ProcessingProfile },
                          `已更新「${source.name}」的处理档位`,
                        );
                      }}
                      className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[11px] text-zinc-700"
                    >
                      {PROCESSING_PROFILE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {GROWTH_AXIS_OPTIONS.map((axis) => {
                      const active = source.growthAxes?.includes(axis);
                      return (
                        <button
                          key={axis}
                          type="button"
                          onClick={() => {
                            void handleToggleSourceAxis(source, axis);
                          }}
                          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                            active
                              ? 'border-zinc-900 bg-zinc-900 text-white'
                              : 'border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50'
                          }`}
                        >
                          {axis}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => void handleToggleAutoFetch(source)}
                  className={`p-1.5 rounded hover:bg-zinc-100 ${(source.autoFetchEnabled ?? true) ? 'text-emerald-600' : 'text-zinc-400'}`}
                  title={(source.autoFetchEnabled ?? true) ? '关闭自动抓取' : '开启自动抓取'}
                >
                  {(source.autoFetchEnabled ?? true) ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button
                  onClick={() => void handleToggleAutoTranscribe(source)}
                  className={`p-1.5 rounded hover:bg-zinc-100 ${source.autoTranscribe ? 'text-sky-600' : 'text-zinc-400'}`}
                  title={source.autoTranscribe ? '关闭自动转写' : '开启自动转写'}
                >
                  <Headphones size={14} />
                </button>
                <button onClick={() => void handleFetch(source.id)} className="p-1.5 rounded hover:bg-zinc-100" title="立即采集">
                  <RefreshCw size={14} className="text-zinc-400" />
                </button>
                <button onClick={() => void handleToggleStatus(source.id, source.status)} className="p-1.5 rounded hover:bg-zinc-100" title={source.status === 'active' ? '暂停信源' : '恢复信源'}>
                  {source.status === 'active' ? <Pause size={14} className="text-zinc-400" /> : <Play size={14} className="text-zinc-400" />}
                </button>
                <button onClick={() => void handleDelete(source.id)} className="p-1.5 rounded hover:bg-red-50" title="删除">
                  <Trash2 size={14} className="text-zinc-300 hover:text-red-500" />
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
