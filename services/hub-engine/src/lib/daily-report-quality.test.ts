import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDailyReportPublicationNavigation,
  buildDailyReportQuality,
  describeDailyReportQualityReason,
  resolveDailyReportDeliveryDecision,
  resolvePersistedDailyReportQuality,
} from './daily-report-quality.js';

test('marks a full report only when every required stage and final output passed directly', () => {
  const quality = buildDailyReportQuality({
    generationMode: 'full',
    finalMeta: { status: 'ai', deliveryMode: 'model' },
    stageMetas: [
      { key: 'cleaning', meta: { status: 'ai' } },
      { key: 'decision', meta: { status: 'ai' } },
      { key: 'research', meta: { status: 'ai' } },
      { key: 'reading', meta: { status: 'ai' } },
    ],
  });

  assert.deepEqual(quality, { status: 'full', reasons: [], warnings: [] });
});

test('downgrades a repaired final while keeping repaired module stages observable', () => {
  const quality = buildDailyReportQuality({
    generationMode: 'full',
    finalMeta: { status: 'ai', deliveryMode: 'model', repaired: true, repairReason: 'too_short' },
    stageMetas: [
      { key: 'cleaning', meta: { status: 'ai' } },
      { key: 'decision', meta: { status: 'ai', repaired: true, repairReason: 'missing_sections' } },
      { key: 'research', meta: { status: 'ai' } },
      { key: 'reading', meta: { status: 'ai' } },
    ],
  });

  assert.equal(quality.status, 'degraded');
  assert.deepEqual(quality.reasons, ['final_repaired:too_short']);
  assert.deepEqual(quality.warnings, [
    'stage_repaired:decision:missing_sections',
  ]);
});

test('never labels a deterministic final delivery as a full report', () => {
  const quality = buildDailyReportQuality({
    generationMode: 'full',
    finalMeta: { status: 'ai', deliveryMode: 'deterministic' },
    stageMetas: [
      { key: 'cleaning', meta: { status: 'ai' } },
      { key: 'decision', meta: { status: 'ai' } },
      { key: 'research', meta: { status: 'ai' } },
      { key: 'reading', meta: { status: 'ai' } },
    ],
  });

  assert.equal(quality.status, 'degraded');
  assert.deepEqual(quality.reasons, ['final_deterministic_fallback']);
  assert.match(describeDailyReportQualityReason(quality.reasons[0]), /草稿已保留.*未发布为正式日报/);
});

test('allows a two-pass model composition when the merged final passes directly', () => {
  const quality = buildDailyReportQuality({
    generationMode: 'full',
    finalMeta: { status: 'ai', deliveryMode: 'model_composed' },
    stageMetas: [
      { key: 'cleaning', meta: { status: 'ai' } },
      { key: 'decision', meta: { status: 'ai' } },
      { key: 'research', meta: { status: 'ai' } },
      { key: 'reading', meta: { status: 'ai' } },
    ],
  });

  assert.deepEqual(quality, { status: 'full', reasons: [], warnings: [] });
});

test('marks fast and fallback reports as degraded while retaining repair warnings', () => {
  const quality = buildDailyReportQuality({
    generationMode: 'fast',
    finalMeta: { status: 'ai', deliveryMode: 'model', repaired: true, repairReason: 'too_short' },
    stageMetas: [
      { key: 'cleaning', meta: { status: 'fallback', error: 'fast_generation_mode' } },
      { key: 'decision', meta: null },
    ],
  });

  assert.equal(quality.status, 'degraded');
  assert.deepEqual(quality.reasons, [
    'generation_mode_fast',
    'final_repaired:too_short',
    'stage_fallback:cleaning:fast_generation_mode',
    'stage_missing:decision',
  ]);
  assert.deepEqual(quality.warnings, []);
  assert.match(describeDailyReportQualityReason(quality.reasons[1]), /质量门禁/);
});

test('marks empty candidate diagnostics as degraded', () => {
  const quality = buildDailyReportQuality({
    generationMode: 'full',
    emptyCandidates: true,
    finalMeta: { status: 'fallback', error: 'empty_daily_report_diagnosis' },
    stageMetas: [],
  });

  assert.equal(quality.status, 'degraded');
  assert.ok(quality.reasons.includes('empty_candidates'));
  assert.ok(quality.reasons.includes('final_fallback:empty_daily_report_diagnosis'));
  assert.deepEqual(quality.warnings, []);
});

test('marks a report with too little editorial evidence as degraded', () => {
  const quality = buildDailyReportQuality({
    generationMode: 'full',
    evidenceCount: 1,
    minimumEvidenceCount: 3,
    finalMeta: { status: 'ai', deliveryMode: 'model' },
    stageMetas: [
      { key: 'cleaning', meta: { status: 'ai' } },
      { key: 'decision', meta: { status: 'ai' } },
      { key: 'research', meta: { status: 'ai' } },
      { key: 'reading', meta: { status: 'ai' } },
    ],
  });

  assert.equal(quality.status, 'degraded');
  assert.deepEqual(quality.reasons, ['insufficient_evidence:1/3']);
  assert.match(describeDailyReportQualityReason(quality.reasons[0]), /1 篇.*至少需要 3 篇/);
});

