import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  buildDailyReportEventMetrics,
  type DailyReportEventMetricItem,
  type DailyReportEventMetrics,
} from './daily-report-event-metrics.js';
import { resolveDailyReportWindow } from './daily-report-window.js';

const eventMetricSelection = {
  id: schema.items.id,
  sourceId: schema.items.sourceId,
  sourceName: schema.sources.name,
  sourceRole: schema.sources.sourceRole,
  sourceKind: schema.sources.sourceKind,
  clusterId: schema.items.clusterId,
  title: schema.items.title,
  url: schema.items.url,
  originalUrl: schema.items.originalUrl,
  category: schema.sources.category,
  aiTags: schema.items.aiTags,
  curationSource: schema.items.curationSource,
  curationMeta: schema.items.curationMeta,
};

export async function loadDailyReportEventMetrics(input: {
  userId: string;
  date: string;
  sourceId?: number | null;
}): Promise<DailyReportEventMetrics> {
  const { dayStart, dayEnd } = resolveDailyReportWindow(input.date);
  const localSourceConditions = [
    eq(schema.sources.userId, input.userId),
    eq(schema.sources.status, 'active'),
    sql`coalesce(${schema.sources.sourceRole}, 'normal') not in ('radar', 'reference')`,
    sql`coalesce(${schema.sources.config}->>'integrationStatus', 'active') not in ('shadow', 'paused', 'removed')`,
    ...(input.sourceId ? [eq(schema.sources.id, input.sourceId)] : []),
  ];
  const [localItems, radarItems] = await Promise.all([
    db.select(eventMetricSelection)
      .from(schema.items)
      .innerJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
      .where(and(
        eq(schema.items.userId, input.userId),
        ...localSourceConditions,
        gte(schema.items.fetchedAt, dayStart),
        lt(schema.items.fetchedAt, dayEnd),
        eq(schema.items.filterBucket, 'main'),
        eq(schema.items.isFiltered, false),
      )),
    input.sourceId
      ? Promise.resolve([] as DailyReportEventMetricItem[])
      : db.select(eventMetricSelection)
        .from(schema.items)
        .innerJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
        .where(and(
          eq(schema.items.userId, input.userId),
          eq(schema.sources.userId, input.userId),
          eq(schema.sources.status, 'active'),
          inArray(schema.sources.sourceRole, ['radar', 'reference']),
          sql`coalesce(${schema.sources.config}->>'integrationStatus', 'shadow') not in ('paused', 'removed')`,
          gte(schema.items.fetchedAt, dayStart),
          lt(schema.items.fetchedAt, dayEnd),
          eq(schema.items.isFiltered, false),
        )),
  ]);
  return buildDailyReportEventMetrics({ localItems, radarItems });
}
