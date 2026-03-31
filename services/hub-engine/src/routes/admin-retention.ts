import { Hono } from 'hono';
import { requireAuth } from '../lib/auth.js';
import { getRetentionStatus, runRetention } from '../lib/retention.js';

const app = new Hono();

app.get('/status', async (c) => {
  const authUser = requireAuth(c);
  if (authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can view retention status' }, 403);
  }
  const latest = await getRetentionStatus();
  return c.json({ data: latest });
});

app.post('/run', async (c) => {
  const authUser = requireAuth(c);
  if (authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can run retention' }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  const retentionDays = Math.max(parseInt(String(body.retentionDays || '30'), 10) || 30, 1);
  const dryRun = body.dryRun !== false;
  const data = await runRetention({ retentionDays, dryRun });
  return c.json({ data });
});

export default app;
