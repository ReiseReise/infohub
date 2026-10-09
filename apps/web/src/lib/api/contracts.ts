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
  type: 'quality_filter' | 'scoring' | 'summary' | 'translation' | 'daily_report' | string;
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
  pollUrl?: string;
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
    filtered?: number;
    scored: number;
    summarized: number;
    translated: number;
  };
  contentStats?: {
    withContent: number;
    withoutContent: number;
  };
  qualityFunnel?: SourceQualityFunnel;
  limits?: {
    contentLimit: number;
    aiLimit: number;
    translationLimit: number;
  };
  aiErrors?: {
    scoring?: string[];
    summary?: string[];
    translation?: string[];
  };
  newItemIds?: string[];
}

export interface FetchJobStatus {
  jobId: string;
  state: string;
  sourceId: number;
  sourceName?: string | null;
  collectorType?: string | null;
  attemptsMade: number;
  timestamp?: number | null;
  processedOn?: number | null;
  finishedOn?: number | null;
  failedReason?: string | null;
  stageSummary?: {
    id?: number;
    status?: string | null;
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
  } | null;
}

export interface SourceQualityFunnel {
  fetched: number;
  unique: number;
  duplicate: number;
  visible: number;
  filtered: number;
  contentReady: number;
  contentDegraded: number;
  contentMissing: number;
  qualityPass: number;
  qualityReview: number;
  qualityFilter: number;
  scored: number;
  summarized: number;
  translated: number;
  reportSelected: number;
  duplicateRate: number;
  contentReadyRate: number;
  aiReadyRate: number;
  noiseRate: number;
  reportSelectedRate: number;
  qualityScore: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor' | 'empty' | string;
}

export interface SourceStageHealth {
  status: 'healthy' | 'stale' | 'degraded' | 'failing' | 'blocked' | 'empty' | string;
  label: string;
  summary: string;
  latestIssue?: string | null;
  metrics?: Record<string, number | string | null>;
}

export interface SourceRecommendedAction {
  action: 'fetch' | 'check_config' | 'repair_content' | 'repair_ai' | 'review_daily_coverage' | string;
  label: string;
  reason: string;
  stage: 'fetch' | 'content' | 'ai' | 'report' | string;
}

export interface SourceHealthSnapshot {
  healthStatus: 'healthy' | 'config_mismatch' | 'needs_fetch' | 'fetch_failing' | 'content_degraded' | 'ai_blocked' | 'report_gap' | 'watch' | string;
  healthLabel: string;
  healthReasons: string[];
  stageHealth: {
    fetch: SourceStageHealth;
    content: SourceStageHealth;
    display: SourceStageHealth;
    ai: SourceStageHealth;
    report: SourceStageHealth;
  };
  recommendedActions: SourceRecommendedAction[];
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
  sourceHost?: string | null;
  iconUrl?: string | null;
  sourceRole?: string | null;
  sourceKind?: 'official' | 'blog' | 'rss' | 'x' | 'wechat' | 'media' | 'api' | 'webpage' | 'podcast' | 'other' | string | null;
  sourceTier?: 'S' | 'A' | 'B' | 'C' | 'D' | string | null;
  readingTier?: 'high_value' | 'light_reading' | 'explore' | 'paused' | string | null;
  readingTierLabel?: string | null;
  readingTierReason?: string | null;
  topicGroup?: 'ai_frontier' | 'agents_products' | 'infrastructure' | 'engineering' | 'business_industry' | 'policy_safety' | 'research_deep' | 'society_culture' | 'tools_lifestyle' | 'other' | string | null;
  topicGroupLabel?: string | null;
  governanceRole?: 'first_party' | 'professional_media' | 'personal_blog' | 'aggregator' | 'community_social' | 'monitor' | 'private_inbox' | 'audio_video' | 'other' | string | null;
  governanceRoleLabel?: string | null;
  classificationSource?: 'manual' | 'partial' | 'cold_start' | string | null;
  needsGovernanceReview?: boolean;
  classificationReasons?: string[];
  aiDailyBudget?: number | null;
  aiProcessedToday?: number | null;
  aiBudgetRemaining?: number | null;
  aiBudgetWindowStart?: string | null;
  aiBudgetWindowEnd?: string | null;
  authorityWeight?: number | null;
  processingProfile?: 'full' | 'smart' | 'brief' | 'monitor' | string | null;
  contentStrategy?: 'feed_only' | 'smart' | 'full' | 'monitor_only' | string | null;
  trustScore?: number | null;
  noiseScore?: number | null;
  growthAxes?: string[];
  upgradeRules?: Record<string, unknown> | null;
  tags?: string[] | unknown[] | null;
  category: string;
  status: 'scheduled' | 'running' | 'full' | 'degraded' | 'failed' | string;
  fetchInterval?: number | null;
  autoFetchEnabled?: boolean | null;
  autoTranscribe?: boolean | null;
  healthScore?: number;
  lastFetchedAt?: string | null;
  nextFetchAt?: string | null;
  lastSuccessAt?: string | null;
  lastOutcome?: string | null;
  lastError?: string | null;
  createdAt?: string;
  updatedAt?: string;
  renderMode?: 'auto' | 'native' | 'dynamic' | 'stealth' | 'browser-assist' | string | null;
  lastFetchEngine?: string | null;
  blockedReason?: string | null;
  lastChangeSummary?: string | null;
  freshnessState?: 'healthy' | 'due' | 'stale' | 'paused' | 'error' | string | null;
  staleReason?: string | null;
  errorMessage?: string | null;
  itemCount?: number;
  entryCount?: number;
  filteredCount?: number;
  unreadCount?: number;
  favoriteCount?: number;
  selectedCount?: number;
  selectedHitRate?: number;
  duplicateContribution?: number;
  contentReadyCount?: number;
  contentDegradedCount?: number;
  contentMissingCount?: number;
  qualityPassCount?: number;
  qualityReviewCount?: number;
  qualityFilterCount?: number;
  scoredCount?: number;
  summarizedCount?: number;
  translationCompletedCount?: number;
  summaryFailedCount?: number;
  translationFailedCount?: number;
  titleOnlyCount?: number;
  snippetOnlyCount?: number;
  longReadRiskCount?: number;
  averageContentLength?: number;
  sourceQuality?: SourceQualityFunnel;
  sourceHealth?: SourceHealthSnapshot;
  healthStatus?: SourceHealthSnapshot['healthStatus'];
  healthReasons?: string[];
  stageHealth?: SourceHealthSnapshot['stageHealth'];
  recommendedActions?: SourceRecommendedAction[];
  latestItemTitle?: string | null;
  latestItemUrl?: string | null;
  latestItemAt?: string | null;
  config?: Record<string, unknown> | null;
}

