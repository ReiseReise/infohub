import { Hono } from 'hono';
import { requireAuth } from '../lib/auth.js';
import { getUserFetchSettings, upsertUserFetchSettings } from '../lib/fetch-settings.js';
import { getUserDailyReportSettings, upsertUserDailyReportSettings } from '../lib/daily-report-settings.js';

const app = new Hono();

app.get('/fetch', async (c) => {
  const authUser = requireAuth(c);
  const data = await getUserFetchSettings(authUser.userId);
  return c.json({ data });
});

app.put('/fetch', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const fields = ['autoFetchEnabled', 'autoSummaryEnabled', 'autoTranslationEnabled'] as const;
  const providedFields = fields.filter((field) => field in body);
  if (providedFields.length === 0) {
    return c.json({ error: 'At least one fetch setting must be provided' }, 400);
  }
  const invalidField = providedFields.find((field) => typeof body[field] !== 'boolean');
  if (invalidField) {
    return c.json({ error: `${invalidField} must be boolean` }, 400);
  }

  const data = await upsertUserFetchSettings(authUser.userId, {
    autoFetchEnabled: body.autoFetchEnabled,
    autoSummaryEnabled: body.autoSummaryEnabled,
    autoTranslationEnabled: body.autoTranslationEnabled,
  });

  return c.json({ data });
});

app.get('/daily', async (c) => {
  const authUser = requireAuth(c);
  const data = await getUserDailyReportSettings(authUser.userId);
  return c.json({ data });
});

app.put('/daily', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.dailyReportEnabled !== 'boolean') {
    return c.json({ error: 'dailyReportEnabled must be boolean' }, 400);
  }

  const data = await upsertUserDailyReportSettings(authUser.userId, body.dailyReportEnabled);
  return c.json({ data });
});

export default app;
