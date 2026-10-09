import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  buildDailyGenerationProgress,
  humanizeDailyGenerationError,
  normalizeDailyGenerationProgress,
} from '../lib/daily-generation-progress.js';
import { logger } from '../lib/logger.js';
import { buildDailyInsightType } from '../outputs/daily-report.js';
import { dailyReportQueue, type DailyReportJobData } from './queue.js';
import {
  buildDailyCatchUpDateKeys,
  buildDailyReportJobId,
  DEFAULT_DAILY_CATCH_UP_DAYS,
  DEFAULT_DAILY_REPORT_TIME_ZONE,
  resolveDailyGenerationPublicStatus,
  shouldReuseExistingDailyReport,
} from '../lib/daily-report-schedule-policy.js';
import { loadDailyReportRecoveryContext } from '../outputs/daily-report-recovery-material.js';
import { config } from '../config/index.js';
import { resolveDailyReportRuntimePolicy } from '../lib/runtime-security-policy.js';

export {
  buildDailyCatchUpDateKeys,
  buildDailyReportJobId,
  DEFAULT_DAILY_CATCH_UP_DAYS,
  DEFAULT_DAILY_REPORT_HOUR,
  DEFAULT_DAILY_REPORT_TIME_ZONE,
  getDailyReportDateKey,
  getNextDailyScheduleAt,
  resolveDailyGenerationPublicStatus,
} from '../lib/daily-report-schedule-policy.js';

export async function serializeDailyGenerationJob(job: Awaited<ReturnType<typeof dailyReportQueue.getJob>>) {
  if (!job) return null;
  const state = await job.getState();
  const publicFailedReason = state === 'failed' ? humanizeDailyGenerationError(job.failedReason) : null;
  const progress = state === 'failed'
    ? buildDailyGenerationProgress('failed', { message: publicFailedReason || undefined })
    : normalizeDailyGenerationProgress(job.progress);
  const result = job.returnvalue || null;
  return {
    jobId: String(job.id || ''),
    state,
    status: resolveDailyGenerationPublicStatus(state, result),
    date: job.data?.date || null,
    sourceId: job.data?.sourceId || null,
    sourceName: job.data?.sourceName || null,
    mode: job.data?.mode || null,
    preset: job.data?.preset || null,
    trigger: job.data?.trigger || 'manual',
    scheduledFor: job.data?.scheduledFor || null,
    requestedAt: job.data?.requestedAt || null,
    progress,
    stage: progress.stage,
    label: progress.label,
    percent: progress.percent,
    message: progress.message,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp || null,
    processedOn: job.processedOn || null,
    finishedOn: job.finishedOn || null,
    failedReason: publicFailedReason,
    result,
  };
}

type DailyGenerationJob = NonNullable<Awaited<ReturnType<typeof dailyReportQueue.getJob>>>;
type DailyGenerationEnqueueSuccess = {
  job: DailyGenerationJob;
  enqueued: boolean;
  skipped?: false;
};
type DailyGenerationEnqueueSkipped = {
  job: null;
  enqueued: false;
  skipped: true;
  skipReason: 'automatic_ai_disabled';
};

export function enqueueDailyGenerationJob(
  data: DailyReportJobData & { trigger: 'manual' },
): Promise<DailyGenerationEnqueueSuccess>;
export function enqueueDailyGenerationJob(
  data: DailyReportJobData,
): Promise<DailyGenerationEnqueueSuccess | DailyGenerationEnqueueSkipped>;
export async function enqueueDailyGenerationJob(
  data: DailyReportJobData,
): Promise<DailyGenerationEnqueueSuccess | DailyGenerationEnqueueSkipped> {
  const runtimePolicy = resolveDailyReportRuntimePolicy({
    trigger: data.trigger,
    globalEnabled: config.ai.enabled,
  });
  if (!runtimePolicy.run) {
    return {
      job: null,
      enqueued: false,
      skipped: true,
      skipReason: runtimePolicy.skippedReason || 'automatic_ai_disabled',
    };
  }
  const jobId = buildDailyReportJobId(data.userId, data.date, data.mode, data.preset, data.sourceId);
  const existing = await dailyReportQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (['active', 'waiting', 'delayed', 'prioritized'].includes(state)) {
      return { job: existing, enqueued: false };
    }
    await existing.remove();
  }
  const job = await dailyReportQueue.add('generate', data, {
    jobId,
    priority: data.trigger === 'manual' ? (data.mode === 'full' ? 1 : 5) : 10,
  });
  await job.updateProgress(buildDailyGenerationProgress('queued', {
    message: data.trigger === 'startup_catchup' ? '正在排队补生成缺失日报。' : '日报任务已排队。',
    detail: { trigger: data.trigger || 'manual' },
  }));
  return { job, enqueued: true };
}

