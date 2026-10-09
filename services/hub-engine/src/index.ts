import jevRoutes from './routes/jev.js';
import { startJevWorker } from './jev/queue.js';
import { serve } from '@hono/node-server';
import { UnrecoverableError } from 'bullmq';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sql } from 'drizzle-orm';
import { logger as pinoLogger } from './lib/logger.js';
import { config } from './config/index.js';
import {
  createDailyReportWorker,
  createFetchWorker,
  createItemTranslationWorker,
  createProcessWorker,
  fetchQueue,
  processQueue,
} from './scheduler/queue.js';
import { enqueueDueFetches, handleFetchJob } from './scheduler/pipeline.js';
import { startCronJobs } from './scheduler/cron.js';
import { db } from './db/index.js';
import { buildDailyGenerationProgress, humanizeDailyGenerationError } from './lib/daily-generation-progress.js';
import { buildItemTranslationProgress } from './lib/item-translation-progress.js';
import { runFullItemTranslation } from './lib/item-full-translation.js';
import {
  enqueueItemTranslationJob,
  markAutomaticTranslationPending,
  resolveTranslationProviderReadiness,
} from './scheduler/item-translation-jobs.js';
import {
  resolveTranslationReadinessJobDisposition,
  translationProviderReadinessMessage,
} from './scheduler/item-translation-policy.js';
import { buildDailyInsightType, generateDailyReport } from './outputs/daily-report.js';
import { resolveDailyReportWindow } from './outputs/daily-report-window.js';
import { scheduleDailyReportPush } from './outputs/push.js';
import { getDailyReportWorkflow } from './routes/insights.js';
import { exportToObsidian } from './outputs/obsidian.js';
import { exportToKnowledgeFiles } from './outputs/knowledge.js';
import { enqueueDailyReportCatchUp } from './scheduler/daily-report-scheduler.js';
import { getUserFetchSettings } from './lib/fetch-settings.js';
import { qualityFilterItems } from './processors/quality-filter.js';
import { scoreItems } from './processors/ai-scorer.js';
import { summarizeItemsDetailed, translateItemsDetailed } from './processors/ai-summarizer.js';
import { waitForQueueQuiescence } from './scheduler/startup-recovery.js';
import { resolveDailyReportDeliveryDecision } from './lib/daily-report-quality.js';
import {
  resolveAutomaticAiRuntimePolicy,
  resolveDailyReportRuntimePolicy,
  resolveItemTranslationRuntimePolicy,
} from './lib/runtime-security-policy.js';

import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import sourcesRoutes from './routes/sources.js';
import itemsRoutes from './routes/items.js';
import fetchRoutes from './routes/fetch.js';
import insightsRoutes from './routes/insights.js';
import dailyRoutes from './routes/daily.js';
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
import integrationsRoutes from './routes/integrations.js';

import researchRoutes from './routes/research.js';
import radiusRoutes from './routes/radius.js';
import { startResearchWorker } from './research/queue.js';
const researchWorker = startResearchWorker();
const jevWorker = startJevWorker();
const app = new Hono();
let httpServer: ReturnType<typeof serve> | null = null;
let shutdownStarted = false;

app.use('*', cors({ origin: config.cors.origins }));

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
app.route('/api/daily', dailyRoutes);
app.route('/api/research', researchRoutes);
app.route('/api/radius', radiusRoutes);
app.route('/api/jev', jevRoutes);
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
app.route('/api/integrations', integrationsRoutes);

app.get('/', (c) => c.json({
  service: 'hub-engine',
  version: '3.0.0',
  status: 'running',
}));

const fetchWorker = createFetchWorker(async (job) => {
  await handleFetchJob(job);
});

