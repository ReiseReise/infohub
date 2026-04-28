const VOLCENGINE_ARK_PROVIDER = 'volcengine_ark';
const VOLCENGINE_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

export type AiSceneModelConfig = {
  id: string;
  provider: string;
  alias?: string | null;
  modelName: string;
  baseUrl?: string | null;
  extraConfig?: Record<string, unknown> | null;
  isActive: boolean;
};

export type AiSceneModelBinding = {
  provider: string;
  model: string;
  baseUrl: string | null;
  modelLabel: string;
};

export function normalizeModelProvider(provider?: string | null) {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === 'doubao') return VOLCENGINE_ARK_PROVIDER;
  return normalized || 'openai';
}

export function modelTargetFromConfig(model: AiSceneModelConfig) {
  const provider = normalizeModelProvider(model.provider);
  const extra = model.extraConfig || {};
  if (provider === VOLCENGINE_ARK_PROVIDER) {
    return String(extra.endpointId || model.modelName || '').trim();
  }
  return String(model.modelName || '').trim();
}

export function buildAiSceneModelBinding(model: AiSceneModelConfig): AiSceneModelBinding {
  if (!model.isActive) {
    throw new Error(`Model config ${model.id} is not active`);
  }

  const provider = normalizeModelProvider(model.provider);
  const target = modelTargetFromConfig(model);
  if (!target) {
    throw new Error(`Model config ${model.id} has empty model target`);
  }
  if (provider === VOLCENGINE_ARK_PROVIDER && !target.startsWith('ep-')) {
    throw new Error('Volcengine Ark model config must use an endpoint id like ep-...');
  }

  return {
    provider,
    model: target,
    baseUrl: provider === VOLCENGINE_ARK_PROVIDER
      ? (model.baseUrl || VOLCENGINE_ARK_BASE_URL)
      : (model.baseUrl || null),
    modelLabel: model.alias || target,
  };
}
