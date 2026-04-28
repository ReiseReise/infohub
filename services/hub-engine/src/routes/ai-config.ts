import { Hono } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { AI_SCENE_TYPES, getEffectiveAiSceneAvailability, getVisibleAiConfigsForUser, resolveAiConfigOwner, type AiSceneType } from '../lib/ai-configs.js';
import { buildAiSceneModelBinding } from '../lib/ai-scene-bindings.js';

const app = new Hono();

type AiConfigRow = Awaited<ReturnType<typeof getVisibleAiConfigsForUser>> extends Array<infer T> ? T : never;

const AI_SCENE_TYPE_SET = new Set<string>(AI_SCENE_TYPES);

type SceneModelPayload = {
  provider: string;
  model: string;
  baseUrl: string | null;
  modelLabel: string;
};

async function resolveSceneModelPayload(modelConfigId?: string | null): Promise<SceneModelPayload | null> {
  if (!modelConfigId) return null;

  const rows = await db
    .select({
      id: schema.modelConfigs.id,
      provider: schema.modelConfigs.provider,
      alias: schema.modelConfigs.alias,
      modelName: schema.modelConfigs.modelName,
      baseUrl: schema.modelConfigs.baseUrl,
      extraConfig: schema.modelConfigs.extraConfig,
      isActive: schema.modelConfigs.isActive,
    })
    .from(schema.modelConfigs)
    .where(eq(schema.modelConfigs.id, modelConfigId))
    .limit(1);

  const model = rows[0];
  if (!model) {
    throw new Error(`Model config ${modelConfigId} not found`);
  }

  return buildAiSceneModelBinding({
    id: model.id,
    provider: model.provider,
    alias: model.alias,
    modelName: model.modelName,
    baseUrl: model.baseUrl,
    extraConfig: model.extraConfig as Record<string, unknown> | null,
    isActive: Boolean(model.isActive),
  });
}

function normalizeSceneTypes(input: unknown): AiSceneType[] {
  const raw = Array.isArray(input) && input.length > 0 ? input : AI_SCENE_TYPES;
  const sceneTypes = raw.map((item) => String(item || '').trim()).filter(Boolean);
  const invalid = sceneTypes.filter((type) => !AI_SCENE_TYPE_SET.has(type));
  if (invalid.length > 0) {
    throw new Error(`Invalid AI scene type: ${invalid.join(', ')}`);
  }
  return Array.from(new Set(sceneTypes)) as AiSceneType[];
}

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
  let modelBinding: SceneModelPayload | null = null;
  try {
    modelBinding = await resolveSceneModelPayload(body.modelConfigId || null);
  } catch (err) {
    return c.json({ error: (err as Error).message || 'Invalid model config' }, 400);
  }
  const payload = {
    userId: authUser.userId,
    name: body.name,
    provider: modelBinding?.provider || body.provider || 'openai',
    model: modelBinding?.model || body.model || 'gpt-4o-mini',
    apiKeyEnc: body.apiKeyEnc,
    baseUrl: modelBinding ? modelBinding.baseUrl : body.baseUrl,
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

// POST /api/ai-configs/batch-model
app.post('/batch-model', async (c) => {
  const authUser = requireAuth(c);
  if (authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can manage AI scene bindings' }, 403);
  }
  const body = await c.req.json();
  const modelConfigId = String(body.modelConfigId || '').trim();
  if (!modelConfigId) return c.json({ error: 'modelConfigId is required' }, 400);

  let sceneTypes: AiSceneType[];
  let modelBinding: SceneModelPayload | null = null;
  try {
    sceneTypes = normalizeSceneTypes(body.types);
    modelBinding = await resolveSceneModelPayload(modelConfigId);
  } catch (err) {
    return c.json({ error: (err as Error).message || 'Invalid batch binding payload' }, 400);
  }
  if (!modelBinding) return c.json({ error: 'modelConfigId is required' }, 400);

  const touched: AiConfigRow[] = [];
  for (const type of sceneTypes) {
    const existing = await db
      .select()
      .from(schema.aiConfigs)
      .where(and(eq(schema.aiConfigs.userId, authUser.userId), eq(schema.aiConfigs.type, type)))
      .orderBy(desc(schema.aiConfigs.isActive), desc(schema.aiConfigs.createdAt), desc(schema.aiConfigs.id))
      .limit(1);

    const current = existing[0];
    const payload = {
      name: current?.name || `${type} 默认配置`,
      provider: modelBinding.provider,
      model: modelBinding.model,
      baseUrl: modelBinding.baseUrl,
      temperature: current?.temperature ?? body.temperature ?? 0.3,
      promptTemplate: current?.promptTemplate || '',
      promptTemplateId: current?.promptTemplateId || null,
      modelConfigId,
      type,
      isActive: body.isActive ?? current?.isActive ?? true,
    };

    if (current) {
      const updated = await db.update(schema.aiConfigs)
        .set(payload)
        .where(and(eq(schema.aiConfigs.id, current.id), eq(schema.aiConfigs.userId, authUser.userId)))
        .returning();
      if (updated[0]) touched.push(updated[0]);
    } else {
      const inserted = await db.insert(schema.aiConfigs)
        .values({ ...payload, userId: authUser.userId })
        .returning();
      if (inserted[0]) touched.push(inserted[0]);
    }
  }

  const data = await enrichAiConfigs(touched, { includeReferences: true });
  return c.json({ data, updated: data.length });
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
  if (body.modelConfigId) {
    try {
      const modelBinding = await resolveSceneModelPayload(body.modelConfigId);
      update.provider = modelBinding?.provider;
      update.model = modelBinding?.model;
      update.baseUrl = modelBinding?.baseUrl;
    } catch (err) {
      return c.json({ error: (err as Error).message || 'Invalid model config' }, 400);
    }
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
