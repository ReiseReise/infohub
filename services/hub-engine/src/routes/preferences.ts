import { Hono } from 'hono';
import { requireAuth } from '../lib/auth.js';
import { getPreferenceProfile, rebuildPreferenceProfile } from '../lib/scoring-skills.js';

const app = new Hono();

app.get('/profile', async (c) => {
  const authUser = requireAuth(c);
  const result = await getPreferenceProfile(authUser.userId);
  return c.json({ data: result.profile, summary: result.feedbackSummary });
});

app.post('/rebuild-profile', async (c) => {
  const authUser = requireAuth(c);
  const result = await rebuildPreferenceProfile(authUser.userId);
  return c.json({
    message: 'Preference profile rebuilt',
    data: result.profile,
    summary: result.feedbackSummary,
  });
});

export default app;
