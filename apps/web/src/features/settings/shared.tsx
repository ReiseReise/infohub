import type {
  AdminModelConfig,
  AiConfig,
  AiUsageEvent,
  AiUsageSummary,
} from '../../lib/api';

export type SettingsTab = 'general' | 'reading' | 'models' | 'integrations' | 'diagnostics' | 'quota' | 'admin';
export type AdminTab = 'dashboard' | 'tasks' | 'users' | 'invites';
export type AiCenterTab = 'scenes' | 'models' | 'skills' | 'logs';
export type AiConfigType =
  | 'quality_filter'
  | 'scoring'
  | 'summary'
  | 'translation'
  | 'daily_report'
  | 'daily_report_cleaning'
  | 'daily_report_decision'
  | 'daily_report_research'
  | 'daily_report_reading'
  | 'daily_report_final';

export const GENERAL_KEY = 'infohub.settings.general';
export const INTEGRATIONS_KEY = 'infohub.settings.integrations';

export const TAB_LABELS: Array<{ key: SettingsTab; label: string }> = [
  { key: 'general', label: '通用偏好' },
  { key: 'reading', label: '阅读 AI' },
  { key: 'models', label: 'AI 管理中心' },
  { key: 'integrations', label: '集成' },
  { key: 'diagnostics', label: '诊断中心' },
  { key: 'quota', label: '播客配额' },
  { key: 'admin', label: '管理后台' },
];

export const ADMIN_TAB_LABELS: Array<{ key: AdminTab; label: string }> = [
  { key: 'dashboard', label: '总览看板' },
  { key: 'tasks', label: '任务管理' },
  { key: 'users', label: '用户管理' },
  { key: 'invites', label: '邀请码管理' },
];

export const AI_CENTER_TABS: Array<{ key: AiCenterTab; label: string }> = [
  { key: 'scenes', label: '场景控制台' },
  { key: 'models', label: '模型仓库' },
  { key: 'skills', label: '评分 Skills' },
  { key: 'logs', label: '使用日志' },
];

export const READING_SCENE_TYPES: AiConfigType[] = ['quality_filter', 'scoring', 'summary', 'translation'];
export const DAILY_REPORT_SCENE_TYPES: AiConfigType[] = [
  'daily_report',
  'daily_report_cleaning',
  'daily_report_decision',
  'daily_report_research',
  'daily_report_reading',
  'daily_report_final',
];
export const ALL_BATCH_SCENE_TYPES: AiConfigType[] = [...READING_SCENE_TYPES, ...DAILY_REPORT_SCENE_TYPES];

export const DEFAULT_PROMPTS: Record<AiConfigType, string> = {
  quality_filter: '你是信息中枢的质量质检代理。请输出 JSON：{"decision":"pass|review|filter","summary":"一句话概要","reason":"一句话原因","tags":["..."],"riskFlags":["..."],"confidence":0-1,"score":0-100,"dimensionScores":{"density":0-100,"insight":0-100,"practicality":0-100,"objectivity":0-100,"goalFit":0-100,"novelty":0-100}}。\\n标题：{title}\\n内容：{content}',
  scoring: '请根据标题和内容给出 0-100 分相关性评分，仅输出数字。\\n标题：{title}\\n内容：{content}',
  summary: '请对内容做结构化摘要，返回 JSON：{"summary":"...","tags":["..."]}。\\n标题：{title}\\n内容：{content}',
  translation: '请将内容翻译成简体中文，保留专有名词。\\n标题：{title}\\n内容：{content}',
  daily_report: '请根据以下日报素材，输出一段 3-5 点的中文总览点评，先写总体判断，再写值得关注的信号。\\n日期：{date}\\n今日新增：{newItems}\\n库存总量：{totalItems}\\n重点条目：\\n{highlights}\\n分类统计：\\n{categories}',
  daily_report_cleaning: '你是信息清洗代理。请基于 {context} 提炼主题聚类、关键变化、观察名单与证据分组，优先聚焦 AI 产业、头部舆论、资本市场与监管信号，输出 JSON 或紧凑 Markdown。',
  daily_report_decision: '你是决策简报代理。请基于 {context} 输出：总体判断、关键变化、风险与机会、下一步动作。重点说明今天哪些 AI 产业或头部新闻信号真正改变了判断。',
  daily_report_research: '你是研究汇总代理。请基于 {context} 输出：主题脉络、代表性证据、分歧与空白、值得追踪的问题。优先梳理 AI 产业链、产品落地、舆论叙事和资本定价之间的关系。',
  daily_report_reading: '你是阅读导航代理。请基于 {context} 输出：必读、速览、可跳过，并给出每条理由。优先把真正会改变 AI 行业判断、产品判断或市场叙事的条目放进必读。',
  daily_report_final: '你是最终日报融合代理。请基于 {context} 输出一份可直接分发的最终日报：先给总体判断，再给关键进展、头部舆论/新闻焦点、AI 产业与产品信号、风险与下一步跟踪。',
};

