import { pgSchema, pgTable, serial, text, integer, boolean, real, timestamp, date, uuid, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ============================================================
// Schema: auth
// ============================================================
export const authSchema = pgSchema('auth');

export const users = authSchema.table('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('user'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inviteCodes = authSchema.table('invite_codes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  code: text('code').notNull().unique(),
  maxUses: integer('max_uses').default(1),
  useCount: integer('use_count').default(0),
  usedBy: uuid('used_by').references(() => users.id),
  usedAt: timestamp('used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================
// Schema: hub
// ============================================================
export const hubSchema = pgSchema('hub');

export const sources = hubSchema.table('sources', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  sourceType: text('source_type').notNull(),
  collectorType: text('collector_type').notNull().default('rss'),
  sourceKind: text('source_kind').notNull().default('rss'),
  sourceRole: text('source_role').notNull().default('normal'),
  sourceTier: text('source_tier').notNull().default('B'),
  authorityWeight: real('authority_weight').notNull().default(1),
  processingProfile: text('processing_profile').notNull().default('brief'),
  trustScore: integer('trust_score').notNull().default(60),
  noiseScore: integer('noise_score').notNull().default(40),
  growthAxes: jsonb('growth_axes').notNull().default([]),
  upgradeRules: jsonb('upgrade_rules').notNull().default({}),
  config: jsonb('config').notNull().default({}),
  category: text('category').default('uncategorized'),
  tags: jsonb('tags').default([]),
  priority: integer('priority').default(3),
  fetchInterval: integer('fetch_interval').default(60),
  autoFetchEnabled: boolean('auto_fetch_enabled').default(true),
  autoTranscribe: boolean('auto_transcribe').default(false),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
  nextFetchAt: timestamp('next_fetch_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastOutcome: text('last_outcome'),
  lastItemAt: timestamp('last_item_at', { withTimezone: true }),
  healthScore: integer('health_score').default(100),
  errorCount: integer('error_count').default(0),
  lastError: text('last_error'),
  status: text('status').default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_sources_user').on(table.userId),
  index('idx_sources_type').on(table.sourceType),
  index('idx_sources_kind').on(table.sourceKind),
  index('idx_sources_role').on(table.sourceRole),
  index('idx_sources_tier').on(table.sourceTier),
  index('idx_sources_processing_profile').on(table.processingProfile),
  index('idx_sources_status').on(table.status),
  index('idx_sources_category').on(table.category),
]);

export const userSettings = hubSchema.table('user_settings', {
  userId: uuid('user_id').notNull().primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  autoFetchEnabled: boolean('auto_fetch_enabled').notNull().default(true),
  dailyReportWorkflow: jsonb('daily_report_workflow'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_user_settings_auto_fetch').on(table.autoFetchEnabled),
]);

export const items = hubSchema.table('items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  sourceId: integer('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  sourceType: text('source_type').notNull(),
  sourceTier: text('source_tier').notNull().default('B'),
  processingProfile: text('processing_profile').notNull().default('brief'),
  growthAxes: jsonb('growth_axes').notNull().default([]),
  guid: text('guid'),
  title: text('title').notNull(),
  url: text('url').notNull(),
  author: text('author'),
  content: text('content'),
  snippet: text('snippet'),
  language: text('language'),
  mediaUrl: text('media_url'),
  mediaType: text('media_type'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  dedupHash: text('dedup_hash'),
  aiScore: real('ai_score'),
  aiSummary: text('ai_summary'),
  aiTags: jsonb('ai_tags').default([]),
  aiTranslation: text('ai_translation'),
  priorityScore: real('priority_score'),
  clusterId: text('cluster_id'),
  transcript: text('transcript'),
  knowledge: text('knowledge'),
  audioDuration: integer('audio_duration'),
  audioStatus: text('audio_status').default('none'),
  audioStatusReason: text('audio_status_reason'),
  audioTaskId: text('audio_task_id'),
  isRead: boolean('is_read').default(false),
  isFavorite: boolean('is_favorite').default(false),
  isLater: boolean('is_later').default(false),
  isFiltered: boolean('is_filtered').default(false),
  filterReason: text('filter_reason'),
  qualityDecision: text('quality_decision'),
  qualitySummary: text('quality_summary'),
  qualityReason: text('quality_reason'),
  qualityTags: jsonb('quality_tags').default([]),
  qualityRiskFlags: jsonb('quality_risk_flags').default([]),
  qualityScore: real('quality_score'),
  qualityConfidence: real('quality_confidence'),
  qualityCheckedAt: timestamp('quality_checked_at', { withTimezone: true }),
  filterBucket: text('filter_bucket').notNull().default('main'),
  restoredAt: timestamp('restored_at', { withTimezone: true }),
  restoredFromFilter: boolean('restored_from_filter').notNull().default(false),
  contentStatus: text('content_status').default('missing'),
  contentError: text('content_error'),
  fetchEngine: text('fetch_engine'),
  renderMode: text('render_mode'),
  blockedReason: text('blocked_reason'),
  summaryStatus: text('summary_status').default('pending'),
  summaryBasis: text('summary_basis'),
  translationStatus: text('translation_status').default('pending'),
  translationReason: text('translation_reason'),
  processingStatus: text('processing_status').default('raw'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_items_user_status').on(table.userId, table.processingStatus),
  index('idx_items_user_tier').on(table.userId, table.sourceTier),
  index('idx_items_processing_profile').on(table.userId, table.processingProfile),
  index('idx_items_filter_bucket').on(table.userId, table.filterBucket, table.fetchedAt),
  index('idx_items_quality_decision').on(table.userId, table.qualityDecision, table.fetchedAt),
  uniqueIndex('idx_items_user_url').on(table.userId, table.url),
  index('idx_items_published').on(table.publishedAt),
  index('idx_items_priority').on(table.priorityScore),
  index('idx_items_source').on(table.sourceId, table.fetchedAt),
  uniqueIndex('idx_items_source_guid').on(table.sourceId, table.guid),
]);

export const filterRules = hubSchema.table('filter_rules', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  name: text('name').notNull(),
  type: text('type').notNull(),
  scope: text('scope').notNull().default('user'),
  config: jsonb('config').notNull().default({}),
  enabled: boolean('enabled').default(true),
  priority: integer('priority').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_rules_user').on(table.userId, table.enabled),
  index('idx_rules_scope').on(table.scope, table.enabled),
]);

export const qualityPolicies = hubSchema.table('quality_policies', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  scope: text('scope').notNull().default('user'),
  targetType: text('target_type').notNull(),
  targetKey: text('target_key').notNull(),
  config: jsonb('config').notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_quality_policies_user').on(table.userId, table.scope, table.targetType),
  index('idx_quality_policies_target').on(table.scope, table.targetType, table.targetKey),
]);

export const aiConfigs = hubSchema.table('ai_configs', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  apiKeyEnc: text('api_key_enc'),
  baseUrl: text('base_url'),
  temperature: real('temperature').default(0.3),
  promptTemplate: text('prompt_template').notNull(),
  promptTemplateId: text('prompt_template_id'),
  modelConfigId: text('model_config_id'),
  type: text('type').notNull().default('scoring'),
  isActive: boolean('is_active').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_ai_configs_user').on(table.userId, table.type),
  index('idx_ai_configs_refs').on(table.modelConfigId, table.promptTemplateId),
]);

export const scoringSkills = hubSchema.table('scoring_skills', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  presetKey: text('preset_key'),
  status: text('status').notNull().default('draft'),
  weight: real('weight').notNull().default(1),
  instructionPrompt: text('instruction_prompt').notNull(),
  rubricJson: jsonb('rubric_json').notNull().default({}),
  outputSchemaVersion: integer('output_schema_version').notNull().default(1),
  modelConfigId: text('model_config_id'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_scoring_skills_user').on(table.userId, table.status),
]);

export const itemFeedback = hubSchema.table('item_feedback', {
  id: serial('id').primaryKey(),
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  feedbackType: text('feedback_type').notNull(),
  targetSkillId: integer('target_skill_id').references(() => scoringSkills.id, { onDelete: 'set null' }),
  reasonTags: jsonb('reason_tags').notNull().default([]),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_item_feedback_item_user').on(table.itemId, table.userId, table.createdAt),
  index('idx_item_feedback_user').on(table.userId, table.createdAt),
]);

export const itemScoreBreakdowns = hubSchema.table('item_score_breakdowns', {
  id: serial('id').primaryKey(),
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  skillId: integer('skill_id').references(() => scoringSkills.id, { onDelete: 'set null' }),
  score: real('score'),
  confidence: real('confidence'),
  decision: text('decision'),
  reasons: jsonb('reasons').notNull().default([]),
  matchedSignals: jsonb('matched_signals').notNull().default([]),
  riskFlags: jsonb('risk_flags').notNull().default([]),
  rawResponse: text('raw_response'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_item_score_breakdowns_unique').on(table.itemId, table.userId, table.skillId),
  index('idx_item_score_breakdowns_item').on(table.itemId, table.userId),
]);

export const itemQualityChecks = hubSchema.table('item_quality_checks', {
  id: serial('id').primaryKey(),
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceId: integer('source_id').references(() => sources.id, { onDelete: 'set null' }),
  sceneType: text('scene_type').notNull().default('quality_filter'),
  decision: text('decision'),
  summary: text('summary'),
  reason: text('reason'),
  tags: jsonb('tags').notNull().default([]),
  riskFlags: jsonb('risk_flags').notNull().default([]),
  score: real('score'),
  confidence: real('confidence'),
  policySnapshot: jsonb('policy_snapshot').notNull().default({}),
  rawResponse: text('raw_response'),
  promptPreview: text('prompt_preview'),
  responsePreview: text('response_preview'),
  modelConfigId: text('model_config_id'),
  promptTemplateId: text('prompt_template_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_item_quality_checks_item').on(table.itemId, table.userId, table.createdAt),
  index('idx_item_quality_checks_user').on(table.userId, table.createdAt),
]);

export const userPreferenceProfiles = hubSchema.table('user_preference_profiles', {
  userId: uuid('user_id').notNull().primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  profileSummary: text('profile_summary'),
  positiveSignals: jsonb('positive_signals').notNull().default([]),
  negativeSignals: jsonb('negative_signals').notNull().default([]),
  focusTopics: jsonb('focus_topics').notNull().default([]),
  avoidTopics: jsonb('avoid_topics').notNull().default([]),
  updatedFromFeedbackAt: timestamp('updated_from_feedback_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_user_preference_profiles_updated').on(table.updatedAt),
]);

export const aiUsageLogs = hubSchema.table('ai_usage_logs', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  sceneType: text('scene_type').notNull(),
  status: text('status').notNull().default('success'),
  provider: text('provider'),
  modelName: text('model_name'),
  endpointId: text('endpoint_id'),
  modelConfigId: text('model_config_id'),
  promptTemplateId: text('prompt_template_id'),
  targetType: text('target_type'),
  targetId: text('target_id'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  totalTokens: integer('total_tokens'),
  estimatedCost: real('estimated_cost'),
  latencyMs: integer('latency_ms'),
  providerRequestId: text('provider_request_id'),
  apiKind: text('api_kind'),
  promptPreview: text('prompt_preview'),
  responsePreview: text('response_preview'),
  label: text('label'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_ai_usage_logs_user').on(table.userId, table.createdAt),
  index('idx_ai_usage_logs_scene').on(table.sceneType, table.createdAt),
]);

export const retentionRuns = hubSchema.table('retention_runs', {
  id: serial('id').primaryKey(),
  mode: text('mode').notNull().default('apply'),
  retentionDays: integer('retention_days').notNull().default(30),
  status: text('status').notNull().default('success'),
  summary: jsonb('summary').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_retention_runs_created').on(table.createdAt),
]);

export const insights = hubSchema.table('insights', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  date: date('date').notNull(),
  type: text('type').notNull(),
  topics: jsonb('topics').notNull().default([]),
  payload: jsonb('payload').notNull().default({}),
  summary: text('summary'),
  itemCount: integer('item_count').default(0),
  pipelineVersion: integer('pipeline_version').notNull().default(1),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fetchLogs = hubSchema.table('fetch_logs', {
  id: serial('id').primaryKey(),
  sourceId: integer('source_id').references(() => sources.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull(),
  itemsFound: integer('items_found').default(0),
  itemsNew: integer('items_new').default(0),
  itemsFiltered: integer('items_filtered').default(0),
  itemsDuplicate: integer('items_duplicate').default(0),
  itemsQueuedAi: integer('items_queued_ai').default(0),
  outcome: text('outcome'),
  error: text('error'),
  durationMs: integer('duration_ms'),
}, (table) => [
  index('idx_fetch_logs_source').on(table.sourceId, table.startedAt),
]);

// ============================================================
// Schema: audio
// ============================================================
export const audioSchema = pgSchema('audio');

export const audioTasks = audioSchema.table('tasks', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  source: text('source').default('upload'),
  itemId: uuid('item_id'),
  originalFilename: text('original_filename'),
  storageUrl: text('storage_url').notNull(),
  status: text('status').notNull().default('pending'),
  errorMessage: text('error_message'),
  duration: real('duration'),
  cost: real('cost'),
  transcript: text('transcript'),
  knowledgeExtraction: text('knowledge_extraction'),
  metadata: jsonb('metadata').default({}),
  webhookUrl: text('webhook_url'),
  webhookSentAt: timestamp('webhook_sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const audioUsageLogs = audioSchema.table('usage_logs', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  taskId: uuid('task_id').references(() => audioTasks.id, { onDelete: 'set null' }),
  tokens: integer('tokens'),
  cost: real('cost'),
  provider: text('provider'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================
// Schema: quota
// ============================================================
export const quotaSchema = pgSchema('quota');

export const plans = quotaSchema.table('plans', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  audioMinutesPerMonth: integer('audio_minutes_per_month').default(120),
  articlesPerDay: integer('articles_per_day').default(1000),
  isPublic: boolean('is_public').default(false),
});

export const userQuotas = quotaSchema.table('user_quotas', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull().unique().references(() => users.id),
  planId: integer('plan_id').references(() => plans.id),
  audioMinutesUsedMonth: real('audio_minutes_used_month').default(0),
  audioMinutesResetAt: timestamp('audio_minutes_reset_at', { withTimezone: true }),
  autoTranscribeEnabled: boolean('auto_transcribe_enabled').default(false),
  maxAutoPerDay: integer('max_auto_per_day').default(3),
  maxEpisodeMinutes: integer('max_episode_minutes').default(90),
  monthlyBudgetLimit: real('monthly_budget_limit'),
  autoCountToday: integer('auto_count_today').default(0),
  autoCountResetAt: timestamp('auto_count_reset_at', { withTimezone: true }),
});

// ============================================================
// Public schema tables from audio-service
// ============================================================
export const promptTemplates = pgTable('prompt_templates', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').notNull(),
  templateText: text('template_text').notNull(),
  variables: jsonb('variables'),
  isSystem: boolean('is_system').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

export const modelConfigs = pgTable('model_configs', {
  id: uuid('id').primaryKey(),
  provider: text('provider').notNull(),
  alias: text('alias'),
  modelName: text('model_name').notNull(),
  modelType: text('model_type').notNull(),
  baseUrl: text('base_url'),
  extraConfig: jsonb('extra_config'),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  testStatus: text('test_status').notNull().default('untested'),
  testMessage: text('test_message'),
  testedAt: timestamp('tested_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});