export interface DibaoStatusPayload {
  available: boolean;
  publicUrl: string;
  healthUrl: string;
  message: string;
  version: string | null;
  checkedAt: string;
  error: string | null;
  raw?: unknown;
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
  categoryDefault?: string;
  tierSummary?: Partial<Record<'S' | 'A' | 'B' | 'C' | 'D' | string, number>>;
}

export interface BatchSubscriptionResult {
  message: string;
  summary: { total: number; created: number; duplicates: number; failed: number };
  created: Array<{ index: number; data: SourceRecord }>;
  duplicates: Array<{ index: number; data: SourceRecord }>;
  failed: Array<{ index: number; error: string }>;
}

export type ReferenceSourceProvider = 'qmreader' | 'follow_builders' | 'aihot' | 'origin12';
export type ReferenceSourceImportMode = 'rss' | 'podcast' | 'adapter_required' | 'reference_only';

export interface ReferenceSourceCatalogItem {
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
  readingTier: 'high_value' | 'light_reading' | 'explore' | 'paused';
  recommended: boolean;
  defaultEnabled: false;
  importMode: ReferenceSourceImportMode;
  providerEnabled: boolean;
  providerStatus: string;
  observationStatus: 'current' | 'historical';
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
  alreadyAdded: boolean;
  existingSourceId: number | null;
  canImport: boolean;
  importReason: string;
}

export interface ReferenceSourceCatalogPayload {
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
  total: number;
  offset: number;
  limit: number;
  providers: ReferenceSourceProvider[];
  channels: string[];
  items: ReferenceSourceCatalogItem[];
}

export type ReferenceIntegrationStatus = 'available' | 'shadow' | 'active' | 'paused' | 'removed';

export interface ReferenceSourceQualityMetrics {
  windowDays: 7;
  observationDays: number;
  fetchAttempts: number;
  fetchSuccessRate: number | null;
  itemCount: number;
  aiRelevanceRate: number | null;
  aiProcessingRate: number | null;
  originalLinkRate: number | null;
  noiseRate: number | null;
  duplicateRate: number | null;
  componentHealth: Array<{
    key: string;
    name: string;
    required: boolean;
    attempts7d: number;
    successes7d: number;
    successRate: number | null;
    lastOutcome: string;
    lastError: string | null;
    lastCheckedAt: string | null;
    eligible: boolean;
  }>;
  eligibleForActivation: boolean;
  activationReasons: string[];
}

export interface ReferenceIntegrationCatalogItem extends Omit<
  ReferenceSourceCatalogItem,
  'alreadyAdded' | 'existingSourceId' | 'canImport' | 'importReason'
> {
  integrationStatus: ReferenceIntegrationStatus;
  sourceId: number | null;
  quality: ReferenceSourceQualityMetrics;
  canPreview: boolean;
}

export interface ReferenceIntegrationCatalogPayload {
  version: number;
  updatedAt: string;
  total: number;
  recommended: number;
  enabled?: boolean;
  limits: {
    totalActive: number;
    referenceActive: number;
    referenceShadow: number;
    referenceFormal: number;
    totalScheduled: number;
  };
  activeCounts: {
    total: number;
    reference: number;
    formalReference: number;
    referenceShadow: number;
    referenceFormal: number;
    totalScheduled: number;
  };
  items: ReferenceIntegrationCatalogItem[];
}

export interface ReferenceSourcePreviewItem {
  title: string;
  url: string;
  originalUrl?: string | null;
  curationUrl?: string | null;
  curationSource?: string | null;
  content: string;
  publishedAt?: string | null;
  curationMeta?: Record<string, unknown> | null;
}

export interface ReferenceSourcePreviewPayload {
  key: string;
  status: 'ready' | 'empty' | 'failed';
  fetchedAt: string;
  error: string | null;
  items: ReferenceSourcePreviewItem[];
}

export interface DailyReportItemDiagnostic {
  itemId: string;
  status: 'selected' | 'review' | 'latest_visible' | 'excluded' | 'not_in_window' | 'not_generated' | string;
  label: string;
  reason: string;
  detail?: string | null;
  action: string;
  tone: 'ok' | 'warning' | 'danger' | 'neutral';
  selectionMode?: string | null;
  selectionReason?: string | null;
  excludedReason?: 'translation_failed' | 'not_chinese' | 'not_selected' | 'business_noise' | 'fallback_scored' | string | null;
  diagnosticBasis?: 'insight_snapshot' | 'current_rules' | string;
  diagnosticBasisLabel?: string | null;
  snapshotGeneratedAt?: string | null;
}

