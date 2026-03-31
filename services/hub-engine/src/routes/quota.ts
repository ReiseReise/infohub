import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';

const app = new Hono();

async function ensureUserQuota(userId: string) {
  const existing = await db.select()
    .from(schema.userQuotas)
    .where(eq(schema.userQuotas.userId, userId))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const freePlan = await db.select({ id: schema.plans.id })
    .from(schema.plans)
    .where(eq(schema.plans.name, 'free'))
    .limit(1);

  const inserted = await db.insert(schema.userQuotas).values({
    userId,
    planId: freePlan[0]?.id,
  }).returning();
  return inserted[0];
}

// GET /api/quota/me
app.get('/me', async (c) => {
  const authUser = requireAuth(c);
  await ensureUserQuota(authUser.userId);

  const rows = await db
    .select({
      id: schema.userQuotas.id,
      userId: schema.userQuotas.userId,
      planId: schema.userQuotas.planId,
      planName: schema.plans.name,
      audioMinutesPerMonth: schema.plans.audioMinutesPerMonth,
      articlesPerDay: schema.plans.articlesPerDay,
      audioMinutesUsedMonth: schema.userQuotas.audioMinutesUsedMonth,
      audioMinutesResetAt: schema.userQuotas.audioMinutesResetAt,
      autoTranscribeEnabled: schema.userQuotas.autoTranscribeEnabled,
      maxAutoPerDay: schema.userQuotas.maxAutoPerDay,
      maxEpisodeMinutes: schema.userQuotas.maxEpisodeMinutes,
      monthlyBudgetLimit: schema.userQuotas.monthlyBudgetLimit,
      autoCountToday: schema.userQuotas.autoCountToday,
      autoCountResetAt: schema.userQuotas.autoCountResetAt,
    })
    .from(schema.userQuotas)
    .leftJoin(schema.plans, eq(schema.userQuotas.planId, schema.plans.id))
    .where(eq(schema.userQuotas.userId, authUser.userId))
    .limit(1);

  return c.json({ data: rows[0] || null });
});

// PUT /api/quota/me
app.put('/me', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json().catch(() => ({}));

  const patch: Record<string, unknown> = {};
  if (body.autoTranscribeEnabled !== undefined) patch.autoTranscribeEnabled = Boolean(body.autoTranscribeEnabled);
  if (body.maxAutoPerDay !== undefined) patch.maxAutoPerDay = Number(body.maxAutoPerDay);
  if (body.maxEpisodeMinutes !== undefined) patch.maxEpisodeMinutes = Number(body.maxEpisodeMinutes);
  if (body.monthlyBudgetLimit !== undefined) {
    patch.monthlyBudgetLimit = body.monthlyBudgetLimit === null || body.monthlyBudgetLimit === ''
      ? null
      : Number(body.monthlyBudgetLimit);
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'No updatable fields provided' }, 400);
  }

  await ensureUserQuota(authUser.userId);
  const updated = await db.update(schema.userQuotas)
    .set(patch)
    .where(eq(schema.userQuotas.userId, authUser.userId))
    .returning();

  return c.json({ data: updated[0] || null });
});

// GET /api/quota/plans
app.get('/plans', async (c) => {
  requireAuth(c);
  const rows = await db.select().from(schema.plans);
  return c.json({ data: rows });
});

// PUT /api/quota/me/plan
app.put('/me/plan', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const planName = String(body.planName || '').trim();
  if (!planName) return c.json({ error: 'planName is required' }, 400);

  const plan = await db.select().from(schema.plans).where(eq(schema.plans.name, planName)).limit(1);
  if (plan.length === 0) return c.json({ error: 'Plan not found' }, 404);

  await ensureUserQuota(authUser.userId);
  const updated = await db.update(schema.userQuotas)
    .set({ planId: plan[0].id })
    .where(eq(schema.userQuotas.userId, authUser.userId))
    .returning();

  return c.json({ data: updated[0] || null });
});

export default app;
