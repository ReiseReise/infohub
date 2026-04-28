import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { completeWithModelConfig, getEffectiveAiConfig, getEffectiveAiSceneAvailability, type ResolvedAiConfig } from '../lib/ai-configs.js';
import { logAiUsage } from '../lib/ai-usage.js';
import { applyRulesAndPriority } from './priority.js';
import { ensureItemContent, resolveItemText } from '../lib/item-enrichment.js';
import {
  aggregateSkillScores,
  buildSkillPrompt,
  getActiveScoringSkills,
  getPreferenceProfile,
  parseSkillResponse,
  replaceItemBreakdowns,
  type ScoringSkillRecord,
} from '../lib/scoring-skills.js';

type AiConfig = ResolvedAiConfig;

export type LlmCallResult = {
  text: string;
  provider?: string;
  model: string;
  endpointId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number | null;
  providerRequestId?: string | null;
  latencyMs?: number | null;
  apiKind?: string | null;
};

export type AiStageResult = {
  processed: number;
  attempted: number;
  failed: number;
  errors: string[];
};

type LlmCallOptions = {
  maxTokens?: number;
};

function buildAiStageResult(processed: number, attempted: number, errors: string[]): AiStageResult {
  return {
    processed,
    attempted,
    failed: Math.max(attempted - processed, 0),
    errors: [...new Set(errors)].slice(0, 3),
  };
}

