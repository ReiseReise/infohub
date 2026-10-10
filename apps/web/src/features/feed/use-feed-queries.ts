import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type FeedItemRecord } from '../../lib/api';
import { feedViewForSortMode } from '../../lib/feed-layout';
import { patchFeedItemInInfiniteCache } from '../../lib/feed-query-cache';
import type { FeedScoreBand } from '../../lib/feed-query-state';
import { useAuth } from '../../lib/use-auth';
import { feedKeys, type FeedListParams } from '../../lib/feed-query-keys';

export { feedKeys, type FeedListParams } from '../../lib/feed-query-keys';

// --------------- Parameter Types ---------------

const SCORE_BAND_FILTERS: Array<{ value: FeedScoreBand; minScore?: string; maxScore?: string }> = [
  { value: 'all' },
  { value: '80', minScore: '80' },
  { value: '70', minScore: '70', maxScore: '79.99' },
  { value: '60', minScore: '60', maxScore: '69.99' },
  { value: 'below60', maxScore: '59.99' },
];

function isMonitorCategory(category?: string | null): boolean {
  const normalized = (category || '').trim().toLowerCase();
  return normalized === '监控' || normalized === 'monitor';
}

function buildListRequestParams(params: FeedListParams, offset: number, limit: number): Record<string, string> {
  const reqParams: Record<string, string> = { limit: String(limit), offset: String(offset) };
  reqParams.sortBy = params.sortMode === 'priority' ? 'priority' : params.sortMode === 'score' ? 'score' : 'publishedAt';
  reqParams.view = feedViewForSortMode(params.sortMode);
  const scoreFilter = SCORE_BAND_FILTERS.find((entry) => entry.value === params.scoreBand);
  if (scoreFilter?.minScore) reqParams.minScore = scoreFilter.minScore;
  if (scoreFilter?.maxScore) reqParams.maxScore = scoreFilter.maxScore;
  if (params.searchQuery) reqParams.search = params.searchQuery;
  if (params.filter === 'unread') reqParams.isRead = 'false';
  if (params.filter === 'favorites') reqParams.isFavorite = 'true';
  if (isMonitorCategory(params.category)) { reqParams.monitorOnly = 'true'; } else if (params.category) { reqParams.category = params.category; }
  if (params.sourceId) reqParams.sourceId = params.sourceId;
  if (params.sourceTierFilter) reqParams.sourceTier = params.sourceTierFilter;
  if (params.readingTierFilter) reqParams.readingTier = params.readingTierFilter;
  if (params.growthAxisFilter) reqParams.growthAxis = params.growthAxisFilter;
  return reqParams;
}

// --------------- Query Hooks ---------------

const FEED_LIST_LIMIT = 20;

