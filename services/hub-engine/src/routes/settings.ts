import { Hono } from 'hono';
import { requireAuth } from '../lib/auth.js';
import { getUserFetchSettings, upsertUserFetchSettings } from '../lib/fetch-settings.js';

const app = new Hono();

app.get('/fetch', async (c) => {
  const authUser = requireAuth(c);
  const data = await getUserFetchSettings(authUser.userId);
  return c.json({ data });
});

app.put('/fetch', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.autoFetchEnabled !== 'boolean') {
    return c.json({ error: 'autoFetchEnabled must be boolean' }, 400);
  }

  const data = await upsertUserFetchSettings(authUser.userId, {
    autoFetchEnabled: body.autoFetchEnabled,
  });

  return c.json({ data });
});

export default app;
