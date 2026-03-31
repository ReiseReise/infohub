export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

export interface AiConfig {
  id: number;
  userId: string;
  name: string;
  provider: string;
  model: string;
  modelLabel?: string | null;
  baseUrl?: string | null;
  temperature?: number | null;
  promptTemplate: string;
  promptTemplateName?: string | null;
  promptTemplateId?: string | null;
  modelConfigId?: string | null;
  type: 'scoring' | 'summary' | 'translation' | 'daily_report' | string;
  isActive: boolean;
  createdAt: string;
}

export interface AiConfigMeta {
  ownerLabel?: string | null;
  scope: 'admin' | 'self';
  resolvedFrom: 'self' | 'preferred_admin' | 'fallback_admin' | 'missing_user' | string;
  availableScenes?: string[];
}

export interface UserQuota {
  id: number;
  userId: string;
  planId?: number | null;
  planName?: string | null;
  audioMinutesPerMonth?: number | null;
  articlesPerDay?: number | null;
  audioMinutesUsedMonth?: number | null;
  audioMinutesResetAt?: string | null;
  autoTranscribeEnabled?: boolean | null;
  maxAutoPerDay?: number | null;
  maxEpisodeMinutes?: number | null;
  monthlyBudgetLimit?: number | null;
  autoCountToday?: number | null;
  autoCountResetAt?: string | null;
}

export interface FetchTriggerResult {
  message: string;
  sourceId?: number;
  enqueued?: boolean;
  jobId?: string;
  state?: string | null;
  mode?: string;
  itemsFound?: number;
  itemsNew?: number;
  itemsFiltered?: number;
  itemsDuplicate?: number;
  itemsQueuedAi?: number;
  outcome?: string;
  durationMs?: number;
  aiProcessed?: {
    scored: number;
    summarized: number;
    translated: number;
  };
  contentStats?: {
    withContent: number;
    withoutContent: number;
  };
  aiErrors?: {
    scoring?: string[];
    summary?: string[];
    translation?: string[];
  };
  newItemIds?: string[];
}

export interface DiscoveryCandidate {
  title: string;
  description?: string | null;
  websiteUrl?: string | null;
  feedUrl?: string | null;
  sourceHost?: string | null;
  iconUrl?: string | null;
  sourceType: string;
  collectorType: string;
  config: Record<string, unknown>;
  reason: string;
  confidence: number;
  discoveryKey: string;
  sampleCount: number;
  latestPublishedAt?: string | null;
  alreadySubscribed?: boolean;
  sampleItems: Array<{
    title: string;
    url?: string | null;
    publishedAt?: string | null;
  }>;
}

export interface ServiceDiagnostic {
  name: string;
  status: 'ok' | 'error';
  latencyMs: number;
  detail?: string;
  statusCode?: number;
  target?: string;
  reachable?: boolean;
  healthSource?: 'http' | 'container' | 'inferred';
  checkType?: 'http' | 'healthcheck';
}

export interface NetworkDiagnosticResponse {
  timestamp: string;
  summary: {
    total: number;
    ok: number;
    error: number;
  };
  services: ServiceDiagnostic[];
}

export interface QueueJobDiagnostic {
  id: string;
  name: string;
  state: string;
  sourceId?: number | null;
  sourceName?: string | null;
  collectorType?: string | null;
  attemptsMade: number;
  timestamp?: number | null;
  processedOn?: number | null;
  finishedOn?: number | null;
  failedReason?: string | null;
}

export interface FetchQueueDiagnosticResponse {
  queue: { waiting: number; active: number; completed: number; failed: number };
  totalJobs: number;
  jobs: QueueJobDiagnostic[];
}

export interface SourceRecord {
  id: number;
  name: string;
  url?: string | null;
  sourceType: string;
  collectorType: string;
  sourceRole?: string | null;
  sourceTier?: 'S' | 'A' | 'B' | 'C' | 'D' | string | null;
  processingProfile?: 'full' | 'smart' | 'brief' | 'monitor' | string | null;
  trustScore?: number | null;
  noiseScore?: number | null;
  growthAxes?: string[];
  upgradeRules?: Record<string, unknown> | null;
  category: string;
  status: string;
  fetchInterval?: number | null;
  autoFetchEnabled?: boolean | null;
  autoTranscribe?: boolean | null;
  healthScore?: number;
  lastFetchedAt?: string | null;
  nextFetchAt?: string | null;
  lastSuccessAt?: string | null;
  lastOutcome?: string | null;
  lastError?: string | null;
  renderMode?: 'auto' | 'native' | 'dynamic' | 'stealth' | string | null;
  lastFetchEngine?: string | null;
  blockedReason?: string | null;
  lastChangeSummary?: string | null;
  freshnessState?: 'healthy' | 'due' | 'stale' | 'paused' | 'error' | string | null;
  staleReason?: string | null;
  errorMessage?: string | null;
  itemCount?: number;
  config?: Record<string, unknown> | null;
}

