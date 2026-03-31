import { Hono } from 'hono';
import { requireAuth } from '../lib/auth.js';
import {
  createDefaultScoringSkill,
  createScoringSkill,
  deleteScoringSkill,
  defaultSkillPrompt,
  defaultSkillRubric,
  ensureDefaultScoringSkills,
  FEEDBACK_REASON_TAGS,
  LAST_ACTIVE_SKILL_ERROR,
  listScoringSkills,
  SKILL_PRESET_KEYS,
  toggleScoringSkill,
  updateScoringSkill,
} from '../lib/scoring-skills.js';

const app = new Hono();

app.get('/', async (c) => {
  const authUser = requireAuth(c);
  let rows = await listScoringSkills(authUser.userId);
  if (rows.length === 0 || !rows.some((row) => row.status === 'active')) {
    await ensureDefaultScoringSkills(authUser.userId);
    rows = await listScoringSkills(authUser.userId);
  }
  return c.json({
    data: rows,
    defaults: {
      prompt: defaultSkillPrompt(),
      rubric: defaultSkillRubric(),
      presets: SKILL_PRESET_KEYS,
      reasonTags: FEEDBACK_REASON_TAGS,
    },
  });
});

app.post('/', async (c) => {
  const authUser = requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const shouldCreateDefault = body.createDefault === true;
  if (shouldCreateDefault) {
    await createDefaultScoringSkill(authUser.userId);
    const refreshed = await listScoringSkills(authUser.userId);
    return c.json({ data: refreshed[0] || null }, 201);
  }

  const row = await createScoringSkill(authUser.userId, body);
  return c.json({ data: row }, 201);
});

app.put('/:id', async (c) => {
  const authUser = requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid skill id' }, 400);
  const body = await c.req.json().catch(() => ({}));
  let row = null;
  try {
    row = await updateScoringSkill(authUser.userId, id, body);
  } catch (error) {
    if ((error as Error).message === LAST_ACTIVE_SKILL_ERROR) {
      return c.json({ error: LAST_ACTIVE_SKILL_ERROR }, 409);
    }
    throw error;
  }
  if (!row) return c.json({ error: 'Skill not found' }, 404);
  return c.json({ data: row });
});

app.post('/:id/toggle', async (c) => {
  const authUser = requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid skill id' }, 400);
  let row = null;
  try {
    row = await toggleScoringSkill(authUser.userId, id);
  } catch (error) {
    if ((error as Error).message === LAST_ACTIVE_SKILL_ERROR) {
      return c.json({ error: LAST_ACTIVE_SKILL_ERROR }, 409);
    }
    throw error;
  }
  if (!row) return c.json({ error: 'Skill not found' }, 404);
  return c.json({ data: row });
});

app.delete('/:id', async (c) => {
  const authUser = requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid skill id' }, 400);
  let row = null;
  try {
    row = await deleteScoringSkill(authUser.userId, id);
  } catch (error) {
    if ((error as Error).message === LAST_ACTIVE_SKILL_ERROR) {
      return c.json({ error: LAST_ACTIVE_SKILL_ERROR }, 409);
    }
    throw error;
  }
  if (!row) return c.json({ error: 'Skill not found' }, 404);
  return c.json({ message: 'Deleted' });
});

export default app;