export const VOLCENGINE_ARK_PROVIDER = 'volcengine_ark';
export const VOLCENGINE_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
export const DEEPSEEK_PROVIDER = 'deepseek';
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_TRANSLATION_MODEL = 'deepseek-flash';
export const DEFAULT_LLM_PROVIDER = VOLCENGINE_ARK_PROVIDER;
export const DEFAULT_LLM_ENDPOINT_ID = '';
export const DEFAULT_LLM_BASE_URL = VOLCENGINE_ARK_BASE_URL;

export const AI_SCENE_LABELS: Record<string, string> = {
  quality_filter: '阅读质检',
  feed_scoring: '阅读评分',
  feed_summary: '阅读摘要',
  feed_translation: '阅读翻译',
  daily_report: '日报总览',
  daily_report_cleaning: '日报清洗',
  daily_report_decision: '决策简报',
  daily_report_research: '研究汇总',
  daily_report_reading: '阅读导航',
  daily_report_final: '最终日报',
  audio_asr: '音频转写',
  audio_summary: '音频总结',
  audio_translation: '音频翻译',
  audio_multimodal: '音频多模态',
};

export type GeneralPrefs = {
  compactList: boolean;
  autoRefreshSeconds: number;
  openExternalInNewTab: boolean;
  cardShowAbsoluteTime: boolean;
};

export type IntegrationPrefs = {
  ntfyTopic: string;
  feishuWebhook: string;
  webhookSecret: string;
};

export type AiForm = {
  id?: number;
  name: string;
  provider: string;
  model: string;
  modelLabel?: string;
  baseUrl: string;
  temperature: number;
  promptTemplate: string;
  promptTemplateName?: string;
  promptTemplateId?: string;
  modelConfigId?: string;
  isActive: boolean;
};

export const USER_TABS: SettingsTab[] = ['general', 'reading', 'integrations', 'quota'];
export const ADMIN_TABS: SettingsTab[] = ['models', 'diagnostics', 'admin'];

export type SettingsMode = 'user' | 'admin';

// --- Utility functions ---

export function normalizeProvider(provider?: string | null) {
  const normalized = (provider || '').trim().toLowerCase();
  if (normalized === 'doubao') return VOLCENGINE_ARK_PROVIDER;
  return normalized || DEFAULT_LLM_PROVIDER;
}

export function providerLabel(provider?: string | null) {
  const normalized = normalizeProvider(provider);
  if (normalized === 'dashscope') return 'DashScope';
  if (normalized === VOLCENGINE_ARK_PROVIDER) return 'Volcengine Ark';
  if (normalized === DEEPSEEK_PROVIDER) return 'DeepSeek 官方 API';
  if (normalized === 'openai_compatible') return 'OpenAI-compatible';
  if (normalized === 'openai') return 'OpenAI';
  return provider || DEFAULT_LLM_PROVIDER;
}

