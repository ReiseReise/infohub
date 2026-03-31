import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

export interface StartAudioTaskInput {
  audioUrl: string;
  title: string;
  itemId: string;
  userId: string;
}

export interface StartAudioTaskResult {
  taskId: string;
  status: string;
  message?: string;
}

export interface AudioUsageBudgetSnapshot {
  userId: string;
  monthStart: string;
  monthEnd: string;
  totalCalls: number;
  audioSeconds: number;
  estimatedCostMonth: number;
  asrEstimatedCostMonth: number;
  llmEstimatedCostMonth: number;
}

export interface AudioProbeSnapshot {
  sourceUrl: string;
  sourceKind: string;
  probeStatus: 'ready' | 'failed' | string;
  resolveStrategy: string;
  resolvedAudioUrl?: string | null;
  title?: string | null;
  duration?: number | null;
  contentLength?: number | null;
  mimeType?: string | null;
  reason?: string | null;
}

export interface DeleteAudioTaskStorageResult {
  deleted: boolean;
  reason?: string | null;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export async function startAudioTaskForItem(input: StartAudioTaskInput): Promise<StartAudioTaskResult> {
  const serviceUrl = normalizeBaseUrl(config.audio.serviceUrl);
  const callbackBaseUrl = normalizeBaseUrl(config.audio.callbackBaseUrl);
  const endpoint = `${serviceUrl}/api/v1/tasks/from-url`;
  const callbackUrl = `${callbackBaseUrl}/api/hooks/audio-callback`;

  const payload = {
    audio_url: input.audioUrl,
    title: input.title,
    article_id: input.itemId,
    user_id: input.userId,
    webhook_url: callbackUrl,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.audio.timeoutMs);

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': config.audio.internalApiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let body: Record<string, unknown> = {};
    const parsed = await resp.json().catch(() => null);
    if (parsed && typeof parsed === 'object') {
      body = parsed as Record<string, unknown>;
    }
    if (!resp.ok) {
      const detail =
        (typeof body.detail === 'string' && body.detail) ||
        (typeof body.error === 'string' && body.error) ||
        `HTTP ${resp.status}`;
      throw new Error(detail);
    }

    const taskId = typeof body.job_id === 'string' ? body.job_id : '';
    if (!taskId) {
      throw new Error('audio-service 响应缺少 job_id');
    }

    return {
      taskId,
      status: typeof body.status === 'string' ? body.status : 'queued',
      message: typeof body.message === 'string' ? body.message : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { endpoint, itemId: input.itemId, userId: input.userId, error: message },
      'Failed to start audio task from hub-engine',
    );
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getAudioUsageBudgetSnapshot(userId: string): Promise<AudioUsageBudgetSnapshot | null> {
  const serviceUrl = normalizeBaseUrl(config.audio.serviceUrl);
  const endpoint = `${serviceUrl}/api/internal/usage/summary?user_id=${encodeURIComponent(userId)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.audio.timeoutMs, 10000));

  try {
    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'X-Internal-API-Key': config.audio.internalApiKey,
      },
      signal: controller.signal,
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(detail || `HTTP ${resp.status}`);
    }

    const payload = await resp.json().catch(() => null) as { data?: AudioUsageBudgetSnapshot | null } | null;
    return payload?.data || null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ endpoint, userId, error: message }, 'Failed to load audio usage budget snapshot');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeAudioUrl(audioUrl: string, sourceType?: string | null): Promise<AudioProbeSnapshot | null> {
  const serviceUrl = normalizeBaseUrl(config.audio.serviceUrl);
  const endpoint = `${serviceUrl}/api/internal/probe`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.audio.timeoutMs, 15000));

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': config.audio.internalApiKey,
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        source_type: sourceType || undefined,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(detail || `HTTP ${resp.status}`);
    }

    const payload = await resp.json().catch(() => null) as { data?: AudioProbeSnapshot | null } | null;
    return payload?.data || null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ endpoint, audioUrl, error: message }, 'Failed to probe audio URL');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function deleteAudioTaskStorage(taskId: string): Promise<DeleteAudioTaskStorageResult> {
  const serviceUrl = normalizeBaseUrl(config.audio.serviceUrl);
  const endpoint = `${serviceUrl}/api/internal/storage/delete-task-audio`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.audio.timeoutMs, 10000));

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': config.audio.internalApiKey,
      },
      body: JSON.stringify({ task_id: taskId }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(detail || `HTTP ${resp.status}`);
    }

    const payload = await resp.json().catch(() => null) as { data?: DeleteAudioTaskStorageResult | null } | null;
    return payload?.data || { deleted: false, reason: 'invalid_response' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ endpoint, taskId, error: message }, 'Failed to delete audio task storage');
    return { deleted: false, reason: message };
  } finally {
    clearTimeout(timeout);
  }
}
