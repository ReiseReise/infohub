import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, type FeedItemRecord, type FetchStatusResponse, type ItemScoreBreakdownPayload, type ItemTranslationJob, type ItemsStats, type PreferenceProfileSummary, type SourceRecord } from '../../lib/api';
import {
  buildReprocessStageNotice,
  shouldRefreshScoreBreakdownAfterEnrich,
  shouldRefreshScoreBreakdownAfterReprocess,
  type FeedReprocessStage,
  type NoticeTone,
} from '../../lib/feed-diagnostics';
import {
  clampFeedListPaneWidth,
  resolveCompletedFullTranslationNotice,
  resolveFeedDetailSourceContext,
  resolveFeedSourceMismatchNotice,
  resolveFeedTranslationAction,
  shouldAutoSelectFirstFeedItem,
} from '../../lib/feed-layout';
import {
  mergeFeedUrlParams,
  readFeedUrlState,
  type FeedFilterMode,
  type FeedScoreBand,
  type FeedSortMode,
} from '../../lib/feed-query-state';
import {
  loadReaderPreferences,
  saveReaderPreferences,
  type ReaderPreferences,
} from '../../lib/reader-preferences';
import { buildArticleAgentPrompt, type ArticleAgentPromptKey } from '../../lib/reading-assets';
import { getPreferredReaderSourceText, normalizeAiSummary } from './presentation';
import { useAuth } from '../../lib/use-auth';
import { selectFeedDetailForRoute } from '../../lib/feed-query-cache';
import {
  useFeedList,
  useFeedDetail,
  useFeedSourceRail,
  useFeedCategories,
  useFeedStats,
  useFetchStatus,
  usePreferenceSummary,
  useScoreBreakdown,
  useMarkReadMutation,
  useFavoriteMutation,
  useMarkAllReadMutation,
  useReprocessAiMutation,
  useEnrichMutation,
  useFeedbackMutation,
  useTriggerFetchMutation,
  useTriggerDueMutation,
  useStartAudioMutation,
  useReprocessBatchMutation,
  useTranslateFullMutation,
  useGenerateAssetMutation,
  feedKeys,
  type FeedListParams,
} from './use-feed-queries';

export type FeedItem = FeedItemRecord;
type ReprocessStage = FeedReprocessStage;
export type NoticeState = string | { message: string; tone: NoticeTone };

export type FeedViewMode = 'dense' | 'comfortable' | 'deep';

const FEED_VIEW_MODE_KEY = 'feed-view-mode';
function loadViewMode(): FeedViewMode {
  const stored = localStorage.getItem(FEED_VIEW_MODE_KEY);
  if (stored === 'dense' || stored === 'comfortable' || stored === 'deep') return stored;
  return 'comfortable';
}
function saveViewMode(mode: FeedViewMode): FeedViewMode {
  localStorage.setItem(FEED_VIEW_MODE_KEY, mode);
  return mode;
}

