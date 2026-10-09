import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { buildBestBlogsOriginalUrlPatch } from '../lib/bestblogs-backfill.js';
import { resolveBestBlogsOriginalUrlFromHtml } from '../collectors/webpage-index.js';

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
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

async function fetchHtml(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'InfoHub/3.1 BestBlogs original-url backfill',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!resp.ok) return null;
    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) return null;
    return await resp.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const apply = hasFlag('--apply');
  const limit = Math.max(1, Math.min(Number(argValue('--limit') || 50), 300));
  const timeoutMs = Math.max(1000, Math.min(Number(argValue('--timeout-ms') || 6000), 20000));
  const userId = await resolveUserId();
  const sourceId = argValue('--source-id');
  const userClause = userId ? sql`and i.user_id = ${userId}` : sql``;
  const sourceClause = sourceId ? sql`and i.source_id = ${Number(sourceId)}` : sql``;

  const candidates = await db.execute(sql`
    select
      i.id,
      i.title,
      i.url,
      i.curation_url,
      i.curation_source,
      i.curation_meta,
      i.source_id,
      s.name as source_name
    from hub.items i
    join hub.sources s on s.id = i.source_id
    where coalesce(i.original_url, '') = ''
      and (
        i.source_type = 'curated_index'
        or s.collector_type = 'webpage_index'
      )
      and i.url ilike '%bestblogs.dev/%article/%'
      ${userClause}
      ${sourceClause}
    order by i.fetched_at desc
    limit ${limit}
  `);

  const resolved = [];
  const unresolved = [];
  const errors = [];

  for (const item of candidates) {
    const url = String(item.url || '');
    try {
      const html = await fetchHtml(url, timeoutMs);
      const originalUrl = html ? resolveBestBlogsOriginalUrlFromHtml(html, url) : null;
      const patch = buildBestBlogsOriginalUrlPatch({
        itemUrl: url,
        curationUrl: item.curation_url ? String(item.curation_url) : null,
        curationSource: item.curation_source ? String(item.curation_source) : null,
        curationMeta: item.curation_meta && typeof item.curation_meta === 'object'
          ? item.curation_meta as Record<string, unknown>
          : {},
        resolvedOriginalUrl: originalUrl,
      });
      if (!patch) {
        unresolved.push({
          id: item.id,
          title: item.title,
          sourceId: item.source_id,
          sourceName: item.source_name,
          reason: html ? 'detail_page_has_no_external_link' : 'detail_page_unavailable',
        });
        continue;
      }

      if (apply) {
        await db.execute(sql`
          update hub.items
          set
            original_url = ${patch.originalUrl},
            curation_url = ${patch.curationUrl},
            curation_source = ${patch.curationSource},
            curation_meta = ${JSON.stringify(patch.curationMeta)}::jsonb,
            blocked_reason = case
              when blocked_reason = 'original_url_missing' then null
              else blocked_reason
            end
          where id = ${item.id}
        `);
      }

      resolved.push({
        id: item.id,
        title: item.title,
        sourceId: item.source_id,
        sourceName: item.source_name,
        originalUrl: patch.originalUrl,
      });
    } catch (error) {
      errors.push({
        id: item.id,
        title: item.title,
        sourceId: item.source_id,
        sourceName: item.source_name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    userId: userId || 'all',
    sourceId: sourceId || 'all',
    scanned: candidates.length,
    resolvedCount: resolved.length,
    unresolvedCount: unresolved.length,
    errorCount: errors.length,
    resolved,
    unresolved: unresolved.slice(0, 20),
    errors: errors.slice(0, 20),
    nextAction: apply
      ? '已回填可解析的 BestBlogs 原站链接；仍未解析的条目会继续以榜单摘要降级展示。'
      : '默认仅诊断不写库；确认后加 --apply 回填 originalUrl。',
  }, null, 2));
}

void main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
