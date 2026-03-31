import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { getEffectiveAiSceneAvailability, getVisibleAiConfigsForUser, resolveAiConfigOwner } from '../lib/ai-configs.js';

const app = new Hono();

type AiConfigRow = Awaited<ReturnType<typeof getVisibleAiConfigsForUser>> extends Array<infer T> ? T : never;

async function enrichAiConfigs(rows: AiConfigRow[], options: { includeReferences: boolean }) {
  const promptIds = Array.from(new Set(rows.map((row) => row.promptTemplateId).filter((value): value is string => Boolean(value))));
  const modelIds = Array.from(new Set(rows.map((row) => row.modelConfigId).filter((value): value is string => Boolean(value))));

  const promptNameById = new Map<string, string>();
  if (promptIds.length > 0) {
    const prompts = await db
      .select({ id: schema.promptTemplates.id, name: schema.promptTemplates.name })
      .from(schema.promptTemplates)
      .where(inArray(schema.promptTemplates.id, promptIds));
    for (const prompt of prompts) {
      promptNameById.set(prompt.id, prompt.name);
    }
  }

  const modelLabelById = new Map<string, string>();
  if (modelIds.length > 0) {
    const models = await db
      .select({
        id: schema.modelConfigs.id,
        alias: schema.modelConfigs.alias,
        modelName: schema.modelConfigs.modelName,
        provider: schema.modelConfigs.provider,
        extraConfig: schema.modelConfigs.extraConfig,
      })
      .from(schema.modelConfigs)
      .where(inArray(schema.modelConfigs.id, modelIds));
    for (const model of models) {
      const endpointId = model.provider === 'volcengine_ark'
        ? String((model.extraConfig as Record<string, unknown> | null)?.endpointId || model.modelName || '')
        : model.modelName;
      modelLabelById.set(model.id, model.alias || endpointId || model.modelName || '');
    }
  }

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    name: row.name,
    provider: row.provider,
    model: row.model,
    modelLabel: (row.modelConfigId && modelLabelById.get(row.modelConfigId)) || row.model || '',
    baseUrl: options.includeReferences ? row.baseUrl : null,
    temperature: row.temperature,
    promptTemplate: options.includeReferences ? row.promptTemplate : '',
    promptTemplateName: (row.promptTemplateId && promptNameById.get(row.promptTemplateId)) || null,
    promptTemplateId: options.includeReferences ? row.promptTemplateId : null,
    modelConfigId: options.includeReferences ? row.modelConfigId : null,
    type: row.type,
    isActive: row.isActive,
    createdAt: row.createdAt,
  }));
}

function buildOwnerLabel(role: string, resolution: Awaited<ReturnType<typeof resolveAiConfigOwner>>) {
  if (role === 'admin') {
    return resolution.ownerEmail ?? resolution.ownerUsername ?? resolution.ownerUserId;
  }
  return resolution.scope === 'admin' ? '管理员统一配置' : '个人配置';
}

// GET /api/ai-configs
app.get('/', async (c) => {
  const authUser = requireAuth(c);
  const resolution = await resolveAiConfigOwner(authUser.userId);
  const rows = await getVisibleAiConfigsForUser(authUser.userId, authUser.role);
  const availableScenes = Array.from(await getEffectiveAiSceneAvailability(authUser.userId));
  const data = await enrichAiConfigs(rows, { includeReferences: authUser.role === 'admin' });
  return c.json({
    data,
    meta: {
      ownerLabel: buildOwnerLabel(authUser.role, resolution),
      scope: resolution.scope,
      resolvedFrom: resolution.resolvedFrom,
      availableScenes,
    },
  });
});

// POST /api/ai-configs
app.post('/', async (c) => {
  const authUser = requireAuth(c);
  if (authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can manage AI scene bindings' }, 403);
  }
  const body = await c.req.json();
  const payload = {
    userId: authUser.userId,
    name: body.name,
    provider: body.provider || 'openai',
    model: body.model || 'gpt-4o-mini',
    apiKeyEnc: body.apiKeyEnc,
    baseUrl: body.baseUrl,
    temperature: body.temperature ?? 0.3,
    promptTemplate: body.promptTemplate || '',
    promptTemplateId: body.promptTemplateId || null,
    modelConfigId: body.modelConfigId || null,
    type: body.type || 'scoring',
    isActive: body.isActive ?? false,
  };
  const result = await db.insert(schema.aiConfigs).values(payload).returning();
  const data = await enrichAiConfigs(result, { includeReferences: true });
  return c.json({ data: data[0] }, 201);
});

// PUT /api/ai-configs/:id
app.put('/:id', async (c) => {
  const authUser = requireAuth(c);
  if (authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can manage AI scene bindings' }, 403);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid config id' }, 400);
  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  for (const f of ['name', 'provider', 'model', 'apiKeyEnc', 'baseUrl', 'temperature', 'promptTemplate', 'promptTemplateId', 'modelConfigId', 'type', 'isActive']) {
    if (body[f] !== undefined) update[f] = body[f];
  }
  const result = await db.update(schema.aiConfigs)
    .set(update)
    .where(and(eq(schema.aiConfigs.id, id), eq(schema.aiConfigs.userId, authUser.userId)))
    .returning();
  if (result.length === 0) return c.json({ error: 'Not found' }, 404);
  const data = await enrichAiConfigs(result, { includeReferences: true });
  return c.json({ data: data[0] });
});

// DELETE /api/ai-configs/:id
app.delete('/:id', async (c) => {
  const authUser = requireAuth(c);
  if (authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can manage AI scene bindings' }, 403);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid config id' }, 400);
  await db.delete(schema.aiConfigs).where(and(eq(schema.aiConfigs.id, id), eq(schema.aiConfigs.userId, authUser.userId)));
  return c.json({ message: 'Deleted' });
});

export default app;
