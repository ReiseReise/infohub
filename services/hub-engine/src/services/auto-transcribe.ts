import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { getAudioUsageBudgetSnapshot, probeAudioUrl, startAudioTaskForItem } from './audio.js';

export interface AutoTranscribeCandidate {
  itemId: string;
  userId: string;
  sourceId: number;
  sourceName: string;
  sourceType: string;
  title: string;
  url: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  audioDuration?: number | null;
  sourceAutoTranscribe?: boolean | null;
}

type QuotaSnapshot = {
  autoTranscribeEnabled: boolean | null;
  maxAutoPerDay: number | null;
  maxEpisodeMinutes: number | null;
  monthlyBudgetLimit: number | null;
  autoCountToday: number | null;
  autoCountResetAt: Date | null;
};

function isAudioCandidate(candidate: AutoTranscribeCandidate): boolean {
  return candidate.mediaType === 'audio' || candidate.sourceType === 'podcast';
}

function resolveAudioUrl(candidate: AutoTranscribeCandidate): string | null {
  const value = candidate.mediaUrl || candidate.url;
  if (!value || !/^https?:\/\//i.test(value)) return null;
  return value;
}

function nextAutoResetAt(now: Date): Date {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next;
}

async function getQuotaSnapshot(userId: string): Promise<QuotaSnapshot | null> {
  const rows = await db
    .select({
      autoTranscribeEnabled: schema.userQuotas.autoTranscribeEnabled,
      maxAutoPerDay: schema.userQuotas.maxAutoPerDay,
      maxEpisodeMinutes: schema.userQuotas.maxEpisodeMinutes,
      monthlyBudgetLimit: schema.userQuotas.monthlyBudgetLimit,
      autoCountToday: schema.userQuotas.autoCountToday,
      autoCountResetAt: schema.userQuotas.autoCountResetAt,
    })
    .from(schema.userQuotas)
    .where(eq(schema.userQuotas.userId, userId))
    .limit(1);

  if (rows.length === 0) return null;

  const current = rows[0];
  const now = new Date();
  const resetAt = current.autoCountResetAt ? new Date(current.autoCountResetAt) : null;

  if (!resetAt || Number.isNaN(resetAt.getTime()) || resetAt <= now) {
    const refreshed = await db
      .update(schema.userQuotas)
      .set({
        autoCountToday: 0,
        autoCountResetAt: nextAutoResetAt(now),
      })
      .where(eq(schema.userQuotas.userId, userId))
      .returning({
        autoTranscribeEnabled: schema.userQuotas.autoTranscribeEnabled,
        maxAutoPerDay: schema.userQuotas.maxAutoPerDay,
        maxEpisodeMinutes: schema.userQuotas.maxEpisodeMinutes,
        monthlyBudgetLimit: schema.userQuotas.monthlyBudgetLimit,
        autoCountToday: schema.userQuotas.autoCountToday,
        autoCountResetAt: schema.userQuotas.autoCountResetAt,
      });

    return refreshed[0] || {
      ...current,
      autoCountToday: 0,
      autoCountResetAt: nextAutoResetAt(now),
    };
  }

  return current;
}

function normalizePositiveNumber(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function estimateWorstCaseAudioCost(audioSeconds: number | null | undefined): number | null {
  if (typeof audioSeconds !== 'number' || !Number.isFinite(audioSeconds) || audioSeconds <= 0) return null;
  return Number(((audioSeconds / 3600) * 0.6).toFixed(4));
}

async function markSkipped(itemId: string, reason: string) {
  await db
    .update(schema.items)
    .set({
      audioStatus: 'skipped',
      audioStatusReason: reason,
      audioTaskId: null,
    })
    .where(eq(schema.items.id, itemId));
  logger.info({ itemId, reason }, 'Auto transcribe skipped');
}

async function setAudioState(
  itemId: string,
  status: string,
  reason: string,
  patch?: Partial<typeof schema.items.$inferInsert>,
) {
  await db
    .update(schema.items)
    .set({
      audioStatus: status,
      audioStatusReason: reason,
      ...(patch || {}),
    })
    .where(eq(schema.items.id, itemId));
}

async function incrementAutoCount(userId: string, quota: QuotaSnapshot): Promise<void> {
  await db
    .update(schema.userQuotas)
    .set({
      autoCountToday: (quota.autoCountToday || 0) + 1,
      autoCountResetAt: quota.autoCountResetAt || nextAutoResetAt(new Date()),
    })
    .where(eq(schema.userQuotas.userId, userId));
}

export async function maybeAutoTranscribeItem(candidate: AutoTranscribeCandidate): Promise<{ triggered: boolean; reason: string }> {
  if (!candidate.sourceAutoTranscribe) {
    return { triggered: false, reason: 'source_disabled' };
  }

  if (!isAudioCandidate(candidate)) {
    return { triggered: false, reason: 'not_audio' };
  }

  const audioUrl = resolveAudioUrl(candidate);
  if (!audioUrl) {
    logger.warn({ itemId: candidate.itemId, sourceId: candidate.sourceId }, 'Auto transcribe skipped: invalid audio URL');
    return { triggered: false, reason: 'invalid_url' };
  }

  const quota = await getQuotaSnapshot(candidate.userId);
  if (!quota) {
    logger.warn({ itemId: candidate.itemId, userId: candidate.userId }, 'Auto transcribe skipped: missing quota row');
    return { triggered: false, reason: 'missing_quota' };
  }

  if (!quota.autoTranscribeEnabled) {
    await markSkipped(candidate.itemId, '自动转写已关闭');
    return { triggered: false, reason: 'user_disabled' };
  }

  const maxEpisodeMinutes = normalizePositiveNumber(quota.maxEpisodeMinutes);
  const monthlyBudgetLimit = normalizePositiveNumber(quota.monthlyBudgetLimit);
  const requiresDurationProbe = (!candidate.audioDuration || candidate.audioDuration <= 0) && Boolean(maxEpisodeMinutes || monthlyBudgetLimit);

  if (requiresDurationProbe) {
    const probed = await probeAudioUrl(audioUrl, candidate.sourceType);
    if (probed?.duration && Number.isFinite(probed.duration) && probed.duration > 0) {
      candidate.audioDuration = Math.round(probed.duration);
      await db
        .update(schema.items)
        .set({
          audioDuration: candidate.audioDuration,
          audioStatusReason: `时长已预探测（${Math.round(probed.duration)} 秒）`,
        })
        .where(eq(schema.items.id, candidate.itemId));
      logger.info(
        { itemId: candidate.itemId, sourceId: candidate.sourceId, duration: candidate.audioDuration, strategy: probed.resolveStrategy },
        'Auto transcribe probe resolved duration',
      );
    } else {
      const reason = probed?.reason || '无法在自动转写前探测音频时长';
      await markSkipped(candidate.itemId, `自动转写前置预判失败：${reason}`);
      return { triggered: false, reason: probed?.probeStatus === 'failed' ? 'probe_failed' : 'duration_unknown' };
    }
  } else if (!candidate.audioDuration || candidate.audioDuration <= 0) {
    await setAudioState(candidate.itemId, 'pending', '未获取到时长，但当前未配置时长/预算限制，继续放行');
  }

  if (
    maxEpisodeMinutes
    && typeof candidate.audioDuration === 'number'
    && candidate.audioDuration > maxEpisodeMinutes * 60
  ) {
    logger.info(
      {
        itemId: candidate.itemId,
        sourceId: candidate.sourceId,
        audioDuration: candidate.audioDuration,
        maxEpisodeMinutes,
      },
      'Auto transcribe skipped: episode duration exceeds limit',
    );
    await markSkipped(candidate.itemId, `单集时长超过自动转写上限（${maxEpisodeMinutes} 分钟）`);
    return { triggered: false, reason: 'episode_too_long' };
  }

  const maxAutoPerDay = typeof quota.maxAutoPerDay === 'number' ? quota.maxAutoPerDay : 3;
  const autoCountToday = quota.autoCountToday || 0;
  if (maxAutoPerDay <= 0 || autoCountToday >= maxAutoPerDay) {
    logger.info(
      { itemId: candidate.itemId, sourceId: candidate.sourceId, autoCountToday, maxAutoPerDay },
      'Auto transcribe skipped: daily limit reached',
    );
    await markSkipped(candidate.itemId, `今日自动转写已达上限（${maxAutoPerDay}）`);
    return { triggered: false, reason: 'daily_limit' };
  }

  if (monthlyBudgetLimit) {
    const usage = await getAudioUsageBudgetSnapshot(candidate.userId);
    const currentCost = usage?.estimatedCostMonth || 0;
    const projectedCost = currentCost + (estimateWorstCaseAudioCost(candidate.audioDuration) || 0);
    if (currentCost >= monthlyBudgetLimit) {
      logger.info(
        {
          itemId: candidate.itemId,
          sourceId: candidate.sourceId,
          currentCost,
          monthlyBudgetLimit,
        },
        'Auto transcribe skipped: monthly budget already reached',
      );
      await markSkipped(candidate.itemId, `当月音频预算已达上限（¥${monthlyBudgetLimit.toFixed(2)}）`);
      return { triggered: false, reason: 'monthly_budget_reached' };
    }
    if (candidate.audioDuration && projectedCost > monthlyBudgetLimit) {
      logger.info(
        {
          itemId: candidate.itemId,
          sourceId: candidate.sourceId,
          currentCost,
          projectedCost,
          monthlyBudgetLimit,
          audioDuration: candidate.audioDuration,
        },
        'Auto transcribe skipped: projected monthly budget would be exceeded',
      );
      await markSkipped(candidate.itemId, `预计会超出当月预算（预算 ¥${monthlyBudgetLimit.toFixed(2)}）`);
      return { triggered: false, reason: 'monthly_budget_projected' };
    }
  }

  await db
    .update(schema.items)
    .set({
      audioStatus: 'pending',
      audioStatusReason: '通过自动转写判定，准备创建任务',
    })
    .where(eq(schema.items.id, candidate.itemId));

  try {
    const result = await startAudioTaskForItem({
      audioUrl,
      title: candidate.title,
      itemId: candidate.itemId,
      userId: candidate.userId,
    });
    const nextStatus = result.status === 'queued' ? 'pending' : 'processing';

    await db
      .update(schema.items)
      .set({
        audioStatus: nextStatus,
        audioStatusReason: result.message || (nextStatus === 'pending' ? '任务已入队，等待音频服务处理' : '音频任务已启动'),
        audioTaskId: result.taskId,
      })
      .where(eq(schema.items.id, candidate.itemId));

    await incrementAutoCount(candidate.userId, quota);

    logger.info(
      {
        itemId: candidate.itemId,
        taskId: result.taskId,
        sourceId: candidate.sourceId,
        sourceName: candidate.sourceName,
      },
      'Auto transcribe started',
    );

    return { triggered: true, reason: 'started' };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);

    await db
      .update(schema.items)
      .set({
        audioStatus: 'error',
        audioStatusReason: detail,
      })
      .where(eq(schema.items.id, candidate.itemId));

    logger.error(
      {
        itemId: candidate.itemId,
        sourceId: candidate.sourceId,
        sourceName: candidate.sourceName,
        error: detail,
      },
      'Auto transcribe failed to start',
    );

    return { triggered: false, reason: 'start_failed' };
  }
}