export function isVolcengineArk(provider?: string | null) {
  return normalizeProvider(provider) === VOLCENGINE_ARK_PROVIDER;
}

export function baseUrlForProvider(provider?: string | null, current?: string) {
  if (isVolcengineArk(provider)) return VOLCENGINE_ARK_BASE_URL;
  if (normalizeProvider(provider) === DEEPSEEK_PROVIDER) return DEEPSEEK_BASE_URL;
  if (normalizeProvider(provider) === DEFAULT_LLM_PROVIDER) return current || DEFAULT_LLM_BASE_URL;
  return current || '';
}

export function modelTarget(model?: Partial<AdminModelConfig> | null) {
  if (!model) return '';
  return isVolcengineArk(model.provider)
    ? String(model.extra_config?.endpointId || model.model_name || '')
    : String(model.model_name || '');
}

export function modelDisplayName(model?: Partial<AdminModelConfig> | null) {
  if (!model) return '未绑定';
  return String(model.alias || modelTarget(model) || '未命名模型');
}

export function freshnessBadge(status?: string) {
  if (status === 'stale') return { label: '数据已过期', className: 'bg-red-100 text-red-700 border-red-200' };
  if (status === 'warning') return { label: '有到期来源待补抓', className: 'bg-amber-100 text-amber-700 border-amber-200' };
  return { label: '数据新鲜度正常', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
}

export const QUEUE_STATE_LABELS: Record<string, string> = {
  waiting: '等待', active: '执行中', completed: '已完成', failed: '失败', delayed: '延迟', prioritized: '优先队列', paused: '暂停',
};

export function queueStateLabel(state?: string | null) {
  return QUEUE_STATE_LABELS[String(state || '').trim().toLowerCase()] || '状态待确认';
}

export const FETCH_OUTCOME_LABELS: Record<string, string> = {
  success: '成功', done: '完成', ok: '成功', running: '抓取中', pending: '等待中', error: '失败', failed: '失败', partial: '部分完成', new_items: '有新增', all_duplicate: '全部重复', no_new: '无新增', no_items: '无结果', skipped: '已跳过', filtered: '已过滤',
};

export function fetchOutcomeLabel(outcome?: unknown, status?: unknown) {
  return FETCH_OUTCOME_LABELS[String(outcome || status || '').trim().toLowerCase()] || '状态待确认';
}

export const DIAGNOSTIC_STATUS_LABELS: Record<string, string> = {
  ok: '正常', healthy: '健康', success: '成功', done: '完成', running: '运行中', pending: '等待中', warning: '需关注', error: '异常', failed: '失败', skipped: '已跳过', unknown: '状态待确认',
};

export function diagnosticStatusLabel(value?: unknown, fallback = '暂无') {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  return DIAGNOSTIC_STATUS_LABELS[normalized] || '状态待确认';
}

export const RETENTION_MODE_LABELS: Record<string, string> = {
  apply: '正式执行', live: '正式执行', dry_run: '预演', dryrun: '预演', preview: '预演',
};

export function retentionModeLabel(value?: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return '暂无';
  return RETENTION_MODE_LABELS[normalized] || '模式待确认';
}

export const STORAGE_BACKEND_LABELS: Record<string, string> = {
  local: '本地存储', filesystem: '本地文件', fs: '本地文件', oss: '对象存储', s3: '对象存储', r2: '对象存储', none: '未配置',
};

export function storageBackendLabel(value?: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return '未配置';
  return STORAGE_BACKEND_LABELS[normalized] || '存储方式待确认';
}

export const SYNC_MODE_LABELS: Record<string, string> = {
  sync_ok: '可同步', sync: '可同步', backup_only: '仅备份', archive_only: '仅归档', ignore: '不建议同步', disabled: '未启用',
};

export function syncModeLabel(value?: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return '待确认';
  return SYNC_MODE_LABELS[normalized] || '待确认';
}

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

export function writeLocal<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function normalizeAiForm(
  type: AiConfigType,
  cfg?: AiConfig,
  fallbackModelConfigId?: string,
  fallbackPromptTemplateId?: string,
): AiForm {
  const provider = normalizeProvider(cfg?.provider);
  const baseUrl = baseUrlForProvider(provider, cfg?.baseUrl || DEFAULT_LLM_BASE_URL);
  return {
    id: cfg?.id,
    name: cfg?.name || `${type} 默认配置`,
    provider,
    model: cfg?.model || DEFAULT_LLM_ENDPOINT_ID,
    modelLabel: cfg?.modelLabel || cfg?.model || DEFAULT_LLM_ENDPOINT_ID,
    baseUrl,
    temperature: typeof cfg?.temperature === 'number' ? cfg.temperature : 0.3,
    promptTemplate: cfg?.promptTemplate || DEFAULT_PROMPTS[type],
    promptTemplateName: cfg?.promptTemplateName || undefined,
    promptTemplateId: cfg?.promptTemplateId || fallbackPromptTemplateId || undefined,
    modelConfigId: cfg?.modelConfigId || fallbackModelConfigId || undefined,
    isActive: cfg?.isActive ?? false,
  };
}

export function sectionTitle(title: string, desc?: string) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-zinc-800">{title}</h2>
      {desc ? <p className="text-xs text-zinc-500 mt-0.5">{desc}</p> : null}
    </div>
  );
}

