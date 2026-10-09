#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_LOGIN_PATH = '/private/tmp/infohub_login.json';
const DEFAULT_OUTPUT_DIR = path.join(
  ROOT,
  'output/source-archive/2026-07-20-reference-shadow-start/daily-comparisons',
);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function unwrapData(value) {
  const payload = asObject(value);
  return asObject(payload.data || payload);
}

function dateStamp(iso) {
  return iso.replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function extractLocalFeedItemIds(markdown) {
  const ids = [];
  const seen = new Set();
  const pattern = /\]\(\/feed\/([0-9a-f-]{16,})(?:\?[^)]*)?\)/gi;
  for (const match of String(markdown || '').matchAll(pattern)) {
    const id = match[1].toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function summarizeReport(payload) {
  const report = unwrapData(payload);
  return {
    date: report.date || null,
    qualityStatus: report.qualityStatus || null,
    publicationStatus: report.publicationStatus || null,
    publishable: Boolean(report.publishable),
    itemCount: finiteNumber(report.itemCount),
    markdownLength: String(report.markdown || '').length,
    priorityArticleCount: Array.isArray(report.priorityArticles) ? report.priorityArticles.length : 0,
    moduleCount: Array.isArray(report.moduleSections) ? report.moduleSections.length : 0,
    eventMetrics: asObject(report.eventMetrics),
    coverageDiagnostics: asObject(report.coverageDiagnostics),
  };
}

function summarizeCandidatePreview(payload) {
  const preview = unwrapData(payload);
  const candidates = Array.isArray(preview.candidates) ? preview.candidates : [];
  const modes = [...new Set(candidates.map((item) => String(item?.selectionMode || '')).filter(Boolean))];
  const sourceNames = [...new Set(candidates.map((item) => String(item?.sourceName || '')).filter(Boolean))];
  const funnel = asObject(preview.funnel);
  const diagnostics = asObject(preview.coverageDiagnostics);
  return {
    date: preview.date || null,
    candidateCount: candidates.length,
    finalCandidates: finiteNumber(funnel.finalCandidates || candidates.length),
    selectionModes: modes,
    candidateSourceCount: sourceNames.length,
    reviewCandidates: finiteNumber(funnel.reviewCandidates),
    fallbackScoredCandidates: finiteNumber(funnel.fallbackScoredCandidates),
    latestFallbackCandidates: finiteNumber(funnel.latestFallbackCandidates),
    hotNotSelected: finiteNumber(diagnostics.hotNotSelected),
  };
}

export function buildReferenceDailyComparisonObservation({
  catalogPayload,
  runReportPayload,
  publishedReportPayload,
  candidatePreviewPayload = null,
  linkChecks = [],
  capturedAt = new Date().toISOString(),
}) {
  const catalog = unwrapData(catalogPayload);
  const catalogItems = Array.isArray(catalog.items) ? catalog.items : [];
  const runReport = unwrapData(runReportPayload);
  const publishedReport = unwrapData(publishedReportPayload);
  const formalReferenceCount = catalogItems.filter((item) => item?.integrationStatus === 'active').length;
  const shadowReferenceCount = catalogItems.filter((item) => item?.integrationStatus === 'shadow').length;
  const feedItemIds = extractLocalFeedItemIds(publishedReport.markdown);
  const checkedById = new Map(linkChecks.map((check) => [String(check?.id || '').toLowerCase(), check]));
  const tracedCount = feedItemIds.filter((id) => checkedById.get(id)?.ok).length;
  const missingIds = feedItemIds.filter((id) => !checkedById.get(id)?.ok);
  const traceabilityRate = feedItemIds.length > 0 ? tracedCount / feedItemIds.length : null;
  const publishedSummary = summarizeReport(publishedReportPayload);
  const hasPublishedReport = publishedSummary.publicationStatus === 'published'
    && publishedSummary.qualityStatus === 'full'
    && publishedSummary.markdownLength > 0;
  const status = hasPublishedReport && missingIds.length === 0 ? 'observing' : 'review';

  return {
    version: 1,
    capturedAt,
    mode: 'read_only',
    phase: formalReferenceCount > 0 ? 'post_activation' : 'baseline_shadow',
    status,
    sources: {
      catalogTotal: finiteNumber(catalog.total || catalogItems.length),
      shadowReferenceCount,
      formalReferenceCount,
    },
    currentRun: summarizeReport(runReportPayload),
    liveCandidatePreview: summarizeCandidatePreview(candidatePreviewPayload),
    latestPublished: publishedSummary,
    traceability: {
      localFeedLinkCount: feedItemIds.length,
      tracedCount,
      missingCount: missingIds.length,
      traceabilityRate,
      missingIds,
    },
    comparison: {
      runDate: runReport.date || null,
      publishedDate: publishedReport.date || null,
      multiSourceEventCount: finiteNumber(publishedReport.eventMetrics?.multiSourceEventCount),
      firstPartyEventShare: finiteNumber(publishedReport.eventMetrics?.firstPartyEventShare),
      aihotLocalMissCount: finiteNumber(publishedReport.eventMetrics?.aihotLocalMissCount),
      independentEventCount: finiteNumber(publishedReport.eventMetrics?.independentEventCount),
    },
  };
}

async function resolveToken(loginPath = DEFAULT_LOGIN_PATH) {
  const envToken = String(process.env.INFOHUB_TOKEN || '').trim();
  if (envToken) return envToken;
  const login = JSON.parse(await readFile(loginPath, 'utf8'));
  const token = String(login.accessToken || login.token || '').trim();
  if (!token) throw new Error(`登录状态文件缺少 accessToken：${loginPath}`);
  return token;
}

async function requestJson(endpoint, token, fetchImpl) {
  const response = await fetchImpl(endpoint, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) throw new Error(`只读请求失败：HTTP ${response.status} ${endpoint}`);
  return response.json();
}

export async function captureReferenceDailyComparison({
  apiBase = process.env.INFOHUB_API_BASE_URL || 'http://localhost/api',
  loginPath = process.env.INFOHUB_LOGIN_JSON || DEFAULT_LOGIN_PATH,
  outputDir = process.env.INFOHUB_REFERENCE_DAILY_COMPARISON_DIR || DEFAULT_OUTPUT_DIR,
  now = new Date(),
  fetchImpl = fetch,
} = {}) {
  const token = await resolveToken(loginPath);
  const base = String(apiBase).replace(/\/+$/, '');
  const [catalogPayload, runReportPayload] = await Promise.all([
    requestJson(`${base}/integrations/reference-sources/catalog`, token, fetchImpl),
    requestJson(`${base}/daily/reports/latest`, token, fetchImpl),
  ]);
  const runReport = unwrapData(runReportPayload);
  const candidatePreviewPayload = runReport.date
    ? await requestJson(`${base}/daily/candidates?date=${encodeURIComponent(runReport.date)}`, token, fetchImpl)
    : null;
  const publishedDate = runReport.dateNavigation?.latestPublishedDate || null;
  const publishedReportPayload = publishedDate && (
    publishedDate !== runReport.date || runReport.publicationStatus !== 'published'
  )
    ? await requestJson(`${base}/daily/reports/latest?date=${encodeURIComponent(publishedDate)}`, token, fetchImpl)
    : runReportPayload;
  const publishedReport = unwrapData(publishedReportPayload);
  const feedItemIds = extractLocalFeedItemIds(publishedReport.markdown);
  const linkChecks = await Promise.all(feedItemIds.map(async (id) => {
    try {
      const response = await fetchImpl(`${base}/items/${id}`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      return { id, ok: response.ok, status: response.status };
    } catch (error) {
      return { id, ok: false, status: null, error: error instanceof Error ? error.message : String(error) };
    }
  }));

  const capturedAt = now.toISOString();
  const snapshot = buildReferenceDailyComparisonObservation({
    catalogPayload,
    runReportPayload,
    publishedReportPayload,
    candidatePreviewPayload,
    linkChecks,
    capturedAt,
  });
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `reference-daily-${dateStamp(capturedAt)}.json`);
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return { outputPath, snapshot };
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  captureReferenceDailyComparison()
    .then(({ outputPath, snapshot }) => {
      console.log(JSON.stringify({
        outputPath,
        status: snapshot.status,
        phase: snapshot.phase,
        currentRun: snapshot.currentRun,
        liveCandidatePreview: snapshot.liveCandidatePreview,
        latestPublished: snapshot.latestPublished,
        traceability: snapshot.traceability,
        comparison: snapshot.comparison,
      }, null, 2));
      if (snapshot.status !== 'observing') process.exitCode = 2;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