export function useFeedList(params: FeedListParams) {
  const { user } = useAuth();
  const userId = user?.id || '';
  return useInfiniteQuery({
    queryKey: feedKeys.list(userId, params),
    queryFn: async ({ pageParam = 0 }) => {
      const reqParams = buildListRequestParams(params, pageParam as number, FEED_LIST_LIMIT);
      return api.items.list(reqParams);
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    initialPageParam: 0,
    enabled: Boolean(userId),
  });
}

export function useFeedDetail(id: string | null) {
  const { user } = useAuth();
  const userId = user?.id || '';
  return useQuery({
    queryKey: feedKeys.detail(userId, id),
    queryFn: async () => {
      const resp = await api.items.get(id!);
      return resp.data as FeedItemRecord;
    },
    enabled: Boolean(userId && id),
  });
}

export function useFeedSourceRail(readingTier: string) {
  const { user } = useAuth();
  const userId = user?.id || '';
  return useQuery({
    queryKey: feedKeys.sourceRail(userId, readingTier),
    queryFn: async () => {
      const params: Record<string, string> = { sortBy: 'unread', status: 'active' };
      if (readingTier) params.readingTier = readingTier;
      const res = await api.sources.list(params);
      return res.data || [];
    },
    enabled: Boolean(userId),
  });
}

export function useFeedCategories() {
  const { user } = useAuth();
  const userId = user?.id || '';
  return useQuery({
    queryKey: feedKeys.categories(userId),
    queryFn: async () => {
      const res = await api.sources.categories();
      return (res.data as Array<{ category: string }>).map((r) => r.category).filter(Boolean).sort();
    },
    enabled: Boolean(userId),
  });
}

export function useFeedStats() {
  const { user } = useAuth();
  const userId = user?.id || '';
  return useQuery({
    queryKey: feedKeys.stats(userId),
    queryFn: () => api.items.stats(),
    enabled: Boolean(userId),
  });
}

export function useFetchStatus() {
  const { user } = useAuth();
  const userId = user?.id || '';
  return useQuery({
    queryKey: feedKeys.fetchStatus(userId),
    queryFn: () => api.fetch.status(),
    enabled: Boolean(userId),
  });
}

export function usePreferenceSummary() {
  const { user } = useAuth();
  const userId = user?.id || '';
  return useQuery({
    queryKey: feedKeys.preferenceSummary(userId),
    queryFn: async () => {
      const resp = await api.preferences.profile();
      return resp.summary || null;
    },
    enabled: Boolean(userId),
  });
}

export function useScoreBreakdown(id: string | null) {
  const { user } = useAuth();
  const userId = user?.id || '';
  return useQuery({
    queryKey: feedKeys.scoreBreakdown(userId, id),
    queryFn: async () => {
      const resp = await api.items.scoreBreakdown(id!);
      return resp.data || null;
    },
    enabled: Boolean(userId && id),
  });
}

// --------------- Mutation Hooks ---------------

export function useMarkReadMutation() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id || '';
  return useMutation({
    mutationFn: (id: string) => api.items.markRead(id),
    onSuccess: (_data, id) => {
      qc.setQueriesData(
        { queryKey: feedKeys.lists(userId) },
        (old) => patchFeedItemInInfiniteCache(old, id, { isRead: true }),
      );
    },
  });
}

export function useFavoriteMutation() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id || '';
  return useMutation({
    mutationFn: ({ id, isFavorite }: { id: string; isFavorite: boolean }) => api.items.favorite(id, isFavorite),
    onSuccess: (_data, { id, isFavorite }) => {
      qc.setQueriesData(
        { queryKey: feedKeys.lists(userId) },
        (old) => patchFeedItemInInfiniteCache(old, id, { isFavorite }),
      );
    },
  });
}

export function useMarkAllReadMutation() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id || '';
  return useMutation({
    mutationFn: () => api.items.markAllRead(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: feedKeys.lists(userId) });
    },
  });
}

export function useReprocessAiMutation() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id || '';
  return useMutation({
    mutationFn: (id: string) => api.items.reprocessAi(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: feedKeys.lists(userId) });
    },
  });
}

export function useEnrichMutation() {
  return useMutation({
    mutationFn: (id: string) => api.items.enrich(id),
  });
}

export function useFeedbackMutation() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { feedbackType: string; reasonTags?: string[] } }) =>
      api.items.feedback(id, data),
  });
}

export function useTriggerFetchMutation() {
  return useMutation({
    mutationFn: () => api.fetch.trigger(),
  });
}

export function useTriggerDueMutation() {
  return useMutation({
    mutationFn: () => api.fetch.triggerDue(),
  });
}

export function useStartAudioMutation() {
  return useMutation({
    mutationFn: (id: string) => api.items.startAudio(id),
  });
}

export function useReprocessBatchMutation() {
  return useMutation({
    mutationFn: (data: { stage?: string; itemId?: string; sourceId?: number; date?: string; limit?: number }) =>
      api.items.reprocessBatch(data as Parameters<typeof api.items.reprocessBatch>[0]),
  });
}

export function useTranslateFullMutation() {
  return useMutation({
    mutationFn: (id: string) => api.items.translateFull(id, { async: true }),
  });
}

export function useGenerateAssetMutation() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { type: 'qa' | 'rewrite'; promptKey: string; force?: boolean } }) =>
      api.items.generateAsset(id, data),
  });
}