test('does not expose internal final-agent errors in user-facing quality labels', () => {
  const label = describeDailyReportQualityReason(
    'final_fallback:invalid_daily_scene_output:too_short;_repair_failed:too_short',
  );
  assert.equal(label, '最终融合 Agent 未通过质量门禁，当前使用保底输出。');
  assert.doesNotMatch(label, /invalid_daily_scene_output|repair_failed|too_short/);
});

test('recomputes stale persisted full status when the final was actually deterministic', () => {
  const quality = resolvePersistedDailyReportQuality({
    generationMode: 'full',
    qualityStatus: 'full',
    qualityReasons: [],
    final: {
      meta: {
        status: 'ai',
        deliveryMode: 'deterministic',
        repaired: true,
        repairReason: 'too_short; deterministic_fallback',
      },
    },
  });

  assert.equal(quality.status, 'degraded');
  assert.deepEqual(quality.reasons, ['final_deterministic_fallback']);
});

test('allows external delivery only for a recomputed full report', () => {
  const decision = resolveDailyReportDeliveryDecision({
    generationMode: 'full',
    qualityStatus: 'full',
    final: { meta: { status: 'ai', deliveryMode: 'model' } },
  });

  assert.equal(decision.quality.status, 'full');
  assert.equal(decision.allowExternalPush, true);
  assert.equal(decision.allowAutomaticFormalExport, true);
});

test('denies a stored full report when final metadata is missing', () => {
  const decision = resolveDailyReportDeliveryDecision({
    generationMode: 'full',
    qualityStatus: 'full',
  });

  assert.equal(decision.quality.status, 'degraded');
  assert.deepEqual(decision.quality.reasons, ['final_missing']);
  assert.equal(decision.allowExternalPush, false);
  assert.equal(decision.allowAutomaticFormalExport, false);
});

test('denies a stored full report when model delivery mode is missing', () => {
  const decision = resolveDailyReportDeliveryDecision({
    generationMode: 'full',
    qualityStatus: 'full',
    final: { meta: { status: 'ai' } },
  });

  assert.equal(decision.quality.status, 'degraded');
  assert.deepEqual(decision.quality.reasons, ['final_delivery_mode_unverified']);
  assert.equal(decision.allowExternalPush, false);
  assert.equal(decision.allowAutomaticFormalExport, false);
});

test('denies push and automatic formal export for a degraded report', () => {
  const decision = resolveDailyReportDeliveryDecision({
    generationMode: 'full',
    qualityStatus: 'degraded',
    qualityReasons: ['final_fallback:model_error'],
    final: { meta: { status: 'fallback', error: 'model_error' } },
  });

  assert.equal(decision.quality.status, 'degraded');
  assert.equal(decision.allowExternalPush, false);
  assert.equal(decision.allowAutomaticFormalExport, false);
  assert.match(decision.message, /未推送.*未自动正式导出/);
});

test('deterministically denies a forged persisted full label with deterministic final output', () => {
  const payload = {
    generationMode: 'full',
    qualityStatus: 'full' as const,
    final: { meta: { status: 'ai', deliveryMode: 'deterministic' } },
  };

  assert.deepEqual(
    resolveDailyReportDeliveryDecision(payload),
    resolveDailyReportDeliveryDecision(payload),
  );
  assert.equal(resolveDailyReportDeliveryDecision(payload).quality.status, 'degraded');
  assert.equal(resolveDailyReportDeliveryDecision(payload).allowExternalPush, false);
});

test('keeps run navigation separate from publishable report navigation', () => {
  const navigation = buildDailyReportPublicationNavigation([
    {
      date: '2026-07-17',
      payload: {
        generationMode: 'full',
        qualityStatus: 'degraded',
        qualityReasons: ['final_deterministic_fallback'],
        final: { meta: { status: 'ai', deliveryMode: 'deterministic' } },
      },
    },
    {
      date: '2026-07-16',
      payload: {
        generationMode: 'full',
        qualityStatus: 'full',
        final: { meta: { status: 'ai', deliveryMode: 'model' } },
      },
    },
    {
      date: '2026-07-15',
      payload: {
        generationMode: 'full',
        qualityStatus: 'full',
        final: { meta: { status: 'ai', deliveryMode: 'model' } },
      },
    },
  ], '2026-07-17');

  assert.equal(navigation.latestDate, '2026-07-17');
  assert.equal(navigation.latestPublishedDate, '2026-07-16');
  assert.equal(navigation.previousPublishedDate, '2026-07-16');
  assert.equal(navigation.nextPublishedDate, null);
  assert.deepEqual(navigation.publishedDates, ['2026-07-16', '2026-07-15']);
});
