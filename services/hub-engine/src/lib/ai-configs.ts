import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { config } from '../config/index.js';

export const DAILY_REPORT_AGENT_SCENES = [
  'daily_report_cleaning',
  'daily_report_decision',
  'daily_report_research',
  'daily_report_reading',
  'daily_report_final',
] as const;

export const AI_SCENE_TYPES = [
  'scoring',
  'summary',
  'translation',
  'daily_report',
  ...DAILY_REPORT_AGENT_SCENES,
] as const;
export type AiSceneType = typeof AI_SCENE_TYPES[number];

export type ResolvedAiConfig = {
  id: number;
  ownerUserId: string;
  scope: 'admin' | 'self';
  type: string;
  provider: string;
  model: string;
  apiKeyEnc?: string | null;
  baseUrl?: string | null;
  temperature: number;
  promptTemplate: string;
  promptTemplateId?: string | null;
  modelConfigId?: string | null;
  isActive: boolean;
};

export type ModelConfigCompletion = {
  text: string;
  model: string;
  provider?: string;
  endpointId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number | null;
  providerRequestId?: string | null;
  latencyMs?: number | null;
  apiKind?: string | null;
};

export type AiConfigOwnerResolution = {
  ownerUserId: string;
  scope: 'admin' | 'self';
  resolvedFrom: 'self' | 'preferred_admin' | 'fallback_admin' | 'missing_user';
  ownerEmail?: string | null;
  ownerUsername?: string | null;
};

async function resolvePreferredAdmin(): Promise<{
  id: string;
  email: string | null;
  username: string | null;
  activeConfigCount: number;
} | null> {
  const admins = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      username: schema.users.username,
      activeConfigCount: sql<number>`count(${schema.aiConfigs.id})::int`,
    })
    .from(schema.users)
    .leftJoin(
      schema.aiConfigs,
      and(eq(schema.aiConfigs.userId, schema.users.id), eq(schema.aiConfigs.isActive, true)),
    )
    .where(and(eq(schema.users.role, 'admin'), eq(schema.users.isActive, true)))
    .groupBy(schema.users.id, schema.users.email, schema.users.username, schema.users.createdAt)
    .orderBy(
      desc(sql`count(${schema.aiConfigs.id})`),
      desc(sql`max(${schema.aiConfigs.createdAt})`),
      asc(schema.users.createdAt),
    )
    .limit(1);

  return admins[0] ?? null;
}

export async function resolveAiConfigOwner(userId: string): Promise<AiConfigOwnerResolution> {
  const rows = await db
    .select({
      id: schema.users.id,
      role: schema.users.role,
      email: schema.users.email,
      username: schema.users.username,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  const current = rows[0];
  if (!current) {
    return { ownerUserId: userId, scope: 'self', resolvedFrom: 'missing_user' };
  }

  if (current.role === 'admin') {
    return {
      ownerUserId: userId,
      scope: 'self',
      resolvedFrom: 'self',
      ownerEmail: current.email,
      ownerUsername: current.username,
    };
  }

  const preferredAdmin = await resolvePreferredAdmin();
  if (!preferredAdmin) {
    return {
      ownerUserId: userId,
      scope: 'self',
      resolvedFrom: 'fallback_admin',
      ownerEmail: current.email,
      ownerUsername: current.username,
    };
  }

  const resolvedFrom = preferredAdmin.activeConfigCount > 0 ? 'preferred_admin' : 'fallback_admin';
  return {
    ownerUserId: preferredAdmin.id,
    scope: 'admin',
    resolvedFrom,
    ownerEmail: preferredAdmin.email,
    ownerUsername: preferredAdmin.username,
  };
}

function interpolatePrompt(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, value),
    template,
  );
}

export function buildDailyReportPrompt(
  template: string,
  input: {
    date: string;
    newItems: number;
    totalItems: number;
    topItems: Array<{ title: string; sourceName: string; aiScore: number | null; aiSummary: string | null }>;
    categories: Array<{ category: string; count: number }>;
  },
): string {
  const highlights = input.topItems
    .slice(0, 8)
    .map((item, index) => {
      const score = item.aiScore != null ? `AI ${item.aiScore}` : 'AI -';
      const summary = item.aiSummary?.trim() || '暂无摘要';
      return `${index + 1}. ${item.title}\n来源: ${item.sourceName}\n评分: ${score}\n摘要: ${summary}`;
    })
    .join('\n\n');

  const categories = input.categories
    .slice(0, 10)
    .map((entry) => `${entry.category}: ${entry.count}`)
    .join('\n');

  return interpolatePrompt(template, {
    date: input.date,
    newItems: String(input.newItems),
    totalItems: String(input.totalItems),
    highlights,
    categories,
  });
}

