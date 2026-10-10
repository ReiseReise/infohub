export const AI_RUNTIME_CIRCUIT_WINDOW_MS = 10 * 60 * 1000;
export const AI_RUNTIME_CIRCUIT_COOLDOWN_MS = 10 * 60 * 1000;
export const AI_RUNTIME_CIRCUIT_FAILURE_THRESHOLD = 3;
export const AI_TARGET_QUALITY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type AiRuntimeConfigIdentity = {
  provider?: string | null;
  model?: string | null;
  modelConfigId?: string | null;
};

export type AiRuntimeCircuitEvent = {
  status?: string | null;
  provider?: string | null;
  modelName?: string | null;
  modelConfigId?: string | null;
  targetId?: string | null;
  errorMessage?: string | null;
  createdAt?: Date | string | null;
};

export type AiRuntimeCircuitDecision = {
  shouldBypass: boolean;
  retryableFailureCount: number;
  lastFailureAt: string | null;
  openUntil: string | null;
  reason: string | null;
};

export type AiTargetQualityCooldownDecision = {
  shouldBypass: boolean;
  lastFailureAt: string | null;
  retryAfter: string | null;
  reason: string | null;
};

function normalizeIdentityPart(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

function eventMatchesConfig(event: AiRuntimeCircuitEvent, config: AiRuntimeConfigIdentity): boolean {
  const configId = normalizeIdentityPart(config.modelConfigId);
  const eventConfigId = normalizeIdentityPart(event.modelConfigId);
  if (configId && eventConfigId) return configId === eventConfigId;

  const provider = normalizeIdentityPart(config.provider);
  const model = normalizeIdentityPart(config.model);
  return Boolean(provider && model)
    && normalizeIdentityPart(event.provider) === provider
    && normalizeIdentityPart(event.modelName) === model;
}

function eventTime(event: AiRuntimeCircuitEvent): number | null {
  const value = event.createdAt instanceof Date ? event.createdAt : new Date(String(event.createdAt || ''));
  const timestamp = value.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isAiOutputQualityFailure(error?: string | null): boolean {
  const message = String(error || '').toLowerCase();
  if (!message || isRetryableAiRuntimeFailure(message)) return false;
  return /(?:translation_quality_incomplete|translation_truncated_or_empty|summary_quality_incomplete|译文.*(?:过短|缺少|丢失|不完整|没有完整保留)|摘要.*(?:过短|截断|不完整|没有完整))/.test(message);
}

export function isRetryableAiRuntimeFailure(error?: string | null): boolean {
  const message = String(error || '').toLowerCase();
  if (!message) return false;
  return /(?:\b5\d\d\b|\b408\b|\b429\b|timeout|timed out|abort|fetch failed|econn|network|socket|rate limit|too many requests|connection reset|service unavailable|temporarily unavailable)/.test(message);
}

export function resolveAiRuntimeCircuit(
  events: AiRuntimeCircuitEvent[],
  config: AiRuntimeConfigIdentity,
  options: {
    now?: Date;
    windowMs?: number;
    cooldownMs?: number;
    failureThreshold?: number;
  } = {},
): AiRuntimeCircuitDecision {
  const now = options.now || new Date();
  const nowMs = now.getTime();
  const windowMs = options.windowMs ?? AI_RUNTIME_CIRCUIT_WINDOW_MS;
  const cooldownMs = options.cooldownMs ?? AI_RUNTIME_CIRCUIT_COOLDOWN_MS;
  const failureThreshold = options.failureThreshold ?? AI_RUNTIME_CIRCUIT_FAILURE_THRESHOLD;
  const windowStart = nowMs - windowMs;

  const relevant = events
    .map((event) => ({ event, timestamp: eventTime(event) }))
    .filter((entry): entry is { event: AiRuntimeCircuitEvent; timestamp: number } => (
      entry.timestamp != null
      && entry.timestamp >= windowStart
      && entry.timestamp <= nowMs
      && eventMatchesConfig(entry.event, config)
    ))
    .sort((left, right) => right.timestamp - left.timestamp);

  const latestSuccessAt = relevant.find((entry) => entry.event.status === 'success')?.timestamp ?? null;
  const failures = relevant.filter((entry) => (
    entry.event.status === 'error'
    && isRetryableAiRuntimeFailure(entry.event.errorMessage)
    && (latestSuccessAt == null || entry.timestamp > latestSuccessAt)
  ));
  const lastFailureAtMs = failures[0]?.timestamp ?? null;
  const openUntilMs = lastFailureAtMs == null ? null : lastFailureAtMs + cooldownMs;

  if (failures.length < failureThreshold || openUntilMs == null || openUntilMs <= nowMs) {
    return {
      shouldBypass: false,
      retryableFailureCount: failures.length,
      lastFailureAt: lastFailureAtMs == null ? null : new Date(lastFailureAtMs).toISOString(),
      openUntil: openUntilMs == null ? null : new Date(openUntilMs).toISOString(),
      reason: null,
    };
  }

  return {
    shouldBypass: true,
    retryableFailureCount: failures.length,
    lastFailureAt: new Date(lastFailureAtMs).toISOString(),
    openUntil: new Date(openUntilMs).toISOString(),
    reason: `automatic_model_circuit_open:${failures.length}_retryable_failures`,
  };
}

export function resolveAutomaticAiRoute(input: {
  automatic?: boolean;
  circuit: AiRuntimeCircuitDecision;
  hasFallback: boolean;
}): 'primary' | 'fallback' | 'defer' {
  if (!input.automatic || !input.circuit.shouldBypass) return 'primary';
  return input.hasFallback ? 'fallback' : 'defer';
}

export function resolveAiTargetQualityCooldown(
  events: AiRuntimeCircuitEvent[],
  config: AiRuntimeConfigIdentity,
  targetId: string,
  options: { now?: Date; cooldownMs?: number } = {},
): AiTargetQualityCooldownDecision {
  const now = options.now || new Date();
  const nowMs = now.getTime();
  const cooldownMs = options.cooldownMs ?? AI_TARGET_QUALITY_COOLDOWN_MS;
  const latestFailure = events
    .map((event) => ({ event, timestamp: eventTime(event) }))
    .filter((entry): entry is { event: AiRuntimeCircuitEvent; timestamp: number } => (
      entry.timestamp != null
      && entry.timestamp <= nowMs
      && entry.event.status === 'error'
      && String(entry.event.targetId || '') === targetId
      && eventMatchesConfig(entry.event, config)
      && isAiOutputQualityFailure(entry.event.errorMessage)
    ))
    .sort((left, right) => right.timestamp - left.timestamp)[0];

  if (!latestFailure) {
    return { shouldBypass: false, lastFailureAt: null, retryAfter: null, reason: null };
  }

  const retryAfterMs = latestFailure.timestamp + cooldownMs;
  if (retryAfterMs <= nowMs) {
    return {
      shouldBypass: false,
      lastFailureAt: new Date(latestFailure.timestamp).toISOString(),
      retryAfter: new Date(retryAfterMs).toISOString(),
      reason: null,
    };
  }

  return {
    shouldBypass: true,
    lastFailureAt: new Date(latestFailure.timestamp).toISOString(),
    retryAfter: new Date(retryAfterMs).toISOString(),
    reason: 'automatic_target_quality_cooldown',
  };
}