export interface RetentionSummary {
  retentionDays: number;
  dryRun: boolean;
  items: number;
  insights: number;
  fetchLogs: number;
  aiUsageLogs: number;
  audioTasks: number;
  deleted?: {
    items?: number;
    insights?: number;
    fetchLogs?: number;
    aiUsageLogs?: number;
    audioTasks?: number;
  };
  skippedReferencedAudioTasks?: number;
  storageDeleteFailed?: number;
  errors?: string[];
}

export interface RetentionRunRecord {
  id: number;
  mode: string;
  retentionDays: number;
  status: string;
  summary: RetentionSummary | Record<string, unknown>;
  createdAt: string;
}

export interface StorageSyncGuidance {
  path: string;
  mode: 'backup_only' | 'sync_ok' | 'archive_only' | string;
  reason: string;
}

export interface StorageStatusRecord {
  hostDataRoot: string;
  hostExportRoot: string;
  hostBackupRoot: string;
  runtimePaths: Record<string, string>;
  audioStorageBackend: string;
  syncGuidance: StorageSyncGuidance[];
}

export interface BackupRunRecord {
  updatedAt?: string;
  status?: string;
  durationMs?: number;
  message?: string;
  backupDir?: string;
  manualCommand?: string;
  bundle?: {
    name?: string | null;
    path?: string | null;
    sizeBytes?: number | null;
  } | null;
  localRetention?: number;
  localPruned?: string[];
  remote?: {
    enabled?: boolean;
    configured?: boolean;
    status?: string;
    bucket?: string | null;
    prefix?: string | null;
    objectKey?: string | null;
    uploadedAt?: string | null;
    prunedKeys?: string[];
    error?: string | null;
  } | null;
}