async function callLLM(config: AiConfig, prompt: string, options: LlmCallOptions = {}): Promise<LlmCallResult> {
  const maxTokens = Math.max(128, options.maxTokens ?? 200);
  if (config.modelConfigId) {
    return completeWithModelConfig(config.modelConfigId, prompt, {
      temperature: config.temperature,
      maxTokens,
    });
  }

  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const apiKey = config.apiKeyEnc || process.env.OPENAI_API_KEY || '';
  const isArkEndpoint = config.provider === 'volcengine_ark' && config.model.startsWith('ep-');

  if (!apiKey) {
    throw new Error('No API key configured for AI scoring');
  }

  if (isArkEndpoint) {
    const startedAt = Date.now();
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: prompt }],
          },
        ],
        temperature: config.temperature,
        max_output_tokens: maxTokens,
      }),
    });
    if (!resp.ok) {
      throw new Error(`LLM API error: ${resp.status} ${await resp.text()}`);
    }
    const data = await resp.json() as any;
    const text = (data.output || [])
      .flatMap((item: any) => item?.type === 'message' ? (item.content || []) : [])
      .filter((item: any) => item?.type === 'output_text')
      .map((item: any) => item.text || '')
      .join('\n')
      .trim();
    return {
      text,
      provider: config.provider,
      model: config.model,
      endpointId: config.model,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? ((data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0)),
      estimatedCost: null,
      providerRequestId: resp.headers.get('x-request-id') || data.id || null,
      latencyMs: Date.now() - startedAt,
      apiKind: 'responses',
    };
  }

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    }),
  });

  if (!resp.ok) {
    throw new Error(`LLM API error: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json() as any;
  return {
    text: data.choices?.[0]?.message?.content?.trim() || '',
    provider: config.provider,
    model: config.model,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? ((data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0)),
    estimatedCost: null,
    providerRequestId: data.id ?? null,
    latencyMs: null,
    apiKind: 'chat.completions',
  };
}

async function callSkillLLM(
  baseConfig: AiConfig,
  skill: ScoringSkillRecord,
  prompt: string,
): Promise<LlmCallResult> {
  if (skill.modelConfigId) {
    return completeWithModelConfig(skill.modelConfigId, prompt, {
      temperature: baseConfig.temperature,
      maxTokens: 320,
    });
  }
  return callLLM(baseConfig, prompt, { maxTokens: 320 });
}

type ScoreOptions = {
  itemId?: string;
  itemIds?: string[];
};

export async function scoreItems(userId: string, limit = 10, options: ScoreOptions = {}): Promise<number> {
  const result = await scoreItemsDetailed(userId, limit, options);
  return result.processed;
}

export async function scoreItemsDetailed(userId: string, limit = 10, options: ScoreOptions = {}): Promise<AiStageResult> {
  const config = await getEffectiveAiConfig(userId, 'scoring');
  if (!config) {
    logger.debug('No active scoring AI config, skipping');
    return buildAiStageResult(0, 0, []);
  }
  const activeScenes = await getEffectiveAiSceneAvailability(userId);
  const activeSkills = await getActiveScoringSkills(userId);
  const preferenceProfile = await getPreferenceProfile(userId);

  const conditions = [
    eq(schema.items.userId, userId),
    inArray(schema.items.processingStatus, ['raw', 'score_failed']),
    eq(schema.items.isFiltered, false),
  ];
  if (options.itemId) {
    conditions.push(eq(schema.items.id, options.itemId));
  } else if (options.itemIds && options.itemIds.length > 0) {
    conditions.push(inArray(schema.items.id, options.itemIds));
  }
  if (activeScenes.has('quality_filter')) {
    conditions.push(isNotNull(schema.items.qualityCheckedAt));
  }

  const rawItems = await db
    .select({
      id: schema.items.id,
      title: schema.items.title,
      snippet: schema.items.snippet,
      content: schema.items.content,
      contentStatus: schema.items.contentStatus,
    })
    .from(schema.items)
    .where(and(...conditions))
    .orderBy(desc(schema.items.fetchedAt))
    .limit(options.itemId ? 1 : limit);

  if (rawItems.length === 0) return buildAiStageResult(0, 0, []);

  let scored = 0;
  const errors: string[] = [];
  for (const item of rawItems) {
    let effectiveItem = item;
    let prompt = '';
    try {
      if (item.contentStatus !== 'ready') {
        const enriched = await ensureItemContent(userId, item.id);
        if (enriched.item) {
          effectiveItem = {
            ...effectiveItem,
            content: enriched.item.content,
            snippet: enriched.item.snippet,
            contentStatus: enriched.item.contentStatus,
          };
        }
      }
      const source = resolveItemText(effectiveItem);
      let score: number | null = null;
      let lastResponseText = '';

      if (activeSkills.length > 0) {
        const breakdownRows: Array<{
          skillId: number | null;
          score: number;
          confidence: number;
          decision: string;
          reasons: string[];
          matchedSignals: string[];
          riskFlags: string[];
          rawResponse: string;
        }> = [];

        for (const skill of activeSkills) {
          const skillPrompt = buildSkillPrompt({
            skill,
            profileSummary: preferenceProfile.profile?.profileSummary || null,
            title: effectiveItem.title,
            content: source.text.slice(0, 6000),
          });
          const result = await callSkillLLM(config, skill, skillPrompt);
          const parsed = parseSkillResponse(result.text);
          breakdownRows.push({
            skillId: skill.id,
            score: parsed.score,
            confidence: parsed.confidence,
            decision: parsed.decision,
            reasons: parsed.reasons,
            matchedSignals: parsed.matchedSignals,
            riskFlags: parsed.riskFlags,
            rawResponse: parsed.rawResponse,
          });
          lastResponseText = parsed.rawResponse;
          await logAiUsage({
            userId,
            sceneType: 'feed_scoring_skill',
            status: 'success',
            provider: result.provider || config.provider,
            modelName: result.model || config.model,
            endpointId: result.endpointId || null,
            modelConfigId: skill.modelConfigId || config.modelConfigId || null,
            promptTemplateId: config.promptTemplateId || null,
            targetType: 'item',
            targetId: item.id,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            totalTokens: result.totalTokens,
            estimatedCost: result.estimatedCost,
            latencyMs: result.latencyMs,
            providerRequestId: result.providerRequestId,
            apiKind: result.apiKind,
            promptPreview: skillPrompt,
            responsePreview: result.text,
            label: `${effectiveItem.title} / ${skill.name}`,
          });
        }

        await replaceItemBreakdowns(userId, item.id, breakdownRows);
        score = aggregateSkillScores(
          breakdownRows.map((row, index) => ({
            score: row.score,
            confidence: row.confidence,
            weight: activeSkills[index]?.weight ?? 1,
          })),
        );
      } else {
        prompt = config.promptTemplate
          .replace('{title}', effectiveItem.title)
          .replace('{content}', source.text.slice(0, 4000));

        const result = await callLLM(config, prompt);
        const scoreMatch = result.text.match(/(\d{1,3})/);
        score = scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1], 10))) : null;
        lastResponseText = result.text;

        await logAiUsage({
          userId,
          sceneType: 'feed_scoring',
          status: 'success',
          provider: result.provider || config.provider,
          modelName: result.model || config.model,
          endpointId: result.endpointId || null,
          modelConfigId: config.modelConfigId || null,
          promptTemplateId: config.promptTemplateId || null,
          targetType: 'item',
          targetId: item.id,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          totalTokens: result.totalTokens,
          estimatedCost: result.estimatedCost,
          latencyMs: result.latencyMs,
          providerRequestId: result.providerRequestId,
          apiKind: result.apiKind,
          promptPreview: prompt,
          responsePreview: result.text,
          label: effectiveItem.title,
        });
      }

      await db.update(schema.items).set({
        aiScore: score,
        processingStatus: 'scored',
      }).where(eq(schema.items.id, item.id));

      await applyRulesAndPriority(item.id, userId);

      scored++;
      logger.debug({ itemId: item.id, score, mode: activeSkills.length > 0 ? 'skills' : 'legacy', preview: lastResponseText.slice(0, 80) }, 'Item scored');
    } catch (err) {
      const message = (err as Error).message;
      logger.error({ itemId: item.id, error: message }, 'Scoring failed');
      await db.update(schema.items).set({
        processingStatus: 'score_failed',
      }).where(eq(schema.items.id, item.id));
      await logAiUsage({
        userId,
        sceneType: 'feed_scoring',
        status: 'error',
        provider: config.provider,
        modelName: config.model,
        endpointId: config.provider === 'volcengine_ark' && config.model.startsWith('ep-') ? config.model : null,
        modelConfigId: config.modelConfigId || null,
        promptTemplateId: config.promptTemplateId || null,
        targetType: 'item',
        targetId: item.id,
        promptPreview: prompt,
        label: effectiveItem.title,
        errorMessage: message,
      });
      errors.push(message);
    }
  }

  logger.info({ userId, scored, total: rawItems.length }, 'Batch scoring complete');
  return buildAiStageResult(scored, rawItems.length, errors);
}

export { getEffectiveAiConfig as getActiveAiConfig, callLLM };
