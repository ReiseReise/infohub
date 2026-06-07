import type {
  AdminStorageStatus,
  AdminDashboardStats,
  AdminInviteCode,
  AdminModelConfig,
  AdminPromptTemplate,
  AdminTask,
  AdminUser,
  AiConfig,
  AiUsageEvent,
  AiUsageSummary,
  AudioQuotaSnapshot,
  AudioTask,
  AudioTaskListResponse,
  AudioTaskModelsResponse,
  AudioTaskTemplate,
  AuthResponse,
  AuthUser,
  BatchSubscriptionResult,
  AiConfigMeta,
  DiscoveryCandidate,
  DailyReportWorkflowConfig,
  DailyReportWorkflowPayload,
  DailyReportWorkflowPreview,
  ExportMutationResult,
  FallbackScoringRecoverySummary,
  FetchSettings,
  FetchQueueDiagnosticResponse,
  FetchStatusResponse,
  FetchTriggerResult,
  FeedItemRecord,
  GrowthDashboardRecord,
  ItemFeedbackRecord,
  ItemScoreBreakdownPayload,
  ItemEnrichResult,
  InsightGeneratePayload,
  InsightRecord,
  ItemQualityCheckPayload,
  ItemsStats,
  NetworkDiagnosticResponse,
  PreferenceProfileRecord,
  PreferenceProfileSummary,
  QualityPolicySnapshot,
  RetentionRunRecord,
  RetentionSummary,
  ScoringModelRemediationApplyResult,
  ScoringModelProbeSummary,
  ScoringSkillHealthSummary,
  ScoringSkillRecord,
  SourceRecord,
  SourceStats,
  SubscriptionInput,
  SubscriptionPackageMeta,
  SubscriptionMutationResult,
  UserQuota,
} from './contracts';
import { API_BASE_URL, request, withQuery } from './shared';
import { getStoredToken } from '../auth-storage';

type AiUsageSummaryQuery = {
  timeWindow?: '24h' | '7d' | '30d';
  interval?: 'hour' | 'day';
  from?: string;
  to?: string;
};

type AiUsageEventsQuery = {
  limit?: number;
  status?: string;
  sceneType?: string;
  provider?: string;
  search?: string;
  from?: string;
  to?: string;
};

