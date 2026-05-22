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

async function main() {
  const apply = hasFlag('--apply');
  const userId = argValue('--user-id');
  const userClause = userId ? sql`and user_id = ${userId}` : sql``;

  const mismatchRows = await db.execute(sql`
    select
      count(*)::int as total,
      count(*) filter (where is_filtered = true and filter_bucket = 'main')::int as filtered_in_main,
      count(*) filter (where is_filtered = false and filter_bucket = 'filtered')::int as visible_in_filtered
    from hub.items
    where 1 = 1
    ${userClause}
  `);

  const reasonRows = await db.execute(sql`
    select coalesce(nullif(btrim(filter_reason), ''), '未记录过滤原因') as reason, count(*)::int as count
    from hub.items
    where is_filtered = true
      and filter_bucket = 'main'
      ${userClause}
    group by 1
    order by count desc
    limit 10
  `);

  let repaired = 0;
  if (apply) {
    const result = await db.execute(sql`
      update hub.items
      set
        filter_bucket = 'filtered',
        quality_decision = coalesce(quality_decision, 'filter')
      where is_filtered = true
        and filter_bucket = 'main'
        ${userClause}
      returning id
    `);
    repaired = result.length;
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    userId: userId || 'all',
    summary: mismatchRows[0] || {},
    topReasons: reasonRows,
    repaired,
    nextAction: apply
      ? '已修正过滤状态错位，请重新生成日报并刷新 Feed/过滤池。'
      : '默认仅诊断不改库；确认影响范围后再加 --apply 执行回补。',
  }, null, 2));
}

void main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
