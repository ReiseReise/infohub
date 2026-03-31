import { desc, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { deleteAudioTaskStorage } from '../services/audio.js';

type RetentionSummary = {
  retentionDays: number;
  dryRun: boolean;
  items: number;
  insights: number;
  fetchLogs: number;
  aiUsageLogs: number;
  audioTasks: number;
  deleted?: {
    items?: number;
    insights?: number;
    fetchLogs?: number;
    aiUsageLogs?: number;
    audioTasks?: number;
  };
  skippedReferencedAudioTasks?: number;
  storageDeleteFailed?: number;
  errors?: string[];
};

async function tableExists(schemaName: string, tableName: string): Promise<boolean> {
  const result = await db.execute(sql`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = ${schemaName}
        and table_name = ${tableName}
    ) as exists
  `);
  const row = Array.from(result)[0] as { exists?: boolean } | undefined;
  return Boolean(row?.exists);
}

async function countOlderThan(tableSql: ReturnType<typeof sql>, timestampColumn: string, cutoffIso: string, extraSql?: ReturnType<typeof sql>) {
  const result = await db.execute(sql`
    select count(*)::int as count
    from ${tableSql}
    where ${sql.raw(timestampColumn)} < ${cutoffIso}::timestamptz
      ${extraSql ? sql`and ${extraSql}` : sql``}
  `);
  const row = Array.from(result)[0] as { count?: number } | undefined;
  return Number(row?.count || 0);
}

async function listDeletableAudioTaskIds(
  tableSql: ReturnType<typeof sql>,
  cutoffIso: string,
): Promise<string[]> {
  const result = await db.execute(sql`
    with protected_task_ids as (
      select distinct audio_task_id as task_id
      from hub.items
      where audio_task_id is not null
        and (
          created_at >= ${cutoffIso}::timestamptz
          or coalesce(is_favorite, false) = true
          or coalesce(is_later, false) = true
        )
    )
    select id::text as id
    from ${tableSql}
    where created_at < ${cutoffIso}::timestamptz
      and id::text not in (select task_id from protected_task_ids)
  `);
  return Array.from(result)
    .map((row) => (row as { id?: string }).id || '')
    .filter(Boolean);
}

export async function runRetention(options?: { retentionDays?: number; dryRun?: boolean }): Promise<RetentionSummary> {
  const retentionDays = Math.max(options?.retentionDays || 30, 1);
  const dryRun = options?.dryRun !== false;
  const cutoffIso = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const summary: RetentionSummary = {
    retentionDays,
    dryRun,
    items: await countOlderThan(sql.raw('hub.items'), 'created_at', cutoffIso, sql`coalesce(is_favorite, false) = false and coalesce(is_later, false) = false`),
    insights: await countOlderThan(sql.raw('hub.insights'), 'generated_at', cutoffIso),
    fetchLogs: await countOlderThan(sql.raw('hub.fetch_logs'), 'started_at', cutoffIso),
    aiUsageLogs: await countOlderThan(sql.raw('hub.ai_usage_logs'), 'created_at', cutoffIso),
    audioTasks: 0,
    deleted: dryRun ? undefined : {},
    skippedReferencedAudioTasks: 0,
    storageDeleteFailed: 0,
    errors: [],
  };

  const hasPublicAudioTasks = await tableExists('public', 'audio_tasks');
  const hasAudioTasks = await tableExists('audio', 'tasks');
  let deletableAudioTaskIds: string[] = [];
  if (hasPublicAudioTasks) {
    const totalOld = await countOlderThan(sql.raw('public.audio_tasks'), 'created_at', cutoffIso);
    deletableAudioTaskIds = await listDeletableAudioTaskIds(sql.raw('public.audio_tasks'), cutoffIso);
    summary.audioTasks = deletableAudioTaskIds.length;
    summary.skippedReferencedAudioTasks = Math.max(totalOld - deletableAudioTaskIds.length, 0);
  } else if (hasAudioTasks) {
    const totalOld = await countOlderThan(sql.raw('audio.tasks'), 'created_at', cutoffIso);
    deletableAudioTaskIds = await listDeletableAudioTaskIds(sql.raw('audio.tasks'), cutoffIso);
    summary.audioTasks = deletableAudioTaskIds.length;
    summary.skippedReferencedAudioTasks = Math.max(totalOld - deletableAudioTaskIds.length, 0);
  }

  if (!dryRun) {
    await db.execute(sql`
      delete from hub.items
      where created_at < ${cutoffIso}::timestamptz
        and coalesce(is_favorite, false) = false
        and coalesce(is_later, false) = false
    `);
    await db.execute(sql`delete from hub.insights where generated_at < ${cutoffIso}::date`);
    await db.execute(sql`delete from hub.fetch_logs where started_at < ${cutoffIso}::timestamptz`);
    await db.execute(sql`delete from hub.ai_usage_logs where created_at < ${cutoffIso}::timestamptz`);
    summary.deleted = {
      items: summary.items,
      insights: summary.insights,
      fetchLogs: summary.fetchLogs,
      aiUsageLogs: summary.aiUsageLogs,
      audioTasks: 0,
    };
    if (deletableAudioTaskIds.length > 0) {
      for (const taskId of deletableAudioTaskIds) {
        const cleanup = await deleteAudioTaskStorage(taskId);
        if (!cleanup.deleted && cleanup.reason && cleanup.reason !== 'task_not_found' && cleanup.reason !== 'no_audio_url') {
          summary.storageDeleteFailed = (summary.storageDeleteFailed || 0) + 1;
          summary.errors?.push(`audio-storage:${taskId}:${cleanup.reason}`);
        }
        if (hasPublicAudioTasks) {
          await db.execute(sql`delete from public.audio_tasks where id::text = ${taskId}`);
        } else if (hasAudioTasks) {
          await db.execute(sql`delete from audio.tasks where id::text = ${taskId}`);
        }
        summary.deleted.audioTasks = (summary.deleted.audioTasks || 0) + 1;
      }
    }
  }

  await db.insert(schema.retentionRuns).values({
    mode: dryRun ? 'dry-run' : 'apply',
    retentionDays,
    status: 'success',
    summary,
  });

  return summary;
}

export async function getRetentionStatus() {
  const rows = await db.select().from(schema.retentionRuns).orderBy(desc(schema.retentionRuns.createdAt)).limit(1);
  return rows[0] ?? null;
}