export async function findActiveDailyGenerationJob(userId: string, dateKey: string, sourceId?: number | null) {
  const expectedSourceId = sourceId || null;
  const jobs = await dailyReportQueue.getJobs(['active', 'waiting', 'delayed', 'prioritized'], 0, 100, false);
  const match = jobs
    .filter((job) => job.data?.userId === userId && job.data?.date === dateKey && (job.data?.sourceId || null) === expectedSourceId)
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))[0];
  return serializeDailyGenerationJob(match || null);
}

export async function getAutomatedDailyReportUserIds(): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.userSettings.userId })
    .from(schema.userSettings)
    .innerJoin(schema.sources, and(
      eq(schema.sources.userId, schema.userSettings.userId),
      eq(schema.sources.status, 'active'),
    ))
    .where(eq(schema.userSettings.dailyReportEnabled, true))
    .groupBy(schema.userSettings.userId);
  return rows.map((row) => row.userId);
}

export async function getDedicatedDailyReportSources() {
  const rows = await db.select({
    id: schema.sources.id,
    userId: schema.sources.userId,
    name: schema.sources.name,
    config: schema.sources.config,
    status: schema.sources.status,
  })
    .from(schema.sources)
    .where(eq(schema.sources.status, 'active'));

  return rows.filter((row) => {
    const config = row.config && typeof row.config === 'object' ? row.config as Record<string, unknown> : {};
    return config.dailyReportEnabled === true;
  });
}

async function existingReportDateKeys(
  userId: string,
  reportType: string,
  dateKeys: string[],
  sourceId?: number | null,
): Promise<Set<string>> {
  if (dateKeys.length === 0) return new Set();
  const rows = await db
    .select({
      date: schema.insights.date,
      itemCount: schema.insights.itemCount,
      payload: schema.insights.payload,
    })
    .from(schema.insights)
    .where(and(
      eq(schema.insights.userId, userId),
      eq(schema.insights.type, reportType),
      inArray(schema.insights.date, dateKeys),
    ));
  const reusable = new Set<string>();
  for (const row of rows) {
    const date = String(row.date);
    const payload = row.payload && typeof row.payload === 'object'
      ? row.payload as Record<string, unknown>
      : {};
    const snapshot = payload.snapshot && typeof payload.snapshot === 'object'
      ? payload.snapshot as Record<string, unknown>
      : {};
    const candidateFunnel = snapshot.candidateFunnel && typeof snapshot.candidateFunnel === 'object'
      ? snapshot.candidateFunnel as Record<string, unknown>
      : {};
    const recoveryContext = payload.recoveryContext && typeof payload.recoveryContext === 'object'
      ? payload.recoveryContext as Record<string, unknown>
      : {};
    const qualityStatus = typeof payload.qualityStatus === 'string' ? payload.qualityStatus : null;
    const currentRecoveryContext = await loadDailyReportRecoveryContext(userId, date, sourceId);
    const savedItemCount = Number(
      recoveryContext.itemCount
      ?? snapshot.newItems
      ?? candidateFunnel.todayNew
      ?? row.itemCount
      ?? 0,
    );
    const savedReadyCount = Number(
      recoveryContext.readyCount
      ?? candidateFunnel.scoredCandidates
      ?? 0,
    );
    const savedMaterialFingerprint = typeof recoveryContext.materialFingerprint === 'string'
      ? recoveryContext.materialFingerprint
      : null;
    if (shouldReuseExistingDailyReport({
      qualityStatus,
      savedItemCount,
      currentItemCount: currentRecoveryContext.itemCount,
      savedReadyCount,
      currentReadyCount: currentRecoveryContext.readyCount,
      savedMaterialFingerprint,
      currentMaterialFingerprint: currentRecoveryContext.materialFingerprint,
    })) {
      reusable.add(date);
      continue;
    }
    logger.info({
      userId,
      reportType,
      date,
      qualityStatus,
      savedItemCount,
      currentItemCount: currentRecoveryContext.itemCount,
      savedReadyCount,
      currentReadyCount: currentRecoveryContext.readyCount,
      fingerprintChanged: Boolean(savedMaterialFingerprint)
        && savedMaterialFingerprint !== currentRecoveryContext.materialFingerprint,
    }, 'Degraded daily report has newer material and will be regenerated');
  }
  return reusable;
}