export function formatBytes(value?: number | null) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

export function sceneLabel(sceneType: string) {
  return AI_SCENE_LABELS[sceneType] || sceneType;
}

export function formatCost(value?: number | null) {
  return `¥${Number(value || 0).toFixed(4)}`;
}

export function mergeUsageBuckets(...groups: Array<Array<{ key: string; count: number; inputTokens: number; outputTokens: number; estimatedCost: number; avgLatencyMs?: number | null }> | undefined>) {
  const merged = new Map<string, { key: string; count: number; inputTokens: number; outputTokens: number; estimatedCost: number; avgLatencyMs: number }>();
  for (const group of groups) {
    for (const item of group || []) {
      const current = merged.get(item.key) || { key: item.key, count: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0, avgLatencyMs: 0 };
      const nextCount = current.count + (item.count || 0);
      const nextLatency = item.avgLatencyMs || 0;
      current.avgLatencyMs = nextCount > 0 ? (((current.avgLatencyMs * current.count) + (nextLatency * (item.count || 0))) / nextCount) : 0;
      current.count += item.count || 0;
      current.inputTokens += item.inputTokens || 0;
      current.outputTokens += item.outputTokens || 0;
      current.estimatedCost += item.estimatedCost || 0;
      merged.set(item.key, current);
    }
  }
  return [...merged.values()].sort((a, b) => (b.estimatedCost - a.estimatedCost) || (b.count - a.count)).slice(0, 8);
}

