import { createHash } from 'node:crypto';
import { and, eq, gte, lt } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { resolveDailyReportWindow } from './daily-report-window.js';

export type DailyReportRecoveryMaterialRow = {
  id: string;
  fetchedAt?: Date | string | null;
  aiScore?: number | null;
  aiSummary?: string | null;
  aiTranslation?: string | null;
  priorityScore?: number | null;
  contentStatus?: string | null;
  summaryStatus?: string | null;
  translationStatus?: string | null;
  processingStatus?: string | null;
  isFiltered?: boolean | null;
  filterBucket?: string | null;
  qualityDecision?: string | null;
};

export type DailyReportRecoveryContext = {
  capturedAt: string;
  itemCount: number;
  mainVisibleCount: number;
  readyCount: number;
  latestFetchedAt: string | null;
  materialFingerprint: string;
};

function normalizedTimestamp(value: Date | string | null | undefined) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizedScore(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '';
  return Number(value).toFixed(3);
}

function isMainVisible(row: DailyReportRecoveryMaterialRow) {
  return row.isFiltered !== true && String(row.filterBucket || 'main') === 'main';
}

function isCandidateReady(row: DailyReportRecoveryMaterialRow) {
  if (!isMainVisible(row)) return false;
  if (row.aiScore != null || row.priorityScore != null) return true;
  if (String(row.aiSummary || '').trim() || String(row.aiTranslation || '').trim()) return true;
  return ['scored', 'summarized', 'translated', 'processed'].includes(String(row.processingStatus || ''));
}

export function buildDailyReportRecoveryContext(
  rows: DailyReportRecoveryMaterialRow[],
  capturedAt = new Date(),
): DailyReportRecoveryContext {
  const normalizedRows = [...rows]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((row) => [
      row.id,
      normalizedTimestamp(row.fetchedAt),
      String(row.processingStatus || ''),
      String(row.contentStatus || ''),
      String(row.summaryStatus || ''),
      String(row.translationStatus || ''),
      normalizedScore(row.aiScore),
      normalizedScore(row.priorityScore),
      String(Boolean(String(row.aiSummary || '').trim())),
      String(Boolean(String(row.aiTranslation || '').trim())),
      String(Boolean(row.isFiltered)),
      String(row.filterBucket || 'main'),
      String(row.qualityDecision || ''),
    ].join('|'));
  const fetchedTimes = rows
    .map((row) => normalizedTimestamp(row.fetchedAt))
    .filter(Boolean)
    .sort();

  return {
    capturedAt: capturedAt.toISOString(),
    itemCount: rows.length,
    mainVisibleCount: rows.filter(isMainVisible).length,
    readyCount: rows.filter(isCandidateReady).length,
    latestFetchedAt: fetchedTimes.at(-1) || null,
    materialFingerprint: createHash('sha256').update(normalizedRows.join('\n')).digest('hex'),
  };
}

export async function loadDailyReportRecoveryContext(
  userId: string,
  dateKey: string,
  sourceId?: number | null,
) {
  const { dayStart, dayEnd } = resolveDailyReportWindow(dateKey);
  const rows = await db
    .select({
      id: schema.items.id,
      fetchedAt: schema.items.fetchedAt,
      aiScore: schema.items.aiScore,
      aiSummary: schema.items.aiSummary,
      aiTranslation: schema.items.aiTranslation,
      priorityScore: schema.items.priorityScore,
      contentStatus: schema.items.contentStatus,
      summaryStatus: schema.items.summaryStatus,
      translationStatus: schema.items.translationStatus,
      processingStatus: schema.items.processingStatus,
      isFiltered: schema.items.isFiltered,
      filterBucket: schema.items.filterBucket,
      qualityDecision: schema.items.qualityDecision,
    })
    .from(schema.items)
    .innerJoin(schema.sources, and(
      eq(schema.items.sourceId, schema.sources.id),
      eq(schema.sources.userId, userId),
      eq(schema.sources.status, 'active'),
    ))
    .where(and(
      eq(schema.items.userId, userId),
      gte(schema.items.fetchedAt, dayStart),
      lt(schema.items.fetchedAt, dayEnd),
      ...(sourceId ? [eq(schema.items.sourceId, sourceId)] : []),
    ));

  return buildDailyReportRecoveryContext(rows);
}