const dailyReportWorker = createDailyReportWorker(async (job) => {
  await job.updateProgress(buildDailyGenerationProgress('queued', { message: '日报任务开始排队。' }));
  const runtimePolicy = resolveDailyReportRuntimePolicy({
    trigger: job.data.trigger,
    globalEnabled: config.ai.enabled,
  });
  if (!runtimePolicy.run) {
    await job.updateProgress(buildDailyGenerationProgress('completed', {
      message: '自动日报已由 AI 总闸关闭，本任务未调用模型。',
      detail: {
        trigger: job.data.trigger,
        skipped: true,
        reason: runtimePolicy.skippedReason,
      },
    }));
    return {
      date: job.data.date,
      itemCount: 0,
      generatedAt: new Date().toISOString(),
      qualityStatus: 'degraded',
      qualityReasons: [runtimePolicy.skippedReason],
      message: '自动日报已跳过，未调用模型。',
      reportUrl: null,
      skipped: true,
      skipReason: runtimePolicy.skippedReason,
    };
  }
  const workflow = await getDailyReportWorkflow(job.data.userId);
  try {
    const reportDate = resolveDailyReportWindow(job.data.date).dayStart;
    const workflowOverride = job.data.sourceId
      ? {
        ...workflow,
        scope: {
          ...(workflow.scope || {}),
          sourceIds: [job.data.sourceId],
          sourceNames: job.data.sourceName ? [job.data.sourceName] : [],
        },
      }
      : workflow;
    const report = await generateDailyReport(job.data.userId, reportDate, {
      generationMode: job.data.mode,
      preset: job.data.preset,
      workflow: workflowOverride,
      sourceId: job.data.sourceId || null,
      sourceName: job.data.sourceName || null,
      reportType: buildDailyInsightType(job.data.sourceId || null),
      onProgress: (progress) => job.updateProgress(progress),
    });
    const delivery = resolveDailyReportDeliveryDecision(report.payload);
    if (delivery.allowExternalPush) {
      scheduleDailyReportPush(`${job.data.sourceName || '信息中枢日报'} — ${report.date}`, report.markdown);
    }
    if (!job.data.sourceId && delivery.allowAutomaticFormalExport) {
      const exportResults = await Promise.allSettled([
        exportToObsidian(job.data.userId),
        exportToKnowledgeFiles(job.data.userId),
      ]);
      exportResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          pinoLogger.warn({
            userId: job.data.userId,
            target: index === 0 ? 'obsidian' : 'knowledge',
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          }, 'Daily report export failed after generation');
        }
      });
    }
    return {
      date: report.date,
      itemCount: report.newItems,
      generatedAt: new Date().toISOString(),
      qualityStatus: delivery.quality.status,
      qualityReasons: delivery.quality.reasons,
      message: delivery.message,
      reportUrl: job.data.sourceId
        ? `/daily/reports/latest?date=${encodeURIComponent(report.date)}&sourceId=${encodeURIComponent(String(job.data.sourceId))}`
        : `/daily/reports/latest?date=${encodeURIComponent(report.date)}`,
    };
  } catch (err) {
    const userMessage = humanizeDailyGenerationError(err);
    await job.updateProgress(buildDailyGenerationProgress('failed', {
      message: userMessage,
    }));
    pinoLogger.error({ jobId: job.id, error: (err as Error).message }, 'Daily report generation failed');
    throw err;
  }
});