export function mergeUsageTrends(...groups: Array<AiUsageSummary['trends'] | undefined>) {
  const merged = new Map<string, { bucket: string; calls: number; success: number; error: number; estimatedCost: number; totalTokens: number; avgLatencyMs: number }>();
  for (const group of groups) {
    for (const item of group || []) {
      const current = merged.get(item.bucket) || { bucket: item.bucket, calls: 0, success: 0, error: 0, estimatedCost: 0, totalTokens: 0, avgLatencyMs: 0 };
      const nextCalls = current.calls + (item.calls || 0);
      current.avgLatencyMs = nextCalls > 0 ? (((current.avgLatencyMs * current.calls) + ((item.avgLatencyMs || 0) * (item.calls || 0))) / nextCalls) : 0;
      current.calls += item.calls || 0;
      current.success += item.success || 0;
      current.error += item.error || 0;
      current.estimatedCost += item.estimatedCost || 0;
      current.totalTokens += item.totalTokens || 0;
      merged.set(item.bucket, current);
    }
  }
  return [...merged.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

export function mergeUsageHotspots(...groups: Array<AiUsageSummary['hotspots'] | undefined>) {
  const mergeList = (selector: (group: NonNullable<AiUsageSummary['hotspots']>) => Array<{ key: string; count: number; estimatedCost: number; avgLatencyMs?: number | null }>) => {
    const merged = new Map<string, { key: string; count: number; estimatedCost: number; avgLatencyMs: number }>();
    for (const group of groups) {
      if (!group) continue;
      for (const item of selector(group)) {
        const current = merged.get(item.key) || { key: item.key, count: 0, estimatedCost: 0, avgLatencyMs: 0 };
        const nextCount = current.count + (item.count || 0);
        current.avgLatencyMs = nextCount > 0 ? (((current.avgLatencyMs * current.count) + ((item.avgLatencyMs || 0) * (item.count || 0))) / nextCount) : 0;
        current.count += item.count || 0;
        current.estimatedCost += item.estimatedCost || 0;
        merged.set(item.key, current);
      }
    }
    return [...merged.values()].sort((a, b) => (b.count - a.count) || (b.estimatedCost - a.estimatedCost)).slice(0, 6);
  };
  return {
    errors: mergeList((group) => group.errors || []),
    expensive: mergeList((group) => group.expensive || []).sort((a, b) => (b.estimatedCost - a.estimatedCost) || (b.count - a.count)).slice(0, 6),
    slow: mergeList((group) => group.slow || []).sort((a, b) => (b.avgLatencyMs - a.avgLatencyMs) || (b.count - a.count)).slice(0, 6),
  };
}

export function mergeUsageSummary(hub?: AiUsageSummary | null, audio?: AiUsageSummary | null): AiUsageSummary {
  return {
    totalCalls: (hub?.totalCalls || 0) + (audio?.totalCalls || 0),
    totalInputTokens: (hub?.totalInputTokens || 0) + (audio?.totalInputTokens || 0),
    totalOutputTokens: (hub?.totalOutputTokens || 0) + (audio?.totalOutputTokens || 0),
    totalEstimatedCost: Number(((hub?.totalEstimatedCost || 0) + (audio?.totalEstimatedCost || 0)).toFixed(4)),
    byScene: mergeUsageBuckets(hub?.byScene, audio?.byScene),
    byProvider: mergeUsageBuckets(hub?.byProvider, audio?.byProvider),
    byModel: mergeUsageBuckets(hub?.byModel, audio?.byModel),
    byStatus: mergeUsageBuckets(hub?.byStatus, audio?.byStatus),
    trends: mergeUsageTrends(hub?.trends, audio?.trends),
    hotspots: mergeUsageHotspots(hub?.hotspots, audio?.hotspots),
  };
}

export type ModelConfigWithUsage = AdminModelConfig & { usageScenes: string[]; usageCount: number };

export function buildModelConfigsWithUsage(
  adminModelConfigs: AdminModelConfig[],
  aiConfigs: AiConfig[],
  scoringSkills: Array<{ modelConfigId?: string | null; name: string }>,
): ModelConfigWithUsage[] {
  const usage = new Map<string, Set<string>>();
  for (const cfg of aiConfigs) {
    if (!cfg.modelConfigId) continue;
    const current = usage.get(cfg.modelConfigId) || new Set<string>();
    current.add(sceneLabel(cfg.type));
    usage.set(cfg.modelConfigId, current);
  }
  for (const skill of scoringSkills) {
    if (!skill.modelConfigId) continue;
    const current = usage.get(skill.modelConfigId) || new Set<string>();
    current.add(`评分 Skill: ${skill.name}`);
    usage.set(skill.modelConfigId, current);
  }
  return adminModelConfigs.map((item) => ({
    ...item,
    usageScenes: [...(usage.get(item.id) || new Set<string>())],
    usageCount: (usage.get(item.id) || new Set<string>()).size,
  }));
}

export type AiUsageEventWithSource = AiUsageEvent & { source?: 'hub' | 'audio' };