export type DetailSectionKey = 'summary' | 'original' | 'rewrite' | 'translation' | 'qa' | 'transcript' | 'knowledge';

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export interface FeedContextValue {
  // State
  items: FeedItem[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  detailLoading: boolean;
  detailError: string | null;
  selectedItem: FeedItem | null;
  selectedId: string | null;
  searchInput: string;
  searchQuery: string;
  filter: FeedFilterMode;
  sortMode: FeedSortMode;
  category: string;
  sourceId: string;
  sourceTierFilter: string;
  readingTierFilter: string;
  growthAxisFilter: string;
  scoreBand: FeedScoreBand;
  sourcePaneCollapsed: boolean;
  listPaneWidth: number;
  readerPreferences: ReaderPreferences;
  mobileSourceOpen: boolean;
  advancedFiltersOpen: boolean;
  sourceRail: SourceRecord[];
  categories: string[];
  stats: ItemsStats | null;
  nextPageOffset: number | null;
  error: string | null;
  notice: NoticeState | null;
  detailActionNotice: NoticeState | null;
  stageNotice: NoticeState | null;
  feedbackNotice: NoticeState | null;
  fetching: boolean;
  audioSubmittingId: string | null;
  aiReprocessingId: string | null;
  enrichingId: string | null;
  stageReprocessing: { itemId: string; stage: ReprocessStage } | null;
  activeDetailTab: DetailSectionKey;
  copiedAgentPrompt: ArticleAgentPromptKey | null;
  generatingAgentPrompt: ArticleAgentPromptKey | null;
  agentPromptErrors: Partial<Record<ArticleAgentPromptKey, string>>;
  scoreBreakdown: ItemScoreBreakdownPayload | null;
  breakdownLoading: boolean;
  feedbackSubmittingType: string | null;
  selectedFeedbackTags: string[];
  preferenceSummary: PreferenceProfileSummary | null;
  fetchStatus: FetchStatusResponse | null;
  dueRefreshing: boolean;
  offset: number;
  viewMode: FeedViewMode;

  // Refs
  detailPanelRef: React.RefObject<HTMLDivElement | null>;
  listPanelRef: React.RefObject<HTMLDivElement | null>;

  // Actions
  setSearchInput: (value: string) => void;
  setFilter: (value: FeedFilterMode) => void;
  setSortMode: (value: FeedSortMode) => void;
  setCategory: (value: string) => void;
  setSourceId: (value: string) => void;
  setSourceTierFilter: (value: string) => void;
  setReadingTierFilter: (value: string) => void;
  setGrowthAxisFilter: (value: string) => void;
  setScoreBand: (value: FeedScoreBand) => void;
  setSourcePaneCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setListPaneWidth: (value: number) => void;
  setMobileSourceOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setAdvancedFiltersOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveDetailTab: (value: DetailSectionKey) => void;
  setSelectedFeedbackTags: React.Dispatch<React.SetStateAction<string[]>>;
  setOffset: (value: number) => void;
  setViewMode: (mode: FeedViewMode) => void;
  setNotice: (value: NoticeState | null) => void;
  setDetailActionNotice: (value: NoticeState | null) => void;
  setStageNotice: (value: NoticeState | null) => void;
  updateReaderPreference: <Key extends keyof ReaderPreferences>(key: Key, value: ReaderPreferences[Key]) => void;
  updateListQuery: (next: { q?: string; filter?: FeedFilterMode; category?: string; sourceId?: string; sort?: FeedSortMode; sourceTier?: string; readingTier?: string; growthAxis?: string; score?: FeedScoreBand }) => void;

  // Handlers
  handleSearch: (e: React.FormEvent) => void;
  handleFavorite: (id: string, current: boolean) => Promise<void>;
  handleMarkRead: (id: string) => Promise<void>;
  handleOpenDetail: (item: FeedItem) => Promise<void>;
  handleMarkAllRead: () => Promise<void>;
  handleNextUnread: () => void;
  handleTriggerFetch: () => Promise<void>;
  handleStartAudio: (item: FeedItem) => Promise<void>;
  handleReprocessAi: (item: FeedItem) => Promise<void>;
  handleReprocessStage: (item: FeedItem, stage: ReprocessStage) => Promise<void>;
  handleTranslateFull: (item: FeedItem) => Promise<void>;
  handleEnrich: (item: FeedItem, options?: { silent?: boolean }) => Promise<void>;
  handleFeedback: (item: FeedItem, feedbackType: NonNullable<FeedItem['latestFeedbackType']>, reasonTags?: string[]) => Promise<void>;
  handleSelectSource: (source: SourceRecord) => void;
  handleListPaneResizeStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
  handleReturnToList: () => void;
  handleTranslationPrimaryAction: (item: FeedItem) => void;
  handleCopyArticleAgentPrompt: (key: ArticleAgentPromptKey) => Promise<void>;
  handleGenerateArticleAsset: (key: ArticleAgentPromptKey, force?: boolean) => Promise<void>;
  triggerDueSources: () => Promise<void>;
  fetchItems: () => Promise<void>;
  fetchScoreBreakdown: (itemId: string) => Promise<void>;
}

const FEEDBACK_ACTIONS: Array<{
  type: NonNullable<FeedItem['latestFeedbackType']>;
  label: string;
}> = [
  { type: 'must_read', label: '值得重点关注' },
  { type: 'like', label: '更想看' },
  { type: 'dislike', label: '少给我看' },
  { type: 'not_for_me', label: '不符合口味' },
];

const FeedContext = createContext<FeedContextValue | null>(null);

export function useFeedContext(): FeedContextValue {
  const ctx = useContext(FeedContext);
  if (!ctx) throw new Error('useFeedContext must be used inside FeedProvider');
  return ctx;
}

export function FeedProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id || '';
  const { id: selectedIdFromRoute } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQueryState = readFeedUrlState(searchParams);

  // --- Local UI State (not server-derived) ---
  const [searchInput, setSearchInput] = useState(initialQueryState.q);
  const [searchQuery, setSearchQuery] = useState(initialQueryState.q);
  const [filter, setFilter] = useState<FeedFilterMode>(initialQueryState.filter);
  const [sortMode, setSortMode] = useState<FeedSortMode>(initialQueryState.sort);
  const [category, setCategory] = useState(initialQueryState.category);
  const [sourceId, setSourceId] = useState(initialQueryState.sourceId);
  const [sourceTierFilter, setSourceTierFilter] = useState(initialQueryState.sourceTier);
  const [readingTierFilter, setReadingTierFilter] = useState(initialQueryState.readingTier);
  const [growthAxisFilter, setGrowthAxisFilter] = useState(initialQueryState.growthAxis);
  const [scoreBand, setScoreBand] = useState<FeedScoreBand>(initialQueryState.score);
  const [sourcePaneCollapsed, setSourcePaneCollapsed] = useState(() => !searchParams.get('sourceId'));
  const [listPaneWidth, setListPaneWidth] = useState(340);
  const [readerPreferences, setReaderPreferences] = useState(loadReaderPreferences);
  const [mobileSourceOpen, setMobileSourceOpen] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [detailActionNotice, setDetailActionNotice] = useState<NoticeState | null>(null);
  const [stageNotice, setStageNotice] = useState<NoticeState | null>(null);
  const [fetching, setFetching] = useState(false);
  const [audioSubmittingId, setAudioSubmittingId] = useState<string | null>(null);
  const [aiReprocessingId, setAiReprocessingId] = useState<string | null>(null);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [stageReprocessing, setStageReprocessing] = useState<{ itemId: string; stage: ReprocessStage } | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<DetailSectionKey>('original');
  const [copiedAgentPrompt, setCopiedAgentPrompt] = useState<ArticleAgentPromptKey | null>(null);
  const [generatingAgentPrompt, setGeneratingAgentPrompt] = useState<ArticleAgentPromptKey | null>(null);
  const [agentPromptErrors, setAgentPromptErrors] = useState<Partial<Record<ArticleAgentPromptKey, string>>>({});
  const [feedbackSubmittingType, setFeedbackSubmittingType] = useState<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<NoticeState | null>(null);
  const [selectedFeedbackTags, setSelectedFeedbackTags] = useState<string[]>([]);
  const [dueRefreshing, setDueRefreshing] = useState(false);
  const [viewMode, setViewModeRaw] = useState<FeedViewMode>(loadViewMode);
  const [selectedItem, setSelectedItem] = useState<FeedItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const setViewMode = useCallback((mode: FeedViewMode) => {
    setViewModeRaw(saveViewMode(mode));
  }, []);

  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  const listPanelRef = useRef<HTMLDivElement | null>(null);
  const clearedDeepLinkSourceRef = useRef<string | null>(null);

  // --- React Query: Feed List (infinite query) ---
  const listParams: FeedListParams = useMemo(() => ({
    filter, sortMode, searchQuery, category, sourceId,
    sourceTierFilter, readingTierFilter, growthAxisFilter, scoreBand,
  }), [filter, sortMode, searchQuery, category, sourceId, sourceTierFilter, readingTierFilter, growthAxisFilter, scoreBand]);

  const feedListQuery = useFeedList(listParams);

  // Flatten infinite pages into a single items array
  const items: FeedItem[] = useMemo(() => {
    if (!feedListQuery.data?.pages) return [];
    const seen = new Set<string>();
    const result: FeedItem[] = [];
    for (const page of feedListQuery.data.pages) {
      for (const item of page.data) {
        if (!seen.has(item.id)) { seen.add(item.id); result.push(item); }
      }
    }
    return result;
  }, [feedListQuery.data?.pages]);

  const lastPage = feedListQuery.data?.pages[feedListQuery.data.pages.length - 1];
  const total = lastPage?.total ?? 0;
  const nextPageOffset = lastPage?.nextOffset ?? null;
  const loading = feedListQuery.isLoading;
  const loadingMore = feedListQuery.isFetchingNextPage;
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = feedListQuery;

  // --- React Query: Supporting Queries ---
  const sourceRailQuery = useFeedSourceRail(readingTierFilter);
  const categoriesQuery = useFeedCategories();
  const statsQuery = useFeedStats();
  const fetchStatusQuery = useFetchStatus();
  const preferenceSummaryQuery = usePreferenceSummary();

  const sourceRail: SourceRecord[] = useMemo(() => sourceRailQuery.data ?? [], [sourceRailQuery.data]);
  const categories: string[] = categoriesQuery.data ?? [];
  const stats: ItemsStats | null = statsQuery.data ?? null;
  const fetchStatus: FetchStatusResponse | null = fetchStatusQuery.data ?? null;
  const preferenceSummary: PreferenceProfileSummary | null = preferenceSummaryQuery.data ?? null;

  // --- React Query: Score Breakdown ---
  const breakdownQuery = useScoreBreakdown(selectedItem?.id ?? selectedIdFromRoute ?? null);
  const scoreBreakdown: ItemScoreBreakdownPayload | null = breakdownQuery.data ?? null;
  const breakdownLoading = breakdownQuery.isLoading;

  // --- React Query: Detail ---
  const detailQuery = useFeedDetail(selectedIdFromRoute ?? null);

  // Sync detail query result to selectedItem
  useEffect(() => {
    if (detailQuery.data && selectedIdFromRoute) {
      setSelectedItem((prev) => prev?.id === selectedIdFromRoute ? { ...prev, ...detailQuery.data } : detailQuery.data!);
    }
  }, [detailQuery.data, selectedIdFromRoute]);

  useEffect(() => {
    setDetailLoading(detailQuery.isLoading);
    setDetailError(detailQuery.error ? (detailQuery.error as Error).message || '详情加载失败' : null);
  }, [detailQuery.isLoading, detailQuery.error]);

  // --- React Query: Mutations ---
  const markReadMutation = useMarkReadMutation();
  const favoriteMutation = useFavoriteMutation();
  const markAllReadMutation = useMarkAllReadMutation();
  const reprocessAiMutation = useReprocessAiMutation();
  const enrichMutation = useEnrichMutation();
  const feedbackMutation = useFeedbackMutation();
  const triggerFetchMutation = useTriggerFetchMutation();
  const triggerDueMutation = useTriggerDueMutation();
  const startAudioMutation = useStartAudioMutation();
  const reprocessBatchMutation = useReprocessBatchMutation();
  const translateFullMutation = useTranslateFullMutation();
  const generateAssetMutation = useGenerateAssetMutation();

  // --- Helpers ---
  const updateReaderPreference = useCallback(<Key extends keyof ReaderPreferences>(key: Key, value: ReaderPreferences[Key]) => {
    setReaderPreferences((current) => saveReaderPreferences({ ...current, [key]: value }));
  }, []);

  const updateListQuery = useCallback((next: { q?: string; filter?: FeedFilterMode; category?: string; sourceId?: string; sort?: FeedSortMode; sourceTier?: string; readingTier?: string; growthAxis?: string; score?: FeedScoreBand }) => {
    const params = mergeFeedUrlParams(searchParams, next);
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const invalidateList = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: feedKeys.lists(userId) });
  }, [queryClient, userId]);

  const fetchItems = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: feedKeys.lists(userId) });
  }, [queryClient, userId]);

  const fetchScoreBreakdown = useCallback(async (itemId: string) => {
    void queryClient.invalidateQueries({ queryKey: feedKeys.scoreBreakdown(userId, itemId) });
  }, [queryClient, userId]);

  const fetchDetail = async (itemId: string, silent = false) => {
    if (!silent) setDetailLoading(true);
    setDetailError(null);
    try {
      const resp = await api.items.get(itemId);
      const detail = resp.data as FeedItem;
      setSelectedItem((prev) => prev?.id === itemId ? { ...prev, ...detail } : detail);
    } catch (err) { const message = (err as Error).message || '详情加载失败'; setDetailError(message); if (!silent) setError(message); }
    finally { if (!silent) setDetailLoading(false); }
  };

  // Load more pages
  useEffect(() => {
    if (offset > 0 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, offset]);

  // Sync URL params to state
  useEffect(() => {
    const nextState = readFeedUrlState(searchParams);
    let changed = false;
    if (searchInput !== nextState.q) setSearchInput(nextState.q);
    if (searchQuery !== nextState.q) { setSearchQuery(nextState.q); changed = true; }
    if (filter !== nextState.filter) { setFilter(nextState.filter); changed = true; }
    if (sortMode !== nextState.sort) { setSortMode(nextState.sort); changed = true; }
    if (category !== nextState.category) { setCategory(nextState.category); changed = true; }
    if (sourceId !== nextState.sourceId) { setSourceId(nextState.sourceId); changed = true; }
    if (sourceTierFilter !== nextState.sourceTier) { setSourceTierFilter(nextState.sourceTier); changed = true; }
    if (readingTierFilter !== nextState.readingTier) { setReadingTierFilter(nextState.readingTier); changed = true; }
    if (growthAxisFilter !== nextState.growthAxis) { setGrowthAxisFilter(nextState.growthAxis); changed = true; }
    if (scoreBand !== nextState.score) { setScoreBand(nextState.score); changed = true; }
    if (changed) setOffset(0);
  }, [category, filter, growthAxisFilter, readingTierFilter, scoreBand, searchInput, searchQuery, searchParams, sortMode, sourceId, sourceTierFilter]);

  // Route-driven detail loading
  useEffect(() => {
    setSelectedItem((current) => selectFeedDetailForRoute(current, selectedIdFromRoute, items));
  }, [items, selectedIdFromRoute]);

  // 宽屏下详情区占 2/3 版面，无选中时整片空白；自动选中首条填满版面（窄屏不做，见 shouldAutoSelectFirstFeedItem）
  useEffect(() => {
    if (!shouldAutoSelectFirstFeedItem({
      hasRouteId: Boolean(selectedIdFromRoute),
      hasSelectedItem: Boolean(selectedItem),
      itemCount: items.length,
    })) return;
    setSelectedItem(items[0]);
  }, [items, selectedIdFromRoute, selectedItem]);

  // Clear per-item state on selection change
  useEffect(() => { setActiveDetailTab('original'); }, [selectedItem?.id]);
  useEffect(() => { setCopiedAgentPrompt(null); setAgentPromptErrors({}); }, [selectedItem?.id, activeDetailTab]);
  useEffect(() => { setSelectedFeedbackTags([]); setDetailActionNotice(null); setStageNotice(null); setFeedbackNotice(null); }, [selectedItem?.id]);

  // Auto-clear source filter on mismatch deep link
  const selectedSource = useMemo(() => sourceRail.find((source) => String(source.id) === sourceId) || null, [sourceId, sourceRail]);
  const sourceMismatchNotice = useMemo(() => resolveFeedSourceMismatchNotice({ querySourceId: sourceId, itemSourceId: selectedItem?.sourceId, itemSourceName: selectedItem?.sourceName, filterSourceName: selectedSource?.name }), [selectedItem?.sourceId, selectedItem?.sourceName, selectedSource?.name, sourceId]);

  useEffect(() => {
    const context = resolveFeedDetailSourceContext({ selectedIdFromRoute, querySourceId: sourceId, itemSourceId: selectedItem?.sourceId });
    if (!context.shouldClearSourceFilter || !selectedItem) return;
    const mismatchKey = `${selectedItem.id}:${sourceId}:${selectedItem.sourceId}`;
    if (clearedDeepLinkSourceRef.current === mismatchKey) return;
    clearedDeepLinkSourceRef.current = mismatchKey;
    setSourceId(''); setOffset(0); updateListQuery({ sourceId: '' });
    setDetailActionNotice({ tone: 'warning', message: sourceMismatchNotice?.message ? `${sourceMismatchNotice.message} 已自动清除这个过期来源过滤。` : '已自动清除 URL 中过期的来源过滤，当前详情按文章真实来源展示。' });
  }, [selectedIdFromRoute, selectedItem, selectedItem?.id, selectedItem?.sourceId, sourceId, sourceMismatchNotice, updateListQuery]);

  const selectedId = selectedItem?.id || selectedIdFromRoute || null;

  // --- Handlers ---
  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); const nextSearch = searchInput.trim(); setSearchQuery(nextSearch); setOffset(0); updateListQuery({ q: nextSearch }); };

  const handleFavorite = async (id: string, current: boolean) => {
    setError(null);
    try {
      await favoriteMutation.mutateAsync({ id, isFavorite: !current });
      // Optimistic local update
      setSelectedItem((prev) => prev?.id === id ? { ...prev, isFavorite: !current } : prev);
      invalidateList();
    } catch (err) { setError((err as Error).message || '收藏更新失败'); }
  };

  const handleMarkRead = async (id: string) => {
    setError(null);
    try {
      await markReadMutation.mutateAsync(id);
      setSelectedItem((prev) => prev?.id === id ? { ...prev, isRead: true } : prev);
      invalidateList();
    } catch (err) { setError((err as Error).message || '标记已读失败'); }
  };

  const handleOpenDetail = async (item: FeedItem) => {
    setSelectedItem((current) => selectFeedDetailForRoute(current, item.id, [item])); setDetailActionNotice(null); setStageNotice(null); setFeedbackNotice(null);
    const queryString = searchParams.toString();
    navigate(`/feed/${item.id}${queryString ? `?${queryString}` : ''}`);
    if (!item.isRead) void handleMarkRead(item.id);
  };

  const handleMarkAllRead = async () => {
    setError(null);
    try {
      await markAllReadMutation.mutateAsync();
      setSelectedItem((prev) => prev ? { ...prev, isRead: true } : prev);
      invalidateList();
    } catch (err) { setError((err as Error).message || '全部已读失败'); }
  };

  const handleNextUnread = () => {
    if (items.length === 0) return;
    const currentIndex = selectedId ? items.findIndex((item) => item.id === selectedId) : -1;
    const ordered = [...items.slice(currentIndex + 1), ...items.slice(0, Math.max(currentIndex + 1, 0))];
    const nextUnread = ordered.find((item) => !item.isRead);
    if (!nextUnread) { setNotice('当前页没有未读条目'); return; }
    void handleOpenDetail(nextUnread);
  };

  const handleTriggerFetch = async () => {
    setFetching(true); setError(null); setNotice(null);
    try {
      const resp = await triggerFetchMutation.mutateAsync();
      setNotice(`采集已触发，入队 ${resp.enqueued ?? 0} 个信源。`);
      setTimeout(() => { invalidateList(); void queryClient.invalidateQueries({ queryKey: feedKeys.stats(userId) }); }, 2500);
    } catch (err) { setError((err as Error).message || '触发采集失败'); }
    finally { setFetching(false); }
  };

  const handleStartAudio = async (item: FeedItem) => {
    setAudioSubmittingId(item.id); setError(null);
    try {
      const resp = await startAudioMutation.mutateAsync(item.id);
      setSelectedItem((prev) => prev?.id === item.id ? { ...prev, audioStatus: resp.status, audioTaskId: resp.taskId } : prev);
      await fetchDetail(item.id);
      invalidateList();
    } catch (err) { setError((err as Error).message || '启动播客转写失败'); }
    finally { setAudioSubmittingId(null); }
  };

  const handleReprocessAi = async (item: FeedItem) => {
    setAiReprocessingId(item.id); setError(null); setNotice(null); setDetailActionNotice(null);
    try {
      const resp = await reprocessAiMutation.mutateAsync(item.id);
      setDetailActionNotice(`AI 重处理完成：评分 ${resp.scored}，摘要 ${resp.summarized}，翻译 ${resp.translated}`);
      invalidateList();
      await fetchDetail(item.id);
      if (shouldRefreshScoreBreakdownAfterReprocess('full-ai')) void fetchScoreBreakdown(item.id);
    } catch (err) { setDetailActionNotice({ message: (err as Error).message || '重处理失败', tone: 'danger' }); }
    finally { setAiReprocessingId(null); }
  };

  const handleReprocessStage = async (item: FeedItem, stage: ReprocessStage) => {
    setStageReprocessing({ itemId: item.id, stage }); setError(null); setNotice(null); setStageNotice(null);
    try {
      const resp = await reprocessBatchMutation.mutateAsync({ stage, itemId: item.id, limit: 1 });
      setStageNotice(buildReprocessStageNotice(stage, resp));
      invalidateList();
      await fetchDetail(item.id, true);
      if (shouldRefreshScoreBreakdownAfterReprocess(stage)) void fetchScoreBreakdown(item.id);
    } catch (err) { setStageNotice({ message: (err as Error).message || `修复失败`, tone: 'danger' }); }
    finally { setStageReprocessing((prev) => (prev?.itemId === item.id && prev.stage === stage ? null : prev)); }
  };

  const pollItemTranslationJob = useCallback(async (jobId: string, itemId: string): Promise<ItemTranslationJob> => {
    let lastJob: ItemTranslationJob | null = null;
    for (let attempt = 0; attempt < 440; attempt++) {
      const resp = await api.items.translationJob(jobId);
      const job = resp.data; lastJob = job;
      const label = job.label || job.progress?.label || '全文翻译';
      const percent = Number.isFinite(job.percent) ? Number(job.percent) : Number(job.progress?.percent || 0);
      const message = job.message || job.progress?.message || '全文翻译任务正在运行。';
      const n = { message: `${label} ${Math.round(percent)}%：${message}`, tone: 'warning' } as const;
      setDetailActionNotice(n); setStageNotice(n);
      if (job.state === 'completed') return job;
      if (job.state === 'failed') throw new Error(message || job.failedReason || '全文翻译失败。');
      await sleep(1500);
    }
    throw new Error(lastJob?.message || `全文翻译仍在运行，请稍后刷新当前文章。任务：${jobId} / ${itemId}`);
  }, []);

  const handleTranslateFull = async (item: FeedItem) => {
    const action = resolveFeedTranslationAction(item);
    setStageReprocessing({ itemId: item.id, stage: 'translation' }); setError(null); setNotice(null); setStageNotice(null);
    setDetailActionNotice({ message: action === 'fetch_then_translate' ? '正在先补抓原站正文，再生成中文译文。完成后会自动刷新当前文章。' : '正在按全文生成中文译文，完成后会自动刷新当前文章。', tone: 'warning' });
    try {
      const resp = await translateFullMutation.mutateAsync(item.id);
      const queuedJob = resp.data && typeof resp.data === 'object' && 'jobId' in resp.data ? resp.data as ItemTranslationJob : null;
      const jobId = resp.jobId || queuedJob?.jobId;
      if (!jobId) throw new Error(resp.message || '全文翻译任务创建失败。');
      setDetailActionNotice({ message: resp.message || '全文翻译任务已创建，正在等待执行。', tone: 'warning' });
      const job = await pollItemTranslationJob(jobId, item.id);
      const result = job.result || {};
      const refreshed = await api.items.get(item.id).catch(() => null);
      const resultItem = refreshed?.data || result.data || null;
      if (resultItem) { setSelectedItem((prev) => (prev?.id === item.id ? { ...prev, ...resultItem } : prev)); }
      const n2 = resolveCompletedFullTranslationNotice({ jobState: job.state, message: job.message, contentFetched: result.contentFetched, translated: result.translated, skipped: result.skipped, errorReason: result.errorReason || null, item: resultItem });
      setDetailActionNotice(n2); setStageNotice(n2);
      invalidateList();
      if (!resultItem) await fetchDetail(item.id, true);
    } catch (err) { const n3 = { message: (err as Error).message || '精译全文失败', tone: 'danger' } as const; setDetailActionNotice(n3); setStageNotice(n3); }
    finally { setStageReprocessing((prev) => (prev?.itemId === item.id && prev.stage === 'translation' ? null : prev)); }
  };

  const handleEnrich = useCallback(async (item: FeedItem, options: { silent?: boolean } = {}) => {
    if (!item?.id) return;
    setEnrichingId(item.id);
    if (!options.silent) { setNotice(null); setError(null); setDetailActionNotice(null); }
    try {
      const resp = await enrichMutation.mutateAsync(item.id);
      if (resp.data) { setSelectedItem((prev) => (prev?.id === item.id ? { ...prev, ...resp.data! } : prev)); }
      if (!options.silent) { const warningText = resp.warnings?.filter(Boolean).join('；'); const basisText = resp.contentBasis === 'content' ? '正文' : resp.contentBasis === 'snippet' ? '片段' : '标题'; setDetailActionNotice(warningText ? { message: warningText, tone: 'warning' } : `补全完成：正文 ${resp.contentFetched ? '已补抓' : '未变化'}（当前基于${basisText}），评分 ${resp.scored}，摘要 ${resp.summarized}，翻译 ${resp.translated}`); }
      if (shouldRefreshScoreBreakdownAfterEnrich(resp) && selectedId === item.id) void fetchScoreBreakdown(item.id);
      invalidateList();
    } catch (err) { if (!options.silent) setDetailActionNotice({ message: (err as Error).message || '补全失败', tone: 'danger' }); }
    finally { setEnrichingId((prev) => (prev === item.id ? null : prev)); }
  }, [enrichMutation, fetchScoreBreakdown, invalidateList, selectedId]);

  const handleFeedback = async (item: FeedItem, feedbackType: NonNullable<FeedItem['latestFeedbackType']>, reasonTags: string[] = []) => {
    setFeedbackSubmittingType(feedbackType); setError(null); setNotice(null); setFeedbackNotice(null);
    try {
      const resp = await feedbackMutation.mutateAsync({ id: item.id, data: { feedbackType, reasonTags } });
      const latestFeedback = resp.data;
      setSelectedItem((prev) => prev?.id === item.id ? { ...prev, latestFeedbackType: latestFeedback.feedbackType } : prev);
      invalidateList();
      const profileResp = await api.preferences.rebuildProfile().catch(() => null);
      if (profileResp?.summary) void queryClient.invalidateQueries({ queryKey: feedKeys.preferenceSummary(userId) });
      void fetchScoreBreakdown(item.id);
      setSelectedFeedbackTags([]);
      const tagText = reasonTags.length > 0 ? ` · 标签：${reasonTags.join('、')}` : '';
      setFeedbackNotice(`已记录反馈：${FEEDBACK_ACTIONS.find((action) => action.type === latestFeedback.feedbackType)?.label || latestFeedback.feedbackType}${tagText}`);
    } catch (err) { setFeedbackNotice({ message: (err as Error).message || '记录反馈失败', tone: 'danger' }); }
    finally { setFeedbackSubmittingType(null); }
  };

  const handleSelectSource = (source: SourceRecord) => { const nextId = String(source.id); setSourceId(nextId); setOffset(0); setMobileSourceOpen(false); updateListQuery({ sourceId: nextId }); };

  const handleListPaneResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX; const startWidth = listPaneWidth; const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    const handlePointerMove = (moveEvent: PointerEvent) => { setListPaneWidth(clampFeedListPaneWidth(startWidth + moveEvent.clientX - startX)); };
    const handlePointerUp = () => { window.removeEventListener('pointermove', handlePointerMove); window.removeEventListener('pointerup', handlePointerUp); window.removeEventListener('pointercancel', handlePointerUp); try { target.releasePointerCapture?.(event.pointerId); } catch { /* */ } };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    window.addEventListener('pointercancel', handlePointerUp, { once: true });
  };

  const handleReturnToList = () => { listPanelRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' }); };

  const handleTranslationPrimaryAction = (item: FeedItem) => {
    const action = resolveFeedTranslationAction(item);
    if (action === 'open_original') { const targetUrl = item.originalUrl || item.url; if (targetUrl) window.open(targetUrl, '_blank', 'noopener,noreferrer'); return; }
    void handleTranslateFull(item);
  };

  const handleCopyArticleAgentPrompt = async (key: ArticleAgentPromptKey) => {
    if (!selectedItem) return;
    const articleAgentContext = normalizeAiSummary(selectedItem.aiSummary) || selectedItem.aiTranslation || getPreferredReaderSourceText(selectedItem) || '';
    const prompt = buildArticleAgentPrompt(key, selectedItem.title, articleAgentContext);
    try { await navigator.clipboard.writeText(prompt); setCopiedAgentPrompt(key); }
    catch { setDetailActionNotice({ message: '复制失败：浏览器没有开放剪贴板权限。', tone: 'warning' }); }
  };

  const handleGenerateArticleAsset = async (key: ArticleAgentPromptKey, force = false) => {
    if (!selectedItem || generatingAgentPrompt) return;
    setGeneratingAgentPrompt(key); setAgentPromptErrors((prev) => ({ ...prev, [key]: undefined }));
    try {
      const resp = await generateAssetMutation.mutateAsync({ id: selectedItem.id, data: { type: 'qa', promptKey: key, force } });
      const nextItem = resp.data.item;
      if (nextItem) { setSelectedItem((prev) => (prev?.id === selectedItem.id ? { ...prev, ...nextItem } : prev)); invalidateList(); }
      else if (resp.data.asset) { setSelectedItem((prev) => { if (!prev || prev.id !== selectedItem.id) return prev; const existing = prev.readingAssets || []; const withoutSame = existing.filter((asset) => !(asset.type === 'qa' && asset.promptKey === key)); return { ...prev, readingAssets: [resp.data.asset, ...withoutSame] }; }); }
      setDetailActionNotice({ message: `${resp.data.asset.label || '文章资产'}已生成并保存。`, tone: 'success' });
    } catch (err) { const message = err instanceof Error ? err.message : '生成失败'; setAgentPromptErrors((prev) => ({ ...prev, [key]: message })); setDetailActionNotice({ message, tone: 'warning' }); }
    finally { setGeneratingAgentPrompt(null); }
  };

  const triggerDueSources = async () => {
    setDueRefreshing(true); setError(null);
    try {
      const result = await triggerDueMutation.mutateAsync();
      setNotice(`已补抓到期来源：入队 ${result.enqueued ?? 0} 个`);
      void queryClient.invalidateQueries({ queryKey: feedKeys.fetchStatus(userId) });
      invalidateList();
    } catch (err) { setError((err as Error).message || '补抓到期来源失败'); }
    finally { setDueRefreshing(false); }
  };

  const value: FeedContextValue = {
    items, total, loading, loadingMore, detailLoading, detailError, selectedItem, selectedId,
    searchInput, searchQuery, filter, sortMode, category, sourceId, sourceTierFilter,
    readingTierFilter, growthAxisFilter, scoreBand, sourcePaneCollapsed, listPaneWidth,
    readerPreferences, mobileSourceOpen, advancedFiltersOpen, sourceRail, categories, stats,
    nextPageOffset, error, notice, detailActionNotice, stageNotice, feedbackNotice, fetching,
    audioSubmittingId, aiReprocessingId, enrichingId, stageReprocessing, activeDetailTab,
    copiedAgentPrompt, generatingAgentPrompt, agentPromptErrors, scoreBreakdown, breakdownLoading,
    feedbackSubmittingType, selectedFeedbackTags, preferenceSummary, fetchStatus, dueRefreshing, offset, viewMode,
    detailPanelRef, listPanelRef,
    setSearchInput, setFilter, setSortMode, setCategory, setSourceId, setSourceTierFilter,
    setReadingTierFilter, setGrowthAxisFilter, setScoreBand, setSourcePaneCollapsed, setListPaneWidth,
    setMobileSourceOpen, setAdvancedFiltersOpen, setActiveDetailTab, setSelectedFeedbackTags,
    setOffset, setViewMode, setNotice, setDetailActionNotice, setStageNotice,
    updateReaderPreference, updateListQuery,
    handleSearch, handleFavorite, handleMarkRead, handleOpenDetail, handleMarkAllRead,
    handleNextUnread, handleTriggerFetch, handleStartAudio, handleReprocessAi,
    handleReprocessStage, handleTranslateFull, handleEnrich, handleFeedback,
    handleSelectSource, handleListPaneResizeStart, handleReturnToList,
    handleTranslationPrimaryAction, handleCopyArticleAgentPrompt,
    handleGenerateArticleAsset, triggerDueSources, fetchItems, fetchScoreBreakdown,
  };

  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>;
}
