import { inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { isUsableChineseTranslation } from '../processors/ai-summarizer.js';

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string, fallback = ''): string {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function toPositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sourceLength(content?: string | null, snippet?: string | null): number {
  return (content || snippet || '').replace(/\s+/g, ' ').trim().length;
}

function classifyTranslation(row: {
  content?: string | null;
  snippet?: string | null;
  aiTranslation?: string | null;
}): string | null {
  const source = row.content || row.snippet || '';
  const translation = row.aiTranslation || '';
  if (!translation.trim()) return null;
  if (isUsableChineseTranslation(translation, source)) return null;

  const translationLength = translation.trim().length;
  const readableLength = sourceLength(row.content, row.snippet);
  if (readableLength >= 2500 && translationLength < 480) return 'translation_too_short_for_long_source';
  if (/^(?:#{1,6}\s*)?标题[:：]/.test(translation.trim())) return 'translation_title_wrapper_only';
  return 'translation_not_usable';
}

async function main() {
  const applyFail = hasFlag('--apply-fail');
  const limit = toPositiveInt(argValue('--limit', '80'), 80);
  const userId = argValue('--user-id');
  const itemId = argValue('--item-id');
  const userClause = userId ? sql`and i.user_id = ${userId}` : sql``;
  const itemClause = itemId ? sql`and i.id = ${itemId}` : sql``;

  const rows = await db.execute<{
    id: string;
    userId: string;
    title: string;
    sourceName: string | null;
    sourceTier: string | null;
    processingProfile: string | null;
    language: string | null;
    content: string | null;
    snippet: string | null;
    aiTranslation: string | null;
    translationStatus: string | null;
    fetchedAt: Date | string | null;
  }>(sql`
    select
      i.id,
      i.user_id as "userId",
      i.title,
      s.name as "sourceName",
      i.source_tier as "sourceTier",
      i.processing_profile as "processingProfile",
      i.language,
      i.content,
      i.snippet,
      i.ai_translation as "aiTranslation",
      i.translation_status as "translationStatus",
      i.fetched_at as "fetchedAt"
    from hub.items i
    left join hub.sources s on s.id = i.source_id
    where i.is_filtered = false
      and coalesce(i.language, '') <> 'zh'
      and i.translation_status = 'ready'
      and i.ai_translation is not null
      ${userClause}
      ${itemClause}
    order by i.fetched_at desc
    limit ${limit}
  `);

  const suspicious = rows
    .map((row) => ({
      ...row,
      sourceLength: sourceLength(row.content, row.snippet),
      translationLength: (row.aiTranslation || '').trim().length,
      reason: classifyTranslation(row),
    }))
    .filter((row) => row.reason);

  let markedFailed = 0;
  if (applyFail && suspicious.length > 0) {
    const ids = suspicious.map((row) => row.id);
    const result = await db.update(schema.items).set({
      translationStatus: 'failed',
      translationReason: 'translation_quality_audit_failed',
      processingStatus: 'translation_failed',
    }).where(inArray(schema.items.id, ids)).returning({ id: schema.items.id });
    markedFailed = result.length;
  }

  console.log(JSON.stringify({
    mode: applyFail ? 'apply-fail' : 'dry-run',
    scanned: rows.length,
    suspicious: suspicious.length,
    markedFailed,
    userId: userId || 'all',
    itemId: itemId || null,
    samples: suspicious.slice(0, 25).map((row) => ({
      id: row.id,
      title: row.title,
      sourceName: row.sourceName,
      sourceTier: row.sourceTier,
      processingProfile: row.processingProfile,
      sourceLength: row.sourceLength,
      translationLength: row.translationLength,
      reason: row.reason,
      fetchedAt: row.fetchedAt,
    })),
    nextAction: applyFail
      ? '已把疑似坏译文标记为失败，可在 Feed 用“精译全文”或批量 reprocess 重新翻译。'
      : '默认仅审计不改库；确认样本后可加 --apply-fail 标记失败，再小批量重译。',
  }, null, 2));
}

void main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
