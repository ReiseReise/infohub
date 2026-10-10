#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_LOGIN_PATH = '/private/tmp/infohub_login.json';
const DEFAULT_OUTPUT_DIR = path.join(
  ROOT,
  'output/source-archive/2026-07-20-reference-shadow-start/observations',
);

export const EXPECTED_SHADOW_KEYS = [
  'aihot:channel:selected',
  'follow_builders:blog:anthropic-engineering',
  'follow_builders:blog:claude-blog',
  'follow_builders:podcast:no-priors',
  'follow_builders:podcast:training-data',
  'origin12:ai-news',
  'origin12:the-batch',
  'origin12:research-radar',
  'origin12:model-reality',
  'origin12:semianalysis',
];

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function dateStamp(iso) {
  return iso.replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
}

export function buildReferenceShadowObservation(payload, capturedAt = new Date().toISOString()) {
  const data = asObject(asObject(payload).data || payload);
  const items = Array.isArray(data.items) ? data.items : [];
  const byKey = new Map(items.map((item) => [String(item?.key || ''), item]));
  const missingKeys = EXPECTED_SHADOW_KEYS.filter((key) => !byKey.has(key));
  const sources = EXPECTED_SHADOW_KEYS
    .map((key) => byKey.get(key))
    .filter(Boolean)
    .map((item) => ({
      key: item.key,
      name: item.name,
      sourceId: item.sourceId ?? null,
      integrationStatus: item.integrationStatus,
      quality: item.quality,
    }));
  const wrongStatus = sources
    .filter((item) => item.integrationStatus !== 'shadow')
    .map((item) => ({ key: item.key, status: item.integrationStatus }));
  const eligibleKeys = sources
    .filter((item) => item.quality?.eligibleForActivation)
    .map((item) => item.key);
  const observationDays = sources.map((item) => Number(item.quality?.observationDays || 0));

  return {
    version: 1,
    capturedAt,
    mode: 'read_only',
    source: '/api/integrations/reference-sources/catalog',
    status: missingKeys.length === 0 && wrongStatus.length === 0 ? 'observing' : 'review',
    summary: {
      catalogTotal: Number(data.total || items.length),
      expectedShadowCount: EXPECTED_SHADOW_KEYS.length,
      capturedShadowCount: sources.length,
      activeTotal: Number(data.activeCounts?.total || 0),
      referenceActive: Number(data.activeCounts?.reference || 0),
      referenceShadow: Number(data.activeCounts?.referenceShadow || 0),
      referenceFormal: Number(data.activeCounts?.referenceFormal || data.activeCounts?.formalReference || 0),
      totalScheduled: Number(data.activeCounts?.totalScheduled || data.activeCounts?.total || 0),
      minimumObservationDays: observationDays.length ? Math.min(...observationDays) : 0,
      maximumObservationDays: observationDays.length ? Math.max(...observationDays) : 0,
      eligibleCount: eligibleKeys.length,
      formalActivationCount: sources.filter((item) => item.integrationStatus === 'active').length,
    },
    missingKeys,
    wrongStatus,
    eligibleKeys,
    sources,
  };
}

async function resolveToken(loginPath = DEFAULT_LOGIN_PATH) {
  const envToken = String(process.env.INFOHUB_TOKEN || '').trim();
  if (envToken) return envToken;
  const login = JSON.parse(await readFile(loginPath, 'utf8'));
  const token = String(login.accessToken || '').trim();
  if (!token) throw new Error(`登录状态文件缺少 accessToken：${loginPath}`);
  return token;
}

export async function captureReferenceShadowObservation({
  apiBase = process.env.INFOHUB_API_BASE_URL || 'http://localhost/api',
  loginPath = process.env.INFOHUB_LOGIN_JSON || DEFAULT_LOGIN_PATH,
  outputDir = process.env.INFOHUB_REFERENCE_OBSERVATION_DIR || DEFAULT_OUTPUT_DIR,
  now = new Date(),
  fetchImpl = fetch,
} = {}) {
  const token = await resolveToken(loginPath);
  const endpoint = `${String(apiBase).replace(/\/+$/, '')}/integrations/reference-sources/catalog`;
  const response = await fetchImpl(endpoint, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) throw new Error(`参考源目录请求失败：HTTP ${response.status}`);

  const capturedAt = now.toISOString();
  const snapshot = buildReferenceShadowObservation(await response.json(), capturedAt);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `reference-shadow-${dateStamp(capturedAt)}.json`);
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return { outputPath, snapshot };
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  captureReferenceShadowObservation()
    .then(({ outputPath, snapshot }) => {
      console.log(JSON.stringify({ outputPath, status: snapshot.status, summary: snapshot.summary }, null, 2));
      if (snapshot.status !== 'observing') process.exitCode = 2;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
