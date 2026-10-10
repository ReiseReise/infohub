import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isExplicitlyEnabled,
  resolveAudioRuntimePolicy,
  resolveAutomaticAiRuntimePolicy,
  resolveDailyReportRuntimePolicy,
  resolveItemTranslationRuntimePolicy,
} from './runtime-security-policy.js';

test('runtime opt-ins stay disabled unless the value is exactly true', () => {
  for (const value of [undefined, '', 'false', 'FALSE', 'TRUE', ' true', 'true ', ' true ']) {
    assert.equal(isExplicitlyEnabled(value), false, `expected ${JSON.stringify(value)} to stay disabled`);
  }
  assert.equal(isExplicitlyEnabled('true'), true);
});

test('global AI off disables every automatic AI stage', () => {
  assert.deepEqual(resolveAutomaticAiRuntimePolicy({
    globalEnabled: false,
    scoringEnabled: true,
    summaryEnabled: true,
    translationEnabled: true,
    userAutoSummaryEnabled: true,
    userAutoTranslationEnabled: true,
  }), {
    enabled: false,
    runQualityFilter: false,
    runScoring: false,
    runSummary: false,
    runTranslation: false,
  });
});

test('automatic AI stages preserve independent global and user switches', () => {
  assert.deepEqual(resolveAutomaticAiRuntimePolicy({
    globalEnabled: true,
    scoringEnabled: false,
    summaryEnabled: true,
    translationEnabled: true,
    userAutoSummaryEnabled: false,
    userAutoTranslationEnabled: true,
  }), {
    enabled: true,
    runQualityFilter: true,
    runScoring: false,
    runSummary: false,
    runTranslation: true,
  });
});

test('queued automatic translations fail closed when either runtime switch is off', () => {
  assert.deepEqual(resolveItemTranslationRuntimePolicy({
    mode: 'automatic',
    globalEnabled: false,
    translationEnabled: true,
  }), {
    callProvider: false,
    skippedReason: 'automatic_ai_disabled',
  });
  assert.deepEqual(resolveItemTranslationRuntimePolicy({
    mode: 'automatic',
    globalEnabled: true,
    translationEnabled: false,
  }), {
    callProvider: false,
    skippedReason: 'automatic_translation_disabled',
  });
});

test('manual translations remain available independently of automatic kill switches', () => {
  assert.deepEqual(resolveItemTranslationRuntimePolicy({
    mode: 'manual',
    globalEnabled: false,
    translationEnabled: false,
  }), {
    callProvider: true,
    skippedReason: null,
  });
});

test('automatic daily reports stop at both cron and startup while manual reports stay available', () => {
  assert.deepEqual(resolveDailyReportRuntimePolicy({
    trigger: 'cron',
    globalEnabled: false,
  }), {
    run: false,
    skippedReason: 'automatic_ai_disabled',
  });
  assert.deepEqual(resolveDailyReportRuntimePolicy({
    trigger: 'startup_catchup',
    globalEnabled: false,
  }), {
    run: false,
    skippedReason: 'automatic_ai_disabled',
  });
  assert.deepEqual(resolveDailyReportRuntimePolicy({
    trigger: 'manual',
    globalEnabled: false,
  }), {
    run: true,
    skippedReason: null,
  });
  assert.deepEqual(resolveDailyReportRuntimePolicy({
    globalEnabled: false,
  }), {
    run: false,
    skippedReason: 'automatic_ai_disabled',
  });
});

test('global AI on permits unattended daily reports', () => {
  for (const trigger of ['cron', 'startup_catchup'] as const) {
    assert.deepEqual(resolveDailyReportRuntimePolicy({ trigger, globalEnabled: true }), {
      run: true,
      skippedReason: null,
    });
  }
});

test('automatic audio work stops before probing while manual audio remains available', () => {
  assert.deepEqual(resolveAudioRuntimePolicy({
    mode: 'automatic',
    globalEnabled: false,
    sourceEnabled: true,
  }), {
    run: false,
    skippedReason: 'automatic_ai_disabled',
  });
  assert.deepEqual(resolveAudioRuntimePolicy({
    mode: 'automatic',
    globalEnabled: true,
    sourceEnabled: true,
  }), {
    run: true,
    skippedReason: null,
  });
  assert.deepEqual(resolveAudioRuntimePolicy({
    mode: 'manual',
    globalEnabled: false,
    sourceEnabled: false,
  }), {
    run: true,
    skippedReason: null,
  });
});
