import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { scoreItemsDetailed } from '../processors/ai-scorer.js';
import { summarizeItemsDetailed } from '../processors/ai-summarizer.js';
import { applyRulesAndPriority } from '../processors/priority.js';
import { isDailyReportHotSignal, type DailyReportCandidateSampleItem } from './daily-report-candidate-sampling.js';
import type { DailyReportCandidateInput } from './daily-report-workflow.js';
import { buildDailyReportTranslationJob, waitForDailyReportTranslation } from './daily-report-candidate-translation-policy.js';

export async function translateDailyReportCandidate(userId: string, candidate: DailyReportCandidateInput, deadlineAt = Date.now() + 60_000) {
  const { enqueueItemTranslationJob } = await import('../scheduler/item-translation-jobs.js');
  const { job } = await enqueueItemTranslationJob(buildDailyReportTranslationJob(userId, candidate.id));
  const state = await waitForDailyReportTranslation(job, { deadlineAt });
  const rows = await db
    .select({
      aiSummary: schema.items.aiSummary,
      aiTranslation: schema.items.aiTranslation,
      language: schema.items.language,
      translationStatus: schema.items.translationStatus,
      translationReason: schema.items.translationReason,
    })
    .from(schema.items)
    .where(and(eq(schema.items.id, candidate.id), eq(schema.items.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (state === 'pending' && row.translationStatus !== 'ready') {
    return { ...row, translationStatus: 'pending', translationReason: '中文化任务仍在排队或处理中，完成后可重新生成日报。' };
  }
  return row;
}

export async function repairDailyReportCandidateReadiness(userId: string, candidates: DailyReportCandidateSampleItem[]) {
  const repairIds = candidates
    .filter((item) => (
      isDailyReportHotSignal(item)
      || (item.aiScore != null && item.aiScore >= 70)
      || ['raw', 'scored', 'summary_failed', 'score_failed'].includes(item.processingStatus || '')
    ))
    .filter((item) => (
      ['raw', 'score_failed', 'scored', 'summary_failed'].includes(item.processingStatus || '')
      || item.summaryStatus === 'failed'
      || item.summaryStatus === 'pending'
      || item.priorityScore == null
    ))
    .slice(0, 12)
    .map((item) => item.id);

  if (repairIds.length === 0) {
    return { scoring: 0, summarized: 0, priority: 0, itemIds: [] as string[] };
  }

  const scoring = await scoreItemsDetailed(userId, repairIds.length, { itemIds: repairIds, bypassQualityGate: true });
  const summarization = await summarizeItemsDetailed(userId, repairIds.length, { itemIds: repairIds });
  let priority = 0;
  for (const itemId of repairIds) {
    try {
      await applyRulesAndPriority(itemId, userId);
      priority += 1;
    } catch (error) {
      logger.warn({ itemId, error: (error as Error).message }, 'Daily report priority catch-up failed');
    }
  }

  logger.info({
    userId,
    items: repairIds.length,
    scoring: scoring.processed,
    summarized: summarization.processed,
    scoringErrors: scoring.errors,
    summaryErrors: summarization.errors,
    priority,
  }, 'Daily report candidate readiness catch-up complete');

  return {
    scoring: scoring.processed,
    summarized: summarization.processed,
    priority,
    itemIds: repairIds,
  };
}
