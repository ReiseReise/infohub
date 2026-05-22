import { useEffect, useMemo, useState, useCallback } from 'react';
import { ExternalLink, RefreshCw, Search, Star, CheckCheck, FileText, Loader2, Headphones, ChevronDown, SkipForward } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type FeedItemRecord, type FetchStatusResponse, type ItemScoreBreakdownPayload, type ItemsStats, type PreferenceProfileSummary, type SourceRecord } from '../../lib/api';
import { MarkdownContent } from '../../components/MarkdownContent';

type FeedItem = FeedItemRecord;
type FeedSortMode = 'latest' | 'priority';

type DetailSectionKey = 'summary' | 'original' | 'translation' | 'transcript' | 'knowledge';
type DetailSection = {
  key: DetailSectionKey;
  label: string;
  content?: string | null;
  emptyMessage: string;
  isEmpty?: boolean;
  renderMode?: 'auto' | 'markdown' | 'plain';
};

function normalizeAiSummary(raw?: string | null): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const normalized = fenced?.[1]?.trim() || trimmed;

  try {
    const parsed = JSON.parse(normalized) as { summary?: string; one_sentence?: string };
    return (parsed.summary || parsed.one_sentence || normalized).trim();
  } catch {
    return normalized;
  }
}

function asValidDate(date?: string | null): Date | null {
  if (!date) return null;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasReadableText(value?: string | null): boolean {
  return Boolean(value && value.trim().length > 12);
}

function contentStatusLabel(item?: FeedItem | null) {
  switch (item?.contentStatus) {
    case 'fetching':
      return '正文补抓中';
    case 'ready':
      return hasReadableText(item?.content) ? '正文已缓存' : '仅有片段';
    case 'degraded':
      return item?.contentBasis === 'snippet' ? '仅有摘要片段' : '仅有标题信息';
    case 'failed':
      return '正文抓取失败';
    case 'unavailable':
      return '无可抓正文';
    default:
      return '待补正文';
  }
}

function translationStatusLabel(item?: FeedItem | null) {
  switch (item?.translationStatus) {
    case 'ready':
      return '翻译已完成';
    case 'failed':
      return item?.translationReason || '翻译失败';
    case 'skipped':
      return item?.translationReason || '翻译已跳过';
    default:
      return '等待翻译';
  }
}

function summaryStatusLabel(item?: FeedItem | null) {
  const basisLabel = item?.summaryBasis === 'content'
    ? '正文'
    : item?.summaryBasis === 'snippet'
      ? '片段'
      : item?.summaryBasis === 'title'
        ? '标题'
        : '';
  switch (item?.summaryStatus) {
    case 'ready':
      return basisLabel ? `摘要已生成 · 基于${basisLabel}` : '摘要已生成';
    case 'failed':
      return '摘要失败';
    case 'skipped':
      return '摘要已跳过';
    default:
      return '等待摘要';
  }
}

function contentBasisLabel(item?: FeedItem | null) {
  switch (item?.contentBasis) {
    case 'content':
      return '当前基于正文';
    case 'snippet':
      return '当前基于片段';
    case 'title':
      return '当前仅基于标题';
    default:
      return '';
  }
}

function fetchEngineLabel(item?: FeedItem | null): string {
  switch (item?.fetchEngine) {
    case 'native':
      return '原生提取';
    case 'scrapling-http':
      return 'Scrapling HTTP';
    case 'scrapling-dynamic':
      return 'Scrapling Dynamic';
    case 'scrapling-stealth':
      return 'Scrapling Stealth';
    case 'browser-assist':
      return 'Browser Assist';
    default:
      return '';
  }
}

function renderModeLabel(mode?: string | null): string {
  switch ((mode || '').trim()) {
    case 'native':
      return 'native';
    case 'dynamic':
      return 'dynamic';
    case 'stealth':
      return 'stealth';
    case 'auto':
      return 'auto';
    case 'browser-assist':
      return 'browser-assist';
    default:
      return '';
  }
}

function isMostlyChineseText(value?: string | null): boolean {
  const text = (value || '').trim();
  if (!text) return false;
  const hanCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinCount = (text.match(/[A-Za-z]/g) || []).length;
  if (hanCount >= 24) return true;
  if (hanCount >= 10 && hanCount >= latinCount / 2) return true;
  return hanCount > 0 && latinCount <= 12;
}

function looksTruncatedText(value?: string | null): boolean {
  const text = (value || '').trim();
  if (!text) return false;
  if (/[—\-–:：,，、（(]$/.test(text)) return true;
  return /(evidenced|including|such as|for example|例如|比如|包括)$/i.test(text);
}

function needsEnrich(item?: FeedItem | null): boolean {
  if (!item) return false;
  if (item.contentStatus === 'missing' || item.contentStatus === 'failed' || item.contentStatus === 'degraded') return true;
  if (!hasReadableText(item.content) && !hasReadableText(item.snippet)) return true;
  if (item.summaryStatus === 'pending' && !normalizeAiSummary(item.aiSummary)) return true;
  if (normalizeAiSummary(item.aiSummary) && !isMostlyChineseText(normalizeAiSummary(item.aiSummary))) return true;
  if (item.translationStatus === 'pending' && !hasReadableText(item.aiTranslation)) return true;
  if (hasReadableText(item.aiTranslation) && looksTruncatedText(item.aiTranslation)) return true;
  return false;
}

function isMonitorCategory(category?: string | null): boolean {
  const normalized = (category || '').trim().toLowerCase();
  return normalized === '监控' || normalized === 'monitor';
}

const FEEDBACK_ACTIONS: Array<{
  type: NonNullable<FeedItem['latestFeedbackType']>;
  label: string;
  activeClassName: string;
  idleClassName: string;
}> = [
  { type: 'must_read', label: '值得重点关注', activeClassName: 'bg-teal-600 text-white border-teal-600', idleClassName: 'border-teal-200 text-teal-700 hover:bg-teal-50' },
  { type: 'like', label: '更想看', activeClassName: 'bg-emerald-600 text-white border-emerald-600', idleClassName: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50' },
  { type: 'dislike', label: '少给我看', activeClassName: 'bg-amber-500 text-white border-amber-500', idleClassName: 'border-amber-200 text-amber-700 hover:bg-amber-50' },
  { type: 'not_for_me', label: '不符合口味', activeClassName: 'bg-rose-600 text-white border-rose-600', idleClassName: 'border-rose-200 text-rose-700 hover:bg-rose-50' },
];

const FEEDBACK_REASON_TAG_OPTIONS = [
  'AI行业',
  '模型能力',
  'Agent',
  '产品落地',
  '应用案例',
  '资本市场',
  '监管政策',
  '头部舆论',
  '公司战略',
  '太泛',
  '标题党',
  '信息噪音',
] as const;

const PROCESSING_PROFILE_LABELS: Record<string, string> = {
  full: '深加工',
  smart: '智能加工',
  brief: '轻摘要',
  monitor: '仅监控',
};

function sourceTierBadge(item?: FeedItem | null) {
  switch (item?.sourceTier) {
    case 'T1':
      return { label: 'T1一手', className: 'bg-rose-100 text-rose-700' };
    case 'T1.5':
      return { label: 'T1.5官方社媒', className: 'bg-orange-100 text-orange-700' };
    case 'T2':
      return { label: 'T2讨论', className: 'bg-amber-100 text-amber-700' };
    case 'S':
      return { label: 'S级信号', className: 'bg-rose-100 text-rose-700' };
    case 'A':
      return { label: 'A级分析', className: 'bg-sky-100 text-sky-700' };
    case 'C':
      return { label: 'C级观察', className: 'bg-amber-100 text-amber-700' };
    case 'D':
      return { label: 'D级哨兵', className: 'bg-zinc-100 text-zinc-500' };
    default:
      return { label: 'B级资讯', className: 'bg-emerald-100 text-emerald-700' };
  }
}

function sourceKindLabel(kind?: string | null) {
  const labels: Record<string, string> = {
    official: '官方/一手',
    blog: '博客/研究',
    rss: 'RSS',
    x: 'X/KOL',
    wechat: '公众号',
    media: '媒体',
    api: 'API',
    webpage: '网页',
    podcast: '播客',
    other: '其他',
  };
  return kind ? labels[kind] || kind : '';
}

export function Feed() {
  const navigate = useNavigate();
  const { id: selectedIdFromRoute } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialFilterParam = searchParams.get('filter');
  const initialFilter = initialFilterParam === 'unread' || initialFilterParam === 'favorites'
    ? initialFilterParam
    : 'all';
  const initialSortParam = searchParams.get('sort');
  const initialSort = initialSortParam === 'priority' ? 'priority' : 'latest';

  const [items, setItems] = useState<FeedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<FeedItem | null>(null);
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [filter, setFilter] = useState<'all' | 'unread' | 'favorites'>(initialFilter);
  const [sortMode, setSortMode] = useState<FeedSortMode>(initialSort);
  const [category, setCategory] = useState(() => searchParams.get('category') || '');
  const [sourceId, setSourceId] = useState(() => searchParams.get('sourceId') || '');
  const [sourceRail, setSourceRail] = useState<SourceRecord[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [stats, setStats] = useState<ItemsStats | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [audioSubmittingId, setAudioSubmittingId] = useState<string | null>(null);
  const [aiReprocessingId, setAiReprocessingId] = useState<string | null>(null);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [autoEnrichedIds, setAutoEnrichedIds] = useState<Record<string, boolean>>({});
  const [activeDetailTab, setActiveDetailTab] = useState<DetailSectionKey>('summary');
  const [scoreBreakdown, setScoreBreakdown] = useState<ItemScoreBreakdownPayload | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [feedbackSubmittingType, setFeedbackSubmittingType] = useState<string | null>(null);
  const [selectedFeedbackTags, setSelectedFeedbackTags] = useState<string[]>([]);
  const [preferenceSummary, setPreferenceSummary] = useState<PreferenceProfileSummary | null>(null);
  const [fetchStatus, setFetchStatus] = useState<FetchStatusResponse | null>(null);
  const [dueRefreshing, setDueRefreshing] = useState(false);
  const limit = 20;

  const fetchItems = useCallback(async () => {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const params: Record<string, string> = { limit: String(limit), offset: String(offset) };
      params.sortBy = sortMode === 'priority' ? 'priority' : 'publishedAt';
      if (search) params.search = search;
      if (filter === 'unread') params.isRead = 'false';
      if (filter === 'favorites') params.isFavorite = 'true';
      if (isMonitorCategory(category)) {
        params.monitorOnly = 'true';
      } else if (category) {
        params.category = category;
      }
      if (sourceId) params.sourceId = sourceId;
      const res = await api.items.list(params);
      setItems((prev) => {
        if (offset === 0) return res.data;
        const seen = new Set(prev.map((item) => item.id));
        return [...prev, ...res.data.filter((item) => !seen.has(item.id))];
      });
      setTotal(res.total);
    } catch (err) {
      setError((err as Error).message || '加载失败');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [offset, filter, category, search, sortMode, sourceId]);

  const fetchStats = useCallback(async () => {
    try {
      const s = await api.items.stats();
      setStats(s);
    } catch { /* non-critical */ }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await api.sources.categories();
      const cats = (res.data as Array<{ category: string }>)
        .map((r) => r.category)
        .filter(Boolean)
        .sort();
      setCategories(cats);
    } catch { /* non-critical */ }
  }, []);

  const fetchSourceRail = useCallback(async () => {
    try {
      const res = await api.sources.list({ sortBy: 'unread', status: 'active' });
      setSourceRail(res.data || []);
    } catch {
      setSourceRail([]);
    }
  }, []);

  const fetchFreshness = useCallback(async () => {
    try {
      const status = await api.fetch.status();
      setFetchStatus(status);
    } catch {
      // ignore
    }
  }, []);

  const fetchPreferenceSummary = useCallback(async () => {
    try {
      const resp = await api.preferences.profile();
      setPreferenceSummary(resp.summary || null);
    } catch {
      setPreferenceSummary(null);
    }
  }, []);

  const fetchDetail = async (itemId: string, silent = false) => {
    if (!silent) setDetailLoading(true);
    setDetailError(null);
    try {
      const resp = await api.items.get(itemId);
      setSelectedItem((prev) =>
        prev?.id === itemId ? { ...prev, ...(resp.data as FeedItem) } : (resp.data as FeedItem)
      );
    } catch (err) {
      const message = (err as Error).message || '详情加载失败';
      setDetailError(message);
      if (!silent) setError(message);
    } finally {
      if (!silent) setDetailLoading(false);
    }
  };

  const fetchScoreBreakdown = useCallback(async (itemId: string) => {
    setBreakdownLoading(true);
    try {
      const resp = await api.items.scoreBreakdown(itemId);
      setScoreBreakdown(resp.data || null);
    } catch {
      setScoreBreakdown(null);
    } finally {
      setBreakdownLoading(false);
    }
  }, []);

  const updateListQuery = useCallback((next: { q?: string; filter?: string; category?: string; sourceId?: string; sort?: FeedSortMode }) => {
    const params = new URLSearchParams(searchParams);
    if (next.q !== undefined) {
      if (next.q) params.set('q', next.q);
      else params.delete('q');
    }
    if (next.filter !== undefined) {
      if (next.filter && next.filter !== 'all') params.set('filter', next.filter);
      else params.delete('filter');
    }
    if (next.category !== undefined) {
      if (next.category) params.set('category', next.category);
      else params.delete('category');
    }
    if (next.sourceId !== undefined) {
      if (next.sourceId) params.set('sourceId', next.sourceId);
      else params.delete('sourceId');
    }
    if (next.sort !== undefined) {
      if (next.sort && next.sort !== 'latest') params.set('sort', next.sort);
      else params.delete('sort');
    }
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    void fetchStats();
    void fetchCategories();
    void fetchFreshness();
    void fetchSourceRail();
    void fetchPreferenceSummary();
  }, [fetchCategories, fetchFreshness, fetchPreferenceSummary, fetchSourceRail, fetchStats]);

  const triggerDueSources = async () => {
    setDueRefreshing(true);
    setError(null);
    try {
      const result = await api.fetch.triggerDue();
      setNotice(`已补抓到期来源：入队 ${result.enqueued ?? 0} 个`);
      await Promise.all([fetchFreshness(), fetchItems()]);
    } catch (err) {
      setError((err as Error).message || '补抓到期来源失败');
    } finally {
      setDueRefreshing(false);
    }
  };

  useEffect(() => {
    const nextSearch = searchParams.get('q') || '';
    const nextFilter = searchParams.get('filter');
    const nextSort = searchParams.get('sort');
    const nextCategory = searchParams.get('category') || '';
    const nextSourceId = searchParams.get('sourceId') || '';
    const normalizedFilter = nextFilter === 'unread' || nextFilter === 'favorites' ? nextFilter : 'all';
    const normalizedSort = nextSort === 'priority' ? 'priority' : 'latest';

    let changed = false;
    if (search !== nextSearch) {
      setSearch(nextSearch);
      changed = true;
    }
    if (filter !== normalizedFilter) {
      setFilter(normalizedFilter);
      changed = true;
    }
    if (sortMode !== normalizedSort) {
      setSortMode(normalizedSort);
      changed = true;
    }
    if (category !== nextCategory) {
      setCategory(nextCategory);
      changed = true;
    }
    if (sourceId !== nextSourceId) {
      setSourceId(nextSourceId);
      changed = true;
    }
    if (changed) {
      setOffset(0);
    }
  }, [searchParams, search, filter, sortMode, category, sourceId]);

  useEffect(() => {
    if (selectedIdFromRoute) {
      const existing = items.find((i) => i.id === selectedIdFromRoute);
      if (existing) {
        setSelectedItem(existing);
        void fetchDetail(selectedIdFromRoute, true);
        void fetchScoreBreakdown(selectedIdFromRoute);
      } else {
        void fetchDetail(selectedIdFromRoute, false);
        void fetchScoreBreakdown(selectedIdFromRoute);
      }
      return;
    }
    setSelectedItem(null);
    setScoreBreakdown(null);
  }, [items, selectedIdFromRoute]);

  const selectedId = selectedItem?.id || selectedIdFromRoute || null;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
    updateListQuery({ q: search.trim() });
  };

  const handleFavorite = async (id: string, current: boolean) => {
    setError(null);
    try {
      await api.items.favorite(id, !current);
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, isFavorite: !current } : i)));
      if (selectedItem?.id === id) {
        setSelectedItem({ ...selectedItem, isFavorite: !current });
      }
    } catch (err) {
      setError((err as Error).message || '收藏更新失败');
    }
  };

  const handleMarkRead = async (id: string) => {
    setError(null);
    try {
      await api.items.markRead(id);
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, isRead: true } : i)));
      if (selectedItem?.id === id) {
        setSelectedItem({ ...selectedItem, isRead: true });
      }
    } catch (err) {
      setError((err as Error).message || '标记已读失败');
    }
  };

  const handleOpenDetail = async (item: FeedItem) => {
    setSelectedItem(item);
    const queryString = searchParams.toString();
    navigate(`/feed/${item.id}${queryString ? `?${queryString}` : ''}`);
    void fetchDetail(item.id, true);
    void fetchScoreBreakdown(item.id);
    if (!item.isRead) void handleMarkRead(item.id);
  };

  const handleFeedback = async (
    item: FeedItem,
    feedbackType: NonNullable<FeedItem['latestFeedbackType']>,
    reasonTags: string[] = [],
  ) => {
    setFeedbackSubmittingType(feedbackType);
    setError(null);
    setNotice(null);
    try {
      const resp = await api.items.feedback(item.id, { feedbackType, reasonTags });
      const latestFeedback = resp.data;
      setSelectedItem((prev) => prev?.id === item.id ? { ...prev, latestFeedbackType: latestFeedback.feedbackType } : prev);
      setItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, latestFeedbackType: latestFeedback.feedbackType } : entry));
      const profileResp = await api.preferences.rebuildProfile().catch(() => null);
      if (profileResp?.summary) setPreferenceSummary(profileResp.summary);
      await fetchScoreBreakdown(item.id);
      setSelectedFeedbackTags([]);
      const tagText = reasonTags.length > 0 ? ` · 标签：${reasonTags.join('、')}` : '';
      setNotice(`已记录反馈：${FEEDBACK_ACTIONS.find((action) => action.type === latestFeedback.feedbackType)?.label || latestFeedback.feedbackType}${tagText}`);
    } catch (err) {
      setError((err as Error).message || '记录反馈失败');
    } finally {
      setFeedbackSubmittingType(null);
    }
  };

  const handleMarkAllRead = async () => {
    setError(null);
    try {
      await api.items.markAllRead();
      setItems((prev) => prev.map((i) => ({ ...i, isRead: true })));
      if (selectedItem) {
        setSelectedItem({ ...selectedItem, isRead: true });
      }
    } catch (err) {
      setError((err as Error).message || '全部已读失败');
    }
  };

  const handleNextUnread = () => {
    if (items.length === 0) return;
    const currentIndex = selectedId ? items.findIndex((item) => item.id === selectedId) : -1;
    const ordered = [...items.slice(currentIndex + 1), ...items.slice(0, Math.max(currentIndex + 1, 0))];
    const nextUnread = ordered.find((item) => !item.isRead);
    if (!nextUnread) {
      setNotice('当前页没有未读条目');
      return;
    }
    void handleOpenDetail(nextUnread);
  };

  const handleTriggerFetch = async () => {
    setFetching(true);
    setError(null);
    setNotice(null);
    try {
      const resp = await api.fetch.trigger();
      setNotice(`采集已触发，入队 ${resp.enqueued ?? 0} 个信源。`);
      setTimeout(() => {
        void fetchItems();
        void fetchStats();
      }, 2500);
    } catch (err) {
      setError((err as Error).message || '触发采集失败');
    } finally {
      setFetching(false);
    }
  };

  const handleStartAudio = async (item: FeedItem) => {
    setAudioSubmittingId(item.id);
    setError(null);
    try {
      const resp = await api.items.startAudio(item.id);
      setItems((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? { ...entry, audioStatus: resp.status, audioTaskId: resp.taskId }
            : entry,
        ),
      );
      if (selectedItem?.id === item.id) {
        setSelectedItem({ ...selectedItem, audioStatus: resp.status, audioTaskId: resp.taskId });
      }
      await fetchDetail(item.id);
    } catch (err) {
      setError((err as Error).message || '启动播客转写失败');
    } finally {
      setAudioSubmittingId(null);
    }
  };

  const handleReprocessAi = async (item: FeedItem) => {
    setAiReprocessingId(item.id);
    setError(null);
    setNotice(null);
    try {
      const resp = await api.items.reprocessAi(item.id);
      setNotice(`AI 重处理完成：评分 ${resp.scored}，摘要 ${resp.summarized}，翻译 ${resp.translated}`);
      await fetchItems();
      await fetchDetail(item.id);
    } catch (err) {
      setError((err as Error).message || '重处理失败');
    } finally {
      setAiReprocessingId(null);
    }
  };

  const handleEnrich = useCallback(async (item: FeedItem, options: { silent?: boolean } = {}) => {
    if (!item?.id) return;
    setEnrichingId(item.id);
    if (options.silent) {
      setAutoEnrichedIds((prev) => ({ ...prev, [item.id]: true }));
    }
    if (!options.silent) {
      setNotice(null);
      setError(null);
    }
    try {
      const resp = await api.items.enrich(item.id);
      if (resp.data) {
        setItems((prev) => prev.map((entry) => (entry.id === item.id ? { ...entry, ...resp.data! } : entry)));
        setSelectedItem((prev) => (prev?.id === item.id ? { ...prev, ...resp.data! } : prev));
      }
      if (!options.silent) {
        const warningText = resp.warnings?.filter(Boolean).join('；');
        const basisText = resp.contentBasis === 'content' ? '正文' : resp.contentBasis === 'snippet' ? '片段' : '标题';
        setNotice(warningText || `补全完成：正文 ${resp.contentFetched ? '已补抓' : '未变化'}（当前基于${basisText}），评分 ${resp.scored}，摘要 ${resp.summarized}，翻译 ${resp.translated}`);
      }
    } catch (err) {
      if (!options.silent) {
        setError((err as Error).message || '补全失败');
      }
    } finally {
      setEnrichingId((prev) => (prev === item.id ? null : prev));
    }
  }, []);

  useEffect(() => {
    if (!selectedItem || enrichingId === selectedItem.id || detailLoading) return;
    if (autoEnrichedIds[selectedItem.id]) return;
    if (!needsEnrich(selectedItem)) return;
    void handleEnrich(selectedItem, { silent: true });
  }, [autoEnrichedIds, detailLoading, enrichingId, handleEnrich, selectedItem]);

  useEffect(() => {
    if (enrichingId) return;
    const target = items.find((item) => !autoEnrichedIds[item.id] && needsEnrich(item));
    if (!target) return;
    void handleEnrich(target, { silent: true });
  }, [autoEnrichedIds, enrichingId, handleEnrich, items]);

  const timeAgo = (date?: string) => {
    const parsed = asValidDate(date);
    if (!parsed) return '';
    const diff = Date.now() - parsed.getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return `${Math.max(1, Math.floor(diff / 60000))}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    return `${Math.floor(hours / 24)}天前`;
  };

  const formatAbsoluteTime = (date?: string) => {
    const parsed = asValidDate(date);
    if (!parsed) return '';
    return parsed.toLocaleString('zh-CN');
  };

  const getPrimaryTimeLabel = (item?: FeedItem | null) => {
    if (!item) return '';
    const publishedAt = asValidDate(item.publishedAt);
    const fetchedAt = asValidDate(item.fetchedAt);
    return publishedAt ? `发布 ${timeAgo(item.publishedAt)}` : fetchedAt ? `抓取 ${timeAgo(item.fetchedAt)}` : '';
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '未知时长';
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const getAudioStatusMeta = (status?: string) => {
    switch (status) {
      case 'pending':
        return { label: '音频排队', className: 'bg-sky-100 text-sky-700' };
      case 'processing':
        return { label: '音频处理中', className: 'bg-indigo-100 text-indigo-700' };
      case 'skipped':
        return { label: '自动跳过', className: 'bg-amber-100 text-amber-700' };
      case 'done':
        return { label: '已转写', className: 'bg-emerald-100 text-emerald-700' };
      case 'error':
        return { label: '转写失败', className: 'bg-red-100 text-red-700' };
      default:
        return { label: '未转写', className: 'bg-zinc-100 text-zinc-500' };
    }
  };

  const getAiStatusMeta = (item?: FeedItem | null) => {
    if (!item) return { label: 'AI未处理', className: 'bg-zinc-100 text-zinc-600' };
    if (item.isFiltered) return { label: '规则过滤', className: 'bg-amber-100 text-amber-700' };
    if (item.translationStatus === 'failed') return { label: '翻译失败', className: 'bg-rose-100 text-rose-700' };
    if (item.summaryStatus === 'failed') return { label: '摘要失败', className: 'bg-orange-100 text-orange-700' };
    if (item.processingStatus === 'score_failed') return { label: '评分失败', className: 'bg-red-100 text-red-700' };
    if (item.translationStatus === 'ready' || item.aiTranslation?.trim()) return { label: '已翻译', className: 'bg-emerald-100 text-emerald-700' };
    if (item.summaryStatus === 'ready' || normalizeAiSummary(item.aiSummary)) return { label: '已摘要', className: 'bg-sky-100 text-sky-700' };
    if (item.aiScore != null) return { label: '已评分', className: 'bg-indigo-100 text-indigo-700' };
    if (item.contentStatus === 'fetching') return { label: '补抓正文中', className: 'bg-cyan-100 text-cyan-700' };
    return { label: '待处理', className: 'bg-zinc-100 text-zinc-600' };
  };

  const detailSections = useMemo(() => {
    if (!selectedItem) return [];
    const summaryText = normalizeAiSummary(selectedItem.aiSummary);
    const sections: DetailSection[] = [
      {
        key: 'summary',
        label: '摘要',
        content: summaryText,
        emptyMessage: `当前还没有摘要结果。${summaryStatusLabel(selectedItem)}${selectedItem.filterReason ? `；${selectedItem.filterReason}` : ''}`,
        isEmpty: !summaryText,
        renderMode: 'auto',
      },
      {
        key: 'original',
        label: '原文',
        content: selectedItem.content || selectedItem.snippet,
        emptyMessage: selectedItem.contentError || `当前没有缓存正文。${contentStatusLabel(selectedItem)}`,
        isEmpty: !(hasReadableText(selectedItem.content) || hasReadableText(selectedItem.snippet)),
        renderMode: 'plain',
      },
      {
        key: 'translation',
        label: '翻译',
        content: selectedItem.aiTranslation,
        emptyMessage: translationStatusLabel(selectedItem),
        isEmpty: !hasReadableText(selectedItem.aiTranslation),
        renderMode: 'plain',
      },
      {
        key: 'transcript',
        label: '转写',
        content: selectedItem.transcript,
        emptyMessage: '当前还没有音频转写结果。',
        isEmpty: !hasReadableText(selectedItem.transcript),
        renderMode: 'plain',
      },
      {
        key: 'knowledge',
        label: '知识',
        content: selectedItem.knowledge,
        emptyMessage: '当前还没有知识提炼结果。',
        isEmpty: !hasReadableText(selectedItem.knowledge),
        renderMode: 'markdown',
      },
    ];
    return sections;
  }, [selectedItem]);

  useEffect(() => {
    if (!detailSections.length) return;
    if (!detailSections.some((section) => section.key === activeDetailTab)) {
      setActiveDetailTab(detailSections[0].key);
    }
  }, [activeDetailTab, detailSections]);

  useEffect(() => {
    setSelectedFeedbackTags([]);
  }, [selectedItem?.id]);

  const selectedHost = useMemo(() => {
    if (!selectedItem?.url) return '';
    try {
      return new URL(selectedItem.url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }, [selectedItem?.url]);

  const selectedSource = useMemo(
    () => sourceRail.find((source) => String(source.id) === sourceId) || null,
    [sourceId, sourceRail],
  );

  const activeDetail = detailSections.find((section) => section.key === activeDetailTab) || detailSections[0];

  const getCollectorLabel = (item?: FeedItem | null) => {
    if (item?.sourceCollectorType === 'changedetection') return '网页变更';
    if (item?.sourceCollectorType === 'webpage') return '网页快照';
    if (item?.mediaType === 'audio') return '播客';
    return item?.sourceType || '条目';
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(13,148,136,0.12),_transparent_30%),linear-gradient(180deg,_#fffdf9_0%,_#f8fafc_100%)] p-4 md:p-6">
      <div className="mb-5 rounded-[28px] border border-teal-100/70 bg-white/85 p-5 shadow-[0_24px_80px_-48px_rgba(15,118,110,0.5)] backdrop-blur">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-[11px] tracking-[0.28em] text-teal-700/70">阅读流</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900">信息流</h1>
          {stats && (
            <p className="text-sm text-zinc-500 mt-2">
              <span className="font-medium text-teal-700">{stats.unread.toLocaleString()} 未读</span>
              <span className="mx-1.5 text-zinc-300">·</span>
              <span>{stats.today.toLocaleString()} 今日</span>
              <span className="mx-1.5 text-zinc-300">·</span>
              <span>{stats.total.toLocaleString()} 可读</span>
              {stats.funnel && (
                <>
                  <span className="mx-1.5 text-zinc-300">·</span>
                  <span>{stats.funnel.allItems.toLocaleString()} 库存</span>
                  <span className="mx-1.5 text-zinc-300">·</span>
                  <span>{stats.funnel.filteredBucketItems.toLocaleString()} 过滤池</span>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleTriggerFetch} className="flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800 transition-colors hover:bg-teal-100">
            {fetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} 采集
          </button>
          <button onClick={handleNextUnread} className="flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors hover:bg-zinc-50">
            <SkipForward size={14} /> 下一条未读
          </button>
          <button onClick={handleMarkAllRead} className="flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors hover:bg-zinc-50">
            <CheckCheck size={14} /> 全部已读
          </button>
        </div>
      </div>
      </div>

      <div className="mb-4 flex flex-col gap-2 xl:flex-row">
        <form onSubmit={handleSearch} className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索标题或内容..."
            className="w-full rounded-2xl border border-zinc-200 bg-white/90 py-3 pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600/10"
          />
        </form>
        <div className="flex rounded-2xl bg-white border border-zinc-200 p-1">
          {(['all', 'unread', 'favorites'] as const).map((f) => (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setOffset(0);
                updateListQuery({ filter: f });
              }}
              className={`px-3 py-2 text-xs rounded-xl transition-colors ${filter === f ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              {f === 'all' ? '全部' : f === 'unread' ? `未读${stats ? ` (${stats.unread})` : ''}` : '收藏'}
            </button>
          ))}
        </div>
        <div className="flex rounded-2xl bg-white border border-zinc-200 p-1">
          {([
            { value: 'latest', label: '按时间' },
            { value: 'priority', label: '按优先级' },
          ] as Array<{ value: FeedSortMode; label: string }>).map((option) => (
            <button
              key={option.value}
              onClick={() => {
                setSortMode(option.value);
                setOffset(0);
                updateListQuery({ sort: option.value });
              }}
              className={`px-3 py-2 text-xs rounded-xl transition-colors ${sortMode === option.value ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {categories.length > 0 && (
          <div className="relative">
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setOffset(0);
                updateListQuery({ category: e.target.value });
              }}
              className="appearance-none rounded-2xl border border-zinc-200 bg-white py-3 pl-3 pr-7 text-xs text-zinc-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-600/10"
            >
              <option value="">全部分类</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          </div>
        )}
        {sourceRail.length > 0 && (
          <div className="relative">
            <select
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setOffset(0);
                updateListQuery({ sourceId: e.target.value });
              }}
              className="max-w-[220px] appearance-none rounded-2xl border border-zinc-200 bg-white py-3 pl-3 pr-7 text-xs text-zinc-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-600/10"
            >
              <option value="">全部来源</option>
              {sourceRail.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}{source.unreadCount ? ` · ${source.unreadCount} 未读` : ''}
                </option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          </div>
        )}
        {sourceId && (
          <button
            onClick={() => {
              setSourceId('');
              setOffset(0);
              updateListQuery({ sourceId: '' });
            }}
            className="rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-xs text-zinc-600 hover:bg-zinc-50"
          >
            清除来源筛选
          </button>
        )}
      </div>

      {selectedSource && (
        <div className="mb-4 rounded-[24px] border border-teal-100 bg-[linear-gradient(135deg,_rgba(240,253,250,0.9),_rgba(255,255,255,0.96))] px-4 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-[11px] tracking-[0.24em] text-teal-700/75">当前来源</div>
              <div className="mt-1 text-lg font-semibold text-zinc-900">{selectedSource.name}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                {selectedSource.sourceHost && <span>{selectedSource.sourceHost}</span>}
                <span>{selectedSource.unreadCount ?? 0} 未读</span>
                <span>{selectedSource.entryCount ?? 0} 条可读</span>
                <span>{selectedSource.filteredCount ?? 0} 条过滤</span>
                <span>{selectedSource.itemCount ?? 0} 条总量</span>
                {selectedSource.latestItemAt && <span>最近更新 {timeAgo(selectedSource.latestItemAt)}</span>}
              </div>
              {selectedSource.latestItemTitle && (
                <div className="mt-2 text-sm text-zinc-700">最新一条：{selectedSource.latestItemTitle}</div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setFilter('unread');
                  setOffset(0);
                  updateListQuery({ filter: 'unread' });
                }}
                className="rounded-xl border border-teal-200 bg-white px-3 py-2 text-xs text-teal-800 hover:bg-teal-50"
              >
                只看未读
              </button>
              <button
                type="button"
                onClick={() => {
                  setSourceId('');
                  setOffset(0);
                  updateListQuery({ sourceId: '' });
                }}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50"
              >
                退出来源聚焦
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 px-3 py-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg">
          {notice}
        </div>
      )}
      {fetchStatus?.freshnessStatus && fetchStatus.freshnessStatus !== 'fresh' && (
        <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${fetchStatus.freshnessStatus === 'stale' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-medium">
                {fetchStatus.freshnessStatus === 'stale' ? '当前数据可能已经过期' : '当前有到期来源待补抓'}
              </div>
              <div className="text-xs opacity-90">
                {fetchStatus.staleReason || '抓取调度尚未把最新内容补进来。'}
                {fetchStatus.lastSuccessfulFetchAt ? ` 最近成功抓取：${new Date(fetchStatus.lastSuccessfulFetchAt).toLocaleString('zh-CN')}` : ''}
              </div>
            </div>
            <button
              onClick={() => void triggerDueSources()}
              disabled={dueRefreshing}
              className="rounded-lg border border-current px-3 py-2 text-xs hover:bg-white/40 disabled:opacity-50"
            >
              {dueRefreshing ? '补抓中...' : '立即补抓到期来源'}
            </button>
          </div>
        </div>
      )}

      <div className="grid min-h-[520px] grid-cols-1 gap-4 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.3fr)]">
        <div className="overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white shadow-[0_24px_60px_-48px_rgba(15,23,42,0.5)]">
          {loading ? (
            <div className="text-center py-20 text-zinc-400">加载中...</div>
          ) : items.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="text-base font-semibold text-zinc-800">当前筛选下没有可读内容</div>
              <div className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-500">
                {sourceId
                  ? '该来源可能暂无主 Feed 可读内容，或内容已进入过滤池。'
                  : '当前账号主 Feed 暂无可读内容。请先查看数据漏斗，确认是账号无数据、内容被过滤，还是历史过滤状态尚未回补。'}
              </div>
              {stats?.funnel && (
                <div className="mx-auto mt-5 grid max-w-lg grid-cols-2 gap-2 text-left sm:grid-cols-4">
                  <div className="rounded-2xl bg-zinc-50 px-3 py-3">
                    <div className="text-[11px] text-zinc-500">库存</div>
                    <div className="mt-1 text-lg font-semibold text-zinc-900">{stats.funnel.allItems}</div>
                  </div>
                  <div className="rounded-2xl bg-zinc-50 px-3 py-3">
                    <div className="text-[11px] text-zinc-500">可读</div>
                    <div className="mt-1 text-lg font-semibold text-teal-700">{stats.funnel.visibleItems}</div>
                  </div>
                  <div className="rounded-2xl bg-zinc-50 px-3 py-3">
                    <div className="text-[11px] text-zinc-500">过滤池</div>
                    <div className="mt-1 text-lg font-semibold text-amber-700">{stats.funnel.filteredBucketItems}</div>
                  </div>
                  <div className="rounded-2xl bg-zinc-50 px-3 py-3">
                    <div className="text-[11px] text-zinc-500">错位</div>
                    <div className="mt-1 text-lg font-semibold text-rose-700">{stats.funnel.mismatchedFilteredMain}</div>
                  </div>
                </div>
              )}
              {stats?.funnel?.mismatchedFilteredMain ? (
                <div className="mx-auto mt-4 max-w-md rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs leading-5 text-rose-700">
                  仍有 {stats.funnel.mismatchedFilteredMain} 条历史内容处于过滤状态错位，需要执行过滤路由回补后再刷新。
                </div>
              ) : null}
            </div>
          ) : (
            <div className="max-h-[72vh] overflow-y-auto divide-y divide-zinc-100">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`group cursor-pointer px-4 py-4 transition-colors ${item.isRead ? 'opacity-65' : ''} ${selectedId === item.id ? 'bg-teal-50/60 border-l-2 border-teal-700' : 'hover:bg-zinc-50'}`}
                  onClick={() => { void handleOpenDetail(item); }}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-2 shrink-0">
                      {!item.isRead
                        ? <div className="h-2.5 w-2.5 rounded-full bg-teal-500 shadow-[0_0_0_4px_rgba(20,184,166,0.14)]" />
                        : <div className="h-2.5 w-2.5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-2 flex-wrap">
                      {item.aiScore != null && (
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${item.aiScore >= 70 ? 'bg-emerald-100 text-emerald-700' : item.aiScore >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-zinc-100 text-zinc-500'}`}>
                          {item.aiScore}
                        </span>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${sourceTierBadge(item).className}`}>
                        {sourceTierBadge(item).label}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${getAiStatusMeta(item).className}`}>
                        {getAiStatusMeta(item).label}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-zinc-100 text-zinc-600 rounded-full">
                        {getCollectorLabel(item)}
                      </span>
                      {fetchEngineLabel(item) && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded-full">
                          {fetchEngineLabel(item)}
                        </span>
                      )}
                      {item.audioStatus && item.audioStatus !== 'none' && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${getAudioStatusMeta(item.audioStatus).className}`}>
                          {getAudioStatusMeta(item.audioStatus).label}
                        </span>
                      )}
                    </div>
                    <h3 className={`text-[15px] leading-6 line-clamp-2 ${item.isRead ? 'text-zinc-500 font-medium' : 'text-zinc-900 font-semibold'}`}>{item.title}</h3>
                    {normalizeAiSummary(item.aiSummary) && <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">{normalizeAiSummary(item.aiSummary)}</p>}
                    {!normalizeAiSummary(item.aiSummary) && item.snippet && <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-400">{item.snippet}</p>}
                    <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!item.sourceId) return;
                          setSourceId(String(item.sourceId));
                          setOffset(0);
                          updateListQuery({ sourceId: String(item.sourceId) });
                        }}
                        className="max-w-[180px] truncate text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-400 hover:text-teal-700"
                      >
                        {item.sourceName}
                      </button>
                      {item.sourceCategory && item.sourceCategory !== 'uncategorized' && (
                        <span className="text-[10px] bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full">{item.sourceCategory}</span>
                      )}
                      {item.processingProfile && (
                        <span className="text-[10px] bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded-full">
                          {PROCESSING_PROFILE_LABELS[item.processingProfile] || item.processingProfile}
                        </span>
                      )}
                      {(item.growthAxes || []).slice(0, 2).map((axis) => (
                        <span key={axis} className="text-[10px] bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded-full">
                          {axis}
                        </span>
                      ))}
                      {getPrimaryTimeLabel(item) && (
                        <span className="text-[10px] text-zinc-400">{getPrimaryTimeLabel(item)}</span>
                      )}
                      {item.fetchedAt && (
                        <span className="text-[10px] text-zinc-300">抓取于 {formatAbsoluteTime(item.fetchedAt)}</span>
                      )}
                    </div>
                  </div>
                  {item.mediaUrl && item.mediaType === 'image' && (
                    <img
                      src={item.mediaUrl}
                      alt=""
                      className="mt-1 h-16 w-16 shrink-0 rounded-xl border border-zinc-200 object-cover"
                    />
                  )}

                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleFavorite(item.id, item.isFavorite);
                      }}
                      className="rounded-lg p-1.5 hover:bg-zinc-100"
                    >
                      <Star size={14} className={item.isFavorite ? 'fill-amber-400 text-amber-400' : 'text-zinc-300'} />
                    </button>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener"
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-lg p-1.5 hover:bg-zinc-100"
                    >
                      <ExternalLink size={14} className="text-zinc-300" />
                    </a>
                  </div>
                  </div>
                </div>
              ))}
              {items.length < total && (
                <div className="px-4 py-4">
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() => setOffset(items.length)}
                    className="flex w-full items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50"
                  >
                    {loadingMore ? '加载中...' : `加载更多（已显示 ${items.length} / ${total}）`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="max-h-[72vh] overflow-y-auto rounded-[32px] border border-zinc-200/80 bg-white p-5 shadow-[0_24px_80px_-52px_rgba(15,23,42,0.45)]">
          {detailLoading ? (
            <div className="text-center py-20 text-zinc-400">加载详情...</div>
          ) : selectedItem ? (
            <>
              {detailError && (
                <div className="mb-3 px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                  {detailError}
                </div>
              )}
              <div className="sticky top-0 z-10 -mx-5 -mt-5 mb-5 border-b border-zinc-100 bg-white/92 px-5 py-4 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-[0.24em] text-teal-700/70">{getCollectorLabel(selectedItem)}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${sourceTierBadge(selectedItem).className}`}>
                      {sourceTierBadge(selectedItem).label}
                    </span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${getAiStatusMeta(selectedItem).className}`}>
                      {getAiStatusMeta(selectedItem).label}
                    </span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${getAudioStatusMeta(selectedItem.audioStatus).className}`}>
                      {getAudioStatusMeta(selectedItem.audioStatus).label}
                    </span>
                    {selectedItem.audioDuration ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">时长 {formatDuration(selectedItem.audioDuration)}</span>
                    ) : null}
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold leading-9 tracking-tight text-zinc-900">{selectedItem.title}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span>{selectedItem.sourceName || '未知信源'}{selectedHost ? ` / ${selectedHost}` : ''}</span>
                    {selectedItem.publishedAt && (
                      <span>发布时间 {formatAbsoluteTime(selectedItem.publishedAt)}{getPrimaryTimeLabel(selectedItem) ? ` · ${timeAgo(selectedItem.publishedAt)}` : ''}</span>
                    )}
                    {selectedItem.fetchedAt && (
                      <span>抓取时间 {formatAbsoluteTime(selectedItem.fetchedAt)}</span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {(selectedItem.mediaType === 'audio' || !!selectedItem.mediaUrl) && (
                    <button
                      onClick={() => {
                        void handleStartAudio(selectedItem);
                      }}
                      disabled={audioSubmittingId === selectedItem.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50"
                    >
                      {audioSubmittingId === selectedItem.id ? <Loader2 size={12} className="animate-spin" /> : <Headphones size={12} />}
                      {selectedItem.audioTaskId ? '重新转写' : '播客转写'}
                    </button>
                  )}
                  {selectedItem.audioTaskId && (
                    <button
                      onClick={() => navigate(`/audio?taskId=${selectedItem.audioTaskId}`)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-zinc-200 hover:bg-zinc-50"
                    >
                      查看音频任务
                    </button>
                  )}
                  <a
                    href={selectedItem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-900"
                  >
                    原文
                    <ExternalLink size={12} />
                  </a>
                  <button
                    onClick={() => {
                      void handleReprocessAi(selectedItem);
                    }}
                    disabled={aiReprocessingId === selectedItem.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {aiReprocessingId === selectedItem.id ? <Loader2 size={12} className="animate-spin" /> : null}
                    重跑AI
                  </button>
                  <button
                    onClick={() => {
                      void handleEnrich(selectedItem);
                    }}
                    disabled={enrichingId === selectedItem.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100 disabled:opacity-50"
                  >
                    {enrichingId === selectedItem.id ? <Loader2 size={12} className="animate-spin" /> : null}
                    补抓正文
                  </button>
                </div>
              </div>
              </div>

              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {selectedItem.aiScore != null && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700">AI评分 {selectedItem.aiScore}</span>
                )}
                {selectedItem.processingStatus && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700">处理阶段 {selectedItem.processingStatus}</span>
                )}
                {selectedItem.processingProfile && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">
                    {PROCESSING_PROFILE_LABELS[selectedItem.processingProfile] || selectedItem.processingProfile}
                  </span>
                )}
                {sourceKindLabel(selectedItem.sourceKind) && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-teal-50 text-teal-700">{sourceKindLabel(selectedItem.sourceKind)}</span>
                )}
                {selectedItem.authorityWeight != null && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">权威 {Number(selectedItem.authorityWeight).toFixed(2)}</span>
                )}
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-700">{contentStatusLabel(selectedItem)}</span>
                {fetchEngineLabel(selectedItem) ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">{fetchEngineLabel(selectedItem)}</span>
                ) : null}
                {renderModeLabel(selectedItem.renderMode) ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-fuchsia-50 text-fuchsia-700">渲染 {renderModeLabel(selectedItem.renderMode)}</span>
                ) : null}
                {contentBasisLabel(selectedItem) ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">{contentBasisLabel(selectedItem)}</span>
                ) : null}
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-700">{summaryStatusLabel(selectedItem)}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{translationStatusLabel(selectedItem)}</span>
                {(selectedItem.aiTags || []).slice(0, 6).map((tag) => (
                  <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">
                    {tag}
                  </span>
                ))}
                {(selectedItem.growthAxes || []).map((axis) => (
                  <span key={axis} className="text-[11px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-700">
                    {axis}
                  </span>
                ))}
              </div>

              {selectedItem.eventCluster && (
                <div className="mt-4 rounded-2xl border border-teal-100 bg-teal-50/50 px-4 py-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-xs font-semibold text-teal-900">事件簇</div>
                      <div className="mt-1 text-xs leading-5 text-teal-800">{selectedItem.eventCluster.recommendationReason}</div>
                    </div>
                    <div className="text-xs text-teal-800">
                      关联讨论 {selectedItem.eventCluster.relatedCount} 条
                      {selectedItem.eventCluster.leadItemId === selectedItem.id ? ' · 当前为主条' : ' · 当前为关联条'}
                    </div>
                  </div>
                  {selectedItem.eventCluster.relatedItems.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {selectedItem.eventCluster.relatedItems.slice(0, 6).map((entry) => (
                        <a
                          key={entry.id}
                          href={entry.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block rounded-xl border border-teal-100 bg-white/80 px-3 py-2 hover:bg-white"
                        >
                          <div className="line-clamp-1 text-sm font-medium text-zinc-900">{entry.title}</div>
                          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                            <span>{entry.sourceName || '未知来源'}</span>
                            {entry.sourceKind && <span>{sourceKindLabel(entry.sourceKind)}</span>}
                            {entry.aiScore != null && <span>AI {entry.aiScore}</span>}
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-xs font-semibold text-zinc-800">人类反馈</div>
                    <div className="mt-1 text-xs text-zinc-500">直接告诉系统这条是否更符合你的精选口味。当前偏好会用于后续评分技能和偏好画像。</div>
                  </div>
                  {selectedItem.latestFeedbackType && (
                    <div className="text-xs text-zinc-500">
                      最近反馈：
                      <span className="ml-1 font-medium text-zinc-800">
                        {FEEDBACK_ACTIONS.find((action) => action.type === selectedItem.latestFeedbackType)?.label || selectedItem.latestFeedbackType}
                      </span>
                    </div>
                  )}
                </div>
                <div className="mt-3 grid gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-xs text-zinc-600 sm:grid-cols-3">
                  <div>累计反馈：<span className="font-medium text-zinc-900">{preferenceSummary?.totalFeedback ?? 0}</span></div>
                  <div>正向/负向：<span className="font-medium text-zinc-900">{preferenceSummary?.positiveCount ?? 0} / {preferenceSummary?.negativeCount ?? 0}</span></div>
                  <div>
                    画像状态：
                    <span className="ml-1 font-medium text-zinc-900">
                      {preferenceSummary?.lastFeedbackAt ? '已参与偏好画像' : '尚未形成反馈画像'}
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {FEEDBACK_ACTIONS.map((action) => {
                    const active = selectedItem.latestFeedbackType === action.type;
                    const busy = feedbackSubmittingType === action.type;
                    return (
                      <button
                        key={action.type}
                        onClick={() => { void handleFeedback(selectedItem, action.type, selectedFeedbackTags); }}
                        disabled={Boolean(feedbackSubmittingType)}
                        className={`rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                          active ? action.activeClassName : action.idleClassName
                        }`}
                      >
                        {busy ? '提交中...' : action.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3">
                  <div className="text-[11px] font-medium text-zinc-500">可选标签（0-3 个）</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {FEEDBACK_REASON_TAG_OPTIONS.map((tag) => {
                      const active = selectedFeedbackTags.includes(tag);
                      const disabled = !active && selectedFeedbackTags.length >= 3;
                      return (
                        <button
                          key={tag}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            setSelectedFeedbackTags((prev) => (
                              prev.includes(tag)
                                ? prev.filter((entry) => entry !== tag)
                                : [...prev, tag].slice(0, 3)
                            ));
                          }}
                          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40 ${
                            active
                              ? 'border-zinc-900 bg-zinc-900 text-white'
                              : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 text-[11px] text-zinc-500">
                    标签是可选的。它们会进入偏好画像，并帮助评分 Skills 更快对齐你的精选口味。
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-zinc-200 bg-white px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-zinc-800">评分拆解</div>
                    <div className="mt-1 text-xs text-zinc-500">总分来自评分技能组聚合，再叠加规则过滤与优先级逻辑。</div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-500">
                    <button
                      type="button"
                      onClick={() => navigate('/settings?tab=models&ai=skills')}
                      className="rounded-full border border-zinc-200 px-3 py-1 text-zinc-600 hover:bg-zinc-50"
                    >
                      去 AI 中心管理 Skills
                    </button>
                    <div>
                      总分 <span className="font-semibold text-zinc-900">{scoreBreakdown?.aiScore ?? selectedItem.aiScore ?? '—'}</span>
                    </div>
                  </div>
                </div>
                {breakdownLoading ? (
                  <div className="mt-3 text-sm text-zinc-400">评分拆解加载中...</div>
                ) : scoreBreakdown?.breakdowns?.length ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {scoreBreakdown.breakdowns.map((entry) => (
                      <div key={entry.id} className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium text-zinc-800">{entry.skillName || '默认评分'}</div>
                          <div className="text-xs text-zinc-500">分数 {entry.score ?? '—'} · 置信 {entry.confidence != null ? Number(entry.confidence).toFixed(2) : '—'}</div>
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">决策：{entry.decision || '—'}{entry.skillWeight != null ? ` · 权重 ${entry.skillWeight}` : ''}</div>
                        {entry.reasons.length > 0 && (
                          <ul className="mt-2 space-y-1 text-xs text-zinc-600">
                            {entry.reasons.slice(0, 4).map((reason) => (
                              <li key={reason} className="leading-5">• {reason}</li>
                            ))}
                          </ul>
                        )}
                        {(entry.matchedSignals.length > 0 || entry.riskFlags.length > 0) && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {entry.matchedSignals.slice(0, 4).map((tag) => (
                              <span key={tag} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">{tag}</span>
                            ))}
                            {entry.riskFlags.slice(0, 3).map((tag) => (
                              <span key={tag} className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-zinc-500">当前还没有评分技能拆解结果；旧数据可能仍是单一评分，重跑 AI 后会逐步补齐。</div>
                )}
              </div>

              {(selectedItem.isFiltered || selectedItem.filterReason) && (
                <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${
                  selectedItem.isFiltered
                    ? 'border border-amber-200 bg-amber-50 text-amber-800'
                    : 'border border-zinc-200 bg-zinc-50 text-zinc-700'
                }`}>
                  {selectedItem.isFiltered ? '该条目当前被规则过滤。' : '该条目保留了规则诊断。'}
                  原因：{selectedItem.filterReason || '未提供'}。
                  {selectedItem.contentStatus !== 'ready' ? ' 当前正文不完整，建议复核。' : ''}
                </div>
              )}

              {(selectedItem.contentError || selectedItem.translationReason || selectedItem.blockedReason) && (
                <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                  {selectedItem.contentError ? `正文诊断：${selectedItem.contentError}` : ''}
                  {selectedItem.contentError && (selectedItem.translationReason || selectedItem.blockedReason) ? '；' : ''}
                  {selectedItem.translationReason ? `翻译诊断：${selectedItem.translationReason}` : ''}
                  {(selectedItem.contentError || selectedItem.translationReason) && selectedItem.blockedReason ? '；' : ''}
                  {selectedItem.blockedReason ? `抓取阻断：${selectedItem.blockedReason}` : ''}
                </div>
              )}

              <div className="mt-5 flex gap-2 flex-wrap">
                {detailSections.map((section) => (
                  <button
                    key={section.key}
                    onClick={() => setActiveDetailTab(section.key)}
                    className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                      activeDetail?.key === section.key
                        ? 'bg-zinc-900 text-white'
                        : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                    }`}
                  >
                    {section.label}{section.isEmpty ? ' · 待补全' : ''}
                  </button>
                ))}
              </div>

              <div className="mt-5 rounded-[24px] border border-zinc-100 bg-[#fffdfa] px-5 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                <div className="mb-4 text-xs uppercase tracking-[0.24em] text-zinc-400">{activeDetail?.label || '内容'}</div>
                <MarkdownContent
                  content={activeDetail?.content}
                  empty={activeDetail?.emptyMessage || '暂无内容'}
                  mode={activeDetail?.renderMode || 'auto'}
                  className="min-w-0"
                />
                {activeDetail?.key === 'original' && selectedItem.url && (
                  <a
                    href={selectedItem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-800"
                  >
                    打开原文
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
            </>
          ) : (
            <div className="text-zinc-400 h-full flex flex-col items-center justify-center text-center">
              <FileText size={28} />
              <p className="mt-2 text-sm">从左侧选择一篇文章查看详情与预览</p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
