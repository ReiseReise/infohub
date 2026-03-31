import cron from 'node-cron';
import { eq } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { enqueueDueFetches } from './pipeline.js';
import { batchUpdatePriority } from '../processors/priority.js';
import { scoreItems } from '../processors/ai-scorer.js';
import { summarizeItems, translateItems } from '../processors/ai-summarizer.js';
import { generateDailyReport, formatMarkdown } from '../outputs/daily-report.js';
import { pushDailyReport } from '../outputs/push.js';
import { exportToObsidian } from '../outputs/obsidian.js';
import { exportToKnowledgeFiles } from '../outputs/knowledge.js';
import { db, schema } from '../db/index.js';
import { runRetention } from '../lib/retention.js';
import { rebuildStalePreferenceProfiles } from '../lib/scoring-skills.js';

const jobs: cron.ScheduledTask[] = [];
const DEFAULT_USER_ID = '11ec2268-1635-4e3c-9add-e51c48d0639a';

async function getAiProcessingUserIds(): Promise<string[]> {
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

  if (ids.size === 0) ids.add(DEFAULT_USER_ID);
  return Array.from(ids);
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

  if (ids.size === 0) ids.add(DEFAULT_USER_ID);
  return Array.from(ids);
}

export function startCronJobs() {
  // 每 5 分钟：混合调度，仅入队到期来源
  const hourlyFetch = cron.schedule('*/5 * * * *', async () => {
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
  const aiProcessing = cron.schedule('*/10 * * * *', async () => {
    if (!config.ai.enabled) return;
    try {
      const users = await getAiProcessingUserIds();
      let scored = 0, summarized = 0, translated = 0;
      for (const userId of users) {
        if (config.ai.scoringEnabled) scored += await scoreItems(userId, 20);
        if (config.ai.summaryEnabled) summarized += await summarizeItems(userId, 10);
        if (config.ai.translationEnabled) translated += await translateItems(userId, 5);
      }
      if (scored + summarized + translated > 0) {
        logger.info({ scored, summarized, translated, users: users.length }, 'Cron: AI processing complete');
      }
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Cron: AI processing failed');
    }
  });
  jobs.push(aiProcessing);

  // 每30分钟：优先级评分更新
  const priorityUpdate = cron.schedule('15,45 * * * *', async () => {
    try {
      const users = await getPriorityUserIds();
      let count = 0;
      for (const userId of users) {
        count += await batchUpdatePriority(userId, 200);
      }
      if (count > 0) {
        logger.info({ updated: count, users: users.length }, 'Cron: priority update complete');
      }
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Cron: priority update failed');
    }
  });
  jobs.push(priorityUpdate);

  // 每天早6点：生成日报 + 推送 + 导出
  const dailyReport = cron.schedule('0 6 * * *', async () => {
    logger.info('Cron: daily report triggered');
    try {
      const report = await generateDailyReport(DEFAULT_USER_ID);
      const md = formatMarkdown(report);
      await pushDailyReport(`信息中枢日报 — ${report.date}`, md);
      await exportToObsidian(DEFAULT_USER_ID);
      await exportToKnowledgeFiles(DEFAULT_USER_ID);
      logger.info({ date: report.date, items: report.newItems }, 'Cron: daily report + export complete');
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Cron: daily report failed');
    }
  });
  jobs.push(dailyReport);

  const retentionCleanup = cron.schedule('30 3 * * *', async () => {
    try {
      const result = await runRetention({ retentionDays: 30, dryRun: false });
      logger.info(result, 'Cron: retention cleanup complete');
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Cron: retention cleanup failed');
    }
  });
  jobs.push(retentionCleanup);

  const nightlyPreferenceRebuild = cron.schedule('15 2 * * *', async () => {
    try {
      const result = await rebuildStalePreferenceProfiles(100);
      logger.info(result, 'Cron: preference profile rebuild complete');
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Cron: preference profile rebuild failed');
    }
  });
  jobs.push(nightlyPreferenceRebuild);

  logger.info('Cron jobs started: [hybrid-fetch(5min), ai-processing(10min), priority-update(30min), preference-profile(2:15am), retention(3:30am), daily-report(6am)]');
}

export function stopCronJobs() {
  jobs.forEach((job) => job.stop());
  jobs.length = 0;
  logger.info('Cron jobs stopped');
}