export interface ContentReadiness {
  status: 'full_text' | 'rss_summary' | 'snippet_only' | 'title_only' | 'fetch_failed' | 'pending' | string;
  label: string;
  basis: 'content' | 'snippet' | 'title' | string;
  kind?: 'article' | 'snapshot' | 'curated_summary' | 'index_item' | 'external_link_summary' | string;
  isFullText?: boolean;
  fullTextAvailable: boolean;
  originalTextStatus?: 'ready' | 'pending_fetch' | 'missing_original_url' | 'not_applicable' | string;
  action: string;
}

export type ContentEvidenceLayer =
  | 'readableText'
  | 'rawFeedHtml'
  | 'externalLinkSummary'
  | 'indexSummary'
  | 'curatedSummary'
  | 'snapshotText'
  | 'snippet'
  | 'title'
  | 'none'
  | string;

export interface ContentEvidenceSignal {
  available: boolean;
  length: number;
  label: string;
  status?: string | null;
  reason?: string | null;
}

export interface ContentEvidence {
  primaryLayer: ContentEvidenceLayer;
  primaryLabel: string;
  rawFeedHtml: ContentEvidenceSignal;
  readableHtml: ContentEvidenceSignal;
  readableText: ContentEvidenceSignal;
  externalLinkSummary?: ContentEvidenceSignal;
  indexSummary: ContentEvidenceSignal;
  curatedSummary: ContentEvidenceSignal;
  snapshotText: ContentEvidenceSignal;
  snippet: ContentEvidenceSignal;
  title: ContentEvidenceSignal;
  translationBasis: {
    layer: ContentEvidenceLayer;
    label: string;
    reliableForFullTranslation: boolean;
    reason: string;
  };
}

export interface TranslationCompleteness {
  basisLength: number;
  translatedLength: number;
  chunkCount: number;
  complete: boolean;
  usable?: boolean;
  reason?: string | null;
  reasonCode?: 'empty' | 'structured_output_leak' | 'non_chinese' | 'model_refusal' | 'too_short' | 'missing_paragraphs' | 'missing_links' | 'missing_images' | 'missing_code' | 'truncated' | string | null;
  formatVersion?: 'translation-v2' | string;
}

export interface ReadingAsset {
  id?: number | string | null;
  type: 'summary' | 'translation' | 'rewrite' | 'qa' | 'feedback' | 'report_reference' | 'transcript' | 'knowledge' | string;
  label: string;
  status: 'ready' | 'pending' | 'failed' | 'skipped' | 'missing' | string;
  basis?: 'content' | 'snippet' | 'title' | string | null;
  model?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  preview?: string | null;
  content?: string | null;
  source: 'ai' | 'human' | 'system' | 'report' | string;
  promptKey?: string | null;
  errorReason?: string | null;
}

export interface RankContext {
  strategy: 'feed_recommended_v1' | 'feed_latest_v1' | string;
  version: string;
  generatedAt: string;
  reasons: string[];
  fallback: boolean;
}

export interface ReportContext {
  strategy: 'daily_report_selection_v2' | string;
  version: string;
  window?: string | null;
  selectionMode: string;
  reason: string;
  action: string;
  label: string;
}

export interface FeedEventContext {
  clusterId: string;
  leadItemId: string;
  leadSourceName?: string | null;
  leadReason: string;
  internalSourceCount: number;
  externalSourceCount: number;
  firstPartyCount: number;
  relatedItems: Array<{
    id: string;
    title: string;
    url: string;
    originalUrl?: string | null;
    sourceName?: string | null;
    sourceTier?: string | null;
    sourceKind?: string | null;
    sourceRole?: string | null;
    curationSource?: string | null;
    evidenceType: 'first_party' | 'local' | 'external_radar';
    publishedAt?: string | null;
    fetchedAt?: string | null;
  }>;
}

