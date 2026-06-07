import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Loader2, Shield, SlidersHorizontal } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  api,
  type AdminStorageStatus,
  type AdminDashboardStats,
  type AdminInviteCode,
  type AdminModelConfig,
  type AdminPromptTemplate,
  type AdminTask,
  type AdminUser,
  type AiConfig,
  type AiConfigMeta,
  type AiUsageEvent,
  type AiUsageSummary,
  type FetchSettings,
  type AudioQuotaSnapshot,
  type FetchQueueDiagnosticResponse,
  type FetchStatusResponse,
  type FallbackScoringRecoverySummary,
  type ItemsStats,
  type NetworkDiagnosticResponse,
  type QueueJobDiagnostic,
  type PreferenceProfileRecord,
  type PreferenceProfileSummary,
  type RetentionRunRecord,
  type ScoringModelProbeSummary,
  type ScoringModelRemediationApplyResult,
  type ScoringSkillHealthSummary,
  type ScoringSkillRecord,
  type ServiceDiagnostic,
  type UserQuota,
} from '../../lib/api';
import { useAuth } from '../../lib/use-auth';

type SettingsTab = 'general' | 'reading' | 'models' | 'integrations' | 'diagnostics' | 'quota' | 'admin';
type AdminTab = 'dashboard' | 'tasks' | 'users' | 'invites';
type AiCenterTab = 'scenes' | 'models' | 'skills' | 'logs';
type AiConfigType =
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

const GENERAL_KEY = 'infohub.settings.general';
const INTEGRATIONS_KEY = 'infohub.settings.integrations';

const TAB_LABELS: Array<{ key: SettingsTab; label: string }> = [
  { key: 'general', label: '通用偏好' },
  { key: 'reading', label: '阅读 AI' },
  { key: 'models', label: 'AI 管理中心' },
  { key: 'integrations', label: '集成' },
  { key: 'diagnostics', label: '诊断中心' },
  { key: 'quota', label: '播客配额' },
  { key: 'admin', label: '管理后台' },
];

const ADMIN_TAB_LABELS: Array<{ key: AdminTab; label: string }> = [
  { key: 'dashboard', label: '总览看板' },
  { key: 'tasks', label: '任务管理' },
  { key: 'users', label: '用户管理' },
  { key: 'invites', label: '邀请码管理' },
];

const AI_CENTER_TABS: Array<{ key: AiCenterTab; label: string }> = [
  { key: 'scenes', label: '场景控制台' },
  { key: 'models', label: '模型仓库' },
  { key: 'skills', label: '评分 Skills' },
  { key: 'logs', label: '使用日志' },
];

const READING_SCENE_TYPES: AiConfigType[] = ['quality_filter', 'scoring', 'summary', 'translation'];
const DAILY_REPORT_SCENE_TYPES: AiConfigType[] = [
  'daily_report',
  'daily_report_cleaning',
  'daily_report_decision',
  'daily_report_research',
  'daily_report_reading',
  'daily_report_final',
];
const ALL_BATCH_SCENE_TYPES: AiConfigType[] = [...READING_SCENE_TYPES, ...DAILY_REPORT_SCENE_TYPES];

