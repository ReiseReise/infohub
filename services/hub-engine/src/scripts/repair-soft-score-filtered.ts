import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

async function resolveUserId() {
  const userId = argValue('--user-id');
  if (userId) return userId;
  const email = argValue('--email');
  if (!email) return null;
  const rows = await db.execute(sql`
    select id
    from auth.users
    where email = ${email}
    limit 1
  `);
  return rows[0]?.id ? String(rows[0].id) : null;
}

async function main() {
  const apply = hasFlag('--apply');
  const days = Math.max(1, Math.min(Number(argValue('--days') || 7), 90));
  const userId = await resolveUserId();
  const userClause = userId ? sql`and user_id = ${userId}` : sql``;
  const itemUserClause = userId ? sql`and i.user_id = ${userId}` : sql``;

  const baseWhere = sql`
    fetched_at >= now() - (${days}::text || ' days')::interval
    ${userClause}
  `;
  const itemBaseWhere = sql`
    i.fetched_at >= now() - (${days}::text || ' days')::interval
    ${itemUserClause}
  `;
  const softWhere = sql`
    ${baseWhere}
    and is_filtered = true
    and filter_bucket = 'filtered'
    and coalesce(filter_reason, '') ~* '^ai score too low:\\s*[0-9]+\\s*<\\s*[0-9]+'
  `;
  const hardWhere = sql`
    ${baseWhere}
    and is_filtered = true
    and filter_bucket = 'filtered'
    and coalesce(filter_reason, '') !~* '^ai score too low:\\s*[0-9]+\\s*<\\s*[0-9]+'
  `;

  const [summaryRows, dayRows, sourceRows, hardRows] = await Promise.all([
    db.execute(sql`
      select
        count(*)::int as total,
        count(*) filter (where filter_bucket = 'main' and is_filtered = false)::int as main_visible,
        count(*) filter (where is_filtered = true and filter_bucket = 'filtered')::int as filtered_bucket,
        count(*) filter (where coalesce(filter_reason, '') ~* '^ai score too low:\\s*[0-9]+\\s*<\\s*[0-9]+')::int as soft_score_filtered,
        count(*) filter (where processing_status = 'score_failed')::int as score_failed
      from hub.items
      where ${baseWhere}
    `),
    db.execute(sql`
      select date(fetched_at) as day, count(*)::int as count
      from hub.items
      where ${softWhere}
      group by 1
      order by 1 desc
    `),
    db.execute(sql`
      select coalesce(s.name, '未知信源') as source_name, count(*)::int as count
      from hub.items i
      left join hub.sources s on s.id = i.source_id
      where ${itemBaseWhere}
        and i.is_filtered = true
        and i.filter_bucket = 'filtered'
        and coalesce(i.filter_reason, '') ~* '^ai score too low:\\s*[0-9]+\\s*<\\s*[0-9]+'
      group by 1
      order by count desc
      limit 20
    `),
    db.execute(sql`
      select coalesce(nullif(btrim(filter_reason), ''), '未记录过滤原因') as reason, count(*)::int as count
      from hub.items
      where ${hardWhere}
      group by 1
      order by count desc
      limit 20
    `),
  ]);

  let repaired = 0;
  if (apply) {
    const rows = await db.execute(sql`
      update hub.items
      set
        is_filtered = false,
        filter_bucket = 'main',
        quality_decision = 'review',
        filter_reason = '低分复核：原 AI 分数门槛不再作为硬过滤',
        quality_reason = '低分复核：原 AI 分数门槛不再作为硬过滤',
        restored_from_filter = true,
        restored_at = now()
      where ${softWhere}
      returning id
    `);
    repaired = rows.length;
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    userId: userId || 'all',
    days,
    summary: summaryRows[0] || {},
    recoverableByDay: dayRows,
    recoverableBySource: sourceRows,
    hardFilteredKept: hardRows,
    repaired,
    nextAction: apply
      ? '已恢复软分数误过滤内容；黑名单内容仍保留在过滤池。'
      : '默认仅诊断不改库；确认后加 --apply 执行恢复。',
  }, null, 2));
}

void main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
