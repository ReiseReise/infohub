import { createHash } from 'node:crypto';
import type { ItemTranslationJobData } from './queue.js';

export const ITEM_TRANSLATION_PRIORITIES = {
  manual: 1,
  automatic: 10,
} as const;

export const ITEM_TRANSLATION_POLICY_REVISION = 'runtime-bound-llm-v2';
export const TRANSLATION_RUNTIME_VERIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ItemTranslationRevisionInput = {
  title?: string | null;
  content?: string | null;
  readabilityContent?: string | null;
  snippet?: string | null;
  modelConfigId?: string | null;
  model?: string | null;
  modelConfigUpdatedAt?: Date | string | null;
  promptTemplateId?: string | null;
};

export function buildItemTranslationRevision(input: ItemTranslationRevisionInput): string {
  const modelConfigUpdatedAt = input.modelConfigUpdatedAt
    ? new Date(input.modelConfigUpdatedAt)
    : null;
  const normalizedModelConfigUpdatedAt = modelConfigUpdatedAt
    && Number.isFinite(modelConfigUpdatedAt.getTime())
    ? modelConfigUpdatedAt.toISOString()
    : null;
  return createHash('sha256')
    .update(JSON.stringify({
      policyRevision: ITEM_TRANSLATION_POLICY_REVISION,
      title: input.title || '',
      content: input.content || '',
      readabilityContent: input.readabilityContent || '',
      snippet: input.snippet || '',
      modelConfigId: input.modelConfigId || null,
      model: input.model || null,
      modelConfigUpdatedAt: normalizedModelConfigUpdatedAt,
      promptTemplateId: input.promptTemplateId || null,
    }))
    .digest('hex')
    .slice(0, 16);
}

export type TranslationProviderReadiness =
  | { ready: true; reason: null }
  | {
    ready: false;
    reason:
      | 'missing_binding'
      | 'missing_model_config'
      | 'inactive_model_config'
      | 'wrong_model_type'
      | 'missing_api_key'
      | 'connection_not_verified';
  };

type TranslationModelReadinessInput = {
  modelType: string;
  isActive: boolean;
  hasApiKey: boolean;
  testStatus: string;
  testedAt?: Date | string | null;
  recentSuccessAt?: Date | string | null;
};

function timestamp(value?: Date | string | null): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  const result = parsed.getTime();
  return Number.isFinite(result) ? result : null;
}

function hasFreshRuntimeVerification(
  model: TranslationModelReadinessInput,
  now: Date,
): boolean {
  const successAt = timestamp(model.recentSuccessAt);
  if (successAt == null) return false;

  const nowMs = now.getTime();
  if (successAt > nowMs || nowMs - successAt > TRANSLATION_RUNTIME_VERIFICATION_TTL_MS) {
    return false;
  }

  // testedAt also acts as the invalidation boundary when connection-critical
  // settings change or a later explicit probe fails.
  const invalidatedAt = timestamp(model.testedAt);
  return invalidatedAt == null || successAt >= invalidatedAt;
}

export function evaluateTranslationProviderReadiness(input: {
  hasBinding: boolean;
  modelConfig?: TranslationModelReadinessInput | null;
  now?: Date;
}): TranslationProviderReadiness {
  if (!input.hasBinding) return { ready: false, reason: 'missing_binding' };
  if (!input.modelConfig) return { ready: false, reason: 'missing_model_config' };
  if (!input.modelConfig.isActive) return { ready: false, reason: 'inactive_model_config' };
  if (input.modelConfig.modelType.trim().toLowerCase() !== 'llm') {
    return { ready: false, reason: 'wrong_model_type' };
  }
  if (!input.modelConfig.hasApiKey) return { ready: false, reason: 'missing_api_key' };
  if (
    input.modelConfig.testStatus !== 'success'
    && !hasFreshRuntimeVerification(input.modelConfig, input.now || new Date())
  ) {
    return { ready: false, reason: 'connection_not_verified' };
  }
  return { ready: true, reason: null };
}

export function translationProviderReadinessMessage(readiness: TranslationProviderReadiness) {
  if (readiness.ready) return '';
  const labels: Record<Exclude<TranslationProviderReadiness, { ready: true }>['reason'], string> = {
    missing_binding: '翻译场景未绑定模型',
    missing_model_config: '已绑定的模型配置不存在',
    inactive_model_config: '已绑定的模型未启用',
    wrong_model_type: '已绑定的配置不是 LLM',
    missing_api_key: '已绑定的模型缺少 API Key',
    connection_not_verified: '尚无有效的连通测试或近期成功调用证据',
  };
  return `全文翻译暂不可用：${labels[readiness.reason]}。请在 AI 管理中心检查翻译场景的模型绑定与连通状态后重试。`;
}

export function resolveTranslationReadinessJobDisposition(
  mode: ItemTranslationJobData['mode'],
  readiness: TranslationProviderReadiness,
): 'proceed' | 'defer' | 'fail' {
  if (readiness.ready) return 'proceed';
  return mode === 'automatic' ? 'defer' : 'fail';
}

function safeJobIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function buildItemTranslationJobId(data: Pick<ItemTranslationJobData, 'userId' | 'itemId' | 'revision'>) {
  const suffix = data.revision ? `_${safeJobIdPart(data.revision).slice(0, 16)}` : '';
  return `item_translation_${safeJobIdPart(data.userId)}_${safeJobIdPart(data.itemId)}${suffix}`;
}

export function buildItemTranslationJobOptions(mode: ItemTranslationJobData['mode']) {
  return {
    priority: ITEM_TRANSLATION_PRIORITIES[mode],
  };
}
