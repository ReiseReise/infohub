export function isExplicitlyEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export type AutomaticAiRuntimePolicy = {
  enabled: boolean;
  runQualityFilter: boolean;
  runScoring: boolean;
  runSummary: boolean;
  runTranslation: boolean;
};

export function resolveAutomaticAiRuntimePolicy(input: {
  globalEnabled: boolean;
  scoringEnabled: boolean;
  summaryEnabled: boolean;
  translationEnabled: boolean;
  userAutoSummaryEnabled: boolean;
  userAutoTranslationEnabled: boolean;
}): AutomaticAiRuntimePolicy {
  if (!input.globalEnabled) {
    return {
      enabled: false,
      runQualityFilter: false,
      runScoring: false,
      runSummary: false,
      runTranslation: false,
    };
  }

  return {
    enabled: true,
    runQualityFilter: true,
    runScoring: input.scoringEnabled,
    runSummary: input.summaryEnabled && input.userAutoSummaryEnabled,
    runTranslation: input.translationEnabled && input.userAutoTranslationEnabled,
  };
}

export type ItemTranslationRuntimePolicy = {
  callProvider: boolean;
  skippedReason: 'automatic_ai_disabled' | 'automatic_translation_disabled' | null;
};

export function resolveItemTranslationRuntimePolicy(input: {
  mode: 'manual' | 'automatic';
  globalEnabled: boolean;
  translationEnabled: boolean;
}): ItemTranslationRuntimePolicy {
  if (input.mode === 'manual') {
    return { callProvider: true, skippedReason: null };
  }
  if (!input.globalEnabled) {
    return { callProvider: false, skippedReason: 'automatic_ai_disabled' };
  }
  if (!input.translationEnabled) {
    return { callProvider: false, skippedReason: 'automatic_translation_disabled' };
  }
  return { callProvider: true, skippedReason: null };
}

export type DailyReportRuntimePolicy = {
  run: boolean;
  skippedReason: 'automatic_ai_disabled' | null;
};

export function resolveDailyReportRuntimePolicy(input: {
  trigger?: 'manual' | 'cron' | 'startup_catchup';
  globalEnabled: boolean;
}): DailyReportRuntimePolicy {
  if (input.trigger === 'manual' || input.globalEnabled) {
    return { run: true, skippedReason: null };
  }
  return { run: false, skippedReason: 'automatic_ai_disabled' };
}

export type AudioRuntimePolicy = {
  run: boolean;
  skippedReason: 'automatic_ai_disabled' | 'source_disabled' | null;
};

export function resolveAudioRuntimePolicy(input: {
  mode: 'manual' | 'automatic';
  globalEnabled: boolean;
  sourceEnabled?: boolean | null;
}): AudioRuntimePolicy {
  if (input.mode === 'manual') {
    return { run: true, skippedReason: null };
  }
  if (!input.globalEnabled) {
    return { run: false, skippedReason: 'automatic_ai_disabled' };
  }
  if (!input.sourceEnabled) {
    return { run: false, skippedReason: 'source_disabled' };
  }
  return { run: true, skippedReason: null };
}
