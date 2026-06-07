import { Hono } from 'hono';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { completeWithModelConfig, getEffectiveAiConfig, resolveAiConfigOwner } from '../lib/ai-configs.js';
import { buildAiSceneModelBinding } from '../lib/ai-scene-bindings.js';
import { requireAuth } from '../lib/auth.js';
import { getAiUsageEvents, logAiUsage } from '../lib/ai-usage.js';
import { resolveItemText } from '../lib/item-enrichment.js';
import { AI_TOKEN_BUDGETS } from '../lib/ai-token-budgets.js';
import { scoreItemsDetailed } from '../processors/ai-scorer.js';
import {
  buildScoringModelRemediation,
  buildScoringModelProbeSummary,
  buildScoringModelRepairSummary,
  buildFallbackScoringRecoverySummary,
  buildScoringSkillHealthSummary,
  buildFallbackScoringPrompt,
  canRecoverFallbackScoringItems,
  createDefaultScoringSkill,
  createScoringSkill,
  deleteScoringSkill,
  defaultSkillPrompt,
  defaultSkillRubric,
  ensureDefaultScoringSkills,
  FEEDBACK_REASON_TAGS,
  FALLBACK_SCORING_RISK_FLAGS,
  hasFallbackScoringRiskFlags,
  isFallbackScoringRecoveryStatus,
  LAST_ACTIVE_SKILL_ERROR,
  listScoringSkills,
  normalizeFallbackScoringRecoveryRequest,
  parseSkillResponse,
  resolveScoringModelCircuitBreaker,
  SKILL_PRESET_KEYS,
  toggleScoringSkill,
  updateScoringSkill,
} from '../lib/scoring-skills.js';

const app = new Hono();

function modelLabel(model: { alias?: string | null; modelName?: string | null; id: string }) {
  return model.alias || model.modelName || model.id;
}

type ProbeModelRow = {
  id: string;
  alias: string | null;
  provider: string;
  modelName: string;
  modelType: string;
  baseUrl: string | null;
  extraConfig: unknown;
  isActive: boolean;
};

async function getProbeModel(modelConfigId: string): Promise<ProbeModelRow | null> {
  const rows = await db
    .select({
      id: schema.modelConfigs.id,
      alias: schema.modelConfigs.alias,
      provider: schema.modelConfigs.provider,
      modelName: schema.modelConfigs.modelName,
      modelType: schema.modelConfigs.modelType,
      baseUrl: schema.modelConfigs.baseUrl,
      extraConfig: schema.modelConfigs.extraConfig,
      isActive: schema.modelConfigs.isActive,
    })
    .from(schema.modelConfigs)
    .where(eq(schema.modelConfigs.id, modelConfigId))
    .limit(1);
  return rows[0] || null;
}

async function selectProbeItems(userId: string, limit: number) {
  return db
    .select({
      id: schema.items.id,
      title: schema.items.title,
      snippet: schema.items.snippet,
      content: schema.items.content,
      contentStatus: schema.items.contentStatus,
    })
    .from(schema.items)
    .where(and(
      eq(schema.items.userId, userId),
      eq(schema.items.isFiltered, false),
      inArray(schema.items.processingStatus, ['score_failed', 'raw']),
    ))
    .orderBy(desc(schema.items.processingStatus), desc(schema.items.fetchedAt))
    .limit(limit);
}

async function runScoringModelProbe(input: {
  userId: string;
  model: ProbeModelRow;
  limit: number;
}) {
  const items = await selectProbeItems(input.userId, input.limit);
  const results = [];
  for (const item of items) {
    const source = resolveItemText(item);
    const prompt = buildFallbackScoringPrompt({
      title: item.title,
      content: source.text,
    });
    try {
      const response = await completeWithModelConfig(input.model.id, prompt, {
        temperature: 0.1,
        maxTokens: AI_TOKEN_BUDGETS.feedScoringFallback,
      });
      const parsed = parseSkillResponse(response.text);
      results.push({
        itemId: item.id,
        title: item.title,
        ok: true,
        score: parsed.score,
        decision: parsed.decision,
        confidence: parsed.confidence,
      });
      await logAiUsage({
        userId: input.userId,
        sceneType: 'feed_scoring_model_probe',
        status: 'success',
        provider: response.provider || input.model.provider,
        modelName: response.model || input.model.modelName,
        endpointId: response.endpointId || null,
        modelConfigId: input.model.id,
        targetType: 'item',
        targetId: item.id,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        totalTokens: response.totalTokens,
        estimatedCost: response.estimatedCost,
        latencyMs: response.latencyMs,
        providerRequestId: response.providerRequestId,
        apiKind: response.apiKind,
        promptPreview: prompt,
        responsePreview: response.text,
        label: `${item.title} / scoring model probe`,
      });
    } catch (error) {
      const message = (error as Error).message || 'unknown_model_probe_error';
      results.push({
        itemId: item.id,
        title: item.title,
        ok: false,
        error: message,
      });
      await logAiUsage({
        userId: input.userId,
        sceneType: 'feed_scoring_model_probe',
        status: 'error',
        provider: input.model.provider,
        modelName: input.model.modelName,
        modelConfigId: input.model.id,
        targetType: 'item',
        targetId: item.id,
        promptPreview: prompt,
        label: `${item.title} / scoring model probe`,
        errorMessage: message,
      });
    }
  }

  return buildScoringModelProbeSummary({
    modelConfigId: input.model.id,
    modelLabel: modelLabel(input.model),
    results,
  });
}

