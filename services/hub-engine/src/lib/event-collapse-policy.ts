type EnvLike = Record<string, string | undefined>;

export function eventCollapseFeatureEnabled(env: EnvLike = process.env): boolean {
  const value = String(env.INFOHUB_EVENT_COLLAPSE_ENABLED ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'off', 'disabled'].includes(value);
}

export function resolveEventCollapsePreference(input: {
  enabled: boolean;
  requested?: string | boolean | null;
  view?: string | null;
}): string | boolean {
  if (!input.enabled) return false;
  if (input.requested !== undefined && input.requested !== null) return input.requested;
  return input.view === 'recommended';
}
