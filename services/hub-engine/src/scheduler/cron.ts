import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { getCronJobSchedule } from './cron-specs.js';
import { eq } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { enqueueDueFetches } from './pipeline.js';
import { batchUpdatePriority } from '../processors/priority.js';
import { scoreItems } from '../processors/ai-scorer.js';
import { qualityFilterItems } from '../processors/quality-filter.js';
import { summarizeItems } from '../processors/ai-summarizer.js';
import { db, schema } from '../db/index.js';
import { runRetention } from '../lib/retention.js';
import { rebuildStalePreferenceProfiles } from '../lib/scoring-skills.js';
import { refreshRecentEventClusters } from '../lib/event-cluster-maintenance.js';
import { recoverFormalProcessingDebt } from '../lib/processing-debt-recovery.js';
import { enqueueScheduledDailyReports } from './daily-report-scheduler.js';
import { getUserFetchSettings, type UserFetchSettings } from '../lib/fetch-settings.js';
import {
  DEFAULT_DAILY_REPORT_TIME_ZONE,
  resolveDailyRecoveryCheck,
} from '../lib/daily-report-schedule-policy.js';
import { enqueueAutomaticTranslationCandidates } from './item-translation-jobs.js';
import { resolveDailyReportRuntimePolicy } from '../lib/runtime-security-policy.js';

const jobs: ScheduledTask[] = [];
const FALLBACK_USER_ID = '11ec2268-1635-4e3c-9add-e51c48d0639a';

async function getAiProcessingUsers(): Promise<UserFetchSettings[]> {
  const ids = new Set<string>();

  const activeAiUsers = await db.select({ userId: schema.aiConfigs.userId })
    .from(schema.aiConfigs)
    .where(eq(schema.aiConfigs.isActive, true))
    .groupBy(schema.aiConfigs.userId);
  for (const row of activeAiUsers) ids.add(row.userId);

  const itemUsers = await db.select({ userId: schema.items.userId })
    .from(schema.items)
    .groupBy(schema.items.userId);
  for (const row of itemUsers) ids.add(row.userId);

  if (ids.size === 0) ids.add(FALLBACK_USER_ID);
  return Promise.all(Array.from(ids).map((userId) => getUserFetchSettings(userId)));
}

async function getPriorityUserIds(): Promise<string[]> {
  const ids = new Set<string>();

  const sourceUsers = await db.select({ userId: schema.sources.userId })
    .from(schema.sources)
    .groupBy(schema.sources.userId);
  for (const row of sourceUsers) ids.add(row.userId);

  const itemUsers = await db.select({ userId: schema.items.userId })
    .from(schema.items)
    .groupBy(schema.items.userId);
  for (const row of itemUsers) ids.add(row.userId);

  if (ids.size === 0) ids.add(FALLBACK_USER_ID);
  return Array.from(ids);
}

