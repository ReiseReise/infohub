import { Hono } from 'hono';
import { eq, and, gte, desc, ilike, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';

const app = new Hono();

// GET /api/knowledge/items — 增量拉取
app.get('/items', async (c) => {
  const authUser = requireAuth(c);
  const since = c.req.query('since');
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);

  const conditions = [
    eq(schema.items.userId, authUser.userId),
    eq(schema.items.isFiltered, false),
  ];
  if (since) {
    conditions.push(gte(schema.items.fetchedAt, new Date(since)));
  }

  const rows = await db
    .select({
      id: schema.items.id,
      title: schema.items.title,
      url: schema.items.url,
      aiSummary: schema.items.aiSummary,
      aiTags: schema.items.aiTags,
      aiScore: schema.items.aiScore,
      publishedAt: schema.items.publishedAt,
      fetchedAt: schema.items.fetchedAt,
      sourceType: schema.items.sourceType,
    })
    .from(schema.items)
    .where(and(...conditions))
    .orderBy(desc(schema.items.fetchedAt))
    .limit(limit);

  return c.json({ data: rows, count: rows.length });
});

// GET /api/knowledge/search — 全文 + 向量混合搜索
app.get('/search', async (c) => {
  const authUser = requireAuth(c);
  const q = c.req.query('q');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const mode = c.req.query('mode') || 'text'; // 'text' | 'vector' | 'hybrid'

  if (!q) {
    return c.json({ error: 'Query parameter "q" is required' }, 400);
  }

  if (mode === 'text' || mode === 'hybrid') {
    const textResults = await db
      .select({
        id: schema.items.id,
        title: schema.items.title,
        url: schema.items.url,
        aiSummary: schema.items.aiSummary,
        aiScore: schema.items.aiScore,
        snippet: schema.items.snippet,
        publishedAt: schema.items.publishedAt,
        sourceName: schema.sources.name,
      })
      .from(schema.items)
      .leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id))
      .where(and(
        eq(schema.items.userId, authUser.userId),
        eq(schema.items.isFiltered, false),
        or(
          ilike(schema.items.title, `%${q}%`),
          ilike(schema.items.snippet, `%${q}%`),
          ilike(schema.items.aiSummary, `%${q}%`)
        )
      ))
      .orderBy(desc(schema.items.priorityScore))
      .limit(limit);

    if (mode === 'text') {
      return c.json({ data: textResults, mode: 'text', count: textResults.length });
    }

    // Hybrid: also do vector search and merge
    try {
      const vectorResults = await db.execute(sql`
        SELECT id, title, url, ai_summary, ai_score,
               1 - (embedding <=> (
                 SELECT embedding FROM hub.items
                 WHERE title ILIKE ${'%' + q + '%'} AND embedding IS NOT NULL
                   AND user_id = ${authUser.userId}::uuid
                 LIMIT 1
               )) AS similarity
        FROM hub.items
        WHERE embedding IS NOT NULL
          AND is_filtered = false
          AND user_id = ${authUser.userId}::uuid
        ORDER BY embedding <=> (
          SELECT embedding FROM hub.items
          WHERE title ILIKE ${'%' + q + '%'} AND embedding IS NOT NULL
            AND user_id = ${authUser.userId}::uuid
          LIMIT 1
        )
        LIMIT ${limit}
      `);

      const merged = [...textResults];
      const existingIds = new Set(textResults.map(r => r.id));

      for (const vr of vectorResults as any[]) {
        if (!existingIds.has(vr.id)) {
          merged.push(vr);
        }
      }

      return c.json({ data: merged.slice(0, limit), mode: 'hybrid', count: merged.length });
    } catch {
      return c.json({ data: textResults, mode: 'text_fallback', count: textResults.length });
    }
  }

  // Vector-only search (requires embedding of query — simplified fallback)
  return c.json({ error: 'Vector-only search requires embedding API, use mode=text or mode=hybrid' }, 400);
});

// GET /api/knowledge/daily/:date — 日报
app.get('/daily/:date', async (c) => {
  const authUser = requireAuth(c);
  const date = c.req.param('date');
  const rows = await db
    .select()
    .from(schema.insights)
    .where(and(eq(schema.insights.date, date), eq(schema.insights.userId, authUser.userId)))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'No report for this date' }, 404);
  }

  return c.json({ data: rows[0] });
});

export default app;
