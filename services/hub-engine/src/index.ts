import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sql } from 'drizzle-orm';
import { logger as pinoLogger } from './lib/logger.js';
import { config } from './config/index.js';
import { createFetchWorker } from './scheduler/queue.js';
import { enqueueDueFetches, handleFetchJob } from './scheduler/pipeline.js';
import { startCronJobs } from './scheduler/cron.js';
import { db } from './db/index.js';

import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import sourcesRoutes from './routes/sources.js';
import itemsRoutes from './routes/items.js';
import fetchRoutes from './routes/fetch.js';
import insightsRoutes from './routes/insights.js';
import exportRoutes from './routes/export.js';
import hooksRoutes from './routes/hooks.js';
import knowledgeRoutes from './routes/knowledge.js';
import rulesRoutes from './routes/rules.js';
import qualityPoliciesRoutes from './routes/quality-policies.js';
import aiConfigRoutes from './routes/ai-config.js';
import scoringSkillsRoutes from './routes/scoring-skills.js';
import preferencesRoutes from './routes/preferences.js';
import quotaRoutes from './routes/quota.js';
import discoveryRoutes from './routes/discovery.js';
import subscriptionsRoutes from './routes/subscriptions.js';
import diagnosticsRoutes from './routes/diagnostics.js';
import settingsRoutes from './routes/settings.js';
import adminAiUsageRoutes from './routes/admin-ai-usage.js';
import adminRetentionRoutes from './routes/admin-retention.js';
import adminStorageRoutes from './routes/admin-storage.js';

const app = new Hono();

app.use('*', cors());

app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  pinoLogger.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms }, 'request');
});