export interface FeedItemRecord {
  id: string;
  sourceId?: number;
  title: string;
  url: string;
  originalUrl?: string | null;
  curationUrl?: string | null;
  curationSource?: string | null;
  curationMeta?: Record<string, unknown> | null;
  author?: string;
  snippet?: string;
  publishedAt?: string;
  fetchedAt?: string;
  aiScore?: number;
  aiSummary?: string;
  aiTags?: string[];
  sourceType: string;
  sourceTier?: 'S' | 'A' | 'B' | 'C' | 'D' | string;
  sourceKind?: string | null;
  authorityWeight?: number | null;
  processingProfile?: 'full' | 'smart' | 'brief' | 'monitor' | string;
  growthAxes?: string[];
  clusterId?: string | null;
  eventContext?: FeedEventContext | null;
  eventCluster?: {
    clusterId: string;
    leadItemId: string;
    relatedCount: number;
    recommendationReason: string;
    relatedItems: Array<{
      id: string;
      title: string;
      url: string;
      sourceName?: string | null;
      sourceTier?: string | null;
      sourceKind?: string | null;
      aiScore?: number | null;
      priorityScore?: number | null;
      publishedAt?: string | null;
      fetchedAt?: string | null;
    }>;
  } | null;
  dailyReportDiagnostic?: DailyReportItemDiagnostic | null;
  sourceName?: string;
  sourceCategory?: string;
  sourceCollectorType?: string;
  sourceRole?: string | null;
  sourceContentStrategy?: 'feed_only' | 'smart' | 'full' | 'monitor_only' | string | null;
  isRead: boolean;
  isFavorite: boolean;
  isLater?: boolean;
  mediaType?: string;
  mediaUrl?: string;
  aiTranslation?: string;
  translatedTitle?: string | null;
  language?: string | null;
  content?: string;
  readabilityContent?: string | null;
  readabilityStatus?: 'ready' | 'pending' | 'failed' | 'missing' | string | null;
  readabilityReason?: string | null;
  transcript?: string;
  knowledge?: string;
  audioStatus?: string;
  audioStatusReason?: string | null;
  audioTaskId?: string;
  audioDuration?: number;
  processingStatus?: string;
  isFiltered?: boolean;
  filterReason?: string | null;
  qualityDecision?: 'pass' | 'review' | 'filter' | string | null;
  qualitySummary?: string | null;
  qualityReason?: string | null;
  qualityTags?: string[];
  qualityRiskFlags?: string[];
  qualityScore?: number | null;
  qualityConfidence?: number | null;
  qualityCheckedAt?: string | null;
  filterBucket?: 'main' | 'filtered' | string | null;
  restoredAt?: string | null;
  restoredFromFilter?: boolean | null;
  contentStatus?: string;
  contentBasis?: 'title' | 'snippet' | 'content' | null;
  contentReadiness?: ContentReadiness;
  contentEvidence?: ContentEvidence;
  fullTextReady?: boolean;
  translationAction?: 'translate' | 'fetch_then_translate' | 'open_original' | 'none' | string | null;
  translationCompleteness?: TranslationCompleteness | null;
  translationUsability?: 'usable' | 'invalid' | 'pending' | 'failed' | 'skipped' | string;
  readingAssets?: ReadingAsset[];
  rankContext?: RankContext;
  reportContext?: ReportContext;
  contentError?: string | null;
  fetchEngine?: string | null;
  renderMode?: string | null;
  blockedReason?: string | null;
  summaryStatus?: string;
  summaryBasis?: 'title' | 'snippet' | 'content' | null;
  summaryReason?: string | null;
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

export interface ScoringSkillHealthSummary {
  status: 'healthy' | 'warning' | 'error';
  totalSkillCount: number;
  activeSkillCount: number;
  recentErrorCount: number;
  emptyResponseCount: number;
  deterministicFallbackCount: number;
  retryRecoveredCount: number;
  unstableModelCount: number;
  lastErrorAt?: string | null;
  activeSkills: Array<{
    id: number;
    name: string;
    presetKey?: string | null;
    weight: number;
    modelConfigId?: string | null;
  }>;
  recentErrors: Array<{
    skillName: string;
    message: string;
    targetId?: string | null;
    modelName?: string | null;
    modelConfigId?: string | null;
    createdAt?: string | null;
  }>;
  unstableModels: Array<{
    modelKey: string;
    modelName?: string | null;
    modelConfigId?: string | null;
    retryableFailureCount: number;
    retryRecoveredCount: number;
    deterministicFallbackCount: number;
    lastFailureAt?: string | null;
    circuitBreakerRecommended: boolean;
  }>;
  remediation?: {
    action: 'none' | 'switch_model' | 'repair_config';
    currentModelConfigId?: string | null;
    recommendedModelConfigId?: string | null;
    message: string;
    candidateModels: Array<{
      id: string;
      label: string;
      provider?: string | null;
      modelName?: string | null;
      testStatus?: string | null;
      isDefault: boolean;
    }>;
  };
  recommendations: string[];
}

export interface ScoringModelProbeSummary {
  status: 'passed' | 'failed' | 'empty';
  canSwitch: boolean;
  modelConfigId: string;
  modelLabel: string;
  probed: number;
  passed: number;
  failed: number;
  firstError?: string | null;
  message: string;
  results: Array<{
    itemId: string;
    title: string;
    ok: boolean;
    score?: number | null;
    decision?: string | null;
    confidence?: number | null;
    error?: string | null;
  }>;
}

export interface ScoringModelRepairSummary {
  status: 'recovered' | 'failed' | 'empty';
  canContinueBatchRepair: boolean;
  modelConfigId: string;
  modelLabel: string;
  attempted: number;
  recovered: number;
  failed: number;
  skipped: number;
  recoveryRate: number;
  firstError?: string | null;
  itemIds: string[];
  message: string;
}

export interface FallbackScoringRecoverySummary {
  status: 'recovered' | 'partial' | 'failed' | 'empty' | 'blocked';
  candidateCount: number;
  attempted: number;
  recovered: number;
  failed: number;
  skipped: number;
  remainingCandidateCount: number;
  recoveryRate: number;
  firstError?: string | null;
  itemIds: string[];
  verifiedRecoveredItemIds: string[];
  message: string;
}

export interface ScoringModelRemediationApplyResult {
  switched: boolean;
  configOwnerUserId?: string | null;
  scoringConfigId?: number | null;
  modelConfigId: string;
  modelLabel: string;
  probe: ScoringModelProbeSummary;
  repair: ScoringModelRepairSummary;
  verifiedRecoveredItemIds?: string[];
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

export interface QualityPolicyConfig {
  mode: 'skip' | 'light' | 'standard' | 'strict' | 'monitor' | string;
  onFilter: 'review' | 'filter' | string;
  minConfidence: number;
}

export interface QualityTierPolicyRecord {
  tier: 'S' | 'A' | 'B' | 'C' | 'D' | string;
  overrideId?: number | null;
  overrideScope: 'system' | 'global' | 'user' | string;
  overrideConfig?: Partial<QualityPolicyConfig> | null;
  resolved: QualityPolicyConfig;
}

export interface QualitySourceOverrideRecord {
  id: number;
  sourceId: number;
  sourceName: string;
  sourceTier: 'S' | 'A' | 'B' | 'C' | 'D' | string;
  config: Partial<QualityPolicyConfig>;
  resolved: QualityPolicyConfig;
  scope: 'user' | string;
}

export interface QualityPolicySnapshot {
  tiers: QualityTierPolicyRecord[];
  sourceOverrides: QualitySourceOverrideRecord[];
}

export interface ItemQualityCheckRecord {
  id: number;
  itemId: string;
  userId: string;
  sourceId?: number | null;
  sceneType: string;
  decision?: string | null;
  summary?: string | null;
  reason?: string | null;
  tags: string[];
  riskFlags: string[];
  score?: number | null;
  confidence?: number | null;
  policySnapshot?: Record<string, unknown>;
  rawResponse?: string | null;
  promptPreview?: string | null;
  responsePreview?: string | null;
  modelConfigId?: string | null;
  promptTemplateId?: string | null;
  createdAt: string;
}

export interface ItemQualityCheckPayload {
  itemId: string;
  sourceId?: number | null;
  sourceTier?: string | null;
  isFiltered?: boolean | null;
  filterBucket?: string | null;
  filterReason?: string | null;
  qualityDecision?: string | null;
  qualitySummary?: string | null;
  qualityReason?: string | null;
  qualityTags: string[];
  qualityRiskFlags: string[];
  qualityScore?: number | null;
  qualityConfidence?: number | null;
  qualityCheckedAt?: string | null;
  restoredAt?: string | null;
  restoredFromFilter?: boolean | null;
  latestCheck?: ItemQualityCheckRecord | null;
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
  funnel?: {
    allItems: number;
    visibleItems: number;
    filteredBucketItems: number;
    mismatchedFilteredMain: number;
    todayVisibleItems: number;
  };
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
  qualityFunnel?: SourceQualityFunnel;
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
    qualityFunnel?: SourceQualityFunnel;
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
  selectionMode?: 'scored' | 'review' | 'latest_visible' | 'empty' | string;
      reportFunnel?: {
        newItems: number;
        eligibleItems: number;
        filteredItems: number;
        filteredBucketItems: number;
        reviewItems: number;
        pendingItems: number;
      };
      compareWindowDays?: number;
      topItems?: Array<{
        id: string;
        title: string;
        displayTitle?: string | null;
        url: string;
        aiScore?: number | null;
        aiSummary?: string | null;
        reportSummary?: string | null;
        language?: string | null;
        translationStatus?: string | null;
        selectionReason?: string | null;
        selectionMode?: string | null;
        scopeMatched?: boolean | null;
        sourceName: string;
        category: string;
      }>;
      highScoreItems?: Array<{
        id: string;
        title: string;
        displayTitle?: string | null;
        url: string;
        aiScore?: number | null;
        aiSummary?: string | null;
        reportSummary?: string | null;
        selectionReason?: string | null;
        sourceName: string;
        category: string;
      }>;
      workflowConfig?: DailyReportWorkflowConfig;
      candidateFunnel?: DailyReportWorkflowPreview['funnel'];
      excludedCandidates?: DailyReportWorkflowPreview['excluded'];
      excludedCandidateSummary?: {
        total: number;
        byReason: Array<{
          reason: DailyReportWorkflowPreview['excluded'][number]['reason'];
          count: number;
          samples: DailyReportWorkflowPreview['excluded'];
        }>;
      };
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
        repaired?: boolean;
        repairReason?: string;
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
        repaired?: boolean;
        repairReason?: string;
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
        repaired?: boolean;
        repairReason?: string;
      };
    };
    preset?: 'full' | 'decision' | 'research' | 'reading';
    generationMode?: 'fast' | 'full' | string;
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
  primaryGrowthAxis?: string;
  secondaryGrowthAxes?: string[];
  actionSuggestion: string;
  publishedAt?: string | null;
  fetchedAt?: string | null;
}

