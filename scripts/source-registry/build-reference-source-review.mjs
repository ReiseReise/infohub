#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CATALOG_PATH = path.join(ROOT, 'docs/source-registry/reference-source-catalog.json');
const DECISIONS_PATH = path.join(ROOT, 'docs/source-registry/reference-source-decisions.json');
const OUTPUT_PATH = path.join(ROOT, 'docs/source-registry/reference-source-catalog.csv');

const REVIEW_COLUMNS = [
  ['key', '候选键'],
  ['name', '来源名称'],
  ['providerLabel', '参考项目'],
  ['channel', '渠道'],
  ['sourceTier', '权威等级'],
  ['readingTier', '阅读层级'],
  ['recommended', '首批推荐'],
  ['importMode', '接入方式'],
  ['observationStatus', '观测状态'],
  ['decision', '人工决定'],
  ['runtimeStatus', '运行状态'],
  ['formalSubscription', '正式订阅'],
  ['decisionReason', '决定理由'],
  ['feedUrl', '订阅地址'],
  ['siteUrl', '站点地址'],
  ['provenanceSourceUrl', '证据地址'],
  ['description', '说明'],
  ['notes', '维护备注'],
];

function csvCell(value) {
  const normalized = value === null || value === undefined
    ? ''
    : typeof value === 'boolean'
      ? value ? '是' : '否'
      : String(value);
  return `"${normalized.replaceAll('"', '""').replace(/[\r\n]+/g, ' ').trim()}"`;
}

function reviewRow(source, decisionByKey) {
  const decision = decisionByKey.get(source.key) || {};
  return {
    ...source,
    decision: decision.decision || 'undecided',
    runtimeStatus: decision.runtimeStatus || '',
    formalSubscription: Boolean(decision.formalSubscription),
    decisionReason: decision.reason || '',
    provenanceSourceUrl: source.provenance?.sourceUrl || '',
  };
}

export function buildReferenceSourceReviewCsv(catalog, decisions = {}) {
  const sources = Array.isArray(catalog?.sources) ? catalog.sources : [];
  const decisionByKey = new Map(
    (Array.isArray(decisions?.decisions) ? decisions.decisions : [])
      .filter((decision) => decision?.catalogKey)
      .map((decision) => [decision.catalogKey, decision]),
  );
  const header = REVIEW_COLUMNS.map(([, label]) => csvCell(label)).join(',');
  const rows = sources.map((source) => {
    const row = reviewRow(source, decisionByKey);
    return REVIEW_COLUMNS.map(([key]) => csvCell(row[key])).join(',');
  });
  return `${[header, ...rows].join('\n')}\n`;
}

export async function writeReferenceSourceReviewCsv({
  catalogPath = CATALOG_PATH,
  decisionsPath = DECISIONS_PATH,
  outputPath = OUTPUT_PATH,
} = {}) {
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  let decisions = {};
  try {
    decisions = JSON.parse(await readFile(decisionsPath, 'utf8'));
  } catch {
    // The catalog remains reviewable before the decision ledger is initialized.
  }
  const csv = buildReferenceSourceReviewCsv(catalog, decisions);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, csv, 'utf8');
  return {
    output: outputPath,
    sources: Array.isArray(catalog.sources) ? catalog.sources.length : 0,
  };
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  writeReferenceSourceReviewCsv()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