const DEFAULT_PROMPTS: Record<AiConfigType, string> = {
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

const VOLCENGINE_ARK_PROVIDER = 'volcengine_ark';
const VOLCENGINE_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_LLM_PROVIDER = VOLCENGINE_ARK_PROVIDER;
const DEFAULT_LLM_ENDPOINT_ID = '';
const DEFAULT_LLM_BASE_URL = VOLCENGINE_ARK_BASE_URL;
const AI_SCENE_LABELS: Record<string, string> = {
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

type GeneralPrefs = {
  compactList: boolean;
  autoRefreshSeconds: number;
  openExternalInNewTab: boolean;
  cardShowAbsoluteTime: boolean;
};

function normalizeProvider(provider?: string | null) {
  const normalized = (provider || '').trim().toLowerCase();
  if (normalized === 'doubao') return VOLCENGINE_ARK_PROVIDER;
  return normalized || DEFAULT_LLM_PROVIDER;
}

function providerLabel(provider?: string | null) {
  const normalized = normalizeProvider(provider);
  if (normalized === 'dashscope') return 'DashScope';
  if (normalized === VOLCENGINE_ARK_PROVIDER) return 'Volcengine Ark';
  if (normalized === 'openai_compatible') return 'OpenAI-compatible';
  if (normalized === 'openai') return 'OpenAI';
  return provider || DEFAULT_LLM_PROVIDER;
}

function isVolcengineArk(provider?: string | null) {
  return normalizeProvider(provider) === VOLCENGINE_ARK_PROVIDER;
}

function baseUrlForProvider(provider?: string | null, current?: string) {
  if (isVolcengineArk(provider)) return VOLCENGINE_ARK_BASE_URL;
  if (normalizeProvider(provider) === DEFAULT_LLM_PROVIDER) return current || DEFAULT_LLM_BASE_URL;
  return current || '';
}

function modelTarget(model?: Partial<AdminModelConfig> | null) {
  if (!model) return '';
  return isVolcengineArk(model.provider)
    ? String(model.extra_config?.endpointId || model.model_name || '')
    : String(model.model_name || '');
}

function modelDisplayName(model?: Partial<AdminModelConfig> | null) {
  if (!model) return '未绑定';
  return String(model.alias || modelTarget(model) || '未命名模型');
}

function freshnessBadge(status?: FetchStatusResponse['freshnessStatus']) {
  if (status === 'stale') return { label: '数据已过期', className: 'bg-red-100 text-red-700 border-red-200' };
  if (status === 'warning') return { label: '有到期来源待补抓', className: 'bg-amber-100 text-amber-700 border-amber-200' };
  return { label: '数据新鲜度正常', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
}

const QUEUE_STATE_LABELS: Record<string, string> = {
  waiting: '等待',
  active: '执行中',
  completed: '已完成',
  failed: '失败',
  delayed: '延迟',
  prioritized: '优先队列',
  paused: '暂停',
};

function queueStateLabel(state?: string | null) {
  const normalized = String(state || '').trim().toLowerCase();
  return QUEUE_STATE_LABELS[normalized] || '状态待确认';
}

const FETCH_OUTCOME_LABELS: Record<string, string> = {
  success: '成功',
  done: '完成',
  ok: '成功',
  running: '抓取中',
  pending: '等待中',
  error: '失败',
  failed: '失败',
  partial: '部分完成',
  new_items: '有新增',
  all_duplicate: '全部重复',
  no_new: '无新增',
  no_items: '无结果',
  skipped: '已跳过',
  filtered: '已过滤',
};

function fetchOutcomeLabel(outcome?: unknown, status?: unknown) {
  const normalized = String(outcome || status || '').trim().toLowerCase();
  return FETCH_OUTCOME_LABELS[normalized] || '状态待确认';
}

type IntegrationPrefs = {
  ntfyTopic: string;
  feishuWebhook: string;
  webhookSecret: string;
};

type AiForm = {
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

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeAiForm(
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

function sectionTitle(title: string, desc?: string) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-zinc-800">{title}</h2>
      {desc ? <p className="text-xs text-zinc-500 mt-0.5">{desc}</p> : null}
    </div>
  );
}

function formatBytes(value?: number | null) {
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

function sceneLabel(sceneType: string) {
  return AI_SCENE_LABELS[sceneType] || sceneType;
}

function mergeUsageBuckets(...groups: Array<Array<{ key: string; count: number; inputTokens: number; outputTokens: number; estimatedCost: number; avgLatencyMs?: number | null }> | undefined>) {
  const merged = new Map<string, { key: string; count: number; inputTokens: number; outputTokens: number; estimatedCost: number; avgLatencyMs: number }>();
  for (const group of groups) {
    for (const item of group || []) {
      const current = merged.get(item.key) || {
        key: item.key,
        count: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        avgLatencyMs: 0,
      };
      const nextCount = current.count + (item.count || 0);
      const nextLatency = item.avgLatencyMs || 0;
      current.avgLatencyMs = nextCount > 0
        ? (((current.avgLatencyMs * current.count) + (nextLatency * (item.count || 0))) / nextCount)
        : 0;
      current.count += item.count || 0;
      current.inputTokens += item.inputTokens || 0;
      current.outputTokens += item.outputTokens || 0;
      current.estimatedCost += item.estimatedCost || 0;
      merged.set(item.key, current);
    }
  }
  return [...merged.values()].sort((a, b) => (b.estimatedCost - a.estimatedCost) || (b.count - a.count)).slice(0, 8);
}

function mergeUsageTrends(...groups: Array<AiUsageSummary['trends'] | undefined>) {
  const merged = new Map<string, { bucket: string; calls: number; success: number; error: number; estimatedCost: number; totalTokens: number; avgLatencyMs: number }>();
  for (const group of groups) {
    for (const item of group || []) {
      const current = merged.get(item.bucket) || {
        bucket: item.bucket,
        calls: 0,
        success: 0,
        error: 0,
        estimatedCost: 0,
        totalTokens: 0,
        avgLatencyMs: 0,
      };
      const nextCalls = current.calls + (item.calls || 0);
      current.avgLatencyMs = nextCalls > 0
        ? (((current.avgLatencyMs * current.calls) + ((item.avgLatencyMs || 0) * (item.calls || 0))) / nextCalls)
        : 0;
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

function mergeUsageHotspots(...groups: Array<AiUsageSummary['hotspots'] | undefined>) {
  const mergeList = (selector: (group: NonNullable<AiUsageSummary['hotspots']>) => Array<{ key: string; count: number; estimatedCost: number; avgLatencyMs?: number | null }>) => {
    const merged = new Map<string, { key: string; count: number; estimatedCost: number; avgLatencyMs: number }>();
    for (const group of groups) {
      if (!group) continue;
      for (const item of selector(group)) {
        const current = merged.get(item.key) || { key: item.key, count: 0, estimatedCost: 0, avgLatencyMs: 0 };
        const nextCount = current.count + (item.count || 0);
        current.avgLatencyMs = nextCount > 0
          ? (((current.avgLatencyMs * current.count) + ((item.avgLatencyMs || 0) * (item.count || 0))) / nextCount)
          : 0;
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

function mergeUsageSummary(hub?: AiUsageSummary | null, audio?: AiUsageSummary | null): AiUsageSummary {
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

function formatCost(value?: number | null) {
  return `¥${Number(value || 0).toFixed(4)}`;
}

export function Settings() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = user?.role === 'admin';
  const initialTab = (searchParams.get('tab') || '').trim();
  const initialAiTab = (searchParams.get('ai') || '').trim();

  const [activeTab, setActiveTab] = useState<SettingsTab>(TAB_LABELS.some((tab) => tab.key === initialTab) ? initialTab as SettingsTab : 'general');
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>('dashboard');
  const [activeAiCenterTab, setActiveAiCenterTab] = useState<AiCenterTab>(AI_CENTER_TABS.some((tab) => tab.key === initialAiTab) ? initialAiTab as AiCenterTab : 'scenes');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [fetchStatus, setFetchStatus] = useState<FetchStatusResponse | null>(null);
  const [itemStats, setItemStats] = useState<ItemsStats | null>(null);
  const [networkDiagnostics, setNetworkDiagnostics] = useState<NetworkDiagnosticResponse | null>(null);
  const [fetchQueueDiagnostics, setFetchQueueDiagnostics] = useState<FetchQueueDiagnosticResponse | null>(null);
  const [retentionStatus, setRetentionStatus] = useState<RetentionRunRecord | null>(null);
  const [storageStatus, setStorageStatus] = useState<AdminStorageStatus | null>(null);
  const [scoringSkills, setScoringSkills] = useState<ScoringSkillRecord[]>([]);
  const [scoringSkillHealth, setScoringSkillHealth] = useState<ScoringSkillHealthSummary | null>(null);
  const [scoringModelProbe, setScoringModelProbe] = useState<ScoringModelProbeSummary | null>(null);
  const [scoringModelRepair, setScoringModelRepair] = useState<ScoringModelRemediationApplyResult | null>(null);
  const [fallbackScoringRecovery, setFallbackScoringRecovery] = useState<FallbackScoringRecoverySummary | null>(null);
  const [scoringProbeLoading, setScoringProbeLoading] = useState(false);
  const [preferenceProfile, setPreferenceProfile] = useState<PreferenceProfileRecord | null>(null);
  const [preferenceSummary, setPreferenceSummary] = useState<PreferenceProfileSummary | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [proxyTesting, setProxyTesting] = useState(false);
  const [proxyInput, setProxyInput] = useState('');
  const [proxyTarget, setProxyTarget] = useState('https://www.github.com');
  const [proxyResult, setProxyResult] = useState<{
    ok: boolean;
    proxyUrl: string;
    targetUrl: string;
    statusCode?: number;
    latencyMs: number;
    error?: string;
  } | null>(null);

  const [generalPrefs, setGeneralPrefs] = useState<GeneralPrefs>(() => readLocal<GeneralPrefs>(GENERAL_KEY, {
    compactList: false,
    autoRefreshSeconds: 30,
    openExternalInNewTab: true,
    cardShowAbsoluteTime: true,
  }));

  const [integrationPrefs, setIntegrationPrefs] = useState<IntegrationPrefs>(() => readLocal<IntegrationPrefs>(INTEGRATIONS_KEY, {
    ntfyTopic: '',
    feishuWebhook: '',
    webhookSecret: '',
  }));
  const [fetchSettings, setFetchSettings] = useState<FetchSettings | null>(null);

  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
  const [aiConfigMeta, setAiConfigMeta] = useState<AiConfigMeta | null>(null);
  const [aiForms, setAiForms] = useState<Record<AiConfigType, AiForm>>({
    quality_filter: normalizeAiForm('quality_filter'),
    scoring: normalizeAiForm('scoring'),
    summary: normalizeAiForm('summary'),
    translation: normalizeAiForm('translation'),
    daily_report: normalizeAiForm('daily_report'),
    daily_report_cleaning: normalizeAiForm('daily_report_cleaning'),
    daily_report_decision: normalizeAiForm('daily_report_decision'),
    daily_report_research: normalizeAiForm('daily_report_research'),
    daily_report_reading: normalizeAiForm('daily_report_reading'),
    daily_report_final: normalizeAiForm('daily_report_final'),
  });

  const [hubQuota, setHubQuota] = useState<UserQuota | null>(null);
  const [audioQuota, setAudioQuota] = useState<AudioQuotaSnapshot | null>(null);
  const [plans, setPlans] = useState<Array<{ id: number; name: string; audioMinutesPerMonth: number; articlesPerDay: number; isPublic: boolean }>>([]);

  const [taskTemplates, setTaskTemplates] = useState<Array<{ id: string; name: string; description?: string; category?: string }>>([]);
  const [taskModels, setTaskModels] = useState<{ llm_models: Array<{ id: string; name: string; description?: string }>; asr_models: Array<{ id: string; name: string; description?: string }> }>({ llm_models: [], asr_models: [] });
  const [adminPromptTemplates, setAdminPromptTemplates] = useState<AdminPromptTemplate[]>([]);
  const [adminModelConfigs, setAdminModelConfigs] = useState<AdminModelConfig[]>([]);
  const [promptPreview, setPromptPreview] = useState<string>('');
  const [aiUsageLoading, setAiUsageLoading] = useState(false);
  const [hubAiUsageSummary, setHubAiUsageSummary] = useState<AiUsageSummary | null>(null);
  const [audioAiUsageSummary, setAudioAiUsageSummary] = useState<AiUsageSummary | null>(null);
  const [hubAiUsageEvents, setHubAiUsageEvents] = useState<AiUsageEvent[]>([]);
  const [audioAiUsageEvents, setAudioAiUsageEvents] = useState<AiUsageEvent[]>([]);
  const [aiUsageSourceFilter, setAiUsageSourceFilter] = useState<'all' | 'hub' | 'audio'>('all');
  const [aiUsageStatusFilter, setAiUsageStatusFilter] = useState('');
  const [aiUsageSceneFilter, setAiUsageSceneFilter] = useState('');
  const [aiUsageProviderFilter, setAiUsageProviderFilter] = useState('');
  const [aiUsageSearch, setAiUsageSearch] = useState('');
  const [aiUsageTimeWindow, setAiUsageTimeWindow] = useState<'24h' | '7d' | '30d'>('7d');
  const [aiUsageInterval, setAiUsageInterval] = useState<'hour' | 'day'>('day');
  const [promptForm, setPromptForm] = useState({
    id: '',
    name: '',
    description: '',
    category: 'feed_summary',
    template_text: '',
    variables: 'title,content',
  });
  const [modelForm, setModelForm] = useState({
    id: '',
    alias: '',
    provider: DEFAULT_LLM_PROVIDER,
    model_name: DEFAULT_LLM_ENDPOINT_ID,
    model_type: 'llm',
    api_key: '',
    base_url: DEFAULT_LLM_BASE_URL,
    extra_config: null as Record<string, unknown> | null,
    is_default: false,
    is_active: true,
  });
  const [bulkModelConfigId, setBulkModelConfigId] = useState('');
  const [skillSaving, setSkillSaving] = useState(false);
  const [profileRebuilding, setProfileRebuilding] = useState(false);

  const [adminStats, setAdminStats] = useState<AdminDashboardStats | null>(null);
  const [adminTasks, setAdminTasks] = useState<AdminTask[]>([]);
  const [adminTaskTotal, setAdminTaskTotal] = useState(0);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminInvites, setAdminInvites] = useState<AdminInviteCode[]>([]);
  const [adminTaskStatus, setAdminTaskStatus] = useState('');
  const [adminTaskSearch, setAdminTaskSearch] = useState('');

  const aiConfigByType = useMemo(() => {
    const map = new Map<AiConfigType, AiConfig>();
    for (const cfg of aiConfigs) {
      if (
        cfg.type === 'quality_filter'
        || cfg.type === 'scoring'
        || cfg.type === 'summary'
        || cfg.type === 'translation'
        || cfg.type === 'daily_report'
        || cfg.type === 'daily_report_cleaning'
        || cfg.type === 'daily_report_decision'
        || cfg.type === 'daily_report_research'
        || cfg.type === 'daily_report_reading'
        || cfg.type === 'daily_report_final'
      ) {
        map.set(cfg.type, cfg);
      }
    }
    return map;
  }, [aiConfigs]);

  const defaultLlmModel = useMemo(() => (
    adminModelConfigs.find((item) => item.model_type === 'llm' && item.is_default)
      || adminModelConfigs.find((item) => item.model_type === 'llm' && String(item.extra_config?.endpointId || item.model_name || '') === DEFAULT_LLM_ENDPOINT_ID)
      || adminModelConfigs.find((item) => item.model_type === 'llm')
      || null
  ), [adminModelConfigs]);

  const defaultPromptByType = useMemo(() => ({
    quality_filter: adminPromptTemplates.find((item) => item.category === 'quality_filter') || null,
    scoring: adminPromptTemplates.find((item) => item.category === 'feed_scoring') || null,
    summary: adminPromptTemplates.find((item) => item.category === 'feed_summary') || null,
    translation: adminPromptTemplates.find((item) => item.category === 'feed_translation') || null,
    daily_report: adminPromptTemplates.find((item) => item.category === 'daily_report') || null,
    daily_report_cleaning: adminPromptTemplates.find((item) => item.category === 'daily_report_cleaning') || null,
    daily_report_decision: adminPromptTemplates.find((item) => item.category === 'daily_report_decision') || null,
    daily_report_research: adminPromptTemplates.find((item) => item.category === 'daily_report_research') || null,
    daily_report_reading: adminPromptTemplates.find((item) => item.category === 'daily_report_reading') || null,
    daily_report_final: adminPromptTemplates.find((item) => item.category === 'daily_report_final') || null,
  }), [adminPromptTemplates]);

  const combinedAiUsageSummary = useMemo(
    () => mergeUsageSummary(hubAiUsageSummary, audioAiUsageSummary),
    [audioAiUsageSummary, hubAiUsageSummary],
  );

  const combinedAiUsageEvents = useMemo(
    () => [...hubAiUsageEvents, ...audioAiUsageEvents]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 120),
    [audioAiUsageEvents, hubAiUsageEvents],
  );

  const filteredAiUsageEvents = useMemo(() => (
    combinedAiUsageEvents.filter((event) => aiUsageSourceFilter === 'all' || event.source === aiUsageSourceFilter)
  ), [aiUsageSourceFilter, combinedAiUsageEvents]);

  const aiUsageErrorBuckets = useMemo(() => {
    const buckets = new Map<string, { key: string; count: number; scenes: Set<string> }>();
    for (const event of filteredAiUsageEvents) {
      if (event.status !== 'error') continue;
      const key = (event.errorMessage || '未知错误').trim();
      const current = buckets.get(key) || { key, count: 0, scenes: new Set<string>() };
      current.count += 1;
      current.scenes.add(sceneLabel(event.sceneType));
      buckets.set(key, current);
    }
    return [...buckets.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [filteredAiUsageEvents]);

  const aiUsageSceneOptions = useMemo(
    () => combinedAiUsageSummary.byScene.map((item) => item.key),
    [combinedAiUsageSummary.byScene],
  );

  const aiUsageProviderOptions = useMemo(
    () => combinedAiUsageSummary.byProvider.map((item) => item.key),
    [combinedAiUsageSummary.byProvider],
  );

  const aiUsageSuccessRate = useMemo(() => {
    const success = combinedAiUsageSummary.byStatus.find((item) => item.key === 'success')?.count || 0;
    return combinedAiUsageSummary.totalCalls > 0
      ? `${((success / combinedAiUsageSummary.totalCalls) * 100).toFixed(1)}%`
      : '—';
  }, [combinedAiUsageSummary.byStatus, combinedAiUsageSummary.totalCalls]);

  const aiUsageAvgLatency = useMemo(() => {
    const trends = combinedAiUsageSummary.trends || [];
    const totalCalls = trends.reduce((sum, item) => sum + (item.calls || 0), 0);
    if (totalCalls === 0) return null;
    const weighted = trends.reduce((sum, item) => sum + ((item.avgLatencyMs || 0) * (item.calls || 0)), 0);
    return Math.round(weighted / totalCalls);
  }, [combinedAiUsageSummary.trends]);

  const modelConfigsWithUsage = useMemo(() => {
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
  }, [adminModelConfigs, aiConfigs, scoringSkills]);

  const groupedModelConfigs = useMemo(() => ({
    llm: modelConfigsWithUsage.filter((item) => item.model_type === 'llm'),
    asr: modelConfigsWithUsage.filter((item) => item.model_type === 'asr'),
    multimodal: modelConfigsWithUsage.filter((item) => item.model_type === 'multimodal'),
  }), [modelConfigsWithUsage]);

  const aiFunctionCards = useMemo(() => (
    ([
      ['quality_filter', 'quality_filter'],
      ['scoring', 'feed_scoring'],
      ['summary', 'feed_summary'],
      ['translation', 'feed_translation'],
      ['daily_report_cleaning', 'daily_report_cleaning'],
      ['daily_report_decision', 'daily_report_decision'],
      ['daily_report_research', 'daily_report_research'],
      ['daily_report_reading', 'daily_report_reading'],
      ['daily_report_final', 'daily_report_final'],
    ] as Array<[AiConfigType, string]>).map(([type, sceneKey]) => {
      const form = aiForms[type];
      const model = modelConfigsWithUsage.find((item) => item.id === form.modelConfigId);
      const prompt = adminPromptTemplates.find((item) => item.id === form.promptTemplateId);
      const status = !form.isActive
        ? { label: '已停用', className: 'bg-zinc-100 text-zinc-600' }
        : !model
          ? { label: '缺少模型', className: 'bg-amber-100 text-amber-700' }
          : model.test_status === 'failed'
            ? { label: '模型异常', className: 'bg-red-100 text-red-700' }
            : !prompt && !form.promptTemplate
              ? { label: '缺少模板', className: 'bg-amber-100 text-amber-700' }
              : { label: '运行中', className: 'bg-emerald-100 text-emerald-700' };
      return {
        type,
        sceneKey,
        title: sceneLabel(sceneKey),
        model,
        prompt,
        status,
      };
    })
  ), [adminPromptTemplates, aiForms, modelConfigsWithUsage]);

  const refreshBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fetchResp, fetchSettingsResp, statResp, aiResp, quotaResp, audioQuotaResp, planResp, tplResp, modelResp, promptResp, adminModelResp, skillResp, profileResp] = await Promise.all([
        api.fetch.status(),
        api.settings.fetch().catch(() => ({ data: { userId: user?.id || '', autoFetchEnabled: true } })),
        api.items.stats(),
        api.aiConfigs.list(),
        api.quota.me(),
        api.audio.getMyQuota().catch(() => null),
        api.quota.plans(),
        api.audio.getTaskTemplates().catch(() => []),
        api.audio.getTaskModels().catch(() => ({ llm_models: [], asr_models: [] })),
        isAdmin ? api.admin.listPromptTemplates().catch(() => []) : Promise.resolve([]),
        isAdmin ? api.admin.listModelConfigs().catch(() => []) : Promise.resolve([]),
        api.scoringSkills.list().catch(() => ({ data: [] as ScoringSkillRecord[], health: null as ScoringSkillHealthSummary | null })),
        api.preferences.profile().catch(() => ({ data: null as PreferenceProfileRecord | null, summary: null as PreferenceProfileSummary | null })),
      ]);

      setFetchStatus(fetchResp);
      setFetchSettings(fetchSettingsResp.data || null);
      setItemStats(statResp);
      setAiConfigs(aiResp.data || []);
      setAiConfigMeta(aiResp.meta || null);
      setHubQuota(quotaResp.data || null);
      setAudioQuota(audioQuotaResp || null);
      setPlans(planResp.data || []);
      setTaskTemplates(tplResp || []);
      setTaskModels(modelResp || { llm_models: [], asr_models: [] });
      setAdminPromptTemplates(promptResp || []);
      setAdminModelConfigs(adminModelResp || []);
      setScoringSkills(skillResp.data || []);
      setScoringSkillHealth(skillResp.health || null);
      setScoringModelProbe(null);
      setScoringModelRepair(null);
      setPreferenceProfile(profileResp.data || null);
      setPreferenceSummary(profileResp.summary || null);
    } catch (err) {
      setError((err as Error).message || '加载设置失败');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, user?.id]);

  const refreshAdmin = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [statsResp, tasksResp, usersResp, invitesResp] = await Promise.all([
        api.admin.dashboardStats(),
        api.admin.listTasks({ page: 1, page_size: 20, status: adminTaskStatus || undefined, search: adminTaskSearch || undefined }),
        api.admin.listUsers(),
        api.admin.listInviteCodes(),
      ]);
      setAdminStats(statsResp);
      setAdminTasks(tasksResp.items || []);
      setAdminTaskTotal(tasksResp.total || 0);
      setAdminUsers(usersResp || []);
      setAdminInvites(invitesResp || []);
    } catch (err) {
      setError((err as Error).message || '加载后台数据失败');
    }
  }, [adminTaskSearch, adminTaskStatus, isAdmin]);

  const refreshAiUsage = useCallback(async () => {
    if (!isAdmin) return;
    setAiUsageLoading(true);
    try {
      const summaryParams = {
        timeWindow: aiUsageTimeWindow,
        interval: aiUsageInterval,
      };
      const eventParams = {
        limit: 120,
        status: aiUsageStatusFilter || undefined,
        sceneType: aiUsageSceneFilter || undefined,
        provider: aiUsageProviderFilter || undefined,
        search: aiUsageSearch.trim() || undefined,
      };
      const [hubSummaryResp, hubEventsResp, audioSummaryResp, audioEventsResp] = await Promise.all([
        api.admin.hubAiUsageSummary(summaryParams).catch(() => ({ data: null as AiUsageSummary | null, source: 'hub' })),
        api.admin.hubAiUsageEvents(eventParams).catch(() => ({ data: [] as AiUsageEvent[], source: 'hub' })),
        api.admin.audioAiUsageSummary(summaryParams).catch(() => ({ data: null as AiUsageSummary | null, source: 'audio' })),
        api.admin.audioAiUsageEvents(eventParams).catch(() => ({ data: [] as AiUsageEvent[], source: 'audio' })),
      ]);
      setHubAiUsageSummary(hubSummaryResp.data || null);
      setHubAiUsageEvents((hubEventsResp.data || []).map((event) => ({ ...event, source: 'hub' as const })));
      setAudioAiUsageSummary(audioSummaryResp.data || null);
      setAudioAiUsageEvents((audioEventsResp.data || []).map((event) => ({ ...event, source: 'audio' as const })));
    } catch (err) {
      setError((err as Error).message || '加载 AI 使用日志失败');
    } finally {
      setAiUsageLoading(false);
    }
  }, [aiUsageInterval, aiUsageProviderFilter, aiUsageSceneFilter, aiUsageSearch, aiUsageStatusFilter, aiUsageTimeWindow, isAdmin]);

  const refreshDiagnostics = useCallback(async () => {
    setDiagnosticLoading(true);
    try {
      const networkPromise = api.diagnostics.network();
      const queuePromise = isAdmin ? api.diagnostics.fetchJobs({ limit: 20 }) : Promise.resolve(null);
      const retentionPromise = isAdmin ? api.admin.retentionStatus().catch(() => ({ data: null as RetentionRunRecord | null })) : Promise.resolve({ data: null as RetentionRunRecord | null });
      const storagePromise = isAdmin ? api.admin.storageStatus().catch(() => ({ data: null as AdminStorageStatus | null })) : Promise.resolve({ data: null as AdminStorageStatus | null });
      const [network, queue, retention, storage] = await Promise.all([networkPromise, queuePromise, retentionPromise, storagePromise]);
      setNetworkDiagnostics(network);
      setFetchQueueDiagnostics(queue);
      setRetentionStatus(retention.data || null);
      setStorageStatus(storage.data || null);
    } catch (err) {
      setError((err as Error).message || '加载诊断信息失败');
    } finally {
      setDiagnosticLoading(false);
    }
  }, [isAdmin]);

  const handleCreateDefaultSkill = async () => {
    setSkillSaving(true);
    setError(null);
    try {
      await api.scoringSkills.create({ createDefault: true });
      const skillsResp = await api.scoringSkills.list();
      setScoringSkills(skillsResp.data || []);
      setScoringSkillHealth(skillsResp.health || null);
      setNotice('三个默认评分 Skills 已创建');
    } catch (err) {
      setError((err as Error).message || '创建默认评分技能失败');
    } finally {
      setSkillSaving(false);
    }
  };

  const handleCreateSkill = async () => {
    setSkillSaving(true);
    setError(null);
    try {
      await api.scoringSkills.create({ name: '新的评分技能', status: 'draft', weight: 1 });
      const skillsResp = await api.scoringSkills.list();
      setScoringSkills(skillsResp.data || []);
      setScoringSkillHealth(skillsResp.health || null);
      setNotice('已新增评分技能草稿');
    } catch (err) {
      setError((err as Error).message || '创建评分技能失败');
    } finally {
      setSkillSaving(false);
    }
  };

  const handleToggleSkill = async (skillId: number) => {
    setSkillSaving(true);
    setError(null);
    try {
      await api.scoringSkills.toggle(skillId);
      const skillsResp = await api.scoringSkills.list();
      setScoringSkills(skillsResp.data || []);
      setScoringSkillHealth(skillsResp.health || null);
      setNotice('评分技能状态已更新');
    } catch (err) {
      setError((err as Error).message || '更新评分技能失败');
    } finally {
      setSkillSaving(false);
    }
  };

  const handleSaveSkill = async (skill: ScoringSkillRecord, patch: Partial<ScoringSkillRecord>) => {
    setSkillSaving(true);
    setError(null);
    try {
      await api.scoringSkills.update(skill.id, patch);
      const skillsResp = await api.scoringSkills.list();
      setScoringSkills(skillsResp.data || []);
      setScoringSkillHealth(skillsResp.health || null);
      setNotice(`已保存技能：${patch.name || skill.name}`);
    } catch (err) {
      setError((err as Error).message || '保存评分技能失败');
    } finally {
      setSkillSaving(false);
    }
  };

  const handleDeleteSkill = async (skillId: number) => {
    setSkillSaving(true);
    setError(null);
    try {
      await api.scoringSkills.delete(skillId);
      const skillsResp = await api.scoringSkills.list();
      setScoringSkills(skillsResp.data || []);
      setScoringSkillHealth(skillsResp.health || null);
      setNotice('评分技能已删除');
    } catch (err) {
      setError((err as Error).message || '删除评分技能失败');
    } finally {
      setSkillSaving(false);
    }
  };

  const handleRebuildProfile = async () => {
    setProfileRebuilding(true);
    setError(null);
    try {
      const resp = await api.preferences.rebuildProfile();
      setPreferenceProfile(resp.data || null);
      setPreferenceSummary(resp.summary || null);
      setNotice('偏好画像已更新');
    } catch (err) {
      setError((err as Error).message || '重建偏好画像失败');
    } finally {
      setProfileRebuilding(false);
    }
  };

  const runProxyTest = async () => {
    if (!proxyInput.trim()) {
      setError('请输入代理地址（例如 http://127.0.0.1:7890）');
      return;
    }
    setProxyTesting(true);
    setError(null);
    setProxyResult(null);
    try {
      const result = await api.diagnostics.proxyTest({
        proxyUrl: proxyInput.trim(),
        targetUrl: proxyTarget.trim() || undefined,
      });
      setProxyResult(result);
      setNotice(result.ok ? '代理测试通过' : '代理可达但存在异常');
    } catch (err) {
      setProxyResult(null);
      setError((err as Error).message || '代理测试失败');
    } finally {
      setProxyTesting(false);
    }
  };

  useEffect(() => {
    void refreshBase();
  }, [refreshBase]);

  useEffect(() => {
    const defaultModelId = defaultLlmModel?.id;
    const qualityFilter = normalizeAiForm('quality_filter', aiConfigByType.get('quality_filter'), defaultModelId, defaultPromptByType.quality_filter?.id);
    const scoring = normalizeAiForm('scoring', aiConfigByType.get('scoring'), defaultModelId, defaultPromptByType.scoring?.id);
    const summary = normalizeAiForm('summary', aiConfigByType.get('summary'), defaultModelId, defaultPromptByType.summary?.id);
    const translation = normalizeAiForm('translation', aiConfigByType.get('translation'), defaultModelId, defaultPromptByType.translation?.id);
    const dailyReport = normalizeAiForm('daily_report', aiConfigByType.get('daily_report'), defaultModelId, defaultPromptByType.daily_report?.id);
    const cleaning = normalizeAiForm('daily_report_cleaning', aiConfigByType.get('daily_report_cleaning') || aiConfigByType.get('daily_report'), defaultModelId, defaultPromptByType.daily_report_cleaning?.id || defaultPromptByType.daily_report?.id);
    const decision = normalizeAiForm('daily_report_decision', aiConfigByType.get('daily_report_decision') || aiConfigByType.get('daily_report'), defaultModelId, defaultPromptByType.daily_report_decision?.id || defaultPromptByType.daily_report?.id);
    const research = normalizeAiForm('daily_report_research', aiConfigByType.get('daily_report_research') || aiConfigByType.get('daily_report'), defaultModelId, defaultPromptByType.daily_report_research?.id || defaultPromptByType.daily_report?.id);
    const reading = normalizeAiForm('daily_report_reading', aiConfigByType.get('daily_report_reading') || aiConfigByType.get('daily_report'), defaultModelId, defaultPromptByType.daily_report_reading?.id || defaultPromptByType.daily_report?.id);
    const final = normalizeAiForm('daily_report_final', aiConfigByType.get('daily_report_final') || aiConfigByType.get('daily_report'), defaultModelId, defaultPromptByType.daily_report_final?.id || defaultPromptByType.daily_report?.id);
    setAiForms({
      quality_filter: qualityFilter,
      scoring,
      summary,
      translation,
      daily_report: dailyReport,
      daily_report_cleaning: cleaning,
      daily_report_decision: decision,
      daily_report_research: research,
      daily_report_reading: reading,
      daily_report_final: final,
    });
  }, [aiConfigByType, defaultLlmModel, defaultPromptByType]);

  useEffect(() => {
    if (activeTab === 'admin' && isAdmin) {
      void refreshAdmin();
    }
  }, [activeTab, isAdmin, refreshAdmin]);

  useEffect(() => {
    if (activeTab === 'models' && activeAiCenterTab === 'logs' && isAdmin) {
      void refreshAiUsage();
    }
  }, [activeAiCenterTab, activeTab, isAdmin, refreshAiUsage]);

  useEffect(() => {
    if (activeTab === 'diagnostics') {
      void refreshDiagnostics();
    }
  }, [activeTab, refreshDiagnostics]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', activeTab);
    if (activeTab === 'models') {
      next.set('ai', activeAiCenterTab);
    } else {
      next.delete('ai');
    }
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [activeAiCenterTab, activeTab, searchParams, setSearchParams]);

  const saveGeneralPrefs = () => {
    writeLocal(GENERAL_KEY, generalPrefs);
    setNotice('通用偏好已保存');
  };

  const saveFetchSettings = async () => {
    if (!fetchSettings) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const resp = await api.settings.updateFetch({
        autoFetchEnabled: fetchSettings.autoFetchEnabled,
      });
      setFetchSettings(resp.data || null);
      await refreshBase();
      setNotice(fetchSettings.autoFetchEnabled ? '自动抓取已开启' : '自动抓取已关闭，手动抓取仍可用');
    } catch (err) {
      setError((err as Error).message || '保存自动抓取设置失败');
    } finally {
      setSaving(false);
    }
  };

  const saveIntegrationPrefs = () => {
    writeLocal(INTEGRATIONS_KEY, integrationPrefs);
    setNotice('集成配置已保存（本地）');
  };

  const saveAiConfig = async (type: AiConfigType) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    const form = aiForms[type];
    const selectedModel = modelConfigsWithUsage.find((item) => item.id === form.modelConfigId);
    const selectedPrompt = adminPromptTemplates.find((item) => item.id === form.promptTemplateId);
    const payload = {
      name: form.name,
      provider: selectedModel?.provider || form.provider,
      model: selectedModel?.model_name || form.model,
      baseUrl: selectedModel?.base_url || form.baseUrl,
      temperature: form.temperature,
      promptTemplate: selectedPrompt?.template_text || form.promptTemplate,
      promptTemplateId: form.promptTemplateId || null,
      modelConfigId: form.modelConfigId || null,
      type,
      isActive: form.isActive,
    };

    try {
      const existing = aiConfigByType.get(type);
      if (existing?.id) {
        await api.aiConfigs.update(existing.id, payload);
      } else {
        await api.aiConfigs.create(payload as Partial<AiConfig>);
      }
      await refreshBase();
      setNotice(`${type} 场景绑定已保存`);
    } catch (err) {
      setError((err as Error).message || '保存 AI 配置失败');
    } finally {
      setSaving(false);
    }
  };

  const applyModelToScenes = async (types: AiConfigType[], label: string, modelConfigIdOverride?: string | null) => {
    if (!isAdmin) return;
    const modelConfigId = modelConfigIdOverride || bulkModelConfigId || defaultLlmModel?.id || '';
    if (!modelConfigId) {
      setError('请先在模型仓库创建并启用一个 LLM 模型');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.aiConfigs.batchModel({ modelConfigId, types, isActive: true });
      await refreshBase();
      const selectedModel = adminModelConfigs.find((item) => item.id === modelConfigId);
      setNotice(`${label} 已切换到 ${modelDisplayName(selectedModel)}`);
    } catch (err) {
      setError((err as Error).message || '批量应用模型失败');
    } finally {
      setSaving(false);
    }
  };

  const probeRecommendedScoringModel = async () => {
    const modelConfigId = scoringSkillHealth?.remediation?.recommendedModelConfigId || '';
    if (!isAdmin || !modelConfigId) return;
    setScoringProbeLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.scoringSkills.probeModel({ modelConfigId, limit: 2 });
      setScoringModelProbe(result.data);
      setNotice(result.data.message);
    } catch (err) {
      setError((err as Error).message || '验证备用评分模型失败');
    } finally {
      setScoringProbeLoading(false);
    }
  };

  const applyRecommendedScoringModelAndRepair = async () => {
    const modelConfigId = scoringSkillHealth?.remediation?.recommendedModelConfigId || '';
    if (!isAdmin || !modelConfigId || scoringModelProbe?.canSwitch !== true) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.scoringSkills.applyModelRemediation({ modelConfigId, limit: 2 });
      await refreshBase();
      setScoringModelRepair(result.data);
      setNotice(result.data.repair.message);
    } catch (err) {
      setError((err as Error).message || '切换并修复评分失败项失败');
    } finally {
      setSaving(false);
    }
  };

  const recoverFallbackScoringItems = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.scoringSkills.recoverFallbackScoring({ limit: 5 });
      await refreshBase();
      setFallbackScoringRecovery(result.data);
      setNotice(result.data.message);
    } catch (err) {
      setError((err as Error).message || '回收历史兜底评分失败');
    } finally {
      setSaving(false);
    }
  };

  const editPromptTemplate = (template: AdminPromptTemplate) => {
    const variables = Array.isArray(template.variables)
      ? template.variables.join(',')
      : Object.keys((template.variables as Record<string, unknown>) || {}).join(',');
    setPromptForm({
      id: template.id,
      name: template.name || '',
      description: template.description || '',
      category: template.category || 'feed_summary',
      template_text: template.template_text || '',
      variables,
    });
  };

  const resetPromptForm = () => {
    setPromptForm({
      id: '',
      name: '',
      description: '',
      category: 'feed_summary',
      template_text: '',
      variables: 'title,content',
    });
    setPromptPreview('');
  };

  const savePromptTemplate = async () => {
    if (!isAdmin) return;
    try {
      const payload = {
        name: promptForm.name,
        description: promptForm.description || undefined,
        category: promptForm.category,
        template_text: promptForm.template_text,
        variables: promptForm.variables.split(',').map((item) => item.trim()).filter(Boolean),
      };
      if (promptForm.id) {
        await api.admin.updatePromptTemplate(promptForm.id, payload);
      } else {
        await api.admin.createPromptTemplate(payload);
      }
      await refreshBase();
      resetPromptForm();
      setNotice('提示词模板已保存');
    } catch (err) {
      setError((err as Error).message || '提示词模板保存失败');
    }
  };

  const previewPromptTemplate = async (templateId: string) => {
    try {
      const result = await api.admin.previewPromptTemplate(templateId);
      setPromptPreview(result.rendered || '');
      setNotice(`已预览模板：${result.template_name}`);
    } catch (err) {
      setError((err as Error).message || '模板预览失败');
    }
  };

  const deletePromptTemplate = async (template: AdminPromptTemplate) => {
    if (!window.confirm(`确认删除模板“${template.name}”？`)) return;
    try {
      await api.admin.deletePromptTemplate(template.id);
      await refreshBase();
      if (promptForm.id === template.id) resetPromptForm();
      setNotice('提示词模板已删除');
    } catch (err) {
      setError((err as Error).message || '模板删除失败');
    }
  };

  const editModelConfig = (model: AdminModelConfig) => {
    const normalizedProvider = normalizeProvider(model.provider);
    const endpointId = isVolcengineArk(normalizedProvider)
      ? String(model.extra_config?.endpointId || model.model_name || '')
      : (model.model_name || '');
    setModelForm({
      id: model.id,
      alias: model.alias || '',
      provider: normalizedProvider,
      model_name: endpointId,
      model_type: model.model_type || 'llm',
      api_key: '',
      base_url: baseUrlForProvider(normalizedProvider, model.base_url || ''),
      extra_config: (model.extra_config as Record<string, unknown> | null) || null,
      is_default: Boolean(model.is_default),
      is_active: model.is_active ?? true,
    });
  };

  const resetModelForm = () => {
    setModelForm({
      id: '',
      alias: '',
      provider: DEFAULT_LLM_PROVIDER,
      model_name: DEFAULT_LLM_ENDPOINT_ID,
      model_type: 'llm',
      api_key: '',
      base_url: DEFAULT_LLM_BASE_URL,
      extra_config: null,
      is_default: false,
      is_active: true,
    });
  };

  const saveModelConfig = async () => {
    if (!isAdmin) return;
    try {
      const provider = normalizeProvider(modelForm.provider);
      if (isVolcengineArk(provider) && !String(modelForm.model_name || '').trim().startsWith('ep-')) {
        setError('Volcengine Ark 必须填写 endpoint id（ep-...），不要再填 doubao-pro-* 这类模型名');
        return;
      }
      const payload = {
        alias: modelForm.alias || undefined,
        provider,
        model_name: modelForm.model_name,
        model_type: modelForm.model_type,
        api_key: modelForm.api_key || undefined,
        base_url: baseUrlForProvider(provider, modelForm.base_url || undefined) || undefined,
        extra_config: isVolcengineArk(provider)
          ? {
            ...(modelForm.extra_config || {}),
            accessMode: 'endpoint',
            endpointId: modelForm.model_name,
          }
          : modelForm.extra_config || undefined,
        is_default: modelForm.is_default,
        is_active: modelForm.is_active,
      };
      if (modelForm.id) {
        await api.admin.updateModelConfig(modelForm.id, payload);
      } else {
        await api.admin.createModelConfig(payload);
      }
      await refreshBase();
      resetModelForm();
      setNotice('模型配置已保存');
    } catch (err) {
      setError((err as Error).message || '模型配置保存失败');
    }
  };

  const testModelConfig = async (modelId: string) => {
    try {
      await api.admin.testModelConfig(modelId);
      await refreshBase();
      setNotice('模型连通测试已执行');
    } catch (err) {
      setError((err as Error).message || '模型测试失败');
    }
  };

  const deleteModelConfig = async (model: AdminModelConfig) => {
    if (!window.confirm(`确认删除模型“${modelDisplayName(model)}”？`)) return;
    try {
      await api.admin.deleteModelConfig(model.id);
      await refreshBase();
      if (modelForm.id === model.id) resetModelForm();
      setNotice('模型配置已删除');
    } catch (err) {
      setError((err as Error).message || '模型删除失败');
    }
  };

  const saveQuota = async () => {
    if (!hubQuota) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.quota.update({
        autoTranscribeEnabled: hubQuota.autoTranscribeEnabled,
        maxAutoPerDay: hubQuota.maxAutoPerDay,
      });
      await refreshBase();
      setNotice('播客配额设置已保存');
    } catch (err) {
      setError((err as Error).message || '保存配额失败');
    } finally {
      setSaving(false);
    }
  };

  const changePlan = async (planName: string) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.quota.setPlan(planName);
      await refreshBase();
      setNotice(`套餐已切换到 ${planName}`);
    } catch (err) {
      setError((err as Error).message || '切换套餐失败');
    } finally {
      setSaving(false);
    }
  };

  const updateAdminUser = async (target: AdminUser, patch: Partial<{ is_active: boolean; role: string; quota_seconds_monthly: number }>) => {
    try {
      await api.admin.updateUser(target.id, patch);
      await refreshAdmin();
      setNotice('用户已更新');
    } catch (err) {
      setError((err as Error).message || '更新用户失败');
    }
  };

  const removeAdminUser = async (target: AdminUser) => {
    if (!window.confirm(`确认删除用户 ${target.username} ?`)) return;
    try {
      await api.admin.deleteUser(target.id);
      await refreshAdmin();
      setNotice('用户已删除');
    } catch (err) {
      setError((err as Error).message || '删除用户失败');
    }
  };

  const createInviteCode = async () => {
    try {
      await api.admin.createInviteCode({ max_uses: 5, expires_days: 30 });
      await refreshAdmin();
      setNotice('邀请码已创建');
    } catch (err) {
      setError((err as Error).message || '创建邀请码失败');
    }
  };

  const reprocessTask = async (taskId: string) => {
    try {
      await api.admin.reprocessTask(taskId);
      await refreshAdmin();
      setNotice('任务已重新提交');
    } catch (err) {
      setError((err as Error).message || '重跑任务失败');
    }
  };

  const renderStatusCards = () => (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
      <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
        <div className="text-2xl font-bold text-zinc-900">{itemStats?.total ?? 0}</div>
        <div className="text-xs text-zinc-500 mt-1">总条目</div>
      </div>
      <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
        <div className="text-2xl font-bold text-zinc-900">{itemStats?.unread ?? 0}</div>
        <div className="text-xs text-zinc-500 mt-1">未读</div>
      </div>
      <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
        <div className="text-2xl font-bold text-zinc-900">{fetchStatus?.queue?.waiting ?? fetchStatus?.waiting ?? 0}</div>
        <div className="text-xs text-zinc-500 mt-1">采集队列等待</div>
      </div>
      <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
        <div className="text-2xl font-bold text-zinc-900">{fetchStatus?.user?.sourceCount ?? 0}</div>
        <div className="text-xs text-zinc-500 mt-1">我的信源</div>
      </div>
      <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
        <div className="text-2xl font-bold text-zinc-900">{fetchStatus?.user?.dueSources ?? 0}</div>
        <div className="text-xs text-zinc-500 mt-1">当前到期信源</div>
      </div>
    </div>
  );

  const renderAiConfigCard = (type: AiConfigType, title: string) => {
    const form = aiForms[type];
    const selectedModel = adminModelConfigs.find((item) => item.id === form.modelConfigId);
    const selectedPrompt = adminPromptTemplates.find((item) => item.id === form.promptTemplateId);
    const sceneStatus = !form.isActive
      ? { label: '场景停用', className: 'bg-zinc-100 text-zinc-600' }
      : !selectedModel
        ? { label: '未绑定模型', className: 'bg-amber-100 text-amber-700' }
        : selectedModel.test_status === 'failed'
          ? { label: '模型测试失败', className: 'bg-red-100 text-red-700' }
          : !selectedModel.has_api_key
            ? { label: '缺少密钥', className: 'bg-amber-100 text-amber-700' }
            : { label: '已可用', className: 'bg-emerald-100 text-emerald-700' };
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-800">{title}</h3>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${sceneStatus.className}`}>{sceneStatus.label}</span>
            <label className="text-xs text-zinc-600 inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={form.isActive}
                disabled={!isAdmin}
                onChange={(e) => setAiForms((prev) => ({ ...prev, [type]: { ...prev[type], isActive: e.target.checked } }))}
              />
              启用
            </label>
          </div>
        </div>
        <input
          value={form.name}
          disabled={!isAdmin}
          onChange={(e) => setAiForms((prev) => ({ ...prev, [type]: { ...prev[type], name: e.target.value } }))}
          placeholder="场景名称"
          className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <select
            value={form.modelConfigId || ''}
            disabled={!isAdmin}
            onChange={(e) => setAiForms((prev) => {
              const next = adminModelConfigs.find((item) => item.id === e.target.value);
              return {
                ...prev,
                [type]: {
                  ...prev[type],
                  modelConfigId: e.target.value || undefined,
                  provider: next?.provider || prev[type].provider,
                  model: next?.model_name || prev[type].model,
                  baseUrl: next?.base_url || prev[type].baseUrl,
                },
              };
            })}
            className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"
          >
            <option value="">选择模型</option>
            {modelConfigsWithUsage
              .filter((item) => item.model_type === 'llm' || item.model_type === 'multimodal')
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {modelDisplayName(item)} · {providerLabel(item.provider)}
                </option>
              ))}
          </select>
          <select
            value={form.promptTemplateId || ''}
            disabled={!isAdmin}
            onChange={(e) => setAiForms((prev) => {
              const next = adminPromptTemplates.find((item) => item.id === e.target.value);
              return {
                ...prev,
                [type]: {
                  ...prev[type],
                  promptTemplateId: e.target.value || undefined,
                  promptTemplate: next?.template_text || prev[type].promptTemplate,
                },
              };
            })}
            className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"
          >
            <option value="">选择提示词模板</option>
            {adminPromptTemplates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.category}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_160px] gap-2">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            {selectedModel ? (
              <>
                <div className="font-medium text-zinc-800">{modelDisplayName(selectedModel)}</div>
                <div className="mt-1">
                  {providerLabel(selectedModel.provider)}
                  <span className="mx-1 text-zinc-300">·</span>
                  目标 {modelTarget(selectedModel)}
                  <span className="mx-1 text-zinc-300">·</span>
                  Key {selectedModel.has_api_key ? '已配置' : '未配置'}
                </div>
              </>
            ) : (
              '请先选择模型仓库里的已配置模型'
            )}
          </div>
          <input
            value={String(form.temperature)}
            disabled={!isAdmin}
            onChange={(e) => setAiForms((prev) => ({ ...prev, [type]: { ...prev[type], temperature: Number(e.target.value || 0) } }))}
            placeholder="temperature"
            className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">
            当前模板正文
          </label>
          <textarea
            value={selectedPrompt?.template_text || form.promptTemplate}
            disabled={!isAdmin}
            onChange={(e) => setAiForms((prev) => ({ ...prev, [type]: { ...prev[type], promptTemplate: e.target.value } }))}
            placeholder="Prompt 模板"
            rows={8}
            className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg font-mono leading-relaxed"
          />
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
          生效模型：{modelDisplayName(selectedModel) || form.model || '未绑定'} · 生效模板：{selectedPrompt?.name || '未绑定'}
          {selectedModel && (
            <>
              <span className="mx-1 text-zinc-300">·</span>
              目标 {modelTarget(selectedModel)}
              <span className="mx-1 text-zinc-300">·</span>
              密钥 {selectedModel.has_api_key ? '已配置' : '未配置'}
            </>
          )}
        </div>
        <button
          onClick={() => void saveAiConfig(type)}
          disabled={saving || !isAdmin}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          {isAdmin ? `保存 ${title}` : '仅管理员可编辑'}
        </button>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-7xl">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-zinc-900">设置中心</h1>
          <p className="text-sm text-zinc-500 mt-1">通用偏好、阅读翻译、模型配置、集成、配额与后台管理</p>
        </div>
        <button
          onClick={() => {
            void refreshBase();
            if (activeTab === 'admin' && isAdmin) void refreshAdmin();
            if (activeTab === 'diagnostics') void refreshDiagnostics();
          }}
          className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm rounded-lg border border-zinc-200 hover:bg-zinc-50"
        >
          <Activity size={14} /> 刷新
        </button>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {TAB_LABELS.filter((tab) => tab.key !== 'admin' || isAdmin).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`min-h-9 px-3 py-2 text-sm rounded-lg border ${activeTab === tab.key ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">{error}</div>}
      {notice && <div className="mb-4 px-3 py-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg">{notice}</div>}

      {loading ? (
        <div className="text-center py-20 text-zinc-400">加载中...</div>
      ) : (
        <div>
          {renderStatusCards()}

          {activeTab === 'general' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-4">
                {sectionTitle('通用偏好', '仅影响当前浏览器体验')}
                <label className="flex items-center justify-between text-sm text-zinc-700">
                  列表紧凑模式
                  <input type="checkbox" checked={generalPrefs.compactList} onChange={(e) => setGeneralPrefs((prev) => ({ ...prev, compactList: e.target.checked }))} />
                </label>
                <label className="flex items-center justify-between text-sm text-zinc-700">
                  卡片显示绝对时间
                  <input type="checkbox" checked={generalPrefs.cardShowAbsoluteTime} onChange={(e) => setGeneralPrefs((prev) => ({ ...prev, cardShowAbsoluteTime: e.target.checked }))} />
                </label>
                <label className="flex items-center justify-between text-sm text-zinc-700">
                  外链新窗口打开
                  <input type="checkbox" checked={generalPrefs.openExternalInNewTab} onChange={(e) => setGeneralPrefs((prev) => ({ ...prev, openExternalInNewTab: e.target.checked }))} />
                </label>
                <div className="flex items-center justify-between text-sm text-zinc-700">
                  自动刷新秒数
                  <input
                    type="number"
                    min={10}
                    max={300}
                    value={generalPrefs.autoRefreshSeconds}
                    onChange={(e) => setGeneralPrefs((prev) => ({ ...prev, autoRefreshSeconds: Number(e.target.value || 30) }))}
                    className="w-24 px-2 py-1 border border-zinc-200 rounded"
                  />
                </div>
                <button onClick={saveGeneralPrefs} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white">
                  <SlidersHorizontal size={14} /> 保存通用偏好
                </button>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-4">
                {sectionTitle('自动抓取', '这里控制 cron 自动采集；手动抓取按钮始终可用。')}
                <label className="flex items-center justify-between text-sm text-zinc-700">
                  全局自动抓取
                  <input
                    type="checkbox"
                    checked={fetchSettings?.autoFetchEnabled ?? true}
                    onChange={(e) => setFetchSettings((prev) => ({
                      userId: prev?.userId || user?.id || '',
                      autoFetchEnabled: e.target.checked,
                      createdAt: prev?.createdAt,
                      updatedAt: prev?.updatedAt,
                    }))}
                  />
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-zinc-500">
                  <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
                    我的信源：<span className="font-medium text-zinc-800">{fetchStatus?.user?.sourceCount ?? 0}</span>
                  </div>
                  <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
                    活跃信源：<span className="font-medium text-zinc-800">{fetchStatus?.user?.activeSources ?? 0}</span>
                  </div>
                  <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
                    自动抓取中：<span className="font-medium text-zinc-800">{fetchStatus?.user?.autoFetchSourceCount ?? 0}</span>
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                  当前全局状态：
                  <span className={`ml-1 inline-flex rounded-full px-1.5 py-0.5 ${fetchSettings?.autoFetchEnabled ?? true ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {fetchSettings?.autoFetchEnabled ?? true ? '已开启' : '已关闭'}
                  </span>
                  <span className="mx-2 text-zinc-300">·</span>
                  调度模式 <span className="font-medium text-zinc-800">{fetchStatus?.user?.scheduleMode || 'hybrid'}</span>
                  <span className="mx-2 text-zinc-300">·</span>
                  新鲜度 <span className="font-medium text-zinc-800">{freshnessBadge(fetchStatus?.freshnessStatus).label}</span>
                  <span className="mx-2 text-zinc-300">·</span>
                  当前到期 {fetchStatus?.user?.dueSources ?? 0} 个信源
                  <span className="mx-2 text-zinc-300">·</span>
                  单源是否参与自动抓取请到「信源管理」页单独控制。
                </div>
                <button onClick={() => void saveFetchSettings()} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white disabled:opacity-50" disabled={saving}>
                  <SlidersHorizontal size={14} /> 保存抓取设置
                </button>
              </div>
            </div>
          )}

          {activeTab === 'reading' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                {sectionTitle('阅读 AI 当前状态', '阅读评分、摘要、翻译现在都走管理员统一配置；普通用户只查看生效状态。')}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {([
                    ['quality_filter', '阅读质检'],
                    ['scoring', '阅读评分'],
                    ['summary', '阅读摘要'],
                    ['translation', '阅读翻译'],
                  ] as Array<[AiConfigType, string]>).map(([type, title]) => {
                    const cfg = aiForms[type];
                    return (
                      <div key={type} className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-medium text-zinc-800">{title}</h3>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cfg.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-200 text-zinc-600'}`}>
                            {cfg.isActive ? '已启用' : '未启用'}
                          </span>
                        </div>
                        <div className="mt-2 text-xs text-zinc-500">
                          场景名：{cfg.name || '未命名'}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          模型：{cfg.modelLabel || adminModelConfigs.find((item) => item.id === cfg.modelConfigId)?.model_name || cfg.model || '未绑定'}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          模板：{cfg.promptTemplateName || adminPromptTemplates.find((item) => item.id === cfg.promptTemplateId)?.name || '未绑定'}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-700">
                  阅读翻译不是假的。后端真实执行链路是 <code className="rounded bg-sky-100 px-1">scoring → summary → translation</code>，当前只是把配置入口统一收敛到了“AI 管理中心”。
                </div>
                {aiConfigMeta && (
                  <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                    当前配置来源：
                    <span className="font-medium text-zinc-800"> {aiConfigMeta.ownerLabel || '未解析'}</span>
                    <span className="mx-1 text-zinc-300">·</span>
                    作用域 <span className="font-medium text-zinc-800">{aiConfigMeta.scope}</span>
                    <span className="mx-1 text-zinc-300">·</span>
                    解析方式 <span className="font-medium text-zinc-800">{aiConfigMeta.resolvedFrom}</span>
                    {aiConfigMeta.availableScenes && aiConfigMeta.availableScenes.length > 0 && (
                      <>
                        <span className="mx-1 text-zinc-300">·</span>
                        已启用场景 {aiConfigMeta.availableScenes.join(', ')}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'models' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    {sectionTitle('AI 管理中心', '现在拆成场景控制台、模型仓库、评分 Skills 和使用日志四层；重点解决“这个功能到底用哪个模型”。')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {AI_CENTER_TABS.map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setActiveAiCenterTab(tab.key)}
                        className={`min-h-9 rounded-full border px-3 py-2 text-xs transition-colors ${activeAiCenterTab === tab.key ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {activeAiCenterTab === 'scenes' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-zinc-200 bg-white p-4">
                    {sectionTitle('场景总览', '按场景看启用状态、绑定模型、模型别名、模板和当前健康度。')}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                      {aiFunctionCards.map((card) => (
                        <div key={card.sceneKey} className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-medium text-zinc-800">{card.title}</h3>
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${card.status.className}`}>{card.status.label}</span>
                          </div>
                          <div className="mt-2 text-xs text-zinc-500">模型：{modelDisplayName(card.model)}</div>
                          {card.model && (
                            <div className="mt-1 text-xs text-zinc-500">目标：{modelTarget(card.model)}</div>
                          )}
                          <div className="mt-1 text-xs text-zinc-500">模板：{card.prompt?.name || '内联模板 / 未绑定'}</div>
                          {card.model && (
                            <div className="mt-1 text-xs text-zinc-500">Provider：{providerLabel(card.model.provider)} · 测试 {card.model.test_status || 'untested'}</div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-700">
                      阅读链路仍然是真实的 <code className="rounded bg-sky-100 px-1">scoring → summary → translation</code>。现在把“是否启用、由哪套模型/模板驱动、最近是否健康”都显式化了。
                    </div>
                    {aiConfigMeta && (
                      <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                        当前配置来源：
                        <span className="font-medium text-zinc-800"> {aiConfigMeta.ownerLabel || '未解析'}</span>
                        <span className="mx-1 text-zinc-300">·</span>
                        作用域 <span className="font-medium text-zinc-800">{aiConfigMeta.scope}</span>
                        <span className="mx-1 text-zinc-300">·</span>
                        解析方式 <span className="font-medium text-zinc-800">{aiConfigMeta.resolvedFrom}</span>
                        {aiConfigMeta.availableScenes && aiConfigMeta.availableScenes.length > 0 && (
                          <>
                            <span className="mx-1 text-zinc-300">·</span>
                            已启用场景 {aiConfigMeta.availableScenes.join(', ')}
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-zinc-200 bg-white p-4">
                    {sectionTitle('场景控制台', '把阅读链路与日报多智能体链路统一绑定到模型、别名和提示词模板。')}
                    <div className="space-y-4">
                      {isAdmin && (
                        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3">
                          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 lg:items-center">
                            <select
                              value={bulkModelConfigId || defaultLlmModel?.id || ''}
                              onChange={(e) => setBulkModelConfigId(e.target.value)}
                              className="px-3 py-2 text-sm border border-zinc-200 rounded-lg bg-white"
                            >
                              <option value="">选择要批量应用的模型</option>
                              {modelConfigsWithUsage
                                .filter((item) => item.model_type === 'llm' || item.model_type === 'multimodal')
                                .map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {modelDisplayName(item)} · {providerLabel(item.provider)}
                                  </option>
                                ))}
                            </select>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => void applyModelToScenes(ALL_BATCH_SCENE_TYPES, '全部阅读和日报场景')}
                                disabled={saving}
                                className="px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white disabled:opacity-50"
                              >
                                应用到全部场景
                              </button>
                              <button
                                onClick={() => void applyModelToScenes(READING_SCENE_TYPES, '阅读链路')}
                                disabled={saving}
                                className="px-3 py-2 text-sm rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 disabled:opacity-50"
                              >
                                只应用到阅读
                              </button>
                              <button
                                onClick={() => void applyModelToScenes(DAILY_REPORT_SCENE_TYPES, '日报链路')}
                                disabled={saving}
                                className="px-3 py-2 text-sm rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 disabled:opacity-50"
                              >
                                只应用到日报
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 text-xs text-zinc-500">
                            批量操作只改模型绑定，不覆盖提示词模板和温度。
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">阅读链路</div>
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                          {renderAiConfigCard('quality_filter', '阅读质检')}
                          {renderAiConfigCard('scoring', '阅读评分')}
                          {renderAiConfigCard('summary', '摘要生成')}
                          {renderAiConfigCard('translation', '阅读翻译')}
                        </div>
                      </div>
                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">日报多智能体链路</div>
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                          {renderAiConfigCard('daily_report_cleaning', '日报清洗')}
                          {renderAiConfigCard('daily_report_decision', '决策简报')}
                          {renderAiConfigCard('daily_report_research', '研究汇总')}
                          {renderAiConfigCard('daily_report_reading', '阅读导航')}
                          {renderAiConfigCard('daily_report_final', '最终日报')}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                    评分 Skills 和偏好画像已经独立到上方的 <span className="font-semibold">「评分 Skills」</span> 分组里，这里只保留场景绑定和提示词管理，避免入口继续埋深。
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-4">
                    <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-4">
                      {sectionTitle('提示词模板库', 'Feed / 日报提示词统一在这里维护，并能按场景看到当前使用关系。')}
                      {!isAdmin ? (
                        <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
                          仅管理员可以新增、编辑和预览提示词模板。
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <input
                            value={promptForm.name}
                            onChange={(e) => setPromptForm((prev) => ({ ...prev, name: e.target.value }))}
                            placeholder="模板名称"
                            className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg"
                          />
                          <input
                            value={promptForm.description}
                            onChange={(e) => setPromptForm((prev) => ({ ...prev, description: e.target.value }))}
                            placeholder="模板说明"
                            className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={promptForm.category}
                              onChange={(e) => setPromptForm((prev) => ({ ...prev, category: e.target.value }))}
                              className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"
                            >
                              <option value="feed_scoring">feed_scoring</option>
                              <option value="feed_summary">feed_summary</option>
                              <option value="feed_translation">feed_translation</option>
                              <option value="daily_report">daily_report</option>
                              <option value="daily_report_cleaning">daily_report_cleaning</option>
                              <option value="daily_report_decision">daily_report_decision</option>
                              <option value="daily_report_research">daily_report_research</option>
                              <option value="daily_report_reading">daily_report_reading</option>
                              <option value="daily_report_final">daily_report_final</option>
                              <option value="audio_summary">audio_summary</option>
                            </select>
                            <input
                              value={promptForm.variables}
                              onChange={(e) => setPromptForm((prev) => ({ ...prev, variables: e.target.value }))}
                              placeholder="变量，如 title,content"
                              className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"
                            />
                          </div>
                          <textarea
                            value={promptForm.template_text}
                            onChange={(e) => setPromptForm((prev) => ({ ...prev, template_text: e.target.value }))}
                            rows={10}
                            placeholder="模板正文"
                            className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg font-mono leading-relaxed"
                          />
                          <div className="flex gap-2">
                            <button onClick={() => void savePromptTemplate()} className="px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white">保存模板</button>
                            <button onClick={resetPromptForm} className="px-3 py-2 text-sm rounded-lg border border-zinc-200 hover:bg-zinc-50">清空</button>
                          </div>
                        </div>
                      )}
                      <div className="space-y-2 max-h-[300px] overflow-y-auto">
                        {adminPromptTemplates.map((template) => (
                          <div key={template.id} className="rounded-lg border border-zinc-100 px-3 py-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="font-medium text-zinc-800">{template.name}</div>
                                <div className="text-zinc-500">{template.category} · v{template.version || 1}</div>
                              </div>
                              <span className={`px-1.5 py-0.5 rounded-full ${template.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>
                                {template.is_system ? 'system' : 'custom'}
                              </span>
                            </div>
                            <div className="mt-1 text-zinc-400">
                              当前使用场景：
                              {aiFunctionCards
                                .filter((item) => item.prompt?.id === template.id)
                                .map((item) => item.title)
                                .join('、') || '未绑定'}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button onClick={() => editPromptTemplate(template)} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-900">编辑</button>
                              <button onClick={() => void previewPromptTemplate(template.id)} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-900">预览</button>
                              {!template.is_system && isAdmin && (
                                <button onClick={() => void deletePromptTemplate(template)} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-red-200 px-3 py-2 text-xs text-red-700 transition-colors hover:bg-red-50 hover:text-red-800">删除</button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {promptPreview && (
                        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                          <h3 className="text-xs font-semibold text-zinc-700 mb-2">模板预览</h3>
                          <pre className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-600">{promptPreview}</pre>
                        </div>
                      )}
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-xl border border-zinc-200 bg-white p-4">
                        {sectionTitle('音频运行时能力', '音频工坊仍保留自己的运行时模型和模板，但现在和阅读/日报能力并列展示。')}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <h3 className="text-xs font-semibold text-zinc-700">ASR 模型</h3>
                            {taskModels.asr_models.length === 0 ? <p className="text-xs text-zinc-400">暂无</p> : taskModels.asr_models.map((model) => (
                              <div key={model.id} className="text-xs text-zinc-700 border border-zinc-100 rounded px-2 py-1">{model.name} <span className="text-zinc-400">({model.id})</span></div>
                            ))}
                          </div>
                          <div className="space-y-2">
                            <h3 className="text-xs font-semibold text-zinc-700">LLM 模型</h3>
                            {taskModels.llm_models.length === 0 ? <p className="text-xs text-zinc-400">暂无</p> : taskModels.llm_models.map((model) => (
                              <div key={model.id} className="text-xs text-zinc-700 border border-zinc-100 rounded px-2 py-1">{model.name} <span className="text-zinc-400">({model.id})</span></div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-zinc-200 bg-white p-4">
                        {sectionTitle('音频任务模板', '音频工坊仍可直接选择的任务模板，和 Feed/日报模板库并列存在。')}
                        <div className="space-y-2 max-h-[320px] overflow-y-auto">
                          {taskTemplates.length === 0 ? <p className="text-xs text-zinc-400">暂无模板</p> : taskTemplates.map((template) => (
                            <div key={template.id} className="text-xs border border-zinc-100 rounded px-3 py-2">
                              <div className="font-medium text-zinc-800">{template.name}</div>
                              <div className="text-zinc-500">{template.description || '无描述'}</div>
                              <div className="text-zinc-400">分类: {template.category || 'default'}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeAiCenterTab === 'models' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-zinc-200 bg-white p-4">
                      <div className="text-2xl font-bold text-zinc-900">{adminModelConfigs.length}</div>
                      <div className="mt-1 text-xs text-zinc-500">注册模型</div>
                    </div>
                    <div className="rounded-xl border border-zinc-200 bg-white p-4">
                      <div className="text-2xl font-bold text-zinc-900">{adminModelConfigs.filter((item) => item.is_active).length}</div>
                      <div className="mt-1 text-xs text-zinc-500">启用模型</div>
                    </div>
                    <div className="rounded-xl border border-zinc-200 bg-white p-4">
                      <div className="text-2xl font-bold text-zinc-900">{adminModelConfigs.filter((item) => !item.has_api_key).length}</div>
                      <div className="mt-1 text-xs text-zinc-500">待补密钥</div>
                    </div>
                    <div className="rounded-xl border border-zinc-200 bg-white p-4">
                      <div className="text-2xl font-bold text-zinc-900">{adminPromptTemplates.length}</div>
                      <div className="mt-1 text-xs text-zinc-500">提示词模板</div>
                    </div>
                  </div>

                  {!isAdmin ? (
                    <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
                      仅管理员可以新增模型、维护 API Key 与 Base URL。
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-4">
                      <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-4">
                        {sectionTitle('模型仓库', '统一管理模型别名、接入方式、Key、Base URL、接入点和默认状态。')}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <input
                            value={modelForm.alias}
                            onChange={(e) => setModelForm((prev) => ({ ...prev, alias: e.target.value }))}
                            placeholder="模型别名，例如 AI 新闻主模型"
                            className="px-3 py-2 text-sm border border-zinc-200 rounded-lg md:col-span-2"
                          />
                          <select
                            value={modelForm.provider}
                            onChange={(e) => setModelForm((prev) => ({
                              ...prev,
                              provider: e.target.value,
                              base_url: baseUrlForProvider(e.target.value, prev.base_url),
                            }))}
                            className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"
                          >
                            <option value={VOLCENGINE_ARK_PROVIDER}>Volcengine Ark</option>
                            <option value="openai_compatible">OpenAI-compatible</option>
                            <option value="openai">OpenAI</option>
                          </select>
                          <input
                            value={modelForm.model_name}
                            onChange={(e) => setModelForm((prev) => ({ ...prev, model_name: e.target.value }))}
                            placeholder={isVolcengineArk(modelForm.provider) ? '接入点 ID，例如 ep-20260309-xxxx' : 'model_name'}
                            className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"
                          />
                          <select
                            value={modelForm.model_type}
                            onChange={(e) => setModelForm((prev) => ({ ...prev, model_type: e.target.value }))}
                            className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"
                          >
                            <option value="llm">llm</option>
                            <option value="asr">asr</option>
                            <option value="multimodal">multimodal</option>
                          </select>
                          <input
                            value={modelForm.api_key}
                            onChange={(e) => setModelForm((prev) => ({ ...prev, api_key: e.target.value }))}
                            placeholder={isVolcengineArk(modelForm.provider) ? 'ARK_API_KEY（更新时留空表示不改）' : 'API Key（更新时留空表示不改）'}
                            className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"
                          />
                          <input
                            value={modelForm.base_url}
                            onChange={(e) => setModelForm((prev) => ({ ...prev, base_url: e.target.value }))}
                            placeholder={isVolcengineArk(modelForm.provider) ? '方舟 Base URL' : 'base_url（可选）'}
                            className="px-3 py-2 text-sm border border-zinc-200 rounded-lg md:col-span-2"
                          />
                        </div>
                        <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                          当前 provider：<span className="font-medium text-zinc-800">{providerLabel(modelForm.provider)}</span>
                          {isVolcengineArk(modelForm.provider)
                            ? '，这里的“模型”其实就是 Endpoint ID。豆包最小必填是：ARK_API_KEY + Endpoint ID（ep-...）+ Base URL。'
                            : '，这里维护的是模型仓库配置，具体场景绑定在「场景控制台」。'}
                        </div>
                        {isVolcengineArk(modelForm.provider) && (
                          <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-700">
                            豆包填写示例：
                            <span className="font-medium"> provider=Volcengine Ark</span>
                            <span className="mx-1 text-sky-300">·</span>
                            <span className="font-medium">API Key=ARK_API_KEY</span>
                            <span className="mx-1 text-sky-300">·</span>
                            <span className="font-medium">模型/接入点=ep-xxxxxxxx</span>
                            <span className="mx-1 text-sky-300">·</span>
                            <span className="font-medium">Base URL=https://ark.cn-beijing.volces.com/api/v3</span>
                            <div className="mt-1 text-sky-800">运行时标准字段已经切到 <code className="rounded bg-sky-100 px-1">DEFAULT_LLM_ENDPOINT_ID</code>；<code className="rounded bg-sky-100 px-1">DOUBAO_ENDPOINT_ID</code> 只作为迁移兼容，不再建议继续填写。</div>
                          </div>
                        )}
                        <div className="flex items-center gap-4 text-xs text-zinc-600">
                          <label className="inline-flex items-center gap-2">
                            <input type="checkbox" checked={modelForm.is_default} onChange={(e) => setModelForm((prev) => ({ ...prev, is_default: e.target.checked }))} />
                            默认模型
                          </label>
                          <label className="inline-flex items-center gap-2">
                            <input type="checkbox" checked={modelForm.is_active} onChange={(e) => setModelForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
                            启用
                          </label>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => void saveModelConfig()} className="px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white">保存模型</button>
                          <button onClick={resetModelForm} className="px-3 py-2 text-sm rounded-lg border border-zinc-200 hover:bg-zinc-50">清空</button>
                        </div>
                        <div className="space-y-2 max-h-[360px] overflow-y-auto">
                          {modelConfigsWithUsage.map((model) => (
                            <div key={model.id} className="rounded-lg border border-zinc-100 px-3 py-2 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <div className="font-medium text-zinc-800">
                                    {modelDisplayName(model)}
                                  </div>
                                  <div className="text-zinc-500">{providerLabel(model.provider)} · {model.model_type} · 目标 {modelTarget(model)}</div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className={`px-1.5 py-0.5 rounded-full ${model.has_api_key ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                    {model.has_api_key ? 'Key 已配置' : 'Key 待配置'}
                                  </span>
                                  <span className={`px-1.5 py-0.5 rounded-full ${model.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>
                                    {model.test_status || 'untested'}
                                  </span>
                                </div>
                              </div>
                              {model.test_message && <div className="mt-1 text-zinc-400">{model.test_message}</div>}
                              {model.usageScenes && model.usageScenes.length > 0 && (
                                <div className="mt-1 text-zinc-400">使用场景：{model.usageScenes.join('、')}</div>
                              )}
                              <div className="mt-1 text-zinc-400">Base URL：{model.base_url || '默认'}</div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button onClick={() => editModelConfig(model)} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-900">编辑</button>
                                <button onClick={() => void testModelConfig(model.id)} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-900">测试</button>
                                <button onClick={() => void deleteModelConfig(model)} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-red-200 px-3 py-2 text-xs text-red-700 transition-colors hover:bg-red-50 hover:text-red-800">删除</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-xl border border-zinc-200 bg-white p-4">
                          {sectionTitle('模型分布', '按能力类型看当前模型库存，方便确认哪一层缺失。')}
                          <div className="grid grid-cols-1 gap-3">
                            {([
                              ['llm', groupedModelConfigs.llm],
                              ['asr', groupedModelConfigs.asr],
                              ['multimodal', groupedModelConfigs.multimodal],
                            ] as Array<[string, AdminModelConfig[]]>).map(([group, models]) => (
                              <div key={group} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-medium text-zinc-800">{group.toUpperCase()}</span>
                                  <span className="text-xs text-zinc-500">{models.length} 个</span>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {models.length === 0 ? (
                                    <span className="text-xs text-zinc-400">暂无</span>
                                  ) : models.map((model) => (
                                    <span key={model.id} className="rounded-full border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-600">
                                      {modelDisplayName(model)}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-xl border border-zinc-200 bg-white p-4">
                          {sectionTitle('运行时快照', '保留音频工坊当前可选模型，方便对照接入层配置是否真正进入运行时。')}
                          <div className="space-y-2">
                            <h3 className="text-xs font-semibold text-zinc-700">ASR</h3>
                            {taskModels.asr_models.length === 0 ? <p className="text-xs text-zinc-400">暂无</p> : taskModels.asr_models.map((model) => (
                              <div key={model.id} className="text-xs text-zinc-700 border border-zinc-100 rounded px-2 py-1">{model.name}</div>
                            ))}
                          </div>
                          <div className="space-y-2 mt-4">
                            <h3 className="text-xs font-semibold text-zinc-700">LLM</h3>
                            {taskModels.llm_models.length === 0 ? <p className="text-xs text-zinc-400">暂无</p> : taskModels.llm_models.map((model) => (
                              <div key={model.id} className="text-xs text-zinc-700 border border-zinc-100 rounded px-2 py-1">{model.name}</div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeAiCenterTab === 'skills' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-4">
                    <div className="rounded-xl border border-zinc-200 bg-white p-4">
                      {sectionTitle('评分 Skills', '每个 Skill 都是一种精选视角。系统默认提供 3 个预设 Skills，你也可以继续扩展自己的个性化评分视角。')}
                      {scoringSkillHealth && (
                        <div className={`mb-4 rounded-xl border px-3 py-3 ${
                          scoringSkillHealth.status === 'healthy'
                            ? 'border-emerald-100 bg-emerald-50'
                            : scoringSkillHealth.status === 'error'
                              ? 'border-rose-100 bg-rose-50'
                              : 'border-amber-100 bg-amber-50'
                        }`}>
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-zinc-900">评分健康</span>
                                <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                                  scoringSkillHealth.status === 'healthy'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : scoringSkillHealth.status === 'error'
                                      ? 'bg-rose-100 text-rose-700'
                                      : 'bg-amber-100 text-amber-700'
                                }`}>
                                  {scoringSkillHealth.status === 'healthy' ? '健康' : scoringSkillHealth.status === 'error' ? '异常' : '需复核'}
                                </span>
                                <span className="text-xs text-zinc-600">
                                  启用 {scoringSkillHealth.activeSkillCount}/{scoringSkillHealth.totalSkillCount} · 近期错误 {scoringSkillHealth.recentErrorCount} · 空响应 {scoringSkillHealth.emptyResponseCount} · 重试恢复 {scoringSkillHealth.retryRecoveredCount} · 兜底 {scoringSkillHealth.deterministicFallbackCount} · 熔断观察 {scoringSkillHealth.unstableModelCount}
                                  {scoringSkillHealth.lastErrorAt ? ` · 最近 ${new Date(scoringSkillHealth.lastErrorAt).toLocaleString('zh-CN')}` : ''}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {scoringSkillHealth.activeSkills.length > 0 ? scoringSkillHealth.activeSkills.map((skill) => (
                                  <span key={skill.id} className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-zinc-700">
                                    {skill.name} · 权重 {skill.weight} · {skill.modelConfigId || '场景默认模型'}
                                  </span>
                                )) : (
                                  <span className="text-xs text-rose-700">没有启用中的评分 Skill</span>
                                )}
                              </div>
                              <div className="space-y-1 text-xs leading-5 text-zinc-700">
                                {scoringSkillHealth.recommendations.map((item) => (
                                  <div key={item}>{item}</div>
                                ))}
                              </div>
                              {scoringSkillHealth.unstableModels.length > 0 && (
                                <div className="space-y-1 rounded-lg border border-amber-200 bg-white/75 px-2 py-2">
                                  {scoringSkillHealth.unstableModels.slice(0, 2).map((model) => (
                                    <div key={model.modelKey} className="text-[11px] leading-5 text-zinc-700">
                                      <span className="font-medium text-zinc-900">模型熔断观察</span>
                                      <span> · {model.modelName || model.modelConfigId || model.modelKey}</span>
                                      <span> · 可重试失败 {model.retryableFailureCount}</span>
                                      <span> · 重试恢复 {model.retryRecoveredCount}</span>
                                      <span> · 兜底 {model.deterministicFallbackCount}</span>
                                      {model.lastFailureAt ? <span> · 最近失败 {new Date(model.lastFailureAt).toLocaleString('zh-CN')}</span> : null}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {scoringSkillHealth.remediation && scoringSkillHealth.remediation.action !== 'none' && (
                                <div className="space-y-2 rounded-lg border border-amber-200 bg-white/80 px-2 py-2">
                                  <div className="text-[11px] leading-5 text-zinc-700">
                                    <span className="font-medium text-zinc-900">治理建议</span>
                                    <span> · {scoringSkillHealth.remediation.message}</span>
                                  </div>
                                  {scoringSkillHealth.remediation.candidateModels.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-2">
                                      {scoringSkillHealth.remediation.candidateModels.slice(0, 2).map((model) => (
                                        <span key={model.id} className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-700">
                                          {model.label}
                                          {model.testStatus ? ` · ${model.testStatus}` : ''}
                                        </span>
                                      ))}
                                      {isAdmin && scoringSkillHealth.remediation.recommendedModelConfigId && (
                                        <>
                                          <button
                                            onClick={() => void probeRecommendedScoringModel()}
                                            disabled={scoringProbeLoading}
                                            className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                                          >
                                            {scoringProbeLoading ? '验证中...' : '验证备用模型'}
                                          </button>
                                          <button
                                            onClick={() => void applyRecommendedScoringModelAndRepair()}
                                            disabled={
                                              saving
                                              || scoringModelProbe?.modelConfigId !== scoringSkillHealth.remediation.recommendedModelConfigId
                                              || scoringModelProbe?.canSwitch !== true
                                            }
                                            className="rounded-lg border border-amber-300 bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-50"
                                          >
                                            切换并修复样本
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  )}
                                  {scoringModelProbe && scoringModelProbe.modelConfigId === scoringSkillHealth.remediation.recommendedModelConfigId && (
                                    <div className={`rounded-md border px-2 py-1 text-[11px] leading-5 ${
                                      scoringModelProbe.canSwitch
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                        : 'border-rose-200 bg-rose-50 text-rose-800'
                                    }`}>
                                      <span className="font-medium">验证结果</span>
                                      <span> · {scoringModelProbe.message}</span>
                                      <span> · 通过 {scoringModelProbe.passed}/{scoringModelProbe.probed}</span>
                                      {scoringModelProbe.firstError ? <span> · 首个错误 {scoringModelProbe.firstError}</span> : null}
                                    </div>
                                  )}
                                  {scoringModelRepair && scoringModelRepair.modelConfigId === scoringSkillHealth.remediation.recommendedModelConfigId && (
                                    <div className={`rounded-md border px-2 py-1 text-[11px] leading-5 ${
                                      scoringModelRepair.repair.status === 'recovered'
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                        : 'border-rose-200 bg-rose-50 text-rose-800'
                                    }`}>
                                      <span className="font-medium">修复结果</span>
                                      <span> · {scoringModelRepair.repair.message}</span>
                                      <span> · 恢复率 {Math.round(scoringModelRepair.repair.recoveryRate * 100)}%</span>
                                      {scoringModelRepair.repair.firstError ? <span> · 首个错误 {scoringModelRepair.repair.firstError}</span> : null}
                                    </div>
                                  )}
                                  {scoringSkillHealth.remediation.action === 'repair_config' && (
                                    <div className="text-[11px] text-amber-800">先到模型仓库新增或测试通过一个 LLM 模型，再回到这里刷新诊断。</div>
                                  )}
                                </div>
                              )}
                              {fallbackScoringRecovery && (
                                <div className={`rounded-md border px-2 py-1 text-[11px] leading-5 ${
                                  fallbackScoringRecovery.status === 'recovered'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                    : fallbackScoringRecovery.status === 'partial' || fallbackScoringRecovery.status === 'blocked'
                                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                                      : fallbackScoringRecovery.status === 'empty'
                                        ? 'border-zinc-200 bg-white text-zinc-600'
                                        : 'border-rose-200 bg-rose-50 text-rose-800'
                                }`}>
                                  <span className="font-medium">历史兜底回收</span>
                                  <span> · {fallbackScoringRecovery.message}</span>
                                  <span> · 候选 {fallbackScoringRecovery.candidateCount}</span>
                                  <span> · 恢复 {fallbackScoringRecovery.recovered}/{fallbackScoringRecovery.attempted}</span>
                                  <span> · 剩余 {fallbackScoringRecovery.remainingCandidateCount}</span>
                                  {fallbackScoringRecovery.firstError ? <span> · 首个错误 {fallbackScoringRecovery.firstError}</span> : null}
                                </div>
                              )}
                              {scoringSkillHealth.recentErrors.length > 0 && (
                                <div className="space-y-1 rounded-lg border border-white/80 bg-white/70 px-2 py-2">
                                  {scoringSkillHealth.recentErrors.slice(0, 3).map((event, index) => (
                                    <div key={`${event.skillName}-${event.targetId || index}-${event.createdAt || index}`} className="text-[11px] leading-5 text-zinc-600">
                                      <span className="font-medium text-zinc-800">{event.skillName}</span>
                                      <span> · {event.message}</span>
                                      {event.modelName ? <span> · {event.modelName}</span> : null}
                                      {event.targetId ? <span> · 条目 {event.targetId.slice(0, 8)}</span> : null}
                                      {event.createdAt ? <span> · {new Date(event.createdAt).toLocaleString('zh-CN')}</span> : null}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex shrink-0 flex-col gap-2">
                              <button
                                onClick={() => void recoverFallbackScoringItems()}
                                disabled={saving}
                                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                              >
                                回收历史兜底评分
                              </button>
                              <button
                                onClick={() => void refreshBase()}
                                disabled={loading}
                                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                              >
                                刷新诊断
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50 px-3 py-3 text-xs leading-6 text-sky-800">
                        <div><span className="font-semibold">Skills</span> 负责智能评分与个性化判断，<span className="font-semibold">Rules</span> 负责硬过滤和加权。</div>
                        <div>系统始终保证至少保留 1 个启用中的评分技能；如果还没配置，评分链会自动补齐 3 个默认预设 Skills。</div>
                      </div>
                      {scoringSkills.length > 0 && (
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <div className="text-xs text-zinc-500">Feed 详情里的评分拆解会和这里的技能一一对应。</div>
                          <button
                            onClick={() => void handleCreateSkill()}
                            disabled={skillSaving}
                            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                          >
                            {skillSaving ? '处理中...' : '新增评分技能'}
                          </button>
                        </div>
                      )}
                      {scoringSkills.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-5">
                          <p className="text-sm text-zinc-600">当前还没有个人评分技能。创建后，系统会补齐 3 个默认预设 Skills，并保证评分链至少保留 1 个启用中的技能。</p>
                          <button
                            onClick={() => void handleCreateDefaultSkill()}
                            disabled={skillSaving}
                            className="mt-3 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50"
                          >
                            {skillSaving ? '创建中...' : '创建默认 3 Skills'}
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {scoringSkills.map((skill) => (
                            <div key={skill.id} className="rounded-xl border border-zinc-100 bg-zinc-50 p-4">
                              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                <div className="min-w-0 flex-1 space-y-2">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium text-zinc-900">{skill.name}</span>
                                    {skill.isDefault && (
                                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] text-sky-700">默认技能</span>
                                    )}
                                    {skill.presetKey && (
                                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] text-violet-700">系统预设</span>
                                    )}
                                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${skill.status === 'active' ? 'bg-emerald-100 text-emerald-700' : skill.status === 'archived' ? 'bg-zinc-200 text-zinc-600' : 'bg-amber-100 text-amber-700'}`}>
                                      {skill.status === 'active' ? '已启用' : skill.status === 'archived' ? '已归档' : '草稿'}
                                    </span>
                                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">权重 {skill.weight}</span>
                                  </div>
                                  <input
                                    value={skill.name}
                                    onChange={(e) => setScoringSkills((prev) => prev.map((entry) => entry.id === skill.id ? { ...entry, name: e.target.value } : entry))}
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                                  />
                                  <input
                                    value={skill.description || ''}
                                    onChange={(e) => setScoringSkills((prev) => prev.map((entry) => entry.id === skill.id ? { ...entry, description: e.target.value } : entry))}
                                    placeholder="技能定位"
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                                  />
                                  <textarea
                                    value={skill.instructionPrompt}
                                    onChange={(e) => setScoringSkills((prev) => prev.map((entry) => entry.id === skill.id ? { ...entry, instructionPrompt: e.target.value } : entry))}
                                    rows={6}
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-mono leading-relaxed"
                                  />
                                </div>
                                <div className="w-full xl:w-52 space-y-2">
                                  <label className="block text-xs text-zinc-500">权重</label>
                                  <input
                                    type="number"
                                    min={0.1}
                                    max={5}
                                    step={0.1}
                                    value={skill.weight}
                                    onChange={(e) => setScoringSkills((prev) => prev.map((entry) => entry.id === skill.id ? { ...entry, weight: Number(e.target.value || 1) } : entry))}
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                                  />
                                  <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[11px] leading-5 text-zinc-500">
                                    {skill.isDefault
                                      ? '默认技能可编辑，但系统不会允许你把评分链清空到零技能。建议保留 3 个预设分别代表产业、落地、舆论/资本视角。'
                                      : '建议保留 1-3 个启用中的技能，分别代表不同的精选视角。'}
                                  </div>
                                  <div className="flex gap-2 pt-1">
                                    <button
                                      onClick={() => void handleToggleSkill(skill.id)}
                                      disabled={skillSaving}
                                      className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-700 hover:bg-white disabled:opacity-50"
                                    >
                                      {skill.status === 'active' ? '停用' : '启用'}
                                    </button>
                                    <button
                                      onClick={() => void handleSaveSkill(skill, skill)}
                                      disabled={skillSaving}
                                      className="flex-1 rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white disabled:opacity-50"
                                    >
                                      保存
                                    </button>
                                  </div>
                                  {!skill.isDefault && (
                                    <button
                                      onClick={() => void handleDeleteSkill(skill.id)}
                                      disabled={skillSaving}
                                      className="w-full rounded-lg border border-rose-200 px-3 py-2 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                    >
                                      删除
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-zinc-200 bg-white p-4">
                      {sectionTitle('偏好画像', '从显式反馈中提炼你真正喜欢与想减少看到的资讯信号，再提供给评分 Skills。')}
                      <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4 space-y-3">
                        <div className="text-sm text-zinc-700">{preferenceProfile?.profileSummary || '当前还没有偏好画像，先在 Feed 里点击“更想看 / 少给我看 / 值得重点关注 / 不符合口味”积累反馈。'}</div>
                        <div className="text-xs leading-5 text-zinc-500">
                          偏好画像来自你的显式反馈汇总，不会在每次点击后立刻改写 Skills。本页适合做低频校准，Feed 里的反馈负责持续喂数据。
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div>
                            <div className="text-xs font-medium text-zinc-500">更偏好</div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {(preferenceProfile?.focusTopics || []).length > 0 ? preferenceProfile?.focusTopics.map((tag) => (
                                <span key={tag} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">{tag}</span>
                              )) : <span className="text-xs text-zinc-400">暂无</span>}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs font-medium text-zinc-500">尽量减少</div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {(preferenceProfile?.avoidTopics || []).length > 0 ? preferenceProfile?.avoidTopics.map((tag) => (
                                <span key={tag} className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">{tag}</span>
                              )) : <span className="text-xs text-zinc-400">暂无</span>}
                            </div>
                          </div>
                        </div>
                        <div className="text-xs text-zinc-500">
                          总反馈 {preferenceSummary?.totalFeedback || 0} · 正向 {preferenceSummary?.positiveCount || 0} · 负向 {preferenceSummary?.negativeCount || 0}
                          {preferenceSummary?.lastFeedbackAt ? ` · 最近反馈 ${new Date(preferenceSummary.lastFeedbackAt).toLocaleString('zh-CN')}` : ''}
                          {preferenceProfile?.updatedAt ? ` · 最近画像同步 ${new Date(preferenceProfile.updatedAt).toLocaleString('zh-CN')}` : ''}
                        </div>
                        <button
                          onClick={() => void handleRebuildProfile()}
                          disabled={profileRebuilding}
                          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-white disabled:opacity-50"
                        >
                          {profileRebuilding ? '更新中...' : '手动重建偏好画像'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeAiCenterTab === 'logs' && (
                !isAdmin ? (
                  <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
                    仅管理员可以查看全 AI 场景使用日志和消耗统计。
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <select value={aiUsageTimeWindow} onChange={(e) => setAiUsageTimeWindow(e.target.value as '24h' | '7d' | '30d')} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg">
                        <option value="24h">最近 24 小时</option>
                        <option value="7d">最近 7 天</option>
                        <option value="30d">最近 30 天</option>
                      </select>
                      <select value={aiUsageInterval} onChange={(e) => setAiUsageInterval(e.target.value as 'hour' | 'day')} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg">
                        <option value="hour">按小时</option>
                        <option value="day">按天</option>
                      </select>
                      <button onClick={() => void refreshAiUsage()} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg hover:bg-zinc-50">刷新趋势</button>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div className="rounded-xl border border-zinc-200 bg-white p-4">
                        <div className="text-2xl font-bold text-zinc-900">{combinedAiUsageSummary.totalCalls}</div>
                        <div className="mt-1 text-xs text-zinc-500">总调用次数</div>
                      </div>
                      <div className="rounded-xl border border-zinc-200 bg-white p-4">
                        <div className="text-2xl font-bold text-zinc-900">{formatCost(combinedAiUsageSummary.totalEstimatedCost)}</div>
                        <div className="mt-1 text-xs text-zinc-500">估算总成本</div>
                      </div>
                      <div className="rounded-xl border border-zinc-200 bg-white p-4">
                        <div className="text-2xl font-bold text-zinc-900">{combinedAiUsageSummary.totalInputTokens.toLocaleString()}</div>
                        <div className="mt-1 text-xs text-zinc-500">输入 Tokens</div>
                      </div>
                      <div className="rounded-xl border border-zinc-200 bg-white p-4">
                        <div className="text-2xl font-bold text-zinc-900">{combinedAiUsageSummary.totalOutputTokens.toLocaleString()}</div>
                        <div className="mt-1 text-xs text-zinc-500">输出 Tokens</div>
                      </div>
                      <div className="rounded-xl border border-zinc-200 bg-white p-4">
                        <div className="text-2xl font-bold text-zinc-900">{aiUsageSuccessRate}</div>
                        <div className="mt-1 text-xs text-zinc-500">成功率</div>
                        <div className="mt-1 text-[11px] text-zinc-400">均延迟 {aiUsageAvgLatency ?? '—'} ms</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4">
                      <div className="rounded-xl border border-zinc-200 bg-white p-4">
                        {sectionTitle('趋势视图', '看调用量、错误量、成本与平均延迟是否出现异常波峰。')}
                        {combinedAiUsageSummary.trends && combinedAiUsageSummary.trends.length > 0 ? (
                          <div className="space-y-3">
                            {combinedAiUsageSummary.trends.map((point) => {
                              const maxCalls = Math.max(...(combinedAiUsageSummary.trends || []).map((item) => item.calls || 0), 1);
                              const width = `${Math.max(8, Math.round(((point.calls || 0) / maxCalls) * 100))}%`;
                              return (
                                <div key={point.bucket} className="rounded-lg border border-zinc-100 px-3 py-3">
                                  <div className="flex items-center justify-between gap-2 text-xs">
                                    <span className="font-medium text-zinc-800">{point.bucket}</span>
                                    <span className="text-zinc-500">{point.calls} 次 · 错误 {point.error} · {formatCost(point.estimatedCost)}</span>
                                  </div>
                                  <div className="mt-2 h-2 rounded-full bg-zinc-100">
                                    <div className="h-2 rounded-full bg-zinc-900" style={{ width }} />
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-zinc-500">
                                    <span>成功 {point.success}</span>
                                    <span>总 Tokens {point.totalTokens.toLocaleString()}</span>
                                    <span>均延迟 {Math.round(point.avgLatencyMs || 0)} ms</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-zinc-400">当前时间窗口暂无趋势数据</p>
                        )}
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-xl border border-zinc-200 bg-white p-4">
                          {sectionTitle('热点错误', '优先定位最常见的失败原因。')}
                          <div className="space-y-2">
                            {(combinedAiUsageSummary.hotspots?.errors || []).length === 0 ? <p className="text-xs text-zinc-400">暂无热点错误</p> : combinedAiUsageSummary.hotspots?.errors.map((item) => (
                              <div key={item.key} className="rounded-lg border border-zinc-100 px-3 py-2 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium text-zinc-800">{item.key}</span>
                                  <span className="text-zinc-500">{item.count} 次</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-xl border border-zinc-200 bg-white p-4">
                          {sectionTitle('热点 Endpoint / 场景', '把最贵和最慢的调用直接挑出来。')}
                          <div className="space-y-3">
                            <div>
                              <div className="mb-2 text-xs font-semibold text-zinc-700">最贵调用目标</div>
                              <div className="space-y-2">
                                {(combinedAiUsageSummary.hotspots?.expensive || []).length === 0 ? <p className="text-xs text-zinc-400">暂无</p> : combinedAiUsageSummary.hotspots?.expensive.map((item) => (
                                  <div key={item.key} className="rounded-lg border border-zinc-100 px-3 py-2 text-xs text-zinc-600">
                                    <div className="font-medium text-zinc-800">{item.key}</div>
                                    <div className="mt-1">成本 {formatCost(item.estimatedCost)} · {item.count} 次</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div className="mb-2 text-xs font-semibold text-zinc-700">最慢调用目标</div>
                              <div className="space-y-2">
                                {(combinedAiUsageSummary.hotspots?.slow || []).length === 0 ? <p className="text-xs text-zinc-400">暂无</p> : combinedAiUsageSummary.hotspots?.slow.map((item) => (
                                  <div key={item.key} className="rounded-lg border border-zinc-100 px-3 py-2 text-xs text-zinc-600">
                                    <div className="font-medium text-zinc-800">{item.key}</div>
                                    <div className="mt-1">均延迟 {Math.round(item.avgLatencyMs || 0)} ms · {item.count} 次</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
                      <div className="rounded-xl border border-zinc-200 bg-white p-4">
                        {sectionTitle('按功能场景', '覆盖阅读评分/摘要/翻译、日报和音频能力。')}
                        <div className="space-y-2">
                          {combinedAiUsageSummary.byScene.length === 0 ? <p className="text-xs text-zinc-400">暂无日志</p> : combinedAiUsageSummary.byScene.map((item) => (
                            <div key={item.key} className="rounded-lg border border-zinc-100 px-3 py-2 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-zinc-800">{sceneLabel(item.key)}</span>
                                <span className="text-zinc-500">{item.count} 次</span>
                              </div>
                              <div className="mt-1 text-zinc-500">成本 {formatCost(item.estimatedCost)} · 输入 {item.inputTokens.toLocaleString()} · 输出 {item.outputTokens.toLocaleString()}</div>
                              <div className="mt-1 text-zinc-400">平均延迟 {Math.round(item.avgLatencyMs || 0)} ms</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-xl border border-zinc-200 bg-white p-4">
                        {sectionTitle('按 Provider', '判断流量是否集中在单一供应商，以及豆包 / Qwen 是否真的在被调用。')}
                        <div className="space-y-2">
                          {combinedAiUsageSummary.byProvider.length === 0 ? <p className="text-xs text-zinc-400">暂无日志</p> : combinedAiUsageSummary.byProvider.map((item) => (
                            <div key={item.key} className="rounded-lg border border-zinc-100 px-3 py-2 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-zinc-800">{providerLabel(item.key)}</span>
                                <span className="text-zinc-500">{item.count} 次</span>
                              </div>
                              <div className="mt-1 text-zinc-500">成本 {formatCost(item.estimatedCost)}</div>
                              <div className="mt-1 text-zinc-400">平均延迟 {Math.round(item.avgLatencyMs || 0)} ms</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-xl border border-zinc-200 bg-white p-4">
                        {sectionTitle('按模型 / 接入点', '直接看哪个模型或火山接入点在承担实际调用。')}
                        <div className="space-y-2">
                          {combinedAiUsageSummary.byModel.length === 0 ? <p className="text-xs text-zinc-400">暂无日志</p> : combinedAiUsageSummary.byModel.map((item) => (
                            <div key={item.key} className="rounded-lg border border-zinc-100 px-3 py-2 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-zinc-800">{item.key}</span>
                                <span className="text-zinc-500">{item.count} 次</span>
                              </div>
                              <div className="mt-1 text-zinc-500">成本 {formatCost(item.estimatedCost)}</div>
                              <div className="mt-1 text-zinc-400">平均延迟 {Math.round(item.avgLatencyMs || 0)} ms</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-xl border border-zinc-200 bg-white p-4">
                        {sectionTitle('按状态', '先看成功/失败占比，再判断问题是在供应商、场景还是具体对象层面。')}
                        <div className="space-y-2">
                          {combinedAiUsageSummary.byStatus.length === 0 ? <p className="text-xs text-zinc-400">暂无日志</p> : combinedAiUsageSummary.byStatus.map((item) => (
                            <div key={item.key} className="rounded-lg border border-zinc-100 px-3 py-2 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-zinc-800">{item.key}</span>
                                <span className="text-zinc-500">{item.count} 次</span>
                              </div>
                              <div className="mt-1 text-zinc-500">成本 {formatCost(item.estimatedCost)}</div>
                              <div className="mt-1 text-zinc-400">平均延迟 {Math.round(item.avgLatencyMs || 0)} ms</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-zinc-200 bg-white p-4">
                      {sectionTitle('最近使用日志', '统一汇总 Feed/日报和音频服务的最近调用，并支持按来源、场景、Provider 和错误关键字筛选。')}
                      <div className="mb-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
                        <select value={aiUsageSourceFilter} onChange={(e) => setAiUsageSourceFilter(e.target.value as 'all' | 'hub' | 'audio')} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg">
                          <option value="all">全部来源</option>
                          <option value="hub">Hub</option>
                          <option value="audio">Audio</option>
                        </select>
                        <select value={aiUsageStatusFilter} onChange={(e) => setAiUsageStatusFilter(e.target.value)} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg">
                          <option value="">全部状态</option>
                          <option value="success">success</option>
                          <option value="error">error</option>
                        </select>
                        <select value={aiUsageSceneFilter} onChange={(e) => setAiUsageSceneFilter(e.target.value)} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg">
                          <option value="">全部场景</option>
                          {aiUsageSceneOptions.map((scene) => <option key={scene} value={scene}>{sceneLabel(scene)}</option>)}
                        </select>
                        <select value={aiUsageProviderFilter} onChange={(e) => setAiUsageProviderFilter(e.target.value)} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg">
                          <option value="">全部 Provider</option>
                          {aiUsageProviderOptions.map((provider) => <option key={provider} value={provider}>{providerLabel(provider)}</option>)}
                        </select>
                        <div className="flex gap-2">
                          <input
                            value={aiUsageSearch}
                            onChange={(e) => setAiUsageSearch(e.target.value)}
                            placeholder="搜索 endpoint / 对象 / req / 错误"
                            className="flex-1 px-3 py-2 text-sm border border-zinc-200 rounded-lg"
                          />
                          <button onClick={() => void refreshAiUsage()} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg hover:bg-zinc-50">刷新</button>
                        </div>
                      </div>
                      {aiUsageErrorBuckets.length > 0 && (
                        <div className="mb-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <div className="text-xs font-semibold text-amber-800">高频错误聚合</div>
                            <div className="mt-2 space-y-2">
                              {aiUsageErrorBuckets.map((bucket) => (
                                <div key={bucket.key} className="rounded border border-amber-100 bg-white px-3 py-2 text-xs text-amber-900">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium">{bucket.count} 次</span>
                                    <span className="text-amber-700">{[...bucket.scenes].join(' / ')}</span>
                                  </div>
                                  <div className="mt-1 text-amber-800 line-clamp-2">{bucket.key}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                            <div>当前结果：{filteredAiUsageEvents.length} 条日志</div>
                            <div className="mt-1">来源筛选：{aiUsageSourceFilter === 'all' ? 'Hub + Audio' : aiUsageSourceFilter}</div>
                            <div className="mt-1">服务端筛选：{[aiUsageStatusFilter || '全部状态', aiUsageSceneFilter ? sceneLabel(aiUsageSceneFilter) : '全部场景', aiUsageProviderFilter ? providerLabel(aiUsageProviderFilter) : '全部 Provider'].join(' · ')}</div>
                          </div>
                        </div>
                      )}
                      {aiUsageLoading ? (
                        <div className="py-10 text-sm text-zinc-500 flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin" />
                          正在加载日志...
                        </div>
                      ) : filteredAiUsageEvents.length === 0 ? (
                        <div className="py-10 text-sm text-zinc-400">暂无日志</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-xs">
                            <thead>
                              <tr className="text-left text-zinc-500 border-b border-zinc-100">
                                <th className="py-2 pr-3 font-medium">时间</th>
                                <th className="py-2 pr-3 font-medium">场景</th>
                                <th className="py-2 pr-3 font-medium">Provider / 接入点</th>
                                <th className="py-2 pr-3 font-medium">对象</th>
                                <th className="py-2 pr-3 font-medium">消耗</th>
                                <th className="py-2 pr-0 font-medium">状态 / 细节</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredAiUsageEvents.map((event) => (
                                <tr key={`${event.sceneType}-${event.id}`} className="border-b border-zinc-50 align-top">
                                  <td className="py-2 pr-3 text-zinc-500 whitespace-nowrap">{new Date(event.createdAt).toLocaleString('zh-CN')}</td>
                                  <td className="py-2 pr-3">
                                    <div className="font-medium text-zinc-800">{sceneLabel(event.sceneType)}</div>
                                    <div className="text-zinc-400">{event.source || '-'}</div>
                                    {(event.username || event.email) && <div className="text-zinc-400">{event.username || event.email}</div>}
                                  </td>
                                  <td className="py-2 pr-3 text-zinc-600">
                                    <div>{providerLabel(event.provider)}</div>
                                    <div className="text-zinc-400">{event.endpointId || event.modelName || '-'}</div>
                                    {(event.apiKind || event.providerRequestId) && (
                                      <div className="text-zinc-400">{event.apiKind || '-'} {event.providerRequestId ? `· req ${event.providerRequestId}` : ''}</div>
                                    )}
                                  </td>
                                  <td className="py-2 pr-3 text-zinc-500">
                                    <div>{event.targetType || '-'}</div>
                                    <div className="text-zinc-400">{event.label || event.targetId || '-'}</div>
                                  </td>
                                  <td className="py-2 pr-3 text-zinc-500">
                                    <div>{formatCost(event.estimatedCost || 0)}</div>
                                    <div className="text-zinc-400">in {Number(event.inputTokens || 0).toLocaleString()} / out {Number(event.outputTokens || 0).toLocaleString()} / total {Number(event.totalTokens || 0).toLocaleString()}</div>
                                    <div className="text-zinc-400">耗时 {event.latencyMs ?? '-'} ms</div>
                                  </td>
                                  <td className="py-2 pr-0">
                                    <span className={`rounded-full px-2 py-0.5 ${event.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                      {event.status}
                                    </span>
                                    {event.promptPreview && <div className="mt-1 max-w-[280px] text-zinc-400">prompt: {event.promptPreview}</div>}
                                    {event.responsePreview && <div className="mt-1 max-w-[280px] text-zinc-400">resp: {event.responsePreview}</div>}
                                    {event.errorMessage && <div className="mt-1 max-w-[240px] text-zinc-400">{event.errorMessage}</div>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {activeTab === 'integrations' && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
              {sectionTitle('集成配置', '当前版本先保存到本地浏览器，后续可迁移到服务端')}
              <input
                value={integrationPrefs.ntfyTopic}
                onChange={(e) => setIntegrationPrefs((prev) => ({ ...prev, ntfyTopic: e.target.value }))}
                placeholder="ntfy topic"
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg"
              />
              <input
                value={integrationPrefs.feishuWebhook}
                onChange={(e) => setIntegrationPrefs((prev) => ({ ...prev, feishuWebhook: e.target.value }))}
                placeholder="飞书 Webhook"
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg"
              />
              <input
                value={integrationPrefs.webhookSecret}
                onChange={(e) => setIntegrationPrefs((prev) => ({ ...prev, webhookSecret: e.target.value }))}
                placeholder="回调签名密钥"
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg"
              />
              <button onClick={saveIntegrationPrefs} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white">
                保存集成配置
              </button>
            </div>
          )}

          {activeTab === 'diagnostics' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                {sectionTitle('服务连通诊断', '用于定位抓取失败、服务不可达、依赖中断')}
                {diagnosticLoading ? (
                  <div className="py-6 text-sm text-zinc-500 flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    正在加载诊断信息...
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-xs text-zinc-500">
                      健康统计：{networkDiagnostics?.summary?.ok ?? 0}/{networkDiagnostics?.summary?.total ?? 0} 正常
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                      {(networkDiagnostics?.services || []).map((service: ServiceDiagnostic) => (
                        <div key={service.name} className="border border-zinc-100 rounded-lg px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-zinc-700">{service.name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${service.status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                              {service.status}
                            </span>
                          </div>
                          <div className="text-xs text-zinc-500 mt-1">{service.detail || '-'}</div>
                          <div className="text-[11px] text-zinc-400 mt-0.5">{service.latencyMs}ms</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  {sectionTitle('抓取新鲜度', '用于判断当前数据为什么旧，以及当前运行态是否真的在工作。')}
                  <div className="space-y-2 text-xs text-zinc-600">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-zinc-800">运行态</span>
                      <span className={`rounded px-2 py-0.5 ${fetchStatus?.runtimeOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {fetchStatus?.runtimeOnline ? '在线' : '离线'}
                      </span>
                    </div>
                    <div>调度模式：{fetchStatus?.schedulerMode || fetchStatus?.user?.scheduleMode || 'hybrid'}</div>
                    <div>新鲜度：{freshnessBadge(fetchStatus?.freshnessStatus).label}</div>
                    <div>最近成功抓取：{fetchStatus?.lastSuccessfulFetchAt ? new Date(fetchStatus.lastSuccessfulFetchAt).toLocaleString('zh-CN') : '暂无'}</div>
                    <div>到期来源：{Number(fetchStatus?.user?.dueSources ?? 0)} · 过期来源：{Number(fetchStatus?.staleSources ?? fetchStatus?.user?.staleSources ?? 0)}</div>
                    <div>最老待抓取：{Number(fetchStatus?.oldestDueMinutes ?? fetchStatus?.user?.oldestDueMinutes ?? 0)} 分钟</div>
                    <div>原因：{String(fetchStatus?.staleReason || fetchStatus?.user?.staleReason || '暂无')}</div>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  {sectionTitle('Scrapling 抓取诊断', '看动态网页抓取兜底层是否存活，以及当前是否能承担头条等动态站点。')}
                  {(() => {
                    const scraplingService = (networkDiagnostics?.services || []).find((service) => service.name.includes('scrapling'));
                    return (
                      <div className="space-y-2 text-xs text-zinc-600">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-zinc-800">服务状态</span>
                          <span className={`rounded px-2 py-0.5 ${scraplingService?.status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                            {scraplingService?.status || 'unknown'}
                          </span>
                        </div>
                        <div>当前定位：网页正文富化 / 网页快照监控的动态抓取兜底层。</div>
                        <div>已知优先动态域名：`toutiao.com`、`jinritoutiao.com`。</div>
                        <div>最近健康明细：{scraplingService?.detail || '暂无'}</div>
                        <div>延迟：{scraplingService?.latencyMs ?? '-'} ms</div>
                      </div>
                    );
                  })()}
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  {sectionTitle('历史裁剪状态', '默认保留最近 30 天；收藏 / 稍后读和被引用音频任务不会被直接裁掉。')}
                  <div className="space-y-2 text-xs text-zinc-600">
                    <div>最近一次运行：{retentionStatus?.createdAt ? new Date(retentionStatus.createdAt).toLocaleString('zh-CN') : '暂无'}</div>
                    <div>模式：{retentionStatus?.mode || '暂无'} · 状态：{retentionStatus?.status || 'unknown'}</div>
                    <div>保留天数：{retentionStatus?.retentionDays ?? (retentionStatus?.summary as { retentionDays?: number } | undefined)?.retentionDays ?? 30}</div>
                    <div>预计/最近删除：items {(retentionStatus?.summary as { deleted?: { items?: number }, items?: number } | undefined)?.deleted?.items ?? (retentionStatus?.summary as { items?: number } | undefined)?.items ?? 0} · audio {(retentionStatus?.summary as { deleted?: { audioTasks?: number }, audioTasks?: number } | undefined)?.deleted?.audioTasks ?? (retentionStatus?.summary as { audioTasks?: number } | undefined)?.audioTasks ?? 0}</div>
                    <div>跳过引用音频任务：{(retentionStatus?.summary as { skippedReferencedAudioTasks?: number } | undefined)?.skippedReferencedAudioTasks ?? 0}</div>
                    <div>存储清理失败：{(retentionStatus?.summary as { storageDeleteFailed?: number } | undefined)?.storageDeleteFailed ?? 0}</div>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  {sectionTitle('存储与备份', '确认哪些目录适合同步，哪些只能做快照归档；同时查看最近一次本地/云端备份结果。')}
                  {!isAdmin && (
                    <div className="text-xs text-zinc-500">仅管理员可查看完整存储与备份状态。</div>
                  )}
                  {isAdmin && (
                    <div className="space-y-3 text-xs text-zinc-600">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-zinc-800">音频存储</span>
                        <span className={`rounded px-2 py-0.5 ${storageStatus?.storage.audioStorageBackend === 'local' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {storageStatus?.storage.audioStorageBackend || 'unknown'}
                        </span>
                      </div>
                      <div>数据根目录：{storageStatus?.storage.hostDataRoot || '暂无'}</div>
                      <div>导出目录：{storageStatus?.storage.hostExportRoot || '暂无'}</div>
                      <div>备份目录：{storageStatus?.storage.hostBackupRoot || '暂无'}</div>
                      <div>最近结果：{storageStatus?.backup.lastRun?.status || '暂无'} · {storageStatus?.backup.lastRun?.message || '未执行过备份'}</div>
                      <div>最近时间：{storageStatus?.backup.lastRun?.updatedAt ? new Date(storageStatus.backup.lastRun.updatedAt).toLocaleString('zh-CN') : '暂无'}</div>
                      <div>最近包：{storageStatus?.backup.lastRun?.bundle?.name || storageStatus?.backup.latestBundleName || '暂无'}{storageStatus?.backup.lastRun?.bundle?.sizeBytes ? ` · ${formatBytes(storageStatus.backup.lastRun.bundle.sizeBytes)}` : ''}</div>
                      <div>本地保留：{storageStatus?.backup.localRetention ?? 0} 份 · 当前可见：{storageStatus?.backup.localBundleCount ?? 0} 份</div>
                      <div>OSS 归档：{storageStatus?.backup.oss.enabled ? `${storageStatus.backup.oss.bucket || '未配置 bucket'} / ${storageStatus.backup.oss.prefix}` : '未启用'}</div>
                      {storageStatus?.backup.lastRun?.remote?.error ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
                          云端归档异常：{storageStatus.backup.lastRun.remote.error}
                        </div>
                      ) : null}
                      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                        <div className="font-medium text-zinc-700 mb-1">同步建议</div>
                        <div className="space-y-1">
                          {(storageStatus?.storage.syncGuidance || []).map((entry) => (
                            <div key={entry.path}>
                              <span className="font-medium text-zinc-800">{entry.path}</span>
                              <span className="ml-1 text-zinc-500">[{entry.mode}]</span>
                              <span className="ml-1">· {entry.reason}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-zinc-700">
                        手动执行：<code>{storageStatus?.backup.manualCommand || 'bash scripts/portable/backup-archive.sh'}</code>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
                {sectionTitle('代理测试', '借鉴桌面端代理规范化做法，快速确认代理是否可用')}
                <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                  <input
                    value={proxyInput}
                    onChange={(e) => setProxyInput(e.target.value)}
                    placeholder="代理地址，如 http://127.0.0.1:7890"
                    className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"
                  />
                  <input
                    value={proxyTarget}
                    onChange={(e) => setProxyTarget(e.target.value)}
                    placeholder="测试目标 URL（可选）"
                    className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"
                  />
                  <button
                    onClick={() => void runProxyTest()}
                    disabled={proxyTesting}
                    className="px-3 py-2 text-sm rounded-lg border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {proxyTesting ? '测试中...' : '测试代理'}
                  </button>
                </div>
                {proxyResult && (
                  <div className={`text-xs px-3 py-2 rounded-lg border ${proxyResult.ok ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
                    结果：{proxyResult.ok ? '可用' : '异常'} · HTTP {proxyResult.statusCode || '-'} · {proxyResult.latencyMs}ms
                    {proxyResult.error ? ` · ${proxyResult.error}` : ''}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                {sectionTitle('抓取队列诊断', '查看等待/执行/失败任务与最近作业')}
                {!isAdmin && (
                  <div className="text-xs text-zinc-500 mb-3">仅管理员可查看队列作业详情。</div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                  <div className="text-xs border border-zinc-100 rounded px-2 py-1.5">等待：{fetchQueueDiagnostics?.queue?.waiting ?? 0}</div>
                  <div className="text-xs border border-zinc-100 rounded px-2 py-1.5">执行中：{fetchQueueDiagnostics?.queue?.active ?? 0}</div>
                  <div className="text-xs border border-zinc-100 rounded px-2 py-1.5">已完成：{fetchQueueDiagnostics?.queue?.completed ?? 0}</div>
                  <div className="text-xs border border-zinc-100 rounded px-2 py-1.5">失败：{fetchQueueDiagnostics?.queue?.failed ?? 0}</div>
                </div>
                <div className="space-y-2 max-h-[320px] overflow-y-auto">
                  {(fetchQueueDiagnostics?.jobs || []).length === 0 && (
                    <div className="text-xs text-zinc-400">暂无队列任务</div>
                  )}
                  {(fetchQueueDiagnostics?.jobs || []).map((job: QueueJobDiagnostic) => (
                    <div key={job.id} className="border border-zinc-100 rounded px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-zinc-700 truncate">{job.sourceName || job.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${job.state === 'failed' ? 'bg-red-100 text-red-700' : 'bg-zinc-100 text-zinc-600'}`}>
                          {queueStateLabel(job.state)}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-500 mt-1">
                        信源：{job.sourceId ?? '-'} · 尝试次数：{job.attemptsMade}
                      </div>
                      {job.failedReason && (
                        <div className="text-xs text-red-600 mt-1 flex items-start gap-1">
                          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                          <span className="line-clamp-2">{job.failedReason}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                {sectionTitle('最近抓取结果', '区分无新增、重复、被过滤和进入 AI 队列，避免“抓了但没反应”的黑箱感。')}
                <div className="space-y-2 max-h-[320px] overflow-y-auto">
                  {!(fetchStatus?.user?.recentFetches as Array<Record<string, unknown>> | undefined)?.length && (
                    <div className="text-xs text-zinc-400">暂无抓取记录</div>
                  )}
                  {((fetchStatus?.user?.recentFetches as Array<Record<string, unknown>> | undefined) || []).map((fetch, index) => (
                    <div key={String(fetch.id || index)} className="rounded-lg border border-zinc-100 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-zinc-700">{String(fetch.sourceName || `source-${fetch.sourceId || '-'}`)}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${fetch.status === 'success' ? 'bg-emerald-100 text-emerald-700' : fetch.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-zinc-100 text-zinc-600'}`}>
                          {fetchOutcomeLabel(fetch.outcome, fetch.status)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        发现 {Number(fetch.itemsFound || 0)} · 新增 {Number(fetch.itemsNew || 0)} · 过滤 {Number(fetch.itemsFiltered || 0)} · 重复 {Number(fetch.itemsDuplicate || 0)} · AI 队列 {Number(fetch.itemsQueuedAi || 0)}
                      </div>
                      {fetch.error ? (
                        <div className="mt-1 text-xs text-red-600 line-clamp-2">{String(fetch.error)}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'quota' && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
                {sectionTitle('平台配额（Hub）', '当前真正参与自动转写执行的是全局开关与每日自动上限。')}
                <div className="text-sm text-zinc-700">当前套餐：<span className="font-medium">{hubQuota?.planName || 'free'}</span></div>
                <div className="text-sm text-zinc-700">音频月额度：{hubQuota?.audioMinutesPerMonth ?? '-'} 分钟</div>
                <div className="text-sm text-zinc-700">当月已用：{hubQuota?.audioMinutesUsedMonth ?? 0} 分钟</div>
                <div className="text-sm text-zinc-700">文章日额度：{hubQuota?.articlesPerDay ?? '-'} 条</div>
                <div className="text-sm text-zinc-700">今日自动转写次数：{hubQuota?.autoCountToday ?? 0}</div>
                <div className="text-xs text-zinc-500">计数重置：{hubQuota?.autoCountResetAt ? new Date(hubQuota.autoCountResetAt).toLocaleString() : '系统会在次日自动重置'}</div>

                <label className="flex items-center justify-between text-sm text-zinc-700">
                  自动转写
                  <input
                    type="checkbox"
                    checked={Boolean(hubQuota?.autoTranscribeEnabled)}
                    onChange={(e) => setHubQuota((prev) => (prev ? { ...prev, autoTranscribeEnabled: e.target.checked } : prev))}
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-zinc-500">
                    每日自动上限
                    <input
                      type="number"
                      value={hubQuota?.maxAutoPerDay ?? 3}
                      onChange={(e) => setHubQuota((prev) => (prev ? { ...prev, maxAutoPerDay: Number(e.target.value || 0) } : prev))}
                      className="mt-1 w-full px-2 py-1 text-sm border border-zinc-200 rounded"
                    />
                  </label>
                  <label className="text-xs text-zinc-500">
                    单集时长上限(分钟)
                    <input
                      type="number"
                      value={hubQuota?.maxEpisodeMinutes ?? 90}
                      onChange={(e) => setHubQuota((prev) => (prev ? { ...prev, maxEpisodeMinutes: Number(e.target.value || 0) } : prev))}
                      className="mt-1 w-full px-2 py-1 text-sm border border-zinc-200 rounded"
                    />
                  </label>
                </div>

                <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-700">
                  当前真实执行链路：`自动转写总开关`、`每日自动上限`、`单集时长上限`、`月预算上限`。其中时长上限依赖 RSS 已解析到的音频时长；若源站没有提供时长元数据，系统会继续放行并在后续音频链路里判定。
                </div>

                <button onClick={() => void saveQuota()} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white">
                  保存配额设置
                </button>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
                {sectionTitle('套餐切换 / 音频服务配额 / 预留策略')}
                <div className="space-y-2">
                  {plans.map((plan) => (
                    <button
                      key={plan.id}
                      onClick={() => void changePlan(plan.name)}
                      className="w-full text-left px-3 py-2 text-sm rounded-lg border border-zinc-200 hover:bg-zinc-50"
                    >
                      <div className="font-medium text-zinc-800">{plan.name}</div>
                      <div className="text-xs text-zinc-500">音频 {plan.audioMinutesPerMonth} 分钟/月 · 文章 {plan.articlesPerDay} 条/日</div>
                    </button>
                  ))}
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <h3 className="text-xs font-semibold text-zinc-700 mb-2">自动转写判定说明</h3>
                  <div className="text-sm text-zinc-700">单集时长上限：{hubQuota?.maxEpisodeMinutes ?? 90} 分钟</div>
                  <div className="text-sm text-zinc-700">月预算上限：{hubQuota?.monthlyBudgetLimit ?? '未设置'}</div>
                  <div className="text-xs text-zinc-500 mt-1">当月预算按音频服务 `usage_logs.estimated_cost` 实时核算；单集时长判断优先使用 RSS/Podcast 元数据，缺失时不提前拦截。</div>
                </div>
                <div className="pt-2 border-t border-zinc-100">
                  <h3 className="text-xs font-semibold text-zinc-700 mb-1">音频服务配额</h3>
                  <pre className="text-xs text-zinc-600 whitespace-pre-wrap">{audioQuota ? JSON.stringify(audioQuota, null, 2) : '暂无'}</pre>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'admin' && isAdmin && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-4">
                <Shield size={16} className="text-zinc-700" />
                <h2 className="text-sm font-semibold text-zinc-800">管理后台（管理员）</h2>
              </div>

              <div className="flex gap-2 mb-4 flex-wrap">
                {ADMIN_TAB_LABELS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveAdminTab(tab.key)}
                    className={`min-h-9 px-3 py-2 text-sm rounded-lg border transition-colors ${activeAdminTab === tab.key ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeAdminTab === 'dashboard' && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg border border-zinc-200 bg-zinc-50">
                    <div className="text-xl font-bold text-zinc-900">{adminStats?.total_tasks ?? 0}</div>
                    <div className="text-xs text-zinc-500">任务总数</div>
                  </div>
                  <div className="p-3 rounded-lg border border-zinc-200 bg-zinc-50">
                    <div className="text-xl font-bold text-zinc-900">{adminStats?.today_tasks ?? 0}</div>
                    <div className="text-xs text-zinc-500">今日新增</div>
                  </div>
                  <div className="p-3 rounded-lg border border-zinc-200 bg-zinc-50">
                    <div className="text-xl font-bold text-zinc-900">{adminStats?.total_users ?? 0}</div>
                    <div className="text-xs text-zinc-500">用户总数</div>
                  </div>
                  <div className="p-3 rounded-lg border border-zinc-200 bg-zinc-50">
                    <div className="text-xl font-bold text-zinc-900">{adminStats?.month_cost ?? 0}</div>
                    <div className="text-xs text-zinc-500">本月费用</div>
                  </div>
                </div>
              )}

              {activeAdminTab === 'tasks' && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <select value={adminTaskStatus} onChange={(e) => setAdminTaskStatus(e.target.value)} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg">
                      <option value="">全部状态</option>
                      <option value="uploading">uploading</option>
                      <option value="transcribing">transcribing</option>
                      <option value="summarizing">summarizing</option>
                      <option value="generating">generating</option>
                      <option value="done">done</option>
                      <option value="failed">failed</option>
                    </select>
                    <input
                      value={adminTaskSearch}
                      onChange={(e) => setAdminTaskSearch(e.target.value)}
                      placeholder="搜索任务或用户"
                      className="px-3 py-2 text-sm border border-zinc-200 rounded-lg flex-1"
                    />
                    <button onClick={() => void refreshAdmin()} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg hover:bg-zinc-50">搜索</button>
                  </div>
                  <p className="text-xs text-zinc-500">共 {adminTaskTotal} 条</p>
                  <div className="space-y-2 max-h-[420px] overflow-y-auto">
                    {adminTasks.map((task) => (
                      <div key={task.id} className="border border-zinc-100 rounded-lg px-3 py-2 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-zinc-800 truncate">{task.title}</div>
                          <div className="text-xs text-zinc-500">{task.user?.email || '-'} · {task.status} · {task.created_at}</div>
                        </div>
                        <button onClick={() => void reprocessTask(task.id)} className="inline-flex min-h-9 min-w-9 items-center justify-center whitespace-nowrap rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-50">重跑</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeAdminTab === 'users' && (
                <div className="space-y-2 max-h-[460px] overflow-y-auto">
                  {adminUsers.map((u) => (
                    <div key={u.id} className="border border-zinc-100 rounded-lg px-3 py-2">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-zinc-800">{u.username} <span className="text-zinc-500">({u.email})</span></div>
                          <div className="text-xs text-zinc-500">role: {u.role} · active: {String(u.is_active)}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => void updateAdminUser(u, { is_active: !u.is_active })} className="inline-flex min-h-9 min-w-9 items-center justify-center whitespace-nowrap rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-50">
                            {u.is_active ? '禁用' : '启用'}
                          </button>
                          <button onClick={() => void updateAdminUser(u, { role: u.role === 'admin' ? 'user' : 'admin' })} className="inline-flex min-h-9 min-w-9 items-center justify-center whitespace-nowrap rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-50">
                            切换角色
                          </button>
                          <button onClick={() => void removeAdminUser(u)} className="inline-flex min-h-9 min-w-9 items-center justify-center whitespace-nowrap rounded-lg border border-red-200 px-3 py-2 text-xs text-red-700 transition-colors hover:bg-red-50">
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeAdminTab === 'invites' && (
                <div className="space-y-3">
                  <button onClick={() => void createInviteCode()} className="px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white">创建邀请码</button>
                  <div className="space-y-2 max-h-[420px] overflow-y-auto">
                    {adminInvites.map((code) => (
                      <div key={code.id} className="border border-zinc-100 rounded-lg px-3 py-2">
                        <div className="text-sm font-medium text-zinc-800">{code.code}</div>
                        <div className="text-xs text-zinc-500">使用 {code.used_count}/{code.max_uses} · 过期 {code.expires_at || '无'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