export interface GrowthDashboardAxis {
  axis: string;
  count: number;
  averageScore?: number | null;
  summary: string;
  emptyReason?: string | null;
  emptyDiagnostics?: {
    matched: number;
    filtered: number;
    unscored: number;
    secondaryOnly: number;
    sourceMapped: number;
  };
  sourceExplanation?: string | null;
  items: GrowthDashboardItem[];
}

export interface GrowthDashboardRecord {
  windowDays: number;
  summary: {
    totalItems: number;
    visibleItems?: number;
    filteredItems?: number;
    filteredBucketItems?: number;
    mismatchedFilteredMain?: number;
    unmappedItems?: number;
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
  generationMode?: 'fast' | 'full' | string;
  compareWindowDays?: number;
  options?: {
    generationMode?: 'fast' | 'full' | string;
    preset?: 'full' | 'decision' | 'research' | 'reading';
    compareWindowDays?: number;
    [key: string]: unknown;
  };
  pipelineVersion?: number;
  [key: string]: unknown;
}

export interface DailyReportWorkflowConfig {
  name?: string;
  version?: string;
  targetAudience?: string[];
  reportTemplateId?: string;
  fallbackStrategy?: 'none' | 'latest_visible' | 'semantic_related' | 'source_priority' | 'manual_review' | string;
  normalization?: {
    translationMode?: 'fast' | 'precise' | string;
    terminologyNormalization?: boolean;
    entityNormalization?: boolean;
    dedupStrategy?: 'event' | 'title' | 'semantic' | string;
  };
  topN: number;
  minScore: number;
  enableLatestFallback: boolean;
  perSourceLimit: number;
  requireChinese: boolean;
  scope: {
    categories: string[];
    keywords: string[];
    sourceTiers: string[];
  };
  enabledModules: {
    cleaning: boolean;
    decision: boolean;
    research: boolean;
    reading: boolean;
    final: boolean;
  };
}

export interface DailyReportWorkflowAiScene {
  id?: number;
  type: string;
  name: string;
  isActive?: boolean | null;
  promptTemplateId?: string | null;
  promptTemplate?: string | null;
  modelConfigId?: string | null;
  model?: string | null;
  provider?: string | null;
}

export type DailyReportCoverageStatus = 'selected' | 'review' | 'latestFallback' | 'excluded' | string;

export interface DailyReportCoverageSummary {
  total: number;
  selected: number;
  review: number;
  latestFallback: number;
  excluded: number;
  missingDigest: number;
}

export interface DailyReportCoverageItem {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  category: string;
  status: DailyReportCoverageStatus;
  statusLabel: string;
  digest: string;
  reason: string;
  action: string;
  score: number | null;
  translationStatus?: string | null;
  translationStatusLabel?: string | null;
}

export interface DailyReportWorkflowPreview {
  generatedAt?: string | null;
  dataUpdatedAt?: string | null;
  selectionMode: 'scored' | 'review' | 'latest_visible' | 'empty' | string;
  funnel: {
    todayNew: number;
    mainVisible: number;
    scopeMatched: number;
    scoredCandidates: number;
    reviewCandidates?: number;
    fallbackScoredCandidates?: number;
    softFilteredRecovered?: number;
    scoreFailedCandidates?: number;
    latestFallbackCandidates: number;
    translationPending: number;
    translationFailed: number;
    finalCandidates: number;
    sampledCandidates?: number;
    filteredItems?: number;
    filteredBucketItems?: number;
    reviewItems?: number;
    pendingItems?: number;
  };
  coverageDiagnostics?: DailyReportCoverageDiagnostics | null;
  coverageSummary?: DailyReportCoverageSummary | null;
  coverageItems?: DailyReportCoverageItem[];
  coverageMarkdown?: string;
  candidates: Array<{
    id: string;
    title: string;
    sourceName: string;
    category: string;
    aiScore?: number | null;
    selectionMode: string;
    selectionReason: string;
    reportSummary: string;
    translationStatus?: string | null;
  }>;
  excluded: Array<{
    id: string;
    title: string;
    reason: 'translation_failed' | 'not_chinese' | 'not_selected' | 'business_noise' | string;
    detail?: string | null;
    url?: string | null;
    sourceName?: string | null;
    category?: string | null;
    aiScore?: number | null;
    translationStatus?: string | null;
  }>;
  excludedSummary?: {
    total: number;
    byReason: Array<{
      reason: DailyReportWorkflowPreview['excluded'][number]['reason'];
      count: number;
      samples: DailyReportWorkflowPreview['excluded'];
    }>;
  };
}

export interface DailyReportWorkflowPayload {
  workflow: DailyReportWorkflowConfig;
  aiScenes?: DailyReportWorkflowAiScene[];
}

export interface DailyWorkbenchPayload {
  date: string;
  reportScope?: {
    reportType: string;
    sourceId?: number | null;
    sourceName?: string | null;
    label: string;
  };
  workflow: DailyReportWorkflowConfig;
  preview: DailyReportWorkflowPreview & { generatedAt?: string | null };
  report: {
    title: string;
    generatedAt?: string | null;
    itemCount: number;
    highlights: string[];
    topItems: Array<Record<string, unknown>>;
    source?: 'final_report' | 'none' | string;
    qualityStatus?: 'full' | 'degraded' | null | string;
    qualityReasons?: string[];
    qualityWarnings?: string[];
    qualityReasonLabel?: string | null;
  };
  reportState?: {
    status: 'missing' | 'full' | 'stale' | 'degraded' | string;
    label: string;
    generatedAt?: string | null;
    itemCount: number;
    reason: string;
  };
  dataFreshness?: Record<string, {
    source: string;
    asOf?: string | null;
    dateScope: string;
    label: string;
  }>;
  agentMatrix: Array<{
    key: string;
    label: string;
    status: 'completed' | 'fallback' | 'error' | 'not_run' | 'pending' | string;
    statusSource?: 'report_payload' | 'ai_usage_target' | 'no_record' | string;
    calls: number;
    tokens: number;
    cost?: number | null;
    signal?: string;
    provider?: string | null;
    model?: string | null;
    promptTemplateId?: string | null;
    modelConfigId?: string | null;
    error?: string | null;
    repaired?: boolean;
  }>;
  monitor: DailyUsageSummary;
  dailyUsage?: DailyUsageSummary;
  systemUsage24h?: DailyUsageSummary;
  scheduleContext?: {
    dailyReportEnabled: boolean;
    nextScheduledAt?: string | null;
    catchUpDays: number;
    sourceScoped?: boolean;
    label: string;
  };
  activeGenerationJob?: DailyGenerationJob | null;
}

export interface DailyUsageSummary {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost?: number | null;
    byStatus?: Array<{ key: string; count: number; inputTokens?: number; outputTokens?: number; estimatedCost?: number; avgLatencyMs?: number | null }>;
    hotspotErrors?: Array<{ key: string; count: number; estimatedCost?: number; avgLatencyMs?: number | null }>;
}

export interface DailyGenerationProgress {
  stage: string;
  label: string;
  percent: number;
  message: string;
  detail?: Record<string, unknown> | null;
  updatedAt?: string | null;
}

export interface DailyGenerationJob {
  jobId: string;
  state: string;
  status: string;
  date?: string | null;
  sourceId?: number | null;
  sourceName?: string | null;
  mode?: 'fast' | 'full' | string | null;
  preset?: string | null;
  trigger?: 'manual' | 'cron' | 'startup_catchup' | string | null;
  scheduledFor?: string | null;
  requestedAt?: string | null;
  progress: DailyGenerationProgress;
  stage?: string;
  label?: string;
  percent?: number;
  message?: string;
  attemptsMade?: number;
  timestamp?: number | null;
  processedOn?: number | null;
  finishedOn?: number | null;
  failedReason?: string | null;
  result?: {
    date?: string;
    itemCount?: number;
    generatedAt?: string;
    reportUrl?: string;
    qualityStatus?: 'full' | 'degraded' | string;
    qualityReasons?: string[];
  } | null;
}

export interface ItemTranslationProgress {
  stage: string;
  label: string;
  percent: number;
  message: string;
  detail?: Record<string, unknown> | null;
  updatedAt?: string | null;
}

export interface ItemTranslationJob {
  jobId: string;
  state: string;
  status: string;
  itemId?: string | null;
  progress: ItemTranslationProgress;
  stage?: string;
  label?: string;
  percent?: number;
  message?: string;
  attemptsMade?: number;
  timestamp?: number | null;
  processedOn?: number | null;
  finishedOn?: number | null;
  failedReason?: string | null;
  result?: {
    itemId?: string;
    translated?: number;
    skipped?: number;
    contentFetched?: boolean;
    errorReason?: string | null;
    data?: FeedItemRecord | null;
    finishedAt?: string;
  } | null;
}

export interface DailyCandidatesPayload {
  date?: string;
  reportScope?: {
    reportType: string;
    sourceId?: number | null;
    sourceName?: string | null;
    label: string;
  };
  workflow: DailyReportWorkflowConfig;
  funnel: DailyReportWorkflowPreview['funnel'];
  candidates: DailyReportWorkflowPreview['candidates'];
  excluded: DailyReportWorkflowPreview['excluded'];
  excludedSummary?: DailyReportWorkflowPreview['excludedSummary'];
  coverageSummary?: DailyReportCoverageSummary | null;
  coverageItems?: DailyReportCoverageItem[];
  coverageMarkdown?: string;
  coverageDiagnostics?: DailyReportCoverageDiagnostics | null;
  filters?: Record<string, unknown>;
}

export interface DailyReportCoverageDiagnostics {
  totalFetched: number;
  sampledCandidates: number;
  mainVisible: number;
  scored: number;
  unscored: number;
  raw: number;
  summaryReady: number;
  summaryFailed: number;
  hotSignals: number;
  hotUnscored: number;
  hotNotSampled: number;
  hotNotSelected: number;
  finalCandidates: number;
}

export interface DailyReportEventMetrics {
  localItemCount: number;
  independentEventCount: number;
  multiSourceEventCount: number;
  firstPartyEventCount: number;
  firstPartyEventShare: number;
  modelProductEventCount: number;
  externalRadarItemCount: number;
  externalRadarEventCount: number;
  aihotLocalMissCount: number;
  unverifiableRadarItemCount: number;
}

export interface DailyReportLatestPayload {
  id: number | string;
  date: string;
  type: string;
  summary?: string | null;
  markdown: string;
  itemCount?: number;
  generatedAt?: string | null;
  qualityStatus?: 'full' | 'degraded' | null | string;
  qualityReasons?: string[];
  qualityWarnings?: string[];
  qualityReasonLabel?: string | null;
  publicationStatus?: 'published' | 'draft' | 'missing' | string;
  publishable?: boolean;
  draft?: {
    markdown: string;
    generatedAt?: string | null;
    qualityReasons?: string[];
    qualityReasonLabel?: string | null;
  } | null;
  payload?: InsightRecord['payload'];
  reportScope?: {
    reportType: string;
    sourceId?: number | null;
    sourceName?: string | null;
    label: string;
  };
  preview?: DailyWorkbenchPayload['report'];
  missing?: boolean;
  dateNavigation?: {
    currentDate?: string | null;
    latestDate?: string | null;
    previousDate?: string | null;
    nextDate?: string | null;
    recentDates?: string[];
    latestPublishedDate?: string | null;
    previousPublishedDate?: string | null;
    nextPublishedDate?: string | null;
    publishedDates?: string[];
  };
  trendSummary?: {
    newItems: number;
    totalItems: number;
    compareWindowDays: number;
    categories: Array<{ category: string; count: number; baselineAvg: number; delta: number; direction: 'up' | 'down' | 'flat' | string }>;
    sources: Array<{ sourceName: string; count: number }>;
    themes: Array<{ label: string; count: number; sampleTitles: string[] }>;
    funnel?: DailyReportWorkflowPreview['funnel'];
    eventMetrics?: DailyReportEventMetrics;
  } | null;
  eventMetrics?: DailyReportEventMetrics | null;
  priorityArticles?: Array<{
    id: string;
    title: string;
    url: string;
    sourceName: string;
    category: string;
    reason: string;
    summary: string;
    assetReferences?: Array<{
      promptKey: string;
      label: string;
      excerpt: string;
    }>;
  }>;
  coverJudgement?: {
    title: string;
    summary: string;
  } | null;
  radarOverview?: {
    markdown: string;
  } | null;
  tableOfContents?: string[];
  readingOrder?: { markdown: string } | null;
  nextActions?: { markdown: string } | null;
  moduleSections?: Array<{
    key: string;
    title: string;
    editorialTitle?: string;
    conclusion: string;
    narrativeMarkdown?: string;
    priorityArticles: Array<{
      id: string;
      title: string;
      url: string;
      sourceName: string;
      category: string;
      reason: string;
      summary: string;
    }>;
    primaryLinks?: Array<{
      id: string;
      title: string;
      url: string;
      sourceName: string;
      category: string;
      reason: string;
      summary: string;
    }>;
    secondaryLinks?: Array<{
      id: string;
      title: string;
      url: string;
      sourceName: string;
      category: string;
      reason: string;
      summary: string;
    }>;
    evidence?: Array<{
      itemId: string;
      title: string;
      url: string;
      sourceName: string;
      fact: string;
      factBasis: 'article_asset' | 'report_summary' | 'ai_summary' | 'snippet' | 'module_summary' | 'title';
      role: 'primary' | 'supporting';
    }>;
    signals: string[];
    noise: string[];
    actions: string[];
    coverageCount: number;
    evidenceCount?: number;
  }>;
  moduleNarratives?: DailyReportLatestPayload['moduleSections'];
  moreDynamics?: Array<{
    id: string;
    title: string;
    url: string;
    sourceName: string;
    category: string;
    reason: string;
    summary: string;
  }>;
  deepReads?: Array<{
    id: string;
    title: string;
    url: string;
    sourceName: string;
    category: string;
    reason: string;
    summary: string;
  }>;
  editorialMaterials?: Array<{
    itemId: string;
    title: string;
    fact: string;
    factBasis: 'article_asset' | 'report_summary' | 'ai_summary' | 'snippet' | 'module_summary' | 'title';
    evidenceUrl: string;
    sourceName: string;
    theme: string;
    recommendedPlacement: 'featured' | 'deep_read' | 'module' | 'more_dynamics' | 'coverage_index';
    placements: Array<'featured' | 'deep_read' | 'module' | 'more_dynamics' | 'coverage_index'>;
    reason: string;
    selectionMode?: string;
    score: number | null;
  }>;
  editorialDigest?: {
    coverJudgement: {
      title: string;
      summary: string;
    };
    radarOverview: {
      markdown: string;
    };
    tableOfContents: string[];
    curated: DailyReportLatestPayload['priorityArticles'];
    moduleReferences: NonNullable<DailyReportLatestPayload['priorityArticles']>;
    moreDynamics: NonNullable<DailyReportLatestPayload['moreDynamics']>;
    deepReads: NonNullable<DailyReportLatestPayload['deepReads']>;
    moduleNarratives: DailyReportLatestPayload['moduleSections'];
    materials: NonNullable<DailyReportLatestPayload['editorialMaterials']>;
    readingOrder: { markdown: string };
    nextActions: { markdown: string };
  } | null;
  coverageSummary?: DailyReportCoverageSummary | null;
  coverageItems?: DailyReportCoverageItem[];
  coverageMarkdown?: string;
  coverageDiagnostics?: DailyReportCoverageDiagnostics | null;
  reportContext?: ReportContext;
}

export interface ExportMutationResult {
  message?: string;
  exported?: number;
  [key: string]: unknown;
}

export interface AudioArtifactChapter {
  id: string;
  title: string;
  summary: string;
  bullets: string[];
  start?: number | null;
  end?: number | null;
  speakers?: string[];
  source?: string | null;
}

export interface AudioArtifactHighlight {
  id: string;
  title: string;
  text: string;
  reason: string;
  start?: number | null;
  end?: number | null;
  speaker?: string | null;
  source?: string | null;
}

export interface AudioArtifactMindMap {
  root: string;
  branches: Array<{
    title: string;
    children: string[];
    chapter_id?: string | null;
  }>;
}

export interface AudioArtifactQaCitation {
  id: string;
  evidence_id?: string | null;
  start: number;
  end: number;
  time_label?: string | null;
  text: string;
  speaker?: string | null;
  source?: string | null;
}

export interface AudioArtifactQaAnswer {
  id: string;
  question: string;
  prompt_key?: string | null;
  answer: string;
  citations: AudioArtifactQaCitation[];
  status: 'ready' | 'failed' | string;
  model?: string | null;
  provider?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  created_at?: string | null;
}

export interface AudioArtifactsV1 {
  schema: 'audio_artifacts_v1';
  version: 1;
  generated_at?: string | null;
  basis?: {
    summary?: boolean;
    transcript?: boolean;
    timed_segments?: number;
    topic_anchors?: number;
  };
  chapters: AudioArtifactChapter[];
  highlights: AudioArtifactHighlight[];
  mind_map: AudioArtifactMindMap;
  action_items?: Array<Record<string, unknown>>;
  qa?: {
    suggestions?: Array<{
      key: string;
      label: string;
      prompt: string;
    }>;
    answers?: AudioArtifactQaAnswer[];
  };
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
  summary_result?: (Record<string, unknown> & { artifacts?: AudioArtifactsV1 }) | string | null;
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
  autoSummaryEnabled: boolean;
  autoTranslationEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface DailyReportSettings {
  userId: string;
  dailyReportEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AudioTaskListResponse {
  items: AudioTask[];
  total: number;
  page: number;
  page_size: number;
}

export interface AudioTaskPlaybackUrl {
  url: string;
  expires_in: number;
  mode: 'direct' | 'signed' | 'stream' | string;
}

export interface AudioTaskQaResponse {
  answer: AudioArtifactQaAnswer;
  task: AudioTask;
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
  provider?: string;
  available?: boolean;
  unavailable_reason?: string | null;
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
