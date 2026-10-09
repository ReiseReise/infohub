import { and, desc, eq, gte, sql } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import {
  assignEventClustersBySimilarity,
  type EventClusterSimilarityItem,
} from './event-clustering.js';
import { logger } from './logger.js';

export type EventClusterMaintenanceOptions = {
  lookbackDays?: number;
  maxItems?: number;
  dryRun?: boolean;
};

export type EventClusterMaintenanceResult = {
  userId: string;
  itemCount: number;
  changedCount: number;
  multiSourceClusterCount: number;
  multiSourceItemCount: number;
  dryRun: boolean;
};

function countMultiSourceClusters(
  rows: EventClusterSimilarityItem[],
  assignments: Map<string, string>,
): { clusterCount: number; itemCount: number } {
  const groups = new Map<string, EventClusterSimilarityItem[]>();
  for (const row of rows) {
    const clusterId = assignments.get(row.id);
    if (!clusterId) continue;
    groups.set(clusterId, [...(groups.get(clusterId) || []), row]);
  }

  let clusterCount = 0;
  let itemCount = 0;
  for (const members of groups.values()) {
    const sources = new Set(members.map((member) => member.sourceId ?? `item:${member.id}`));
    if (members.length < 2 || sources.size < 2) continue;
    clusterCount += 1;
    itemCount += members.length;
  }
  return { clusterCount, itemCount };
}

export async function refreshRecentEventClusters(
  userId: string,
  options: EventClusterMaintenanceOptions = {},
): Promise<EventClusterMaintenanceResult> {
  const lookbackDays = Math.max(1, Math.min(14, Math.floor(options.lookbackDays ?? 7)));
  const maxItems = Math.max(50, Math.min(2_000, Math.floor(options.maxItems ?? 1_200)));
  const dryRun = options.dryRun === true;
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1_000);

  const rows = await db
    .select({
      id: schema.items.id,
      sourceId: schema.items.sourceId,
      title: schema.items.title,
      translatedTitle: schema.items.translatedTitle,
      aiTags: schema.items.aiTags,
      publishedAt: schema.items.publishedAt,
      fetchedAt: schema.items.fetchedAt,
      clusterId: schema.items.clusterId,
    })
    .from(schema.items)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.items.sourceId))
    .where(and(
      eq(schema.items.userId, userId),
      eq(schema.sources.userId, userId),
      eq(schema.sources.status, 'active'),
      eq(schema.items.isFiltered, false),
      gte(schema.items.fetchedAt, since),
      sql`coalesce(${schema.sources.sourceRole}, 'normal') not in ('radar', 'reference')`,
      sql`coalesce(${schema.sources.config}->>'integrationStatus', 'active') not in ('shadow', 'paused', 'removed')`,
    ))
    .orderBy(desc(schema.items.fetchedAt))
    .limit(maxItems);

  const assignments = assignEventClustersBySimilarity(rows);
  const changed = rows
    .map((row) => ({
      id: row.id,
      previousClusterId: row.clusterId,
      clusterId: assignments.get(row.id) || null,
    }))
    .filter((row) => row.clusterId && row.clusterId !== row.previousClusterId);
  const multiSource = countMultiSourceClusters(rows, assignments);

  if (!dryRun && changed.length > 0) {
    await db.transaction(async (tx) => {
      for (const row of changed) {
        await tx
          .update(schema.items)
          .set({ clusterId: row.clusterId })
          .where(and(eq(schema.items.id, row.id), eq(schema.items.userId, userId)));
      }
    });
  }

  const result: EventClusterMaintenanceResult = {
    userId,
    itemCount: rows.length,
    changedCount: changed.length,
    multiSourceClusterCount: multiSource.clusterCount,
    multiSourceItemCount: multiSource.itemCount,
    dryRun,
  };
  if (changed.length > 0 || dryRun) {
    logger.info(result, 'Recent event cluster maintenance complete');
  }
  return result;
}
