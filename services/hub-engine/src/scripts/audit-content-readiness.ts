import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import {
  buildContentRepairApplyPatch,
  buildContentRepairPlan,
  summarizeContentRepairPlan,
  type ContentRepairCandidate,
  type ContentRepairPatch,
  validateContentRepairApplyOptions,
} from '../lib/content-repair-planner.js';

function argValue(name: string, fallback = ''): string {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function toPositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function toOptionalSourceId(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function stripUndefinedPatch(patch: ContentRepairPatch): ContentRepairPatch {
  const clean: ContentRepairPatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      (clean as Record<string, unknown>)[key] = value;
    }
  }
  return clean;
}

async function main() {
  const limit = toPositiveInt(argValue('--limit', '200'), 200);
  const userId = argValue('--user-id');
  const itemId = argValue('--item-id');
  const sourceIdRaw = argValue('--source-id');
  const sourceId = toOptionalSourceId(sourceIdRaw);
  const apply = hasFlag('--apply');
  const malformedMarker = '```#';

  const userClause = userId ? sql`and i.user_id = ${userId}` : sql``;
  const itemClause = itemId ? sql`and i.id = ${itemId}` : sql``;
  const sourceClause = sourceId ? sql`and i.source_id = ${sourceId}` : sql``;

  const validation = validateContentRepairApplyOptions({
    apply,
    itemId: itemId || null,
    sourceId,
    limit,
  });
  if (!validation.ok) {
    console.log(JSON.stringify({
      mode: 'apply-rejected',
      validation,
      filters: {
        userId: userId || 'all',
        itemId: itemId || null,
        sourceId,
        limit,
      },
      nextAction: validation.reason === 'apply_requires_item_or_source_scope'
        ? '写库修复必须指定 --item-id 或 --source-id，避免误伤全库。'
        : '写库修复批量过大，请降低 --limit，或改用 --item-id 精确修复。',
    }, null, 2));
    process.exit(2);
  }

  const rows = await db.execute<ContentRepairCandidate>(sql`
    select
      i.id,
      i.title,
      s.name as "sourceName",
      i.source_type as "sourceType",
      s.source_kind as "sourceKind",
      s.collector_type as "collectorType",
      i.content_status as "contentStatus",
      i.readability_status as "readabilityStatus",
      i.readability_reason as "readabilityReason",
      i.readability_content as "readabilityContent",
      i.content,
      i.snippet,
      i.fetched_at as "fetchedAt"
    from hub.items i
    left join hub.sources s on s.id = i.source_id
    where i.is_filtered = false
      and (
        i.readability_status = 'ready'
        or position(${malformedMarker} in coalesce(i.content, '')) > 0
        or position(${malformedMarker} in coalesce(i.snippet, '')) > 0
        or position(${malformedMarker} in coalesce(i.readability_content, '')) > 0
      )
      ${userClause}
      ${itemClause}
      ${sourceClause}
    order by i.fetched_at desc
    limit ${limit}
  `);

  const plan = buildContentRepairPlan(rows);
  const summary = summarizeContentRepairPlan(plan);
  let applied = 0;

  if (apply) {
    for (const item of plan) {
      const patch = stripUndefinedPatch(buildContentRepairApplyPatch(item));
      if (Object.keys(patch).length === 0) continue;
      await db.update(schema.items)
        .set(patch)
        .where(eq(schema.items.id, item.itemId));
      applied += 1;
    }
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    scanned: rows.length,
    applied,
    summary,
    filters: {
      userId: userId || 'all',
      itemId: itemId || null,
      sourceId,
      limit,
    },
    samples: plan.slice(0, 40).map((item) => ({
      itemId: item.itemId,
      title: item.title,
      sourceName: item.sourceName,
      action: item.action,
      severity: item.severity,
      reason: item.reason,
      metrics: item.metrics,
      plannedPatch: item.plannedPatch,
      fetchedAt: item.fetchedAt,
    })),
    nextAction: apply && applied > 0
      ? '已按受保护范围写入修复。建议立即刷新黄金样本矩阵，并抽查样本详情。'
      : summary.total > 0
      ? '这是只读 dry-run。建议先人工抽查 samples，再按 sourceId/itemId 小批量执行后续修复脚本。'
      : '本次扫描没有发现短 readability 假 ready 或 RSS 串台候选。',
  }, null, 2));
}

void main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