app.route('/', healthRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/sources', sourcesRoutes);
app.route('/api/items', itemsRoutes);
app.route('/api/fetch', fetchRoutes);
app.route('/api/insights', insightsRoutes);
app.route('/api/export', exportRoutes);
app.route('/api/hooks', hooksRoutes);
app.route('/api/knowledge', knowledgeRoutes);
app.route('/api/rules', rulesRoutes);
app.route('/api/quality-policies', qualityPoliciesRoutes);
app.route('/api/ai-configs', aiConfigRoutes);
app.route('/api/scoring-skills', scoringSkillsRoutes);
app.route('/api/preferences', preferencesRoutes);
app.route('/api/quota', quotaRoutes);
app.route('/api/discovery', discoveryRoutes);
app.route('/api/subscriptions', subscriptionsRoutes);
app.route('/api/diagnostics', diagnosticsRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/admin/ai-usage', adminAiUsageRoutes);
app.route('/api/admin/retention', adminRetentionRoutes);
app.route('/api/admin/storage', adminStorageRoutes);

app.get('/', (c) => c.json({
  service: 'hub-engine',
  version: '3.0.0',
  status: 'running',
}));

const fetchWorker = createFetchWorker(async (job) => {
  await handleFetchJob(job);
});

async function ensureSchemaCompatibility() {
  await db.execute(sql`alter table public.prompt_templates alter column category type text`);
  await db.execute(sql`alter table hub.ai_configs drop constraint if exists ai_configs_type_check`);
  await db.execute(sql`
    with ranked as (
      select id,
             row_number() over (
               partition by user_id, type
               order by is_active desc, created_at desc, id desc
             ) as rn
      from hub.ai_configs
      where is_active = true
    )
    update hub.ai_configs cfg
    set is_active = false
    from ranked
    where cfg.id = ranked.id
      and ranked.rn > 1
  `);
  await db.execute(sql`drop index if exists hub.idx_ai_configs_user_type_active`);
  await db.execute(sql`
    create unique index if not exists idx_ai_configs_user_type_active
    on hub.ai_configs(user_id, type)
    where is_active = true
  `);
  await db.execute(sql`
    create table if not exists hub.user_settings (
      user_id uuid primary key references auth.users(id) on delete cascade,
      auto_fetch_enabled boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`alter table hub.items drop constraint if exists items_url_unique`);
  await db.execute(sql`alter table hub.items drop constraint if exists items_url_key`);
  await db.execute(sql`alter table hub.items drop constraint if exists items_processing_status_check`);
  await db.execute(sql`drop index if exists hub.items_url_key`);
  await db.execute(sql`create unique index if not exists idx_items_user_url on hub.items(user_id, url)`);
  await db.execute(sql`alter table hub.items add column if not exists source_tier text default 'B'`);
  await db.execute(sql`alter table hub.items add column if not exists processing_profile text default 'brief'`);
  await db.execute(sql`alter table hub.items add column if not exists growth_axes jsonb default '[]'::jsonb`);
  await db.execute(sql`alter table hub.items add column if not exists content_status text default 'missing'`);
  await db.execute(sql`alter table hub.items add column if not exists content_error text`);
  await db.execute(sql`alter table hub.items add column if not exists fetch_engine text`);
  await db.execute(sql`alter table hub.items add column if not exists render_mode text`);
  await db.execute(sql`alter table hub.items add column if not exists blocked_reason text`);
  await db.execute(sql`alter table hub.items add column if not exists summary_status text default 'pending'`);
  await db.execute(sql`alter table hub.items add column if not exists summary_basis text`);
  await db.execute(sql`alter table hub.items add column if not exists translation_status text default 'pending'`);
  await db.execute(sql`alter table hub.items add column if not exists translation_reason text`);
  await db.execute(sql`alter table hub.items add column if not exists audio_status_reason text`);
  await db.execute(sql`alter table hub.items drop constraint if exists items_audio_status_check`);
  await db.execute(sql`
    alter table hub.items
    add constraint items_audio_status_check
    check (audio_status in ('none', 'pending', 'processing', 'done', 'error', 'skipped'))
  `);
  await db.execute(sql`alter table hub.items add column if not exists quality_decision text`);
  await db.execute(sql`alter table hub.items add column if not exists quality_summary text`);
  await db.execute(sql`alter table hub.items add column if not exists quality_reason text`);
  await db.execute(sql`alter table hub.items add column if not exists quality_tags jsonb default '[]'::jsonb`);
  await db.execute(sql`alter table hub.items add column if not exists quality_risk_flags jsonb default '[]'::jsonb`);
  await db.execute(sql`alter table hub.items add column if not exists quality_score real`);
  await db.execute(sql`alter table hub.items add column if not exists quality_confidence real`);
  await db.execute(sql`alter table hub.items add column if not exists quality_checked_at timestamptz`);
  await db.execute(sql`alter table hub.items add column if not exists filter_bucket text default 'main'`);
  await db.execute(sql`alter table hub.items add column if not exists restored_at timestamptz`);
  await db.execute(sql`alter table hub.items add column if not exists restored_from_filter boolean default false`);
  await db.execute(sql`
    update hub.items
    set content_status = case
      when coalesce(length(trim(content)), 0) > 0 then 'ready'
      when coalesce(length(trim(snippet)), 0) > 0 then 'ready'
      else coalesce(content_status, 'missing')
    end
    where content_status is null
       or (
         content_status = 'missing'
         and (
           coalesce(length(trim(content)), 0) > 0
           or coalesce(length(trim(snippet)), 0) > 0
         )
       )
  `);
  await db.execute(sql`
    update hub.items
    set summary_status = case
      when coalesce(length(trim(ai_summary)), 0) > 0 then 'ready'
      when processing_status in ('summary_failed') then 'failed'
      when processing_status in ('done') then 'skipped'
      else coalesce(summary_status, 'pending')
    end
    where summary_status is null
       or summary_status = 'pending'
  `);
  await db.execute(sql`
    update hub.items
    set translation_status = case
      when coalesce(length(trim(ai_translation)), 0) > 0 then 'ready'
      when processing_status in ('translation_failed') then 'failed'
      when processing_status in ('done') then 'skipped'
      else coalesce(translation_status, 'pending')
    end
    where translation_status is null
       or translation_status = 'pending'
  `);
  await db.execute(sql`
    update hub.items
    set filter_bucket = case
      when is_filtered = true then 'filtered'
      else 'main'
    end
    where filter_bucket is null or btrim(filter_bucket) = ''
  `);
  await db.execute(sql`
    update hub.items
    set quality_summary = coalesce(nullif(trim(snippet), ''), title),
        quality_reason = coalesce(filter_reason, quality_reason, '历史过滤条目'),
        quality_decision = coalesce(quality_decision, 'filter'),
        quality_confidence = coalesce(quality_confidence, 1),
        quality_checked_at = coalesce(quality_checked_at, created_at)
    where is_filtered = true
      and (
        quality_summary is null
        or quality_reason is null
        or quality_decision is null
        or quality_checked_at is null
      )
  `);
  await db.execute(sql`
    alter table hub.items
    add constraint items_processing_status_check
    check (
      processing_status = any (
        array[
          'raw'::text,
          'deduped'::text,
          'filtered'::text,
          'scored'::text,
          'score_failed'::text,
          'summarized'::text,
          'summary_failed'::text,
          'translation_failed'::text,
          'done'::text
        ]
      )
    )
  `);
  await db.execute(sql`alter table hub.sources add column if not exists auto_fetch_enabled boolean default true`);
  await db.execute(sql`alter table hub.sources add column if not exists source_role text not null default 'normal'`);
  await db.execute(sql`alter table hub.sources add column if not exists source_tier text default 'B'`);
  await db.execute(sql`alter table hub.sources add column if not exists processing_profile text default 'brief'`);
  await db.execute(sql`alter table hub.sources add column if not exists trust_score integer default 60`);
  await db.execute(sql`alter table hub.sources add column if not exists noise_score integer default 40`);
  await db.execute(sql`alter table hub.sources add column if not exists growth_axes jsonb default '[]'::jsonb`);
  await db.execute(sql`alter table hub.sources add column if not exists upgrade_rules jsonb default '{}'::jsonb`);
  await db.execute(sql`alter table hub.sources add column if not exists next_fetch_at timestamptz`);
  await db.execute(sql`alter table hub.sources add column if not exists last_success_at timestamptz`);
  await db.execute(sql`alter table hub.sources add column if not exists last_outcome text`);
  await db.execute(sql`update hub.sources set auto_fetch_enabled = true where auto_fetch_enabled is null`);
  await db.execute(sql`
    update hub.sources
    set source_role = 'monitor'
    where (source_role is null or source_role = 'normal')
      and (
        collector_type = 'changedetection'
        or category in ('监控', 'monitor')
        or coalesce(config->>'monitorMode', '') in ('webpage', 'changedetection')
      )
  `);
  await db.execute(sql`
    update hub.sources
    set source_tier = case
      when source_role = 'monitor' or collector_type = 'changedetection' or category in ('监控', 'monitor') then 'D'
      when source_type in ('podcast', 'audio', 'newsletter') then 'A'
      when collector_type = 'custom' then 'S'
      else 'B'
    end
    where source_tier is null or btrim(source_tier) = ''
  `);
  await db.execute(sql`
    update hub.sources
    set processing_profile = case
      when source_role = 'monitor' or source_tier = 'D' then 'monitor'
      when source_tier = 'S' then 'full'
      when source_tier = 'A' then 'smart'
      else 'brief'
    end
    where processing_profile is null or btrim(processing_profile) = ''
  `);
  await db.execute(sql`
    update hub.sources
    set trust_score = case source_tier
      when 'S' then 92
      when 'A' then 78
      when 'B' then 62
      when 'C' then 40
      else 48
    end
    where trust_score is null or trust_score = 0
  `);
  await db.execute(sql`
    update hub.sources
    set noise_score = case source_tier
      when 'S' then 12
      when 'A' then 24
      when 'B' then 42
      when 'C' then 72
      else 58
    end
    where noise_score is null or noise_score = 0
  `);
  await db.execute(sql`
    update hub.sources
    set growth_axes = '["认知升级"]'::jsonb
    where growth_axes is null or jsonb_typeof(growth_axes) <> 'array' or jsonb_array_length(growth_axes) = 0
  `);
  await db.execute(sql`
    update hub.sources
    set upgrade_rules = '{}'::jsonb
    where upgrade_rules is null or jsonb_typeof(upgrade_rules) <> 'object'
  `);
  await db.execute(sql`
    update hub.items as item
    set source_tier = coalesce(src.source_tier, item.source_tier, 'B'),
        processing_profile = coalesce(src.processing_profile, item.processing_profile, 'brief'),
        growth_axes = case
          when item.growth_axes is null or jsonb_typeof(item.growth_axes) <> 'array' or jsonb_array_length(item.growth_axes) = 0
            then coalesce(src.growth_axes, '["认知升级"]'::jsonb)
          else item.growth_axes
        end
    from hub.sources as src
    where src.id = item.source_id
  `);
  await db.execute(sql`create index if not exists idx_sources_tier on hub.sources(source_tier)`);
  await db.execute(sql`create index if not exists idx_sources_processing_profile on hub.sources(processing_profile)`);
  await db.execute(sql`create index if not exists idx_items_user_tier on hub.items(user_id, source_tier)`);
  await db.execute(sql`create index if not exists idx_items_processing_profile on hub.items(user_id, processing_profile)`);
  await db.execute(sql`create index if not exists idx_items_filter_bucket on hub.items(user_id, filter_bucket, fetched_at desc)`);
  await db.execute(sql`create index if not exists idx_items_quality_decision on hub.items(user_id, quality_decision, fetched_at desc)`);
  await db.execute(sql`
    update hub.sources
    set next_fetch_at = coalesce(next_fetch_at, now())
    where status = 'active'
      and auto_fetch_enabled is distinct from false
  `);
  await db.execute(sql`alter table hub.fetch_logs add column if not exists items_filtered integer default 0`);
  await db.execute(sql`alter table hub.fetch_logs add column if not exists items_duplicate integer default 0`);
  await db.execute(sql`alter table hub.fetch_logs add column if not exists items_queued_ai integer default 0`);
  await db.execute(sql`alter table hub.fetch_logs add column if not exists outcome text`);
  await db.execute(sql`
    create table if not exists hub.quality_policies (
      id serial primary key,
      user_id uuid references auth.users(id),
      scope text not null default 'user',
      target_type text not null,
      target_key text not null,
      config jsonb not null default '{}'::jsonb,
      enabled boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`create index if not exists idx_quality_policies_user on hub.quality_policies(user_id, scope, target_type)`);
  await db.execute(sql`create index if not exists idx_quality_policies_target on hub.quality_policies(scope, target_type, target_key)`);
  await db.execute(sql`
    create table if not exists hub.ai_usage_logs (
      id serial primary key,
      user_id uuid not null references auth.users(id),
      scene_type text not null,
      status text not null default 'success',
      provider text,
      model_name text,
      endpoint_id text,
      model_config_id text,
      prompt_template_id text,
      target_type text,
      target_id text,
      input_tokens integer,
      output_tokens integer,
      total_tokens integer,
      estimated_cost real,
      latency_ms integer,
      provider_request_id text,
      api_kind text,
      prompt_preview text,
      response_preview text,
      label text,
      error_message text,
      created_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`alter table hub.ai_usage_logs add column if not exists endpoint_id text`);
  await db.execute(sql`alter table hub.ai_usage_logs add column if not exists total_tokens integer`);
  await db.execute(sql`alter table hub.ai_usage_logs add column if not exists latency_ms integer`);
  await db.execute(sql`alter table hub.ai_usage_logs add column if not exists provider_request_id text`);
  await db.execute(sql`alter table hub.ai_usage_logs add column if not exists api_kind text`);
  await db.execute(sql`alter table hub.ai_usage_logs add column if not exists prompt_preview text`);
  await db.execute(sql`alter table hub.ai_usage_logs add column if not exists response_preview text`);
  await db.execute(sql`alter table hub.ai_usage_logs add column if not exists label text`);
  await db.execute(sql`
    create table if not exists hub.retention_runs (
      id serial primary key,
      mode text not null default 'apply',
      retention_days integer not null default 30,
      status text not null default 'success',
      summary jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`
    create table if not exists hub.scoring_skills (
      id serial primary key,
      user_id uuid not null references auth.users(id) on delete cascade,
      name text not null,
      description text,
      preset_key text,
      status text not null default 'draft',
      weight real not null default 1,
      instruction_prompt text not null,
      rubric_json jsonb not null default '{}'::jsonb,
      output_schema_version integer not null default 1,
      model_config_id text,
      is_default boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`alter table hub.scoring_skills add column if not exists preset_key text`);
  await db.execute(sql`create index if not exists idx_scoring_skills_user on hub.scoring_skills(user_id, status)`);
  await db.execute(sql`
    create table if not exists hub.item_feedback (
      id serial primary key,
      item_id uuid not null references hub.items(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      feedback_type text not null,
      target_skill_id integer references hub.scoring_skills(id) on delete set null,
      reason_tags jsonb not null default '[]'::jsonb,
      note text,
      created_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`create index if not exists idx_item_feedback_item_user on hub.item_feedback(item_id, user_id, created_at desc)`);
  await db.execute(sql`
    create table if not exists hub.item_score_breakdowns (
      id serial primary key,
      item_id uuid not null references hub.items(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      skill_id integer references hub.scoring_skills(id) on delete set null,
      score real,
      confidence real,
      decision text,
      reasons jsonb not null default '[]'::jsonb,
      matched_signals jsonb not null default '[]'::jsonb,
      risk_flags jsonb not null default '[]'::jsonb,
      raw_response text,
      created_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`
    create unique index if not exists idx_item_score_breakdowns_unique
    on hub.item_score_breakdowns(item_id, user_id, skill_id)
  `);
  await db.execute(sql`create index if not exists idx_item_score_breakdowns_item on hub.item_score_breakdowns(item_id, user_id)`);
  await db.execute(sql`
    create table if not exists hub.item_quality_checks (
      id serial primary key,
      item_id uuid not null references hub.items(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      source_id integer references hub.sources(id) on delete set null,
      scene_type text not null default 'quality_filter',
      decision text,
      summary text,
      reason text,
      tags jsonb not null default '[]'::jsonb,
      risk_flags jsonb not null default '[]'::jsonb,
      score real,
      confidence real,
      policy_snapshot jsonb not null default '{}'::jsonb,
      raw_response text,
      prompt_preview text,
      response_preview text,
      model_config_id text,
      prompt_template_id text,
      created_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`create index if not exists idx_item_quality_checks_item on hub.item_quality_checks(item_id, user_id, created_at desc)`);
  await db.execute(sql`create index if not exists idx_item_quality_checks_user on hub.item_quality_checks(user_id, created_at desc)`);
  await db.execute(sql`
    create table if not exists hub.user_preference_profiles (
      user_id uuid primary key references auth.users(id) on delete cascade,
      profile_summary text,
      positive_signals jsonb not null default '[]'::jsonb,
      negative_signals jsonb not null default '[]'::jsonb,
      focus_topics jsonb not null default '[]'::jsonb,
      avoid_topics jsonb not null default '[]'::jsonb,
      updated_from_feedback_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`alter table hub.insights add column if not exists payload jsonb not null default '{}'::jsonb`);
  await db.execute(sql`alter table hub.insights add column if not exists pipeline_version integer not null default 1`);
  await db.execute(sql`
    do $$
    begin
      if exists (
        select 1 from information_schema.tables
        where table_schema = 'public'
          and table_name = 'model_configs'
      ) then
        alter table public.model_configs add column if not exists alias text;
      end if;
    end $$;
  `);
}

async function reconcileRunningFetchLogs() {
  await db.execute(sql`
    with superseded as (
      select running.id,
             coalesce(min(done.finished_at), now()) as reconciled_finished_at
      from hub.fetch_logs running
      join hub.fetch_logs done
        on done.source_id = running.source_id
       and done.status in ('success', 'error')
       and done.started_at > running.started_at
      where running.status = 'running'
      group by running.id
    ),
    stale as (
      select id,
             now() as reconciled_finished_at
      from hub.fetch_logs
      where status = 'running'
        and started_at < now() - interval '6 hours'
    ),
    candidates as (
      select * from superseded
      union
      select * from stale
    )
    update hub.fetch_logs log
    set status = 'error',
        outcome = coalesce(log.outcome, 'error'),
        finished_at = coalesce(log.finished_at, candidates.reconciled_finished_at),
        error = coalesce(nullif(log.error, ''), 'Fetch log reconciled after worker restart or superseded completion'),
        duration_ms = coalesce(
          log.duration_ms,
          greatest(0, floor(extract(epoch from (candidates.reconciled_finished_at - log.started_at)) * 1000)::int)
        )
    from candidates
    where log.id = candidates.id
  `);
}

async function bootstrap() {
  await ensureSchemaCompatibility();
  await reconcileRunningFetchLogs();
  pinoLogger.info('Fetch worker started');
  startCronJobs();
  void enqueueDueFetches(50).then((result) => {
    pinoLogger.info({ ...result, phase: 'startup-catch-up' }, 'Startup catch-up finished');
  }).catch((error) => {
    pinoLogger.error({ error: error instanceof Error ? error.message : String(error) }, 'Startup catch-up failed');
  });

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    pinoLogger.info({ port: info.port, env: config.nodeEnv }, '🚀 hub-engine started');
  });
}

void bootstrap().catch((error) => {
  pinoLogger.error({ error: error instanceof Error ? error.message : String(error) }, 'hub-engine bootstrap failed');
  process.exit(1);
});

process.on('SIGTERM', async () => {
  pinoLogger.info('SIGTERM received, shutting down...');
  await fetchWorker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  pinoLogger.info('SIGINT received, shutting down...');
  await fetchWorker.close();
  process.exit(0);
});
