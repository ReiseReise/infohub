import { Hono } from 'hono';
import { eq, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { config } from '../config/index.js';
import { hashPassword, requireAuth, signAccessToken, verifyPassword } from '../lib/auth.js';

const app = new Hono();

function sanitizeUser(row: {
  id: string;
  email: string;
  username: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
}) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

// POST /api/auth/register
app.post('/register', async (c) => {
  if (!config.auth.allowRegistration) {
    return c.json({ error: 'Registration is disabled' }, 403);
  }

  const body = await c.req.json();
  const email = String(body.email || '').trim().toLowerCase();
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!email || !username || !password) {
    return c.json({ error: 'email, username, password are required' }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: 'password must be at least 8 characters' }, 400);
  }

  const exists = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      username: schema.users.username,
    })
    .from(schema.users)
    .where(or(
      eq(schema.users.email, email),
      eq(schema.users.username, username)
    ))
    .limit(1);

  if (exists.length > 0) {
    return c.json({ error: 'email or username already exists' }, 409);
  }

  const passwordHash = await hashPassword(password);
  const inserted = await db.insert(schema.users).values({
    email,
    username,
    passwordHash,
    role: 'user',
    isActive: true,
  }).returning();

  const user = inserted[0];
  const token = signAccessToken({
    userId: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
  });

  const freePlan = await db.select({ id: schema.plans.id })
    .from(schema.plans)
    .where(eq(schema.plans.name, 'free'))
    .limit(1);
  if (freePlan.length > 0) {
    await db.insert(schema.userQuotas).values({
      userId: user.id,
      planId: freePlan[0].id,
    }).onConflictDoNothing();
  }

  return c.json({
    accessToken: token,
    user: sanitizeUser(user),
  }, 201);
});

// POST /api/auth/login
app.post('/login', async (c) => {
  const body = await c.req.json();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!email || !password) {
    return c.json({ error: 'email and password are required' }, 400);
  }

  const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (rows.length === 0) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const user = rows[0];
  if (!user.isActive) {
    return c.json({ error: 'Account is disabled' }, 403);
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const token = signAccessToken({
    userId: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
  });

  return c.json({
    accessToken: token,
    user: sanitizeUser(user),
  });
});

// GET /api/auth/me
app.get('/me', async (c) => {
  const authUser = requireAuth(c);
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, authUser.userId)).limit(1);
  if (rows.length === 0) {
    return c.json({ error: 'User not found' }, 404);
  }
  if (!rows[0].isActive) {
    return c.json({ error: 'Account is disabled' }, 403);
  }

  return c.json({ user: sanitizeUser(rows[0]) });
});

export default app;
