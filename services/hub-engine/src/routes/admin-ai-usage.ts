import { Hono } from 'hono';
import { requireAuth } from '../lib/auth.js';
import { getAiUsageEvents, getAiUsageSummary } from '../lib/ai-usage.js';

const app = new Hono();

app.get('/summary', async (c) => {
  const authUser = requireAuth(c);
  if (authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can view AI usage logs' }, 403);
  }
  const data = await getAiUsageSummary({
    timeWindow: c.req.query('timeWindow') || '7d',
    interval: c.req.query('interval') || undefined,
    from: c.req.query('from') || null,
    to: c.req.query('to') || null,
  });
  return c.json({ data, source: 'hub' });
});

app.get('/events', async (c) => {
  const authUser = requireAuth(c);
  if (authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can view AI usage logs' }, 403);
  }
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const data = await getAiUsageEvents({
    limit,
    status: c.req.query('status') || null,
    sceneType: c.req.query('sceneType') || null,
    provider: c.req.query('provider') || null,
    search: c.req.query('search') || null,
    from: c.req.query('from') || null,
    to: c.req.query('to') || null,
  });
  return c.json({ data, source: 'hub' });
});

export default app;