async function bindScoringSceneToModel(userId: string, model: ProbeModelRow) {
  const binding = buildAiSceneModelBinding({
    id: model.id,
    provider: model.provider,
    alias: model.alias,
    modelName: model.modelName,
    baseUrl: model.baseUrl,
    extraConfig: model.extraConfig as Record<string, unknown> | null,
    isActive: model.isActive,
  });
  const existing = await db
    .select()
    .from(schema.aiConfigs)
    .where(and(eq(schema.aiConfigs.userId, userId), eq(schema.aiConfigs.type, 'scoring')))
    .orderBy(desc(schema.aiConfigs.isActive), desc(schema.aiConfigs.createdAt), desc(schema.aiConfigs.id))
    .limit(1);
  const current = existing[0];
  const payload = {
    name: current?.name || 'scoring 默认配置',
    provider: binding.provider,
    model: binding.model,
    baseUrl: binding.baseUrl,
    temperature: current?.temperature ?? 0.3,
    promptTemplate: current?.promptTemplate || '',
    promptTemplateId: current?.promptTemplateId || null,
    modelConfigId: model.id,
    type: 'scoring',
    isActive: true,
  };

  if (current) {
    const updated = await db.update(schema.aiConfigs)
      .set(payload)
      .where(and(eq(schema.aiConfigs.id, current.id), eq(schema.aiConfigs.userId, userId)))
      .returning();
    return updated[0] || null;
  }

  const inserted = await db.insert(schema.aiConfigs)
    .values({ ...payload, userId })
    .returning();
  return inserted[0] || null;
}

async function listVerifiedScoringRecoveredItemIds(userId: string, itemIds: string[]) {
  if (itemIds.length === 0) return [];
  const rows = await db
    .select({
      itemId: schema.itemScoreBreakdowns.itemId,
      riskFlags: schema.itemScoreBreakdowns.riskFlags,
    })
    .from(schema.itemScoreBreakdowns)
    .where(and(
      eq(schema.itemScoreBreakdowns.userId, userId),
      inArray(schema.itemScoreBreakdowns.itemId, itemIds),
    ));
  const flagsByItem = new Map<string, string[]>();
  const seenItems = new Set<string>();
  for (const row of rows) {
    const flags = Array.isArray(row.riskFlags) ? row.riskFlags.map((flag) => String(flag)) : [];
    seenItems.add(row.itemId);
    flagsByItem.set(row.itemId, [...(flagsByItem.get(row.itemId) || []), ...flags]);
  }
  return itemIds.filter((itemId) => {
    if (!seenItems.has(itemId)) return false;
    const flags = flagsByItem.get(itemId);
    return !hasFallbackScoringRiskFlags(flags || []);
  });
}

function buildVerifiedScoringStageResult(scoring: Awaited<ReturnType<typeof scoreItemsDetailed>>, recoveredCount: number) {
  return {
    ...scoring,
    processed: recoveredCount,
    failed: Math.max(scoring.attempted - recoveredCount - scoring.skipped, 0),
  };
}