export function startCronJobs() {
  let lastDailyRecoveryCheckKey: string | null = null;

  // 每 5 分钟：混合调度，仅入队到期来源
  const hourlyFetch = cron.schedule(getCronJobSchedule('hybrid-fetch').schedule, async () => {
    logger.info('Cron: hybrid fetch scheduling triggered');
    try {
      const result = await enqueueDueFetches(50);
      logger.info(result, 'Cron: hybrid fetch enqueued');
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Cron: hybrid fetch failed');
    }
  });
  jobs.push(hourlyFetch);

  // 每10分钟：AI处理管道（评分→摘要→翻译）— 受 config.ai 开关控制
  const aiProcessing = cron.schedule(getCronJobSchedule('ai-processing').schedule, async () => {
    if (!config.ai.enabled) return;
    try {
      const users = await getAiProcessingUsers();
      let filtered = 0, scored = 0, summarized = 0, translated = 0;
      for (const settings of users) {
        const userId = settings.userId;
        filtered += await qualityFilterItems(userId, 20, { automatic: true });
        if (config.ai.scoringEnabled) scored += await scoreItems(userId, 20, { automatic: true });
        if (config.ai.summaryEnabled && settings.autoSummaryEnabled) {
          summarized += await summarizeItems(userId, 10, { automatic: true });
        }
        if (config.ai.translationEnabled && settings.autoTranslationEnabled) {
          const result = await enqueueAutomaticTranslationCandidates(userId, 5, 'cron');
          translated += result.enqueued;
        }
      }
      if (filtered + scored + summarized + translated > 0) {
        logger.info({ filtered, scored, summarized, translated, users: users.length }, 'Cron: AI processing complete');
      }
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Cron: AI processing failed');
    }
  });
  jobs.push(aiProcessing);

  // 每15分钟：优先补最老的正式来源处理债；单源可小批追赶，但不能占满全局恢复车道。
  const processingDebtRecovery = cron.schedule(getCronJobSchedule('processing-debt-recovery').schedule, async () => {
    if (!config.ai.enabled) return;
    try {
      const users = await getAiProcessingUsers();
      let selected = 0, quality = 0, scored = 0, summarized = 0, translated = 0;
      for (const settings of users) {
        const result = await recoverFormalProcessingDebt(settings.userId, {
          limit: 6,
          maxPerSource: 3,
          minAgeMs: 30 * 60 * 1000,
          scoringEnabled: config.ai.scoringEnabled,
          summaryEnabled: config.ai.summaryEnabled && settings.autoSummaryEnabled,
          translationEnabled: config.ai.translationEnabled && settings.autoTranslationEnabled,
        });
        selected += result.selected;
        quality += result.quality;
        scored += result.scored;
        summarized += result.summarized;
        translated += result.translated;
      }
      if (selected > 0) {
        logger.info({
          selected,
          quality,
          scored,
          summarized,
          translated,
          users: users.length,
        }, 'Cron: formal processing debt recovery complete');
      }
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Cron: formal processing debt recovery failed');
    }
  });
  jobs.push(processingDebtRecovery);

  // 每30分钟：优先级评分更新
  const priorityUpdate = cron.schedule(getCronJobSchedule('priority-update').schedule, async () => {
    try {
      const users = await getPriorityUserIds();
      let count = 0;
      let clusterChanges = 0;
      let multiSourceClusters = 0;
      for (const userId of users) {
        count += await batchUpdatePriority(userId, 200);
        const clusterResult = await refreshRecentEventClusters(userId);
        clusterChanges += clusterResult.changedCount;
        multiSourceClusters += clusterResult.multiSourceClusterCount;
      }
      if (count > 0 || clusterChanges > 0) {
        logger.info({
          updated: count,
          clusterChanges,
          multiSourceClusters,
          users: users.length,
        }, 'Cron: priority and event cluster update complete');
      }
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Cron: priority update failed');
    }
  });
  jobs.push(priorityUpdate);

  // 每15分钟检查一次：只重跑素材状态发生变化的降级日报。
  const dailyReport = cron.schedule(getCronJobSchedule('daily-report-recovery').schedule, async () => {
    const runtimePolicy = resolveDailyReportRuntimePolicy({
      trigger: 'cron',
      globalEnabled: config.ai.enabled,
    });
    if (!runtimePolicy.run) return;
    const recovery = resolveDailyRecoveryCheck(lastDailyRecoveryCheckKey);
    if (!recovery.shouldRun) return;
    lastDailyRecoveryCheckKey = recovery.checkKey;
    logger.info({
      dateKey: recovery.dateKey,
      checkKey: recovery.checkKey,
    }, 'Cron: daily report recovery check triggered');
    try {
      const result = await enqueueScheduledDailyReports({
        dateKeys: [recovery.dateKey],
        trigger: 'cron',
      });
      logger.info(result, 'Cron: daily reports enqueued');
    } catch (err) {
      lastDailyRecoveryCheckKey = null;
      logger.error({ error: (err as Error).message }, 'Cron: daily report enqueue failed');
    }
  }, { timezone: DEFAULT_DAILY_REPORT_TIME_ZONE });
  jobs.push(dailyReport);

  const retentionCleanup = cron.schedule(getCronJobSchedule('retention-cleanup').schedule, async () => {
    try {
      const result = await runRetention({ retentionDays: 30, dryRun: false });
      logger.info(result, 'Cron: retention cleanup complete');
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Cron: retention cleanup failed');
    }
  });
  jobs.push(retentionCleanup);

  const nightlyPreferenceRebuild = cron.schedule(getCronJobSchedule('preference-profile-rebuild').schedule, async () => {
    try {
      const result = await rebuildStalePreferenceProfiles(100);
      logger.info(result, 'Cron: preference profile rebuild complete');
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Cron: preference profile rebuild failed');
    }
  });
  jobs.push(nightlyPreferenceRebuild);

  logger.info('Cron jobs started: [hybrid-fetch(5min), ai-processing(10min), processing-debt-recovery(15min), priority-update(30min), preference-profile(2:15am), retention(3:30am), daily-report-recovery(15min)]');
}

export function stopCronJobs() {
  jobs.forEach((job) => job.stop());
  jobs.length = 0;
  logger.info('Cron jobs stopped');
}