export async function getVisibleAiConfigsForUser(userId: string, role?: string) {
  const owner = role === 'admin'
    ? { ownerUserId: userId, scope: 'self' as const }
    : await resolveAiConfigOwner(userId);

  return db
    .select()
    .from(schema.aiConfigs)
    .where(eq(schema.aiConfigs.userId, owner.ownerUserId))
    .orderBy(asc(schema.aiConfigs.type), asc(schema.aiConfigs.id));
}

export async function getEffectiveAiConfig(userId: string, type: string): Promise<ResolvedAiConfig | null> {
  const owner = await resolveAiConfigOwner(userId);
  const rows = await db
    .select()
    .from(schema.aiConfigs)
    .where(and(
      eq(schema.aiConfigs.userId, owner.ownerUserId),
      eq(schema.aiConfigs.type, type),
      eq(schema.aiConfigs.isActive, true),
    ))
    .orderBy(desc(schema.aiConfigs.createdAt), desc(schema.aiConfigs.id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  let promptTemplate = row.promptTemplate || '';
  if (row.promptTemplateId) {
    const promptRows = await db
      .select({ templateText: schema.promptTemplates.templateText })
      .from(schema.promptTemplates)
      .where(and(
        eq(schema.promptTemplates.id, row.promptTemplateId),
        eq(schema.promptTemplates.isActive, true),
      ))
      .limit(1);
    if (promptRows[0]?.templateText) {
      promptTemplate = promptRows[0].templateText;
    }
  }

  return {
    id: row.id,
    ownerUserId: owner.ownerUserId,
    scope: owner.scope,
    type: row.type,
    provider: row.provider,
    model: row.model,
    apiKeyEnc: row.apiKeyEnc,
    baseUrl: row.baseUrl,
    temperature: row.temperature ?? 0.3,
    promptTemplate,
    promptTemplateId: row.promptTemplateId,
    modelConfigId: row.modelConfigId,
    isActive: Boolean(row.isActive),
  };
}

export async function getEffectiveAiSceneAvailability(userId: string): Promise<Set<string>> {
  const owner = await resolveAiConfigOwner(userId);
  const rows = await db
    .select({ type: schema.aiConfigs.type })
    .from(schema.aiConfigs)
    .where(and(eq(schema.aiConfigs.userId, owner.ownerUserId), eq(schema.aiConfigs.isActive, true)));
  return new Set(rows.map((row) => row.type));
}

export async function completeWithModelConfig(
  modelConfigId: string,
  prompt: string,
  options?: { temperature?: number; maxTokens?: number },
): Promise<ModelConfigCompletion> {
  const response = await fetch(`${config.audio.serviceUrl}/api/internal/llm/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-API-Key': config.audio.internalApiKey,
    },
    body: JSON.stringify({
      model_config_id: modelConfigId,
      prompt,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
    }),
  });

  if (!response.ok) {
    throw new Error(`Audio internal LLM API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as ModelConfigCompletion & {
    endpointId?: string | null;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    estimated_cost?: number | null;
    providerRequestId?: string | null;
    latencyMs?: number | null;
    apiKind?: string | null;
  };
  return {
    text: (data.text || '').trim(),
    model: data.model || '',
    provider: data.provider,
    endpointId: data.endpointId ?? null,
    inputTokens: data.inputTokens ?? data.input_tokens ?? 0,
    outputTokens: data.outputTokens ?? data.output_tokens ?? 0,
    totalTokens: data.totalTokens ?? data.total_tokens ?? 0,
    estimatedCost: data.estimatedCost ?? data.estimated_cost ?? null,
    providerRequestId: data.providerRequestId ?? null,
    latencyMs: data.latencyMs ?? null,
    apiKind: data.apiKind ?? null,
  };
}