async function listFallbackScoringRecoveryCandidates(userId: string, limit: number, itemIds: string[] = []) {
  const fallbackCondition = sql`${schema.itemScoreBreakdowns.riskFlags} ?| array[${sql.join(
    FALLBACK_SCORING_RISK_FLAGS.map((flag) => sql`${flag}`),
    sql`, `,
  )}]`;
  const recoveryStatuses = ['scored', 'done'].filter(isFallbackScoringRecoveryStatus);
  const conditions = [
    eq(schema.items.userId, userId),
    eq(schema.itemScoreBreakdowns.userId, userId),
    eq(schema.items.isFiltered, false),
    inArray(schema.items.processingStatus, recoveryStatuses),
    fallbackCondition,
  ];
  if (itemIds.length > 0) {
    conditions.push(inArray(schema.items.id, itemIds));
  }

  const countRows = await db
    .select({ count: sql<number>`count(distinct ${schema.items.id})` })
    .from(schema.items)
    .innerJoin(schema.itemScoreBreakdowns, eq(schema.itemScoreBreakdowns.itemId, schema.items.id))
    .where(and(...conditions));
  const rows = await db
    .select({
      id: schema.items.id,
      fetchedAt: schema.items.fetchedAt,
    })
    .from(schema.items)
    .innerJoin(schema.itemScoreBreakdowns, eq(schema.itemScoreBreakdowns.itemId, schema.items.id))
    .where(and(...conditions))
    .groupBy(schema.items.id, schema.items.fetchedAt)
    .orderBy(desc(schema.items.fetchedAt))
    .limit(limit);

  return {
    candidateCount: Number(countRows[0]?.count || 0),
    itemIds: rows.map((row) => row.id),
  };
}

app.get('/', async (c) => {
  const authUser = requireAuth(c);
  let rows = await listScoringSkills(authUser.userId);
  if (rows.length === 0 || !rows.some((row) => row.status === 'active')) {
    await ensureDefaultScoringSkills(authUser.userId);
    rows = await listScoringSkills(authUser.userId);
  }
  const [skillEvents, scoringEvents, probeEvents] = await Promise.all([
    getAiUsageEvents({
      userId: authUser.userId,
      sceneType: 'feed_scoring_skill',
      limit: 50,
    }),
    getAiUsageEvents({
      userId: authUser.userId,
      sceneType: 'feed_scoring',
      limit: 20,
    }),
    getAiUsageEvents({
      userId: authUser.userId,
      sceneType: 'feed_scoring_model_probe',
      limit: 20,
    }),
  ]);
  const [scoringConfig, availableModels] = await Promise.all([
    getEffectiveAiConfig(authUser.userId, 'scoring').catch(() => null),
    db
      .select({
        id: schema.modelConfigs.id,
        alias: schema.modelConfigs.alias,
        provider: schema.modelConfigs.provider,
        modelName: schema.modelConfigs.modelName,
        modelType: schema.modelConfigs.modelType,
        isActive: schema.modelConfigs.isActive,
        isDefault: schema.modelConfigs.isDefault,
        testStatus: schema.modelConfigs.testStatus,
      })
      .from(schema.modelConfigs)
      .where(eq(schema.modelConfigs.isActive, true)),
  ]);
  const health = buildScoringSkillHealthSummary(rows, [...skillEvents, ...scoringEvents]);
  return c.json({
    data: rows,
    health: {
      ...health,
      remediation: buildScoringModelRemediation({
        currentModelConfigId: scoringConfig?.modelConfigId || null,
        unstableModels: health.unstableModels,
        probeEvents,
        availableModels,
      }),
    },
    defaults: {
      prompt: defaultSkillPrompt(),
      rubric: defaultSkillRubric(),
      presets: SKILL_PRESET_KEYS,
      reasonTags: FEEDBACK_REASON_TAGS,
    },
  });
});