const itemTranslationWorker = createItemTranslationWorker(async (job) => {
  await job.updateProgress(buildItemTranslationProgress('queued', {
    message: '全文翻译任务开始排队。',
    detail: { itemId: job.data.itemId },
  }));
  try {
    const runtimePolicy = resolveItemTranslationRuntimePolicy({
      mode: job.data.mode,
      globalEnabled: config.ai.enabled,
      translationEnabled: config.ai.translationEnabled,
    });
    if (!runtimePolicy.callProvider) {
      await job.updateProgress(buildItemTranslationProgress('completed', {
        message: '自动全文翻译已由运行时开关关闭，本任务未调用模型。',
        detail: {
          itemId: job.data.itemId,
          translated: 0,
          skipped: 1,
          reason: runtimePolicy.skippedReason,
        },
      }));
      return {
        itemId: job.data.itemId,
        translated: 0,
        skipped: 1,
        skipReason: runtimePolicy.skippedReason,
        mode: job.data.mode,
        trigger: job.data.trigger,
        finishedAt: new Date().toISOString(),
      };
    }

    const providerReadiness = await resolveTranslationProviderReadiness(job.data.userId);
    const readinessDisposition = resolveTranslationReadinessJobDisposition(job.data.mode, providerReadiness);
    if (readinessDisposition !== 'proceed') {
      const message = translationProviderReadinessMessage(providerReadiness);
      if (readinessDisposition === 'fail') {
        throw new UnrecoverableError(message);
      }
      await markAutomaticTranslationPending(job.data.userId, job.data.itemId, message);
      await job.updateProgress(buildItemTranslationProgress('completed', {
        message,
        detail: {
          itemId: job.data.itemId,
          translated: 0,
          skipped: 1,
          reason: providerReadiness.reason,
        },
      }));
      return {
        itemId: job.data.itemId,
        translated: 0,
        skipped: 1,
        skipReason: providerReadiness.reason,
        mode: job.data.mode,
        trigger: job.data.trigger,
        finishedAt: new Date().toISOString(),
      };
    }
    if (job.data.mode === 'automatic') {
      await job.updateProgress(buildItemTranslationProgress('translating', {
        message: '正在生成高价值内容译文。',
        detail: { itemId: job.data.itemId, trigger: job.data.trigger },
      }));
      const automatic = await translateItemsDetailed(job.data.userId, 1, {
        itemId: job.data.itemId,
        automatic: true,
        bypassQualityCooldown: true,
      });
      if (automatic.errors.length > 0) {
        throw new Error(automatic.errors[0]);
      }
      await job.updateProgress(buildItemTranslationProgress('completed', {
        detail: {
          itemId: job.data.itemId,
          translated: automatic.processed,
          skipped: automatic.skipped,
        },
      }));
      return {
        itemId: job.data.itemId,
        translated: automatic.processed,
        skipped: automatic.skipped,
        mode: job.data.mode,
        trigger: job.data.trigger,
        finishedAt: new Date().toISOString(),
      };
    }

    const result = await runFullItemTranslation(job.data.userId, job.data.itemId, {
      onProgress: (progress) => job.updateProgress(progress),
    });
    await job.updateProgress(buildItemTranslationProgress('completed', {
      detail: {
        itemId: job.data.itemId,
        translated: result.translated,
        skipped: result.skipped,
      },
    }));
    return {
      itemId: job.data.itemId,
      translated: result.translated,
      skipped: result.skipped,
      contentFetched: result.contentFetched,
      errorReason: result.errorReason,
      mode: job.data.mode,
      trigger: job.data.trigger,
      data: result.item,
      finishedAt: new Date().toISOString(),
    };
  } catch (err) {
    await job.updateProgress(buildItemTranslationProgress('failed', {
      message: (err as Error).message || '全文翻译失败。',
      detail: { itemId: job.data.itemId },
    }));
    throw err;
  }
});

const processWorker = createProcessWorker(async (job) => {
  if (job.data.stage !== 'ai_pipeline') return;
  const settings = await getUserFetchSettings(job.data.userId);
  const autoSummaryEnabled = job.data.autoSummaryEnabled ?? settings.autoSummaryEnabled;
  const autoTranslationEnabled = job.data.autoTranslationEnabled ?? settings.autoTranslationEnabled;
  const runtimePolicy = resolveAutomaticAiRuntimePolicy({
    globalEnabled: config.ai.enabled,
    scoringEnabled: config.ai.scoringEnabled,
    summaryEnabled: config.ai.summaryEnabled,
    translationEnabled: config.ai.translationEnabled,
    userAutoSummaryEnabled: autoSummaryEnabled,
    userAutoTranslationEnabled: autoTranslationEnabled,
  });

  if (!runtimePolicy.enabled) return;

  if (runtimePolicy.runQualityFilter) {
    await qualityFilterItems(job.data.userId, 1, {
      itemId: job.data.itemId,
      automatic: true,
    });
  }
  if (runtimePolicy.runScoring) {
    await scoreItems(job.data.userId, 1, {
      itemId: job.data.itemId,
      automatic: true,
    });
  }
  if (runtimePolicy.runSummary) {
    await summarizeItemsDetailed(job.data.userId, 1, {
      itemId: job.data.itemId,
      automatic: true,
    });
  }
  if (runtimePolicy.runTranslation) {
    await enqueueItemTranslationJob({
      userId: job.data.userId,
      itemId: job.data.itemId,
      mode: 'automatic',
      trigger: 'pipeline',
    });
  }
});