function uploadAudioTaskWithProgress(
  formData: FormData,
  onProgress?: (percent: number) => void,
): Promise<AudioTask> {
  return new Promise<AudioTask>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE_URL}/audio/tasks/upload`, true);

    const token = getStoredToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable) return;
      const percent = Math.min(100, Math.max(1, Math.round((event.loaded / event.total) * 100)));
      onProgress(percent);
    };

    xhr.onerror = () => reject(new Error('上传失败：网络异常'));
    xhr.onabort = () => reject(new Error('上传已取消'));
    xhr.onload = () => {
      const text = xhr.responseText || '';
      let payload: unknown = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = {};
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(payload as AudioTask);
        return;
      }

      const message =
        typeof payload === 'object' && payload !== null
          ? ((payload as Record<string, unknown>).detail as string | undefined) ||
            ((payload as Record<string, unknown>).error as string | undefined)
          : undefined;
      reject(new Error(message || `上传失败（HTTP ${xhr.status}）`));
    };

    xhr.send(formData);
  });
}

export const api = {
  auth: {
    register: (data: { email: string; username: string; password: string }) =>
      request<AuthResponse>('/auth/register', { method: 'POST', body: data }),
    login: (data: { email: string; password: string }) =>
      request<AuthResponse>('/auth/login', { method: 'POST', body: data }),
    me: () => request<{ user: AuthUser }>('/auth/me'),
  },

  sources: {
    list: (params?: Record<string, string>) =>
      request<{ data: SourceRecord[]; total: number }>(withQuery('/sources', params)),
    categories: () => request<{ data: Array<{ category: string }> }>('/sources/categories'),
    stats: () => request<SourceStats>('/sources/stats'),
    create: (data: Partial<SourceRecord> & { config?: Record<string, unknown> }) =>
      request<{ data: SourceRecord }>('/sources', { method: 'POST', body: data }),
    update: (id: number, data: Partial<SourceRecord> & { config?: Record<string, unknown> }) =>
      request<{ data: SourceRecord }>(`/sources/${id}`, { method: 'PUT', body: data }),
    delete: (id: number) => request<{ message?: string }>(`/sources/${id}`, { method: 'DELETE' }),
    importOpml: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return request<{ message: string; total: number; imported: number; skipped: number; categories: string[] }>(
        '/sources/import-opml',
        { method: 'POST', body: form },
      );
    },
    renameCategory: (from: string, to: string) =>
      request<{ message: string }>('/sources/categories/rename', { method: 'POST', body: { from, to } }),
  },

  discovery: {
    search: (params: { q: string; type?: 'search' | 'rss' | 'rsshub'; limit?: number }) =>
      request<{ query: string; mode: string; total: number; data: DiscoveryCandidate[] }>(
        withQuery('/discovery/search', params),
      ),
    preview: (data: { url?: string; route?: string; collectorType?: string }) =>
      request<{ data: DiscoveryCandidate }>('/discovery/preview', { method: 'POST', body: data }),
  },

  subscriptions: {
    packages: () =>
      request<{ data: SubscriptionPackageMeta[] }>('/subscriptions/packages'),
    importPackage: (slug: string, data?: { categoryDefault?: string; limit?: number }) =>
      request<BatchSubscriptionResult>(`/subscriptions/packages/${slug}/import`, { method: 'POST', body: data || {} }),
    create: (data: SubscriptionInput) =>
      request<SubscriptionMutationResult>('/subscriptions', { method: 'POST', body: data }),
    createBatch: (items: SubscriptionInput[], categoryDefault?: string) =>
      request<BatchSubscriptionResult>('/subscriptions/batch', {
        method: 'POST',
        body: { items, categoryDefault },
      }),
  },

  items: {
    list: (params?: Record<string, string>) =>
      request<{ data: FeedItemRecord[]; total: number; hasMore: boolean; nextOffset: number | null }>(
        withQuery('/items', params),
      ),
    get: (id: string) => request<{ data: FeedItemRecord }>(`/items/${id}`),
    stats: () => request<ItemsStats>('/items/stats'),
    markRead: (id: string) => request<{ message?: string }>(`/items/${id}/read`, { method: 'PUT' }),
    favorite: (id: string, isFavorite: boolean) =>
      request<{ message?: string }>(`/items/${id}/favorite`, { method: 'PUT', body: { isFavorite } }),
    later: (id: string, isLater: boolean) =>
      request<{ message?: string }>(`/items/${id}/later`, { method: 'PUT', body: { isLater } }),
    markAllRead: () => request<{ message?: string }>('/items/mark-all-read', { method: 'POST' }),
    startAudio: (id: string) =>
      request<{ message: string; taskId: string; status: string }>(`/items/${id}/audio-transcribe`, { method: 'POST' }),
    reprocessAi: (id: string) =>
      request<{ message: string; filtered?: number; scored: number; summarized: number; translated: number; data: FeedItemRecord }>(
        `/items/${id}/reprocess-ai`,
        { method: 'POST' },
      ),
    enrich: (id: string) =>
      request<ItemEnrichResult>(`/items/${id}/enrich`, { method: 'POST' }),
    feedback: (id: string, data: { feedbackType: string; reasonTags?: string[]; note?: string; targetSkillId?: number | null }) =>
      request<{ message: string; data: ItemFeedbackRecord }>(`/items/${id}/feedback`, { method: 'POST', body: data }),
    scoreBreakdown: (id: string) =>
      request<{ data: ItemScoreBreakdownPayload }>(`/items/${id}/score-breakdown`),
    qualityCheck: (id: string) =>
      request<{ data: ItemQualityCheckPayload }>(`/items/${id}/quality-check`),
    restore: (id: string) =>
      request<{ message: string; data: FeedItemRecord | null }>(`/items/${id}/restore`, { method: 'POST' }),
    reprocessBatch: (data: { stage?: 'content' | 'quality' | 'scoring' | 'summary' | 'translation' | 'all'; itemId?: string; sourceId?: number; date?: string; limit?: number }) =>
      request<{
        message: string;
        matched: number;
        content: number;
        quality: number;
        scored: number;
        summarized: number;
        translated: number;
        skipped?: {
          quality?: number;
          scoring?: number;
          summary?: number;
          translation?: number;
        };
        errors: Record<string, string[]>;
        itemIds: string[];
      }>('/items/reprocess', { method: 'POST', body: data }),
  },

  fetch: {
    trigger: () => request<FetchTriggerResult>('/fetch/trigger', { method: 'POST' }),
    triggerDue: () => request<FetchTriggerResult>('/fetch/due', { method: 'POST' }),
    triggerSource: (id: number, params?: { contentLimit?: number; aiLimit?: number; translationLimit?: number }) =>
      request<FetchTriggerResult>(withQuery(`/fetch/source/${id}`, params), { method: 'POST' }),
    status: () => request<FetchStatusResponse>('/fetch/status'),
  },

  diagnostics: {
    network: () => request<NetworkDiagnosticResponse>('/diagnostics/network'),
    proxyTest: (data: { proxyUrl: string; targetUrl?: string }) =>
      request<{ ok: boolean; proxyUrl: string; targetUrl: string; statusCode?: number; latencyMs: number; error?: string }>(
        '/diagnostics/proxy-test',
        { method: 'POST', body: data },
      ),
    fetchJobs: (params?: { limit?: number }) =>
      request<FetchQueueDiagnosticResponse>(withQuery('/diagnostics/fetch-jobs', params)),
  },

  settings: {
    fetch: () => request<{ data: FetchSettings }>('/settings/fetch'),
    updateFetch: (data: Partial<FetchSettings>) =>
      request<{ data: FetchSettings }>('/settings/fetch', { method: 'PUT', body: data }),
  },

  insights: {
    list: (params?: Record<string, string>) => request<{ data: InsightRecord[] }>(withQuery('/insights', params)),
    workflow: () => request<{ data: DailyReportWorkflowPayload }>('/insights/workflow'),
    updateWorkflow: (workflow: DailyReportWorkflowConfig) =>
      request<{ data: { workflow: DailyReportWorkflowConfig } }>('/insights/workflow', { method: 'PUT', body: { workflow } }),
    previewWorkflow: (workflow: DailyReportWorkflowConfig) =>
      request<{ data: { workflow: DailyReportWorkflowConfig; preview: DailyReportWorkflowPreview } }>(
        '/insights/workflow/preview',
        { method: 'POST', body: { workflow } },
      ),
    dashboard: (params?: { windowDays?: number; limit?: number }) =>
      request<{ data: GrowthDashboardRecord }>(withQuery('/insights/dashboard', params)),
    get: (date: string) => request<{ data: InsightRecord }>(`/insights/${date}`),
    generate: (opts?: { date?: string; topN?: number; minScore?: number; preset?: 'full' | 'decision' | 'research' | 'reading'; compareWindowDays?: number; generationMode?: 'fast' | 'full'; mode?: 'fast' | 'full' }) =>
      request<{ data?: InsightGeneratePayload }>(withQuery('/insights/generate', opts), { method: 'POST' }),
  },

  export: {
    obsidian: () => request<ExportMutationResult>('/export/obsidian', { method: 'POST' }),
    knowledge: () => request<ExportMutationResult>('/export/knowledge', { method: 'POST' }),
    markdown: () => request<string>('/export/markdown', { method: 'POST', asText: true }),
  },

  aiConfigs: {
    list: () => request<{ data: AiConfig[]; meta?: AiConfigMeta }>('/ai-configs'),
    create: (data: Partial<AiConfig>) => request<{ data: AiConfig }>('/ai-configs', { method: 'POST', body: data }),
    update: (id: number, data: Partial<AiConfig>) =>
      request<{ data: AiConfig }>(`/ai-configs/${id}`, { method: 'PUT', body: data }),
    batchModel: (data: { modelConfigId: string; types?: string[]; isActive?: boolean }) =>
      request<{ data: AiConfig[]; updated: number }>('/ai-configs/batch-model', { method: 'POST', body: data }),
    delete: (id: number) => request<{ message: string }>(`/ai-configs/${id}`, { method: 'DELETE' }),
  },

  rules: {
    list: (params?: { scope?: 'user' | 'global' | 'effective' }) =>
      request<{ data: Array<Record<string, unknown>> }>(withQuery('/rules', params)),
    create: (data: Record<string, unknown>) => request<{ data: Record<string, unknown> }>('/rules', { method: 'POST', body: data }),
    update: (id: number, data: Record<string, unknown>) =>
      request<{ data: Record<string, unknown> }>(`/rules/${id}`, { method: 'PUT', body: data }),
    delete: (id: number) => request<{ message: string }>(`/rules/${id}`, { method: 'DELETE' }),
  },

  qualityPolicies: {
    list: (params?: { scope?: 'user' | 'global' | 'effective' }) =>
      request<{ data: QualityPolicySnapshot }>(withQuery('/quality-policies', params)),
    updateTier: (tier: string, data: { scope?: 'user' | 'global'; config: Record<string, unknown> }) =>
      request<{ data: Record<string, unknown> }>(`/quality-policies/tier/${tier}`, { method: 'PUT', body: data }),
    deleteTier: (tier: string, scope?: 'user' | 'global') =>
      request<{ message: string }>(withQuery(`/quality-policies/tier/${tier}`, scope ? { scope } : undefined), { method: 'DELETE' }),
    updateSource: (sourceId: number, data: { config: Record<string, unknown> }) =>
      request<{ data: Record<string, unknown> }>(`/quality-policies/source/${sourceId}`, { method: 'PUT', body: data }),
    deleteSource: (sourceId: number) =>
      request<{ message: string }>(`/quality-policies/source/${sourceId}`, { method: 'DELETE' }),
  },

  scoringSkills: {
    list: () => request<{ data: ScoringSkillRecord[]; health?: ScoringSkillHealthSummary; defaults?: { prompt?: string; rubric?: Record<string, unknown>; presets?: string[]; reasonTags?: string[] } }>('/scoring-skills'),
    probeModel: (data: { modelConfigId: string; limit?: number }) =>
      request<{ data: ScoringModelProbeSummary }>('/scoring-skills/model-probe', { method: 'POST', body: data }),
    applyModelRemediation: (data: { modelConfigId: string; limit?: number }) =>
      request<{ data: ScoringModelRemediationApplyResult }>('/scoring-skills/model-remediation/apply', { method: 'POST', body: data }),
    recoverFallbackScoring: (data: { limit?: number }) =>
      request<{ data: FallbackScoringRecoverySummary }>('/scoring-skills/fallback-recovery/apply', { method: 'POST', body: data }),
    create: (data: Partial<ScoringSkillRecord> & { createDefault?: boolean }) =>
      request<{ data: ScoringSkillRecord | null }>('/scoring-skills', { method: 'POST', body: data }),
    update: (id: number, data: Partial<ScoringSkillRecord>) =>
      request<{ data: ScoringSkillRecord }>(`/scoring-skills/${id}`, { method: 'PUT', body: data }),
    toggle: (id: number) =>
      request<{ data: ScoringSkillRecord }>(`/scoring-skills/${id}/toggle`, { method: 'POST' }),
    delete: (id: number) =>
      request<{ message: string }>(`/scoring-skills/${id}`, { method: 'DELETE' }),
  },

  preferences: {
    profile: () =>
      request<{ data: PreferenceProfileRecord | null; summary: PreferenceProfileSummary }>('/preferences/profile'),
    rebuildProfile: () =>
      request<{ message: string; data: PreferenceProfileRecord | null; summary: PreferenceProfileSummary }>('/preferences/rebuild-profile', { method: 'POST' }),
  },

  quota: {
    me: () => request<{ data: UserQuota | null }>('/quota/me'),
    update: (data: Partial<UserQuota>) => request<{ data: UserQuota | null }>('/quota/me', { method: 'PUT', body: data }),
    plans: () =>
      request<{ data: Array<{ id: number; name: string; audioMinutesPerMonth: number; articlesPerDay: number; isPublic: boolean }> }>(
        '/quota/plans',
      ),
    setPlan: (planName: string) =>
      request<{ data: UserQuota | null }>('/quota/me/plan', { method: 'PUT', body: { planName } }),
  },

  audio: {
    uploadTask: (formData: FormData) => request<AudioTask>('/audio/tasks/upload', { method: 'POST', body: formData }),
    uploadTaskWithProgress: (formData: FormData, onProgress?: (percent: number) => void) =>
      uploadAudioTaskWithProgress(formData, onProgress),
    createFromUrl: (data: {
      url: string;
      prompt_template_id?: string;
      user_instruction?: string;
      llm_model?: string;
    }) => request<AudioTask>('/audio/tasks/from-url', { method: 'POST', body: data }),
    listTasks: (params?: { page?: number; page_size?: number; status?: string; tag?: string }) =>
      request<AudioTaskListResponse>(withQuery('/audio/tasks', params)),
    getTask: (taskId: string) => request<AudioTask>(`/audio/tasks/${taskId}`),
    deleteTask: (taskId: string) => request<void>(`/audio/tasks/${taskId}`, { method: 'DELETE' }),
    reprocessTask: (taskId: string, params?: { prompt_template_id?: string; llm_model?: string }) =>
      request<AudioTask>(withQuery(`/audio/tasks/${taskId}/reprocess`, params), { method: 'POST' }),
    getTaskTemplates: () => request<AudioTaskTemplate[]>('/audio/tasks/config/templates'),
    getTaskModels: () => request<AudioTaskModelsResponse>('/audio/tasks/config/models'),
    getMyQuota: () => request<AudioQuotaSnapshot>('/audio/tasks/quota'),
  },

  admin: {
    dashboardStats: () => request<AdminDashboardStats>('/admin/dashboard/stats'),
    dashboardCostByService: () => request<Array<Record<string, unknown>>>('/admin/dashboard/cost-by-service'),
    dashboardCostByUser: () => request<Array<Record<string, unknown>>>('/admin/dashboard/cost-by-user'),
    dashboardRecentUsage: (limit = 20) => request<Array<Record<string, unknown>>>(`/admin/dashboard/recent-usage?limit=${limit}`),

    listUsers: () => request<AdminUser[]>('/admin/users'),
    updateUser: (userId: string, data: Partial<{ is_active: boolean; role: string; quota_seconds_monthly: number }>) =>
      request<AdminUser>(`/admin/users/${userId}`, { method: 'PUT', body: data }),
    deleteUser: (userId: string) => request<{ message: string }>(`/admin/users/${userId}`, { method: 'DELETE' }),

    listInviteCodes: () => request<AdminInviteCode[]>('/admin/invite-codes'),
    createInviteCode: (data: { max_uses: number; expires_days?: number | null }) =>
      request<AdminInviteCode>('/admin/invite-codes', { method: 'POST', body: data }),

    listTasks: (params?: { page?: number; page_size?: number; status?: string; user_id?: string; search?: string }) =>
      request<{ items: AdminTask[]; total: number; page: number; page_size: number }>(withQuery('/admin/tasks', params)),
    getTaskDetail: (taskId: string) => request<{ data: AdminTask }>(`/admin/tasks/${taskId}`),
    reprocessTask: (taskId: string) =>
      request<{ message: string; task_id: string }>(`/admin/tasks/${taskId}/reprocess`, { method: 'POST' }),

    listPromptTemplates: () => request<AdminPromptTemplate[]>('/admin/prompts'),
    createPromptTemplate: (data: Record<string, unknown>) =>
      request<AdminPromptTemplate>('/admin/prompts', { method: 'POST', body: data }),
    updatePromptTemplate: (id: string, data: Record<string, unknown>) =>
      request<AdminPromptTemplate>(`/admin/prompts/${id}`, { method: 'PUT', body: data }),
    deletePromptTemplate: (id: string) => request<void>(`/admin/prompts/${id}`, { method: 'DELETE' }),
    previewPromptTemplate: (id: string) =>
      request<{ rendered: string; template_name: string }>(`/admin/prompts/${id}/preview`, { method: 'POST' }),

    listModelConfigs: () => request<AdminModelConfig[]>('/admin/models'),
    createModelConfig: (data: Record<string, unknown>) =>
      request<AdminModelConfig>('/admin/models', { method: 'POST', body: data }),
    updateModelConfig: (id: string, data: Record<string, unknown>) =>
      request<AdminModelConfig>(`/admin/models/${id}`, { method: 'PUT', body: data }),
    deleteModelConfig: (id: string) => request<void>(`/admin/models/${id}`, { method: 'DELETE' }),
    testModelConfig: (id: string) => request<Record<string, unknown>>(`/admin/models/${id}/test`, { method: 'POST' }),
    hubAiUsageSummary: (params?: AiUsageSummaryQuery) =>
      request<{ data: AiUsageSummary; source: string }>(withQuery('/admin/ai-usage/summary', params)),
    hubAiUsageEvents: (params?: AiUsageEventsQuery) =>
      request<{ data: AiUsageEvent[]; source: string }>(withQuery('/admin/ai-usage/events', params)),
    audioAiUsageSummary: (params?: AiUsageSummaryQuery) =>
      request<{ data: AiUsageSummary; source: string }>(withQuery('/audio/admin/usage/summary', params)),
    audioAiUsageEvents: (params?: AiUsageEventsQuery) =>
      request<{ data: AiUsageEvent[]; source: string }>(withQuery('/audio/admin/usage/events', params)),
    retentionStatus: () =>
      request<{ data: RetentionRunRecord | null }>('/admin/retention/status'),
    runRetention: (data?: { retentionDays?: number; dryRun?: boolean }) =>
      request<{ data: RetentionSummary }>('/admin/retention/run', { method: 'POST', body: data || {} }),
    storageStatus: () =>
      request<{ data: AdminStorageStatus }>('/admin/storage/status'),
  },
};

export * from './contracts';
