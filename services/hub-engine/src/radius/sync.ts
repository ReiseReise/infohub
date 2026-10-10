import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { savedTopic } from './contracts.js';
import { documentFromRow, INDEX, MeiliClient } from './meili.js';

// Full, bounded-memory reconciliation catches late body enrichment and edits even
// when the existing item row has no reliable updated_at column. No editorial filter.
export async function syncRadius(sql: postgres.Sql, client: MeiliClient) {
  const lease = await sql.reserve();
  const [lock] = await lease`select pg_try_advisory_lock(729291008) as acquired`;
  if (!lock.acquired) { lease.release(); return { skipped: true }; }
  try {
    await lease`update hub.radius_sync set started_at=now(),error=null where id=true`;
    await client.prepare();
    const settings = await lease`select user_id,radius_topics from hub.user_settings`;
    const topics = new Map(settings.map(s => [String(s.user_id), savedTopic.array().parse(s.radius_topics)]));
    const generation = randomUUID();
    let cursor = '00000000-0000-0000-0000-000000000000', total = 0, taskId: number | null = null;
    while (true) {
      const rows = await lease`select i.*,s.name as source_name,s.source_role,s.trust_score from hub.items i join hub.sources s on s.id=i.source_id and s.user_id=i.user_id where i.id>${cursor}::uuid and coalesce(s.status,'active') <> 'removed' order by i.id limit 200`;
      if (!rows.length) break;
      const documents = rows.map(row => documentFromRow(row, topics.get(String(row.user_id)) || [], generation));
      taskId = await client.mutate(`/indexes/${INDEX}/documents`, 'POST', documents);
      cursor = String(rows[rows.length - 1].id);
      total += rows.length;
      await lease`update hub.radius_sync set document_count=${total},task_id=${taskId} where id=true`;
    }
    // Only remove obsolete derived search copies after EVERY batch succeeded.
    // The authoritative PostgreSQL articles are never deleted by this worker.
    taskId = await client.mutate(`/indexes/${INDEX}/documents/delete`, 'POST', { filter: `generation != "${generation}"` });
    await lease`update hub.radius_sync set completed_at=now(),document_count=${total},task_id=${taskId},error=null where id=true`;
    return { skipped: false, documents: total, taskId };
  } catch (e) {
    const code = e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'radius_sync_failed';
    await lease`update hub.radius_sync set error=${code} where id=true`.catch(() => {});
    throw new Error(code);
  } finally {
    try { await lease`select pg_advisory_unlock(729291008)`; }
    finally { lease.release(); }
  }
}