export async function enqueueScheduledDailyReports(options: {
  dateKeys: string[];
  trigger: 'cron' | 'startup_catchup';
}) {
  const dateKeys = Array.from(new Set(options.dateKeys)).sort();
  const runtimePolicy = resolveDailyReportRuntimePolicy({
    trigger: options.trigger,
    globalEnabled: config.ai.enabled,
  });
  if (!runtimePolicy.run) {
    return {
      trigger: options.trigger,
      dateKeys,
      users: 0,
      dedicatedSources: 0,
      enqueued: 0,
      existing: 0,
      skipped: true,
      skipReason: runtimePolicy.skippedReason,
    };
  }
  const [userIds, dedicatedSources] = await Promise.all([
    getAutomatedDailyReportUserIds(),
    getDedicatedDailyReportSources(),
  ]);
  let enqueued = 0;
  let existing = 0;

  for (const userId of userIds) {
    const reportType = buildDailyInsightType(null);
    const savedDates = await existingReportDateKeys(userId, reportType, dateKeys);
    for (const date of dateKeys) {
      if (savedDates.has(date)) {
        existing += 1;
        continue;
      }
      const result = await enqueueDailyGenerationJob({
        userId,
        date,
        mode: 'full',
        preset: 'full',
        trigger: options.trigger,
        scheduledFor: `${date}T06:00:00+08:00`,
        requestedAt: new Date().toISOString(),
      });
      if (result.enqueued) enqueued += 1;
      else existing += 1;
    }
  }

  for (const source of dedicatedSources) {
    const reportType = buildDailyInsightType(source.id);
    const savedDates = await existingReportDateKeys(source.userId, reportType, dateKeys, source.id);
    for (const date of dateKeys) {
      if (savedDates.has(date)) {
        existing += 1;
        continue;
      }
      const result = await enqueueDailyGenerationJob({
        userId: source.userId,
        date,
        mode: 'full',
        preset: 'full',
        sourceId: source.id,
        sourceName: source.name,
        trigger: options.trigger,
        scheduledFor: `${date}T06:00:00+08:00`,
        requestedAt: new Date().toISOString(),
      });
      if (result.enqueued) enqueued += 1;
      else existing += 1;
    }
  }

  const summary = {
    trigger: options.trigger,
    dateKeys,
    users: userIds.length,
    dedicatedSources: dedicatedSources.length,
    enqueued,
    existing,
  };
  logger.info(summary, 'Daily report schedule enqueue complete');
  return summary;
}

export async function enqueueDailyReportCatchUp(now = new Date(), days = DEFAULT_DAILY_CATCH_UP_DAYS) {
  return enqueueScheduledDailyReports({
    dateKeys: buildDailyCatchUpDateKeys(now, days),
    trigger: 'startup_catchup',
  });
}