app.post('/model-probe', async (c) => {
  const authUser = requireAuth(c);
  if (authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can validate scoring model remediation' }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  const modelConfigId = String(body.modelConfigId || '').trim();
  const limit = Math.min(Math.max(Number(body.limit || 2), 1), 3);
  if (!modelConfigId) return c.json({ error: 'modelConfigId is required' }, 400);

  const model = await getProbeModel(modelConfigId);
  if (!model) return c.json({ error: 'Model config not found' }, 404);
  if (!model.isActive || model.modelType !== 'llm') {
    return c.json({ error: 'Model config must be an active LLM model' }, 400);
  }

  return c.json({
    data: await runScoringModelProbe({
      userId: authUser.userId,
      model,
      limit,
    }),
  });
});

app.post('/model-remediation/apply', async (c) => {
  const authUser = requireAuth(c);
  if (authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can apply scoring model remediation' }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  const modelConfigId = String(body.modelConfigId || '').trim();
  const limit = Math.min(Math.max(Number(body.limit || 2), 1), 5);
  if (!modelConfigId) return c.json({ error: 'modelConfigId is required' }, 400);

  const model = await getProbeModel(modelConfigId);
  if (!model) return c.json({ error: 'Model config not found' }, 404);
  if (!model.isActive || model.modelType !== 'llm') {
    return c.json({ error: 'Model config must be an active LLM model' }, 400);
  }

  const probe = await runScoringModelProbe({
    userId: authUser.userId,
    model,
    limit: Math.min(limit, 3),
  });
  if (!probe.canSwitch) {
    return c.json({
      error: probe.message,
      data: { switched: false, probe },
    }, 409);
  }

  const owner = await resolveAiConfigOwner(authUser.userId);
  const configRow = await bindScoringSceneToModel(owner.ownerUserId, model);
  const itemIds = probe.results
    .filter((result) => result.ok)
    .map((result) => result.itemId)
    .slice(0, limit);
  const scoring = itemIds.length > 0
    ? await scoreItemsDetailed(authUser.userId, itemIds.length, { itemIds })
    : { processed: 0, attempted: 0, failed: 0, skipped: 0, errors: [] };
  const verifiedRecoveredItemIds = await listVerifiedScoringRecoveredItemIds(authUser.userId, itemIds);
  const repair = buildScoringModelRepairSummary({
    modelConfigId,
    modelLabel: modelLabel(model),
    itemIds,
    scoring: buildVerifiedScoringStageResult(scoring, verifiedRecoveredItemIds.length),
  });

  return c.json({
    data: {
      switched: true,
      configOwnerUserId: owner.ownerUserId,
      scoringConfigId: configRow?.id || null,
      modelConfigId,
      modelLabel: modelLabel(model),
      probe,
      repair,
      verifiedRecoveredItemIds,
    },
  });
});

app.post('/fallback-recovery/apply', async (c) => {
  const authUser = requireAuth(c);
  if (!canRecoverFallbackScoringItems(authUser.role)) {
    return c.json({ error: 'Current user cannot recover fallback scoring items' }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  const request = normalizeFallbackScoringRecoveryRequest(body);
  const candidates = await listFallbackScoringRecoveryCandidates(authUser.userId, request.limit, request.itemIds);
  if (candidates.itemIds.length === 0) {
    return c.json({
      data: buildFallbackScoringRecoverySummary({
        candidateCount: candidates.candidateCount,
        itemIds: [],
        verifiedRecoveredItemIds: [],
        scoring: { processed: 0, attempted: 0, failed: 0, skipped: 0, errors: [] },
      }),
    });
  }

  const [scoringConfig, skillUsageEvents, fallbackUsageEvents, probeUsageEvents] = await Promise.all([
    getEffectiveAiConfig(authUser.userId, 'scoring'),
    getAiUsageEvents({ userId: authUser.userId, sceneType: 'feed_scoring_skill', limit: 50 }),
    getAiUsageEvents({ userId: authUser.userId, sceneType: 'feed_scoring', limit: 20 }),
    getAiUsageEvents({ userId: authUser.userId, sceneType: 'feed_scoring_model_probe', limit: 20 }),
  ]);
  const circuitBreaker = scoringConfig
    ? resolveScoringModelCircuitBreaker({
      modelConfigId: scoringConfig.modelConfigId || null,
      modelName: scoringConfig.model || null,
    }, [...skillUsageEvents, ...fallbackUsageEvents, ...probeUsageEvents])
    : null;
  if (!scoringConfig || circuitBreaker?.shouldBypass) {
    return c.json({
      data: buildFallbackScoringRecoverySummary({
        candidateCount: candidates.candidateCount,
        itemIds: [],
        verifiedRecoveredItemIds: [],
        blockedReason: circuitBreaker?.reason || '当前没有可用评分模型',
        scoring: { processed: 0, attempted: 0, failed: 0, skipped: 0, errors: [] },
      }),
    }, 409);
  }

  await db.update(schema.items)
    .set({
      aiScore: null,
      processingStatus: 'raw',
    })
    .where(and(
      eq(schema.items.userId, authUser.userId),
      inArray(schema.items.id, candidates.itemIds),
    ));

  const scoring = await scoreItemsDetailed(authUser.userId, candidates.itemIds.length, {
    itemIds: candidates.itemIds,
    bypassQualityGate: true,
  });
  const verifiedRecoveredItemIds = await listVerifiedScoringRecoveredItemIds(authUser.userId, candidates.itemIds);
  const verifiedScoring = buildVerifiedScoringStageResult(scoring, verifiedRecoveredItemIds.length);

  return c.json({
    data: buildFallbackScoringRecoverySummary({
      candidateCount: candidates.candidateCount,
      itemIds: candidates.itemIds,
      verifiedRecoveredItemIds,
      scoring: verifiedScoring,
    }),
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