export interface LocalBackupBundle {
  name: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface AdminStorageStatus {
  storage: StorageStatusRecord;
  backup: {
    localDir: string;
    statusFile: string;
    localRetention: number;
    oss: {
      enabled: boolean;
      bucket?: string | null;
      prefix: string;
      region: string;
      retention: number;
    };
    lastRun?: BackupRunRecord | null;
    localBundles: LocalBackupBundle[];
    localBundleCount: number;
    latestBundleName?: string | null;
    latestBundleBasename?: string | null;
    manualCommand: string;
  };
}

export interface SourceStats {
  total: number;
  active?: number;
  paused?: number;
  error?: number;
  byTier?: Array<{ sourceTier: string; count: number }>;
  byProcessingProfile?: Array<{ processingProfile: string; count: number }>;
}

export interface SubscriptionInput {
  name: string;
  sourceType: string;
  collectorType: string;
  config: Record<string, unknown>;
  category?: string;
  priority?: number;
  fetchInterval?: number;
  autoFetchEnabled?: boolean;
  autoTranscribe?: boolean;
  status?: string;
  tags?: unknown[];
  sourceRole?: string;
  sourceTier?: string;
  processingProfile?: string;
  growthAxes?: string[];
  trustScore?: number;
  noiseScore?: number;
  upgradeRules?: Record<string, unknown>;
}

export interface SubscriptionMutationResult {
  data: SourceRecord;
  created: boolean;
  duplicate: boolean;
}

export interface SubscriptionPackageMeta {
  slug: string;
  title: string;
  description: string;
  sourceCount: number;
}

export interface BatchSubscriptionResult {
  message: string;
  summary: { total: number; created: number; duplicates: number; failed: number };
  created: Array<{ index: number; data: SourceRecord }>;
  duplicates: Array<{ index: number; data: SourceRecord }>;
  failed: Array<{ index: number; error: string }>;
}

export interface FeedItemRecord {
  id: string;
  sourceId?: number;
  title: string;
  url: string;
  author?: string;
  snippet?: string;
  publishedAt?: string;
  fetchedAt?: string;
  aiScore?: number;
  aiSummary?: string;
  aiTags?: string[];
  sourceType: string;
  sourceTier?: 'S' | 'A' | 'B' | 'C' | 'D' | string;
  processingProfile?: 'full' | 'smart' | 'brief' | 'monitor' | string;
  growthAxes?: string[];
  sourceName?: string;
  sourceCategory?: string;
  sourceCollectorType?: string;
  isRead: boolean;
  isFavorite: boolean;
  isLater?: boolean;
  mediaType?: string;
  mediaUrl?: string;
  aiTranslation?: string;
  content?: string;
  transcript?: string;
  knowledge?: string;
  audioStatus?: string;
  audioStatusReason?: string | null;
  audioTaskId?: string;
  audioDuration?: number;
  processingStatus?: string;
  isFiltered?: boolean;
  filterReason?: string | null;
  contentStatus?: string;
  contentBasis?: 'title' | 'snippet' | 'content' | null;
  contentError?: string | null;
  fetchEngine?: string | null;
  renderMode?: string | null;
  blockedReason?: string | null;
  summaryStatus?: string;
  summaryBasis?: 'title' | 'snippet' | 'content' | null;
  translationStatus?: string;
  translationReason?: string | null;
  latestFeedbackType?: 'like' | 'dislike' | 'must_read' | 'not_for_me' | null;
}

export interface ScoringSkillRecord {
  id: number;
  userId: string;
  name: string;
  description?: string | null;
  presetKey?: 'ai_industry' | 'product_delivery' | 'narrative_capital' | null;
  status: 'draft' | 'active' | 'archived' | string;
  weight: number;
  instructionPrompt: string;
  rubricJson: Record<string, unknown>;
  outputSchemaVersion: number;
  modelConfigId?: string | null;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ItemFeedbackRecord {
  id: number;
  itemId: string;
  userId: string;
  feedbackType: 'like' | 'dislike' | 'must_read' | 'not_for_me';
  targetSkillId?: number | null;
  reasonTags: string[];
  note?: string | null;
  createdAt: string;
}

export interface PreferenceProfileRecord {
  userId: string;
  profileSummary?: string | null;
  positiveSignals: string[];
  negativeSignals: string[];
  focusTopics: string[];
  avoidTopics: string[];
  updatedFromFeedbackAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PreferenceProfileSummary {
  totalFeedback: number;
  positiveCount: number;
  negativeCount: number;
  topPositiveTags: string[];
  topNegativeTags: string[];
  lastFeedbackAt?: string | null;
}

export interface ItemScoreBreakdownRecord {
  id: number;
  itemId: string;
  userId: string;
  skillId?: number | null;
  score?: number | null;
  confidence?: number | null;
  decision?: string | null;
  reasons: string[];
  matchedSignals: string[];
  riskFlags: string[];
  rawResponse?: string | null;
  createdAt: string;
  skillName?: string | null;
  skillWeight?: number | null;
  skillStatus?: string | null;
}

export interface ItemScoreBreakdownPayload {
  itemId: string;
  aiScore?: number | null;
  priorityScore?: number | null;
  isFiltered?: boolean | null;
  filterReason?: string | null;
  latestFeedback?: ItemFeedbackRecord | null;
  breakdowns: ItemScoreBreakdownRecord[];
}

export interface ItemEnrichResult {
  message: string;
  contentFetched: boolean;
  contentBasis?: 'title' | 'snippet' | 'content' | null;
  scored: number;
  summarized: number;
  translated: number;
  recomputed?: {
    score: boolean;
    summary: boolean;
    translation: boolean;
  };
  filterDecision: string;
  warnings: string[];
  data: FeedItemRecord | null;
}

export interface ItemsStats {
  total: number;
  unread: number;
  today: number;
  favorites: number;
}

export interface FetchStatusResponse {
  runtimeOnline?: boolean;
  schedulerMode?: string;
  lastSuccessfulFetchAt?: string | null;
  freshnessStatus?: 'fresh' | 'warning' | 'stale' | string;
  staleReason?: string | null;
  staleSources?: number;
  oldestDueMinutes?: number | null;
  waiting?: number;
  active?: number;
  failed?: number;
  completed?: number;
  queue?: {
    waiting?: number;
    active?: number;
    failed?: number;
    completed?: number;
  };
  user?: {
    sourceCount?: number;
    userAutoFetchEnabled?: boolean;
      activeSources?: number;
      autoFetchSourceCount?: number;
      cronSkippedByUserSetting?: boolean;
      dueSources?: number;
      scheduleMode?: string;
      freshnessStatus?: 'fresh' | 'warning' | 'stale' | string;
      staleReason?: string | null;
      lastSuccessfulFetchAt?: string | null;
      oldestDueMinutes?: number | null;
      staleDetails?: Array<{
        name?: string | null;
        freshnessState?: string;
        staleReason?: string | null;
      }>;
      recentFetches?: Array<{
      id: number;
      sourceId?: number | null;
      sourceName?: string | null;
      status: string;
      startedAt?: string | null;
      finishedAt?: string | null;
      itemsFound?: number | null;
      itemsNew?: number | null;
      itemsFiltered?: number | null;
      itemsDuplicate?: number | null;
      itemsQueuedAi?: number | null;
      outcome?: string | null;
      error?: string | null;
      durationMs?: number | null;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface InsightRecord {
  id: number | string;
  date: string;
  summary?: string | null;
  itemCount?: number;
  payload?: {
    snapshot?: {
      date?: string;
      totalItems?: number;
      newItems?: number;
      compareWindowDays?: number;
      topItems?: Array<{
        id: string;
        title: string;
        url: string;
        aiScore?: number | null;
        aiSummary?: string | null;
        sourceName: string;
        category: string;
      }>;
      highScoreItems?: Array<{
        id: string;
        title: string;
        url: string;
        aiScore?: number | null;
        aiSummary?: string | null;
        sourceName: string;
        category: string;
      }>;
      byCategory?: Array<{ category: string; count: number; baselineAvg?: number; delta?: number }>;
      topSources?: Array<{ sourceName: string; count: number }>;
      themeClusters?: Array<{ label: string; count: number; sampleTitles: string[] }>;
      generatedAt?: string;
    };
    modules?: Partial<Record<'decision' | 'research' | 'reading', {
      key: 'decision' | 'research' | 'reading';
      title: string;
      markdown: string;
      bullets: string[];
      citations: Array<{
        id: string;
        title: string;
        url: string;
        sourceName: string;
        category: string;
        aiScore?: number | null;
      }>;
      meta?: {
        sceneType: string;
        resolvedConfigType?: string | null;
        provider?: string | null;
        model?: string | null;
        estimatedCost?: number | null;
        status: 'ai' | 'fallback';
        error?: string;
      };
    }>>;
    cleaning?: {
      output?: {
        summary?: string;
        prioritySignals?: string[];
        themeLabels?: string[];
        watchlist?: string[];
        domainBuckets?: Record<string, string[]>;
      };
      rawText?: string;
      meta?: {
        sceneType: string;
        resolvedConfigType?: string | null;
        provider?: string | null;
        model?: string | null;
        estimatedCost?: number | null;
        status: 'ai' | 'fallback';
        error?: string;
      };
    };
    final?: {
      markdown: string;
      bullets?: string[];
      meta?: {
        sceneType: string;
        resolvedConfigType?: string | null;
        provider?: string | null;
        model?: string | null;
        estimatedCost?: number | null;
        status: 'ai' | 'fallback';
        error?: string;
      };
    };
    preset?: 'full' | 'decision' | 'research' | 'reading';
  };
  pipelineVersion?: number;
  [key: string]: unknown;
}

export interface GrowthDashboardItem {
  id: string;
  title: string;
  url: string;
  sourceName?: string | null;
  sourceCategory?: string | null;
  sourceTier: string;
  processingProfile: string;
  aiScore?: number | null;
  priorityScore?: number | null;
  summary?: string | null;
  growthAxes: string[];
  actionSuggestion: string;
  publishedAt?: string | null;
  fetchedAt?: string | null;
}

export interface GrowthDashboardAxis {
  axis: string;
  count: number;
  averageScore?: number | null;
  summary: string;
  items: GrowthDashboardItem[];
}

export interface GrowthDashboardRecord {
  windowDays: number;
  summary: {
    totalItems: number;
    activeSources: number;
    signalSources: number;
    mustReview: number;
    generatedAt: string;
  };
  axes: GrowthDashboardAxis[];
  sourceTierStats: Array<{ tier: string; count: number }>;
  processingProfileStats: Array<{ profile: string; count: number }>;
  recentReports: InsightRecord[];
}

export interface InsightGeneratePayload {
  newItems?: number;
  highScoreItems?: unknown[];
  markdown?: string;
  payload?: InsightRecord['payload'];
  modules?: NonNullable<InsightRecord['payload']>['modules'];
  snapshot?: NonNullable<InsightRecord['payload']>['snapshot'];
  preset?: 'full' | 'decision' | 'research' | 'reading';
  compareWindowDays?: number;
  pipelineVersion?: number;
  [key: string]: unknown;
}

export interface ExportMutationResult {
  message?: string;
  exported?: number;
  [key: string]: unknown;
}

export interface AudioTask {
  id: string;
  title: string;
  status: string;
  error_message?: string | null;
  source_url?: string | null;
  audio_url?: string | null;
  audio_format?: string | null;
  audio_duration?: number | null;
  audio_file_size?: number | null;
  transcript_text?: string | null;
  summary_result?: Record<string, unknown> | string | null;
  multimodal_result?: Record<string, unknown> | null;
  user_instruction?: string | null;
  asr_model?: string | null;
  llm_model?: string | null;
  source_kind?: string | null;
  download_stage?: string | null;
  download_strategy?: string | null;
  storage_backend?: string | null;
  requested_asr_model?: string | null;
  effective_asr_model?: string | null;
  asr_mode?: string | null;
  asr_selection_reason?: string | null;
  fallback_provider?: string | null;
  fallback_reason?: string | null;
  failure_code?: string | null;
  failure_detail?: string | null;
  asr_status?: string | null;
  summary_status?: string | null;
  render_status?: string | null;
  task_integrity_status?: string | null;
  task_integrity_reason?: string | null;
  export_markdown?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FetchSettings {
  userId: string;
  autoFetchEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AudioTaskListResponse {
  items: AudioTask[];
  total: number;
  page: number;
  page_size: number;
}

export interface AudioTaskTemplate {
  id: string;
  name: string;
  description?: string;
  category?: string;
}

export interface AudioModelOption {
  id: string;
  name: string;
  description?: string;
}

export interface AudioTaskModelsResponse {
  llm_models: AudioModelOption[];
  asr_models: AudioModelOption[];
}

export type AudioQuotaSnapshot = Record<string, unknown>;

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
  quota_seconds_monthly: number;
  created_at: string;
  last_active_at?: string | null;
}

export interface AdminInviteCode {
  id: string;
  code: string;
  max_uses: number;
  used_count: number;
  expires_at?: string | null;
  created_at: string;
}

export interface AdminTask {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at?: string;
  user?: {
    email?: string | null;
    username?: string | null;
  } | null;
  [key: string]: unknown;
}

export interface AdminDashboardStats {
  total_tasks?: number;
  today_tasks?: number;
  total_users?: number;
  month_cost?: number;
  [key: string]: unknown;
}

export interface AdminPromptTemplate {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  template_text?: string | null;
  variables?: string[] | Record<string, unknown> | null;
  is_system?: boolean;
  is_active?: boolean;
  version?: number;
  created_at?: string;
  updated_at?: string;
}

export interface AdminModelConfig {
  id: string;
  provider?: string;
  alias?: string | null;
  model_name?: string;
  model_type?: string;
  has_api_key?: boolean;
  base_url?: string | null;
  extra_config?: Record<string, unknown> | null;
  is_default?: boolean;
  is_active?: boolean;
  test_status?: string;
  test_message?: string | null;
  tested_at?: string | null;
  usageScenes?: string[];
  usageCount?: number;
  created_at?: string;
  updated_at?: string;
}

export interface AiUsageSummaryBucket {
  key: string;
  count: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  avgLatencyMs?: number | null;
}

export interface AiUsageTrendPoint {
  bucket: string;
  calls: number;
  success: number;
  error: number;
  estimatedCost: number;
  totalTokens: number;
  avgLatencyMs?: number | null;
}

export interface AiUsageHotspot {
  key: string;
  count: number;
  estimatedCost: number;
  avgLatencyMs?: number | null;
}

export interface AiUsageSummary {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCost: number;
  byScene: AiUsageSummaryBucket[];
  byProvider: AiUsageSummaryBucket[];
  byModel: AiUsageSummaryBucket[];
  byStatus: AiUsageSummaryBucket[];
  trends?: AiUsageTrendPoint[];
  hotspots?: {
    errors: AiUsageHotspot[];
    expensive: AiUsageHotspot[];
    slow: AiUsageHotspot[];
  };
}

export interface AiUsageEvent {
  id: string | number;
  source?: 'hub' | 'audio';
  userId?: string;
  username?: string | null;
  email?: string | null;
  sceneType: string;
  status: string;
  provider?: string | null;
  modelName?: string | null;
  endpointId?: string | null;
  modelConfigId?: string | null;
  promptTemplateId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  label?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number | null;
  latencyMs?: number | null;
  providerRequestId?: string | null;
  apiKind?: string | null;
  promptPreview?: string | null;
  responsePreview?: string | null;
  errorMessage?: string | null;
  createdAt: string;
}
