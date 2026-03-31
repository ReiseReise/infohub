import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';

const app = new Hono();

// GET /api/rules
app.get('/', async (c) => {
  const authUser = requireAuth(c);
  const scope = (c.req.query('scope') || 'user').toLowerCase();
  let rows;

  if (scope === 'global') {
    if (authUser.role !== 'admin') {
      return c.json({ error: 'Only admin can view global rules' }, 403);
    }
    rows = await db.select().from(schema.filterRules).where(eq(schema.filterRules.scope, 'global'));
  } else if (scope === 'effective') {
    rows = await db.select().from(schema.filterRules).where(and(
      eq(schema.filterRules.enabled, true),
      eq(schema.filterRules.scope, 'global'),
    ));
    const personal = await db.select().from(schema.filterRules).where(eq(schema.filterRules.userId, authUser.userId));
    rows = [...rows, ...personal];
  } else {
    rows = await db.select().from(schema.filterRules).where(eq(schema.filterRules.userId, authUser.userId));
  }
  return c.json({ data: rows });
});

// POST /api/rules
app.post('/', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json();
  const { name, type, config: ruleConfig, enabled, priority } = body;
  const scope = body.scope === 'global' ? 'global' : 'user';
  if (!name || !type) return c.json({ error: 'name and type required' }, 400);
  if (scope === 'global' && authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can create global rules' }, 403);
  }

  const result = await db.insert(schema.filterRules).values({
    userId: scope === 'global' ? null : authUser.userId,
    name,
    type,
    scope,
    config: ruleConfig || {},
    enabled: enabled ?? true,
    priority: priority || 0,
  }).returning();
  return c.json({ data: result[0] }, 201);
});

// PUT /api/rules/:id
app.put('/:id', async (c) => {
  const authUser = requireAuth(c);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid rule id' }, 400);
  const body = await c.req.json();
  const target = await db.select().from(schema.filterRules).where(eq(schema.filterRules.id, id)).limit(1);
  if (target.length === 0) return c.json({ error: 'Not found' }, 404);
  const rule = target[0];
  if (rule.scope === 'global' && authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can update global rules' }, 403);
  }
  if (rule.scope !== 'global' && rule.userId !== authUser.userId) {
    return c.json({ error: 'Not found' }, 404);
  }
  const update: Record<string, unknown> = {};
  for (const f of ['name', 'type', 'config', 'enabled', 'priority']) {
    if (body[f] !== undefined) update[f] = body[f];
  }
  const result = await db.update(schema.filterRules)
    .set(update)
    .where(eq(schema.filterRules.id, id))
    .returning();
  if (result.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ data: result[0] });
});

// DELETE /api/rules/:id
app.delete('/:id', async (c) => {
  const authUser = requireAuth(c);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid rule id' }, 400);
  const target = await db.select().from(schema.filterRules).where(eq(schema.filterRules.id, id)).limit(1);
  if (target.length === 0) return c.json({ error: 'Not found' }, 404);
  const rule = target[0];
  if (rule.scope === 'global') {
    if (authUser.role !== 'admin') {
      return c.json({ error: 'Only admin can delete global rules' }, 403);
    }
  } else if (rule.userId !== authUser.userId) {
    return c.json({ error: 'Not found' }, 404);
  }
  await db.delete(schema.filterRules).where(eq(schema.filterRules.id, id));
  return c.json({ message: 'Deleted' });
});

export default app;
