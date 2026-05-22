import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import {
  buildQualityPolicySnapshot,
  deleteQualityPolicy,
  normalizeQualityPolicyConfig,
  upsertQualityPolicy,
} from '../lib/quality-policies.js';
import { SOURCE_TIERS } from '../lib/growth.js';

const app = new Hono();

app.get('/', async (c) => {
  const authUser = requireAuth(c);
  const scope = (c.req.query('scope') || 'effective').toLowerCase() as 'user' | 'global' | 'effective';
  if (scope === 'global' && authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can view global quality policies' }, 403);
  }
  const data = await buildQualityPolicySnapshot(authUser.userId, scope);
  return c.json({ data });
});

app.put('/tier/:tier', async (c) => {
  const authUser = requireAuth(c);
  const tier = String(c.req.param('tier') || '').trim().toUpperCase();
  if (!SOURCE_TIERS.includes(tier as (typeof SOURCE_TIERS)[number])) {
    return c.json({ error: 'Invalid source tier' }, 400);
  }

  const body = await c.req.json();
  const scope = body.scope === 'global' ? 'global' : 'user';
  if (scope === 'global' && authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can update global quality policies' }, 403);
  }

  const config = normalizeQualityPolicyConfig(body.config);
  const updated = await upsertQualityPolicy({
    userId: authUser.userId,
    scope,
    targetType: 'tier',
    targetKey: tier,
    config,
  });
  return c.json({ data: updated });
});

app.delete('/tier/:tier', async (c) => {
  const authUser = requireAuth(c);
  const tier = String(c.req.param('tier') || '').trim().toUpperCase();
  if (!SOURCE_TIERS.includes(tier as (typeof SOURCE_TIERS)[number])) {
    return c.json({ error: 'Invalid source tier' }, 400);
  }
  const scope = (c.req.query('scope') || 'user').toLowerCase() === 'global' ? 'global' : 'user';
  if (scope === 'global' && authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can delete global quality policies' }, 403);
  }
  await deleteQualityPolicy({
    userId: authUser.userId,
    scope,
    targetType: 'tier',
    targetKey: tier,
  });
  return c.json({ message: 'Deleted' });
});

app.put('/source/:sourceId', async (c) => {
  const authUser = requireAuth(c);
  const sourceId = Number(c.req.param('sourceId'));
  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    return c.json({ error: 'Invalid source id' }, 400);
  }

  const sourceRows = await db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(and(eq(schema.sources.id, sourceId), eq(schema.sources.userId, authUser.userId)))
    .limit(1);
  if (!sourceRows[0]) {
    return c.json({ error: 'Source not found' }, 404);
  }

  const body = await c.req.json();
  const config = normalizeQualityPolicyConfig(body.config);
  const updated = await upsertQualityPolicy({
    userId: authUser.userId,
    scope: 'user',
    targetType: 'source',
    targetKey: String(sourceId),
    config,
  });
  return c.json({ data: updated });
});

app.delete('/source/:sourceId', async (c) => {
  const authUser = requireAuth(c);
  const sourceId = Number(c.req.param('sourceId'));
  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    return c.json({ error: 'Invalid source id' }, 400);
  }
  await deleteQualityPolicy({
    userId: authUser.userId,
    scope: 'user',
    targetType: 'source',
    targetKey: String(sourceId),
  });
  return c.json({ message: 'Deleted' });
});

export default app;