async function ensureSchemaCompatibility() {
  await db.execute(sql`alter table public.prompt_templates alter column category type text`);
  await db.execute(sql`alter table hub.ai_configs drop constraint if exists ai_configs_type_check`);
  await db.execute(sql`alter table hub.insights drop constraint if exists insights_type_check`);
  await db.execute(sql`
    alter table hub.insights
    add constraint insights_type_check
    check (
      type = any (array['daily'::text, 'weekly'::text])
      or type like 'daily_source_%'
    )
  `);
  await db.execute(sql`
    update hub.filter_rules
    set
      type = 'source_priority',
      config = '{"minScore":70,"boost":20,"description":"AI 评分达到 70 后优先展示；低于 70 不做硬过滤。"}'::jsonb
    where scope = 'global'
      and user_id is null
      and name = 'AI高分优先'
      and type = 'ai_score_filter'
  `);
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
      auto_summary_enabled boolean not null default true,
      auto_translation_enabled boolean not null default true,
      daily_report_enabled boolean not null default false,
      daily_report_workflow jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`alter table hub.user_settings add column if not exists auto_summary_enabled boolean`);
  await db.execute(sql`alter table hub.user_settings add column if not exists auto_translation_enabled boolean`);
  await db.execute(sql`update hub.user_settings set auto_summary_enabled = true where auto_summary_enabled is null`);
  await db.execute(sql`update hub.user_settings set auto_translation_enabled = true where auto_translation_enabled is null`);
  await db.execute(sql`alter table hub.user_settings alter column auto_summary_enabled set default true`);
  await db.execute(sql`alter table hub.user_settings alter column auto_translation_enabled set default true`);
  await db.execute(sql`alter table hub.user_settings alter column auto_summary_enabled set not null`);
  await db.execute(sql`alter table hub.user_settings alter column auto_translation_enabled set not null`);
  await db.execute(sql`alter table hub.user_settings add column if not exists daily_report_workflow jsonb`);
  await db.execute(sql`alter table hub.user_settings add column if not exists daily_report_enabled boolean`);
  await db.execute(sql`
    update hub.user_settings settings
    set daily_report_workflow = jsonb_set(
      settings.daily_report_workflow,
      '{scope,sourceTiers}',
      coalesce((
        select jsonb_agg(to_jsonb(normalized.mapped) order by normalized.first_ord)
        from (
          select mapped, min(ord) as first_ord
          from (
            select case entry.value
              when 'T1' then 'S'
              when 'T1.5' then 'A'
              when 'T2' then null
              else upper(entry.value)
            end as mapped,
            entry.ord
            from jsonb_array_elements_text(
              coalesce(settings.daily_report_workflow #> '{scope,sourceTiers}', '[]'::jsonb)
            ) with ordinality as entry(value, ord)
          ) mapped_entries
          where mapped in ('S', 'A', 'B', 'C', 'D')
          group by mapped
        ) normalized
      ), '["S", "A"]'::jsonb),
      true
    )
    where settings.daily_report_workflow is not null
      and jsonb_typeof(settings.daily_report_workflow #> '{scope,sourceTiers}') = 'array'
      and exists (
        select 1
        from jsonb_array_elements_text(settings.daily_report_workflow #> '{scope,sourceTiers}') as legacy(value)
        where legacy.value in ('T1', 'T1.5', 'T2')
      )
  `);
  await db.execute(sql`
    insert into hub.user_settings (user_id, auto_fetch_enabled, daily_report_enabled, created_at, updated_at)
    select distinct u.id, true, true, now(), now()
    from auth.users u
    where u.username !~* '^(qa|shadow|hubaudio)'
      and (
        exists (
          select 1 from hub.insights insight
          where insight.user_id = u.id
            and insight.type = 'daily'
        )
        or exists (
          select 1 from hub.user_settings existing
          where existing.user_id = u.id
            and existing.daily_report_workflow is not null
        )
      )
    on conflict (user_id) do update
    set daily_report_enabled = coalesce(hub.user_settings.daily_report_enabled, excluded.daily_report_enabled),
        updated_at = case
          when hub.user_settings.daily_report_enabled is null then now()
          else hub.user_settings.updated_at
        end
  `);
  await db.execute(sql`update hub.user_settings set daily_report_enabled = false where daily_report_enabled is null`);
  await db.execute(sql`alter table hub.user_settings alter column daily_report_enabled set default false`);
  await db.execute(sql`alter table hub.user_settings alter column daily_report_enabled set not null`);
  await db.execute(sql`create index if not exists idx_user_settings_daily_report on hub.user_settings(daily_report_enabled)`);
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
  await db.execute(sql`alter table hub.items add column if not exists readability_content text`);
  await db.execute(sql`alter table hub.items add column if not exists readability_status text default 'missing'`);
  await db.execute(sql`alter table hub.items add column if not exists readability_reason text`);
  await db.execute(sql`alter table hub.items add column if not exists fetch_engine text`);
  await db.execute(sql`alter table hub.items add column if not exists render_mode text`);
  await db.execute(sql`alter table hub.items add column if not exists blocked_reason text`);
  await db.execute(sql`alter table hub.items add column if not exists summary_status text default 'pending'`);
  await db.execute(sql`alter table hub.items add column if not exists summary_basis text`);
  await db.execute(sql`alter table hub.items add column if not exists summary_reason text`);
  await db.execute(sql`alter table hub.items add column if not exists translation_status text default 'pending'`);
  await db.execute(sql`alter table hub.items add column if not exists translation_reason text`);
  await db.execute(sql`alter table hub.items add column if not exists translated_title text`);
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
    set summary_reason = case
      when processing_profile = 'monitor' then '监控档位默认不做摘要'
      when ai_score is not null and ai_score < 40 then 'AI 评分过低，跳过摘要'
      when processing_status = 'summary_failed' then coalesce(summary_reason, '摘要生成失败')
      else summary_reason
    end
    where summary_status in ('skipped', 'failed')
      and summary_reason is null
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
    set translation_reason = case
      when summary_status = 'skipped' and summary_reason is not null then summary_reason || '，未进入翻译'
      when processing_profile = 'monitor' then '监控档位默认不做翻译'
      when ai_score is not null and ai_score < 50 then 'AI 评分过低，跳过翻译'
      else translation_reason
    end
    where translation_status = 'skipped'
      and translation_reason is null
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
  await db.execute(sql`alter table hub.sources add column if not exists source_kind text not null default 'rss'`);
  await db.execute(sql`alter table hub.sources add column if not exists source_role text not null default 'normal'`);
  await db.execute(sql`alter table hub.sources add column if not exists source_tier text default 'B'`);
  await db.execute(sql`alter table hub.sources add column if not exists authority_weight real not null default 1`);
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
    set source_kind = case
      when source_type = 'wechat' or category in ('公众号爆文', 'wechat') then 'wechat'
      when collector_type = 'rsshub' and coalesce(config->>'route', '') ~* '/(twitter|x)/' then 'x'
      when source_type in ('podcast', 'audio') or collector_type = 'youtube' then 'podcast'
      when collector_type = 'custom' then 'api'
      when collector_type in ('changedetection', 'webpage') then 'webpage'
      when coalesce(config->>'url', config->>'htmlUrl', '') ~* '(openai.com|anthropic.com|claude.com|x.ai|machinelearning.apple.com|github.blog|cursor.com|nvidia.com)' then 'official'
      when coalesce(config->>'url', config->>'htmlUrl', '') ~* '(huggingface.co|simonwillison.net|substack.com|interconnects.ai)' then 'blog'
      when coalesce(config->>'url', config->>'htmlUrl', '') ~* '(ithome.com|the-decoder.com|buzzing.cc)' then 'media'
      else coalesce(nullif(source_kind, ''), 'rss')
    end
    where source_kind is null or btrim(source_kind) = '' or source_kind = 'rss'
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
    set authority_weight = greatest(0.35, least(2, case
      when source_tier = 'S' then 1.22
      when source_tier = 'A' then 1.08
      when source_tier = 'B' then 0.96
      when source_tier = 'C' then 0.82
      else 0.72
    end
    + case
      when source_kind = 'official' then 0.06
      when source_kind = 'blog' then 0.02
      when source_kind = 'wechat' then -0.08
      when source_kind = 'media' then -0.03
      else 0
    end))
    where authority_weight is null or authority_weight <= 0
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
  await db.execute(sql`create index if not exists idx_sources_kind on hub.sources(source_kind)`);
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
    create table if not exists hub.item_reading_assets (
      id serial primary key,
      item_id uuid not null references hub.items(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      asset_type text not null,
      prompt_key text not null,
      label text not null,
      status text not null default 'ready',
      basis text,
      content text,
      preview text,
      source text not null default 'ai',
      provider text,
      model_name text,
      model_config_id text,
      prompt_template_id text,
      metadata jsonb not null default '{}'::jsonb,
      error_reason text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`
    create unique index if not exists idx_item_reading_assets_unique
    on hub.item_reading_assets(user_id, item_id, asset_type, prompt_key)
  `);
  await db.execute(sql`create index if not exists idx_item_reading_assets_item on hub.item_reading_assets(item_id, user_id)`);
  await db.execute(sql`create index if not exists idx_item_reading_assets_user_updated on hub.item_reading_assets(user_id, updated_at desc)`);
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
  pinoLogger.info('Daily report worker started');
  startCronJobs();
  void (async () => {
    const fetchResult = await enqueueDueFetches(50);
    pinoLogger.info({ ...fetchResult, phase: 'startup-catch-up' }, 'Startup fetch catch-up enqueued');

    const fetchBarrier = await waitForQueueQuiescence({
      queue: {
        getJobCounts: () => fetchQueue.getJobCounts('waiting', 'active', 'delayed', 'prioritized'),
      },
      timeoutMs: 10 * 60 * 1000,
    });
    if (!fetchBarrier.settled) {
      pinoLogger.warn({ ...fetchBarrier, phase: 'startup-catch-up' }, 'Startup fetch catch-up timed out before queue became quiet');
    } else {
      pinoLogger.info({ ...fetchBarrier, phase: 'startup-catch-up' }, 'Startup fetch catch-up settled');
    }

    const processBarrier = await waitForQueueQuiescence({
      queue: {
        getJobCounts: () => processQueue.getJobCounts('waiting', 'active', 'delayed', 'prioritized'),
      },
      timeoutMs: 60 * 1000,
    });
    if (!processBarrier.settled) {
      pinoLogger.warn({ ...processBarrier, phase: 'startup-ai-catch-up' }, 'Startup AI catch-up is still running; daily report will use its own readiness repair');
    }

    const dailyResult = await enqueueDailyReportCatchUp();
    pinoLogger.info({
      ...dailyResult,
      fetchSettled: fetchBarrier.settled,
      processSettled: processBarrier.settled,
      phase: 'daily-report-startup-catch-up',
    }, 'Daily report startup catch-up finished after content recovery');
  })().catch((error) => {
    pinoLogger.error({ error: error instanceof Error ? error.message : String(error) }, 'Startup recovery failed');
  });

  httpServer = serve({ fetch: app.fetch, port: config.port }, (info) => {
    pinoLogger.info({ port: info.port, env: config.nodeEnv }, '🚀 hub-engine started');
  });
}

void bootstrap().catch((error) => {
  pinoLogger.error({ error: error instanceof Error ? error.message : String(error) }, 'hub-engine bootstrap failed');
  process.exit(1);
});

async function shutdown(signal: 'SIGTERM' | 'SIGINT') {
  if (shutdownStarted) return;
  shutdownStarted = true;
  pinoLogger.info({ signal }, 'Shutdown requested; draining active jobs before exit');
  httpServer?.close();

  const results = await Promise.allSettled([
    fetchWorker.close(),
    processWorker.close(),
    dailyReportWorker.close(),
    itemTranslationWorker.close(),
    researchWorker?.close() ?? Promise.resolve(),
    jevWorker?.close() ?? Promise.resolve(),
  ]);
  const failures = results
    .map((result, index) => ({ result, worker: ['fetch', 'process', 'daily-report', 'item-translation', 'research', 'jev'][index] }))
    .filter((entry): entry is { result: PromiseRejectedResult; worker: string } => entry.result.status === 'rejected');
  failures.forEach(({ result, worker }) => {
    pinoLogger.error({ worker, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }, 'Worker shutdown failed');
  });
  process.exit(failures.length > 0 ? 1 : 0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
