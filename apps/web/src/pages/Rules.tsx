import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Bot, Filter, Loader2, Plus, Search, Shield, ToggleLeft, ToggleRight, Trash2, Workflow, RotateCcw, Sparkles } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type AiConfig, type PreferenceProfileSummary, type QualityPolicyConfig, type QualityPolicySnapshot, type QualitySourceOverrideRecord, type SourceRecord } from '../lib/api';
import { useAuth } from '../lib/use-auth';

const RULE_TYPES = [
  { value: 'ai_score_filter', label: 'AI 评分门槛' },
  { value: 'keyword_whitelist', label: '关键词白名单（加分）' },
  { value: 'keyword_blacklist', label: '关键词黑名单（过滤）' },
  { value: 'length_filter', label: '长度过滤' },
  { value: 'language_filter', label: '语言过滤' },
  { value: 'author_filter', label: '作者过滤' },
];

const TIER_SEQUENCE = ['T1', 'T1.5', 'T2', 'S', 'A', 'B', 'C', 'D'] as const;
type TierKey = (typeof TIER_SEQUENCE)[number];
type RuleScope = 'user' | 'global';
type PolicyDraft = {
  mode: QualityPolicyConfig['mode'];
  onFilter: 'review' | 'filter';
  minConfidence: number;
};

interface RuleConfig {
  keywords?: string[];
  boost?: number;
  minLength?: number;
  maxLength?: number;
  languages?: string[];
  authors?: string[];
  minAiScore?: number;
  maxAiScore?: number;
  [key: string]: unknown;
}

interface Rule {
  id: number;
  userId?: string | null;
  name: string;
  type: string;
  scope?: RuleScope;
  config: RuleConfig;
  enabled: boolean;
  priority: number;
}

interface RuleFormState {
  name: string;
  type: string;
  keywords: string;
  languages: string;
  authors: string;
  boost: number;
  minAiScore: number;
  maxAiScore: number;
  minLength: number;
  maxLength: number;
  enabled: boolean;
  priority: number;
  scope: RuleScope;
}

const DEFAULT_FORM: RuleFormState = {
  name: '',
  type: 'keyword_blacklist',
  keywords: '',
  languages: '',
  authors: '',
  boost: 10,
  minAiScore: 60,
  maxAiScore: 100,
  minLength: 40,
  maxLength: 6000,
  enabled: true,
  priority: 0,
  scope: 'user',
};

const DEFAULT_TIER_POLICIES: Record<TierKey, QualityPolicyConfig> = {
  T1: { mode: 'skip', onFilter: 'review', minConfidence: 1 },
  'T1.5': { mode: 'light', onFilter: 'review', minConfidence: 0.8 },
  T2: { mode: 'standard', onFilter: 'filter', minConfidence: 0.7 },
  S: { mode: 'skip', onFilter: 'review', minConfidence: 1 },
  A: { mode: 'light', onFilter: 'review', minConfidence: 0.78 },
  B: { mode: 'standard', onFilter: 'filter', minConfidence: 0.72 },
  C: { mode: 'strict', onFilter: 'filter', minConfidence: 0.55 },
  D: { mode: 'monitor', onFilter: 'filter', minConfidence: 0.45 },
};

const QUALITY_MODE_OPTIONS = [
  { value: 'skip', label: '跳过', description: '顶级来源直通，不跑 AI 质检。' },
  { value: 'light', label: '轻审', description: '只把明显风险打成待复核。' },
  { value: 'standard', label: '标准', description: '标准质检，失败可进入过滤池。' },
  { value: 'strict', label: '严审', description: '提高拦截力度，适合噪音偏高来源。' },
  { value: 'monitor', label: '哨兵', description: '更偏异常监控与风险分流。' },
] as const;

const FILTER_ACTION_OPTIONS = [
  { value: 'review', label: '转待复核', description: '命中过滤建议后仍留在主 Feed。' },
  { value: 'filter', label: '进过滤池', description: '命中过滤建议后直接分流到过滤池。' },
] as const;

const POLICY_PRESETS: Array<{ key: string; label: string; draft: PolicyDraft }> = [
  { key: 'skip', label: '直通', draft: { mode: 'skip', onFilter: 'review', minConfidence: 1 } },
  { key: 'light', label: '轻审', draft: { mode: 'light', onFilter: 'review', minConfidence: 0.78 } },
  { key: 'standard', label: '标准', draft: { mode: 'standard', onFilter: 'filter', minConfidence: 0.72 } },
  { key: 'strict', label: '严审', draft: { mode: 'strict', onFilter: 'filter', minConfidence: 0.55 } },
  { key: 'monitor', label: '哨兵', draft: { mode: 'monitor', onFilter: 'filter', minConfidence: 0.45 } },
] as const;

const QUALITY_DIMENSIONS = ['信息密度', '独立洞察', '实操性', '客观性 / 动机纯净度', '目标相关性', '认知增量'];
const QUALITY_RISK_FLAGS = ['低信息密度', '疑似导流', '半对半错风险', '情绪煽动', '热点搬运', '目标弱相关'];
const NON_AI_NOISE_PRESET = '体育,足球,篮球,娱乐,明星,影视,汽车,房产,旅游,时尚,美食,情感,母婴,游戏,八卦';

const TIER_GUIDANCE: Record<TierKey, { title: string; note: string }> = {
  T1: { title: '一手官方层', note: '官网、官方博客等一手来源，默认直通。' },
  'T1.5': { title: '官方社媒层', note: '官方 X/社媒来源，轻审后进入主流程。' },
  T2: { title: '观察信源层', note: 'KOL、媒体与综合源，标准质检后再入主流程。' },
  S: { title: '直通信号层', note: '默认不做质检，适合顶级信任源。' },
  A: { title: '轻审分析层', note: '只把明显风险留在主 Feed 待复核。' },
  B: { title: '标准资讯层', note: '常规资讯源，失败可直接进入过滤池。' },
  C: { title: '严审噪音层', note: '提高拦截阈值，防止搬运与导流。' },
  D: { title: '哨兵监控层', note: '监控类来源优先筛掉弱相关与低质量。' },
};

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0.6;
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function formatConfidence(value: number) {
  return `${Math.round(clampConfidence(value) * 100)}%`;
}

function normalizeTier(value?: string | null): TierKey {
  return TIER_SEQUENCE.includes(value as TierKey) ? value as TierKey : 'B';
}

function createPolicyDraft(policy?: Partial<QualityPolicyConfig> | null): PolicyDraft {
  return {
    mode: policy?.mode || 'standard',
    onFilter: policy?.onFilter === 'review' ? 'review' : 'filter',
    minConfidence: clampConfidence(Number(policy?.minConfidence ?? 0.72)),
  };
}

function buildTierDrafts(snapshot?: QualityPolicySnapshot | null) {
  return TIER_SEQUENCE.reduce<Record<TierKey, PolicyDraft>>((acc, tier) => {
    const row = snapshot?.tiers.find((entry) => entry.tier === tier);
    acc[tier] = createPolicyDraft(row?.resolved || DEFAULT_TIER_POLICIES[tier]);
    return acc;
  }, {} as Record<TierKey, PolicyDraft>);
}

function policyEquals(left: PolicyDraft, right: QualityPolicyConfig) {
  return left.mode === right.mode
    && left.onFilter === right.onFilter
    && clampConfidence(left.minConfidence) === clampConfidence(right.minConfidence);
}

function tierTone(tier: TierKey) {
  switch (tier) {
    case 'T1':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'T1.5':
      return 'border-orange-200 bg-orange-50 text-orange-700';
    case 'T2':
      return 'border-sky-200 bg-sky-50 text-sky-700';
    case 'S':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'A':
      return 'border-sky-200 bg-sky-50 text-sky-700';
    case 'B':
      return 'border-zinc-200 bg-zinc-50 text-zinc-700';
    case 'C':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'D':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    default:
      return 'border-zinc-200 bg-zinc-50 text-zinc-700';
  }
}

function policyModeLabel(value: string) {
  return QUALITY_MODE_OPTIONS.find((item) => item.value === value)?.label || value;
}

function filterActionLabel(value: string) {
  return FILTER_ACTION_OPTIONS.find((item) => item.value === value)?.label || value;
}

function policySummary(policy: QualityPolicyConfig | PolicyDraft) {
  if (policy.mode === 'skip') return '跳过 AI 质检，直通主 Feed';
  return `${policyModeLabel(policy.mode)} · ${filterActionLabel(policy.onFilter)} · 过滤阈值 ${formatConfidence(policy.minConfidence)}`;
}

function splitCommaValues(value: string) {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

export function Rules() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedScope = searchParams.get('scope') === 'global' ? 'global' : 'user';
  const requestedSourceId = Number(searchParams.get('source') || '');
  const sourceEditorRef = useRef<HTMLDivElement | null>(null);

  const [scope, setScope] = useState<RuleScope>(requestedScope === 'global' && isAdmin ? 'global' : 'user');
  const [rules, setRules] = useState<Rule[]>([]);
  const [tierSnapshot, setTierSnapshot] = useState<QualityPolicySnapshot | null>(null);
  const [userSnapshot, setUserSnapshot] = useState<QualityPolicySnapshot | null>(null);
  const [effectiveSnapshot, setEffectiveSnapshot] = useState<QualityPolicySnapshot | null>(null);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
  const [preferenceSummary, setPreferenceSummary] = useState<PreferenceProfileSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddRule, setShowAddRule] = useState(false);
  const [savingTier, setSavingTier] = useState<TierKey | null>(null);
  const [savingSource, setSavingSource] = useState(false);
  const [deletingSourceId, setDeletingSourceId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormState>(DEFAULT_FORM);
  const [tierDrafts, setTierDrafts] = useState<Record<TierKey, PolicyDraft>>(buildTierDrafts());
  const [sourceQuery, setSourceQuery] = useState(searchParams.get('q') || '');
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(Number.isInteger(requestedSourceId) && requestedSourceId > 0 ? requestedSourceId : null);
  const [sourceDraft, setSourceDraft] = useState<PolicyDraft>(createPolicyDraft(DEFAULT_TIER_POLICIES.B));
  const [sourceOnlyOverrides, setSourceOnlyOverrides] = useState(searchParams.get('onlyOverrides') === 'true');
  const deferredSourceQuery = useDeferredValue(sourceQuery);

  const setSelectedSource = useCallback((sourceId: number | null, options?: { scroll?: boolean }) => {
    setSelectedSourceId(sourceId);
    if (options?.scroll) {
      sourceEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const loadData = useCallback(async (nextScope: RuleScope) => {
    setLoading(true);
    setError(null);
    try {
      const [
        rulesRes,
        scopeTierRes,
        userTierRes,
        effectiveRes,
        sourcesRes,
        aiConfigRes,
        preferenceRes,
      ] = await Promise.all([
        api.rules.list({ scope: nextScope }),
        api.qualityPolicies.list({ scope: nextScope }),
        api.qualityPolicies.list({ scope: 'user' }),
        api.qualityPolicies.list({ scope: 'effective' }),
        api.sources.list({ sortBy: 'name' }),
        api.aiConfigs.list(),
        api.preferences.profile().catch(() => ({ summary: null })),
      ]);

      setRules((rulesRes.data || []) as unknown as Rule[]);
      setTierSnapshot(scopeTierRes.data || null);
      setUserSnapshot(userTierRes.data || null);
      setEffectiveSnapshot(effectiveRes.data || null);
      setSources(sourcesRes.data || []);
      setAiConfigs(aiConfigRes.data || []);
      setPreferenceSummary(preferenceRes.summary || null);
      setTierDrafts(buildTierDrafts(nextScope === 'user' ? effectiveRes.data : scopeTierRes.data));
      setSelectedSourceId((current) => {
        const availableSources = sourcesRes.data || [];
        if (Number.isInteger(requestedSourceId) && requestedSourceId > 0 && availableSources.some((source) => source.id === requestedSourceId)) {
          return requestedSourceId;
        }
        if (current && availableSources.some((source) => source.id === current)) return current;
        return userTierRes.data?.sourceOverrides?.[0]?.sourceId || availableSources[0]?.id || null;
      });
      setForm((prev) => ({ ...prev, scope: nextScope }));
    } catch (err) {
      setRules([]);
      setTierSnapshot(null);
      setUserSnapshot(null);
      setEffectiveSnapshot(null);
      setSources([]);
      setAiConfigs([]);
      setError((err as Error).message || '过滤策略加载失败');
    } finally {
      setLoading(false);
    }
  }, [requestedSourceId]);

  useEffect(() => {
    void loadData(scope);
  }, [loadData, scope]);

  useEffect(() => {
    const nextScope = requestedScope === 'global' && isAdmin ? 'global' : 'user';
    if (scope !== nextScope) {
      setScope(nextScope);
    }
  }, [isAdmin, requestedScope, scope]);

  const activeQualityConfig = useMemo(
    () => aiConfigs.find((entry) => entry.type === 'quality_filter' && entry.isActive) || null,
    [aiConfigs],
  );

  const effectiveTierMap = useMemo(
    () => new Map((effectiveSnapshot?.tiers || []).map((entry) => [entry.tier, entry])),
    [effectiveSnapshot],
  );

  const scopeTierMap = useMemo(
    () => new Map((tierSnapshot?.tiers || []).map((entry) => [entry.tier, entry])),
    [tierSnapshot],
  );

  const sourceOverrides = useMemo(() => userSnapshot?.sourceOverrides || [], [userSnapshot]);
  const sourceOverrideMap = useMemo(
    () => new Map(sourceOverrides.map((entry) => [entry.sourceId, entry])),
    [sourceOverrides],
  );

  const filteredSources = useMemo(() => {
    const keyword = deferredSourceQuery.trim().toLowerCase();
    const rows = [...sources]
      .filter((source) => !sourceOnlyOverrides || sourceOverrideMap.has(source.id))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    if (!keyword) return rows;
    return rows.filter((source) => {
      const haystack = `${source.name} ${source.category || ''} ${source.sourceTier || ''}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [deferredSourceQuery, sourceOnlyOverrides, sourceOverrideMap, sources]);

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) || null,
    [selectedSourceId, sources],
  );

  const selectedSourceOverride = useMemo(
    () => (selectedSourceId ? sourceOverrideMap.get(selectedSourceId) || null : null),
    [selectedSourceId, sourceOverrideMap],
  );

  const selectedSourceBaseline = useMemo(() => {
    if (!selectedSource) return DEFAULT_TIER_POLICIES.B;
    const tier = normalizeTier(selectedSource.sourceTier);
    return effectiveTierMap.get(tier)?.resolved || DEFAULT_TIER_POLICIES[tier];
  }, [effectiveTierMap, selectedSource]);

  useEffect(() => {
    if (!selectedSource) return;
    setSourceDraft(createPolicyDraft(selectedSourceOverride?.resolved || selectedSourceBaseline));
  }, [selectedSource, selectedSourceBaseline, selectedSourceOverride]);

  useEffect(() => {
    if (Number.isInteger(requestedSourceId) && requestedSourceId > 0 && sources.some((source) => source.id === requestedSourceId)) {
      if (selectedSourceId !== requestedSourceId) {
        setSelectedSourceId(requestedSourceId);
      }
    }
  }, [requestedSourceId, selectedSourceId, sources]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (scope !== 'user') next.set('scope', scope);
    else next.delete('scope');
    if (selectedSourceId) next.set('source', String(selectedSourceId));
    else next.delete('source');
    if (sourceQuery.trim()) next.set('q', sourceQuery.trim());
    else next.delete('q');
    if (sourceOnlyOverrides) next.set('onlyOverrides', 'true');
    else next.delete('onlyOverrides');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [scope, searchParams, selectedSourceId, setSearchParams, sourceOnlyOverrides, sourceQuery]);

  const tierStats = useMemo(() => {
    const rows = effectiveSnapshot?.tiers || [];
    return {
      skip: rows.filter((entry) => entry.resolved.mode === 'skip').length,
      reviewOnly: rows.filter((entry) => entry.resolved.mode !== 'skip' && entry.resolved.onFilter === 'review').length,
      filtered: rows.filter((entry) => entry.resolved.mode !== 'skip' && entry.resolved.onFilter === 'filter').length,
    };
  }, [effectiveSnapshot]);

  const ruleStats = useMemo(() => ({
    total: rules.length,
    enabled: rules.filter((rule) => rule.enabled).length,
    filtered: rules.filter((rule) => rule.type === 'keyword_blacklist' || rule.type === 'ai_score_filter').length,
  }), [rules]);

  const tierBaselineMap = useMemo(() => TIER_SEQUENCE.reduce<Record<TierKey, QualityPolicyConfig>>((acc, tier) => {
    const scopeRow = scopeTierMap.get(tier);
    const effectiveRow = effectiveTierMap.get(tier);
    acc[tier] = (scope === 'user' ? effectiveRow?.resolved : scopeRow?.resolved) || DEFAULT_TIER_POLICIES[tier];
    return acc;
  }, {} as Record<TierKey, QualityPolicyConfig>), [effectiveTierMap, scope, scopeTierMap]);

  const tierDirtyMap = useMemo(() => TIER_SEQUENCE.reduce<Record<TierKey, boolean>>((acc, tier) => {
    acc[tier] = !policyEquals(tierDrafts[tier], tierBaselineMap[tier]);
    return acc;
  }, {} as Record<TierKey, boolean>), [tierBaselineMap, tierDrafts]);

  const tierDirtyCount = useMemo(
    () => TIER_SEQUENCE.filter((tier) => tierDirtyMap[tier]).length,
    [tierDirtyMap],
  );

  const sourceDraftDirty = useMemo(
    () => (selectedSource ? !policyEquals(sourceDraft, selectedSourceOverride?.resolved || selectedSourceBaseline) : false),
    [selectedSource, selectedSourceBaseline, selectedSourceOverride, sourceDraft],
  );

  const buildConfig = (): RuleConfig => {
    const config: RuleConfig = {};

    if (form.type.includes('keyword')) {
      config.keywords = splitCommaValues(form.keywords);
      if (form.type === 'keyword_whitelist') config.boost = form.boost;
    }
    if (form.type === 'ai_score_filter') {
      config.minAiScore = form.minAiScore;
      config.maxAiScore = form.maxAiScore;
      if (form.boost) config.boost = form.boost;
    }
    if (form.type === 'length_filter') {
      config.minLength = form.minLength;
      config.maxLength = form.maxLength;
    }
    if (form.type === 'language_filter') {
      config.languages = splitCommaValues(form.languages);
    }
    if (form.type === 'author_filter') {
      config.authors = splitCommaValues(form.authors);
    }

    return config;
  };

  const handleAddRule = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await api.rules.create({
        name: form.name,
        type: form.type,
        config: buildConfig(),
        enabled: form.enabled,
        priority: form.priority,
        scope: form.scope,
      });
      setShowAddRule(false);
      setForm({ ...DEFAULT_FORM, scope });
      setNotice(form.scope === 'global' ? '全局硬规则已创建' : '个人硬规则已创建');
      await loadData(form.scope);
    } catch (err) {
      setError((err as Error).message || '规则创建失败');
    }
  };

  const handleToggleRule = async (rule: Rule) => {
    try {
      await api.rules.update(rule.id, { enabled: !rule.enabled });
      await loadData(scope);
    } catch (err) {
      setError((err as Error).message || '规则更新失败');
    }
  };

  const handleDeleteRule = async (rule: Rule) => {
    if (!window.confirm(`确定删除规则“${rule.name}”？`)) return;
    try {
      await api.rules.delete(rule.id);
      setNotice('硬规则已删除');
      await loadData(scope);
    } catch (err) {
      setError((err as Error).message || '规则删除失败');
    }
  };

  const handleTierDraftChange = (tier: TierKey, key: keyof PolicyDraft, value: string | number) => {
    setTierDrafts((current) => ({
      ...current,
      [tier]: {
        ...current[tier],
        [key]: key === 'minConfidence' ? clampConfidence(Number(value)) : value,
      },
    }));
  };

  const resetTierDraft = (tier: TierKey) => {
    setTierDrafts((current) => ({
      ...current,
      [tier]: createPolicyDraft(tierBaselineMap[tier]),
    }));
  };

  const resetAllTierDrafts = () => {
    setTierDrafts(buildTierDrafts(scope === 'user' ? effectiveSnapshot : tierSnapshot));
  };

  const applyPresetToTier = (tier: TierKey, draft: PolicyDraft) => {
    setTierDrafts((current) => ({
      ...current,
      [tier]: { ...draft },
    }));
  };

  const handleSaveTier = async (tier: TierKey) => {
    const draft = tierDrafts[tier];
    setSavingTier(tier);
    setError(null);
    setNotice(null);
    try {
      await api.qualityPolicies.updateTier(tier, {
        scope,
        config: {
          mode: draft.mode,
          onFilter: draft.onFilter,
          minConfidence: clampConfidence(draft.minConfidence),
        },
      });
      setNotice(`${tier} 分级质检策略已保存`);
      await loadData(scope);
    } catch (err) {
      setError((err as Error).message || '分级策略保存失败');
    } finally {
      setSavingTier(null);
    }
  };

  const handleDeleteTier = async (tier: TierKey) => {
    if (!window.confirm(`确定删除 ${tier} 分级的${scope === 'global' ? '全局' : '个人'}覆盖，恢复默认行为？`)) return;
    setSavingTier(tier);
    setError(null);
    setNotice(null);
    try {
      await api.qualityPolicies.deleteTier(tier, scope);
      setNotice(`${tier} 分级已恢复默认策略`);
      await loadData(scope);
    } catch (err) {
      setError((err as Error).message || '删除分级覆盖失败');
    } finally {
      setSavingTier(null);
    }
  };

  const handleSaveSource = async () => {
    if (!selectedSource) return;
    setSavingSource(true);
    setError(null);
    setNotice(null);
    try {
      await api.qualityPolicies.updateSource(selectedSource.id, {
        config: {
          mode: sourceDraft.mode,
          onFilter: sourceDraft.onFilter,
          minConfidence: clampConfidence(sourceDraft.minConfidence),
        },
      });
      setNotice(`已保存 ${selectedSource.name} 的单源质检覆盖`);
      await loadData(scope);
    } catch (err) {
      setError((err as Error).message || '单源覆盖保存失败');
    } finally {
      setSavingSource(false);
    }
  };

  const handleDeleteSource = async (sourceId: number) => {
    const target = sources.find((entry) => entry.id === sourceId);
    if (!target) return;
    if (!window.confirm(`确定删除 ${target.name} 的单源覆盖，恢复为分级默认？`)) return;
    setDeletingSourceId(sourceId);
    setError(null);
    setNotice(null);
    try {
      await api.qualityPolicies.deleteSource(sourceId);
      setNotice(`已删除 ${target.name} 的单源覆盖`);
      await loadData(scope);
    } catch (err) {
      setError((err as Error).message || '单源覆盖删除失败');
    } finally {
      setDeletingSourceId(null);
    }
  };

  const applyPresetToSource = (draft: PolicyDraft) => {
    setSourceDraft({ ...draft });
  };

  const resetSourceDraft = () => {
    setSourceDraft(createPolicyDraft(selectedSourceOverride?.resolved || selectedSourceBaseline));
  };

  const activeScope = showAddRule ? form.scope : scope;

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,_rgba(15,118,110,0.07),_transparent_42%),linear-gradient(180deg,_#f8fafc_0%,_#ffffff_52%,_#fafaf9_100%)] p-6">
      <div className="mx-auto max-w-[1520px] space-y-6">
        <section className="overflow-hidden rounded-[32px] border border-zinc-200 bg-white shadow-[0_32px_96px_-56px_rgba(15,23,42,0.55)]">
          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.5fr_0.9fr] lg:px-8">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-teal-700">
                <Workflow size={12} />
                过滤策略台
              </div>
              <h1 className="mt-4 max-w-4xl text-3xl font-semibold tracking-[-0.04em] text-zinc-950">
                用分级策略定义谁该直通、谁该轻审、谁该进过滤池。
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-zinc-600">
                入库之后，系统会先跑硬规则，再根据信源层级进入 AI 质检，最后把内容路由到主 Feed 或过滤池。模型、提示词和模板仍在 AI 中心维护，这里只负责可视化策略与覆盖关系。
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  to="/filtered"
                  className="inline-flex items-center rounded-2xl bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-800"
                >
                  打开过滤池
                  <ArrowUpRight size={14} className="ml-2" />
                </Link>
                <Link
                  to="/settings"
                  className="inline-flex items-center rounded-2xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                >
                  打开 AI 中心
                  <ArrowUpRight size={14} className="ml-2" />
                </Link>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-[24px] border border-zinc-200 bg-zinc-50/90 p-4">
                <div className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">质检路由</div>
                <div className="mt-2 text-3xl font-semibold text-zinc-950">{tierStats.skip}</div>
                <div className="mt-1 text-xs text-zinc-500">个分级默认直通</div>
              </div>
              <div className="rounded-[24px] border border-amber-200 bg-amber-50/85 p-4">
                <div className="text-[10px] uppercase tracking-[0.24em] text-amber-700">待复核</div>
                <div className="mt-2 text-3xl font-semibold text-zinc-950">{tierStats.reviewOnly}</div>
                <div className="mt-1 text-xs text-zinc-500">个分级以 review 收口</div>
              </div>
              <div className="rounded-[24px] border border-rose-200 bg-rose-50/85 p-4">
                <div className="text-[10px] uppercase tracking-[0.24em] text-rose-700">过滤池入口</div>
                <div className="mt-2 text-3xl font-semibold text-zinc-950">{tierStats.filtered}</div>
                <div className="mt-1 text-xs text-zinc-500">个分级命中过滤后直接分流</div>
              </div>
            </div>
          </div>
        </section>

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}
        {!loading && (tierDirtyCount > 0 || sourceDraftDirty) && (
          <section className="rounded-[28px] border border-amber-200 bg-[linear-gradient(135deg,_rgba(254,249,195,0.55),_rgba(255,255,255,0.96))] px-5 py-4 shadow-[0_18px_48px_-40px_rgba(161,98,7,0.45)]">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-2xl bg-amber-100 p-2 text-amber-700">
                  <Sparkles size={16} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-zinc-950">有未保存的策略草稿</div>
                  <div className="mt-1 text-sm text-zinc-600">
                    {tierDirtyCount > 0 && `${tierDirtyCount} 个分级卡片已修改`}
                    {tierDirtyCount > 0 && sourceDraftDirty && ' · '}
                    {sourceDraftDirty && `信源「${selectedSource?.name || '当前选择'}」有未保存覆盖`}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {tierDirtyCount > 0 && (
                  <button
                    type="button"
                    onClick={resetAllTierDrafts}
                    className="inline-flex items-center rounded-2xl border border-amber-200 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-amber-50"
                  >
                    <RotateCcw size={14} className="mr-2" />
                    回退全部分级草稿
                  </button>
                )}
                {sourceDraftDirty && (
                  <button
                    type="button"
                    onClick={resetSourceDraft}
                    className="inline-flex items-center rounded-2xl border border-amber-200 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-amber-50"
                  >
                    <RotateCcw size={14} className="mr-2" />
                    回退单源草稿
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[30px] border border-zinc-200 bg-white p-5 shadow-[0_24px_64px_-52px_rgba(15,23,42,0.42)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-600">
                  <Bot size={12} />
                  AI 质检场景
                </div>
                <h2 className="mt-4 text-xl font-semibold tracking-[-0.03em] text-zinc-950">质量质检绑定</h2>
                <p className="mt-2 text-sm leading-7 text-zinc-600">
                  `quality_filter` 场景负责输出结构化处理结论、标签、风险和解释。深度改模型与提示词，跳转 AI 中心完成。
                </p>
              </div>
              <Link
                to="/settings"
                className="inline-flex min-h-9 shrink-0 items-center rounded-2xl border border-zinc-200 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50"
              >
                去设置
              </Link>
            </div>

            {activeQualityConfig ? (
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-[22px] border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">当前模型</div>
                  <div className="mt-2 text-sm font-semibold text-zinc-950">{activeQualityConfig.modelLabel || activeQualityConfig.model}</div>
                  <div className="mt-1 text-xs text-zinc-500">{activeQualityConfig.provider}</div>
                </div>
                <div className="rounded-[22px] border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">模板</div>
                  <div className="mt-2 text-sm font-semibold text-zinc-950">{activeQualityConfig.promptTemplateName || activeQualityConfig.name}</div>
                  <div className="mt-1 text-xs text-zinc-500">温度 {activeQualityConfig.temperature ?? 0}</div>
                </div>
                <div className="rounded-[22px] border border-teal-200 bg-teal-50/80 p-4">
                  <div className="text-[10px] tracking-[0.22em] text-teal-700">生效状态</div>
                  <div className="mt-2 text-sm font-semibold text-zinc-950">已启用</div>
                  <div className="mt-1 text-xs text-zinc-600">当前 scene 已连接模型与模板</div>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-[24px] border border-dashed border-amber-200 bg-amber-50 px-4 py-5 text-sm leading-7 text-amber-800">
                尚未启用 `quality_filter` AI 质检场景。系统仍会保留硬规则过滤，但不会产出 AI 质检解释。
              </div>
            )}
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-[22px] border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-[10px] tracking-[0.22em] text-zinc-500">硬规则</div>
                <div className="mt-2 text-sm font-semibold text-zinc-950">{rules.filter((rule) => rule.enabled).length} 条启用</div>
                <div className="mt-1 text-xs text-zinc-500">当前层级：{activeScope === 'global' ? '全局默认' : '个人覆盖'}</div>
              </div>
              <div className="rounded-[22px] border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-[10px] tracking-[0.22em] text-zinc-500">AI 质检</div>
                <div className="mt-2 text-sm font-semibold text-zinc-950">{activeQualityConfig ? '已启用' : '未启用'}</div>
                <div className="mt-1 text-xs text-zinc-500">未启用时只保留硬规则证据</div>
              </div>
              <div className="rounded-[22px] border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-[10px] tracking-[0.22em] text-zinc-500">人工反馈</div>
                <div className="mt-2 text-sm font-semibold text-zinc-950">{preferenceSummary?.totalFeedback ?? 0} 条</div>
                <div className="mt-1 text-xs text-zinc-500">
                  {preferenceSummary?.lastFeedbackAt ? '已进入偏好画像' : '尚未形成画像'}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[30px] border border-zinc-200 bg-white p-5 shadow-[0_24px_64px_-52px_rgba(15,23,42,0.42)]">
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-600">
              <Filter size={12} />
              固定质检框架
            </div>
            <h2 className="mt-4 text-xl font-semibold tracking-[-0.03em] text-zinc-950">固定质检框架</h2>
            <p className="mt-2 text-sm leading-7 text-zinc-600">
              AI 质检只在这套固定维度和风险标签上产出结构化结论，避免 prompt 漂移后解释失真。
            </p>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-[22px] border border-zinc-200 bg-zinc-50/80 p-4">
                <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">评分维度</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {QUALITY_DIMENSIONS.map((item) => (
                    <span key={item} className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-[22px] border border-zinc-200 bg-zinc-50/80 p-4">
                <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">风险标签</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {QUALITY_RISK_FLAGS.map((item) => (
                    <span key={item} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs text-rose-700">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-[22px] border border-zinc-200 bg-zinc-950 px-4 py-4 text-sm text-white">
              <div className="text-[10px] tracking-[0.24em] text-white/55">处理链路</div>
              <div className="mt-2 text-sm text-white/85">入库 → 硬规则初判 → AI 质检 → 主 Feed / 过滤池</div>
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-zinc-200 bg-white p-5 shadow-[0_24px_64px_-56px_rgba(15,23,42,0.48)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-600">
                <Workflow size={12} />
                分级质检矩阵
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-zinc-950">分级质检矩阵</h2>
              <p className="mt-2 text-sm leading-7 text-zinc-600">
                {scope === 'global'
                  ? '当前在编辑全局分级默认。它决定所有用户在无个人覆盖时的默认质检路由。'
                  : '当前在编辑个人分级覆盖。保存后会固定当前档位策略；删除覆盖后恢复到全局 / 系统默认。'}
              </p>
              <div className="mt-3 inline-flex rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] text-zinc-600">
                优先级：单源覆盖 &gt; 个人分级 &gt; 全局分级 &gt; 系统默认
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isAdmin && (
                <div className="flex rounded-2xl border border-zinc-200 bg-zinc-50 p-1">
                  {(['user', 'global'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setScope(item)}
                      className={`min-h-9 rounded-xl px-3 py-2 text-xs transition-colors ${
                        scope === item ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-900'
                      }`}
                    >
                      {item === 'user' ? '个人层' : '全局层'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-zinc-400">
              <Loader2 size={16} className="mr-2 animate-spin" />
              加载分级矩阵...
            </div>
          ) : (
            <div className="mt-6 grid gap-4 xl:grid-cols-5">
              {TIER_SEQUENCE.map((tier) => {
                const scopeRow = scopeTierMap.get(tier);
                const effectiveRow = effectiveTierMap.get(tier);
                const draft = tierDrafts[tier];
                const baseline = tierBaselineMap[tier];
                const hasOverride = scope === 'global'
                  ? Boolean(scopeRow?.overrideId)
                  : Boolean(tierSnapshot?.tiers.find((entry) => entry.tier === tier)?.overrideId);
                const isDirty = tierDirtyMap[tier];

                return (
                  <article key={tier} className="rounded-[26px] border border-zinc-200 bg-zinc-50/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${tierTone(tier)}`}>
                          {tier} 分级
                        </span>
                        <h3 className="mt-3 text-lg font-semibold text-zinc-950">{TIER_GUIDANCE[tier].title}</h3>
                        <p className="mt-2 text-xs leading-6 text-zinc-500">{TIER_GUIDANCE[tier].note}</p>
                      </div>
                      {hasOverride && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">
                          已覆盖
                        </span>
                      )}
                      {isDirty && (
                        <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] text-white">
                          草稿
                        </span>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {POLICY_PRESETS.map((preset) => {
                        const active = policyEquals(draft, preset.draft);
                        return (
                          <button
                            key={`${tier}-${preset.key}`}
                            type="button"
                            onClick={() => applyPresetToTier(tier, preset.draft)}
                            className={`min-h-9 rounded-full border px-3 py-2 text-xs transition-colors ${
                              active
                                ? 'border-zinc-900 bg-zinc-900 text-white'
                                : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-4 space-y-3">
                      <label className="block text-xs text-zinc-500">
                        质检模式
                        <select
                          value={draft.mode}
                          onChange={(event) => handleTierDraftChange(tier, 'mode', event.target.value)}
                          className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
                        >
                          {QUALITY_MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>

                      <label className="block text-xs text-zinc-500">
                        命中过滤时
                        <select
                          value={draft.onFilter}
                          onChange={(event) => handleTierDraftChange(tier, 'onFilter', event.target.value as PolicyDraft['onFilter'])}
                          className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
                        >
                          {FILTER_ACTION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>

                      <label className="block text-xs text-zinc-500">
                        最低置信度
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.01}
                          value={draft.minConfidence}
                          onChange={(event) => handleTierDraftChange(tier, 'minConfidence', event.target.value)}
                          className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
                        />
                      </label>
                    </div>

                    <div className="mt-4 rounded-[20px] border border-zinc-200 bg-white px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">当前生效</div>
                      <div className="mt-2 text-sm text-zinc-900">{policySummary(effectiveRow?.resolved || baseline)}</div>
                      {isDirty && (
                        <div className="mt-2 text-xs text-amber-700">草稿预览：{policySummary(draft)}</div>
                      )}
                    </div>

                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSaveTier(tier)}
                        disabled={savingTier === tier || !isDirty}
                        className="flex-1 rounded-2xl bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {savingTier === tier ? '保存中...' : '保存'}
                      </button>
                      <button
                        type="button"
                        onClick={() => resetTierDraft(tier)}
                        disabled={savingTier === tier || !isDirty}
                        className="rounded-2xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        回退草稿
                      </button>
                    </div>
                    {hasOverride && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteTier(tier)}
                        disabled={savingTier === tier}
                        className="mt-2 text-xs text-zinc-500 hover:text-zinc-900 disabled:opacity-50"
                      >
                        删除覆盖，恢复默认
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
          <div ref={sourceEditorRef} className="rounded-[30px] border border-zinc-200 bg-white p-5 shadow-[0_24px_64px_-56px_rgba(15,23,42,0.48)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-600">
                  <Search size={12} />
                  Source Override
                </div>
                <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-zinc-950">单源覆盖编辑</h2>
                <p className="mt-2 text-sm leading-7 text-zinc-600">
                  单源覆盖永远属于个人层。它适合处理“某个源比同档位明显更稳定”或“同档位里某个源更需要严审”的例外。
                </p>
              </div>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] text-zinc-600">
                {sourceOverrides.length} 个覆盖
              </span>
            </div>

            <div className="mt-5 space-y-3">
              <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3">
                <Search size={15} className="text-zinc-400" />
                <input
                  value={sourceQuery}
                  onChange={(event) => setSourceQuery(event.target.value)}
                  placeholder="搜索信源名称或层级"
                  className="w-full bg-transparent text-sm text-zinc-700 outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                <div>
                  {deferredSourceQuery !== sourceQuery ? '正在过滤信源...' : `当前可选 ${filteredSources.length} 个信源`}
                </div>
                <button
                  type="button"
                  onClick={() => setSourceOnlyOverrides((prev) => !prev)}
                  className={`min-h-9 rounded-full border px-3 py-2 transition-colors ${
                    sourceOnlyOverrides
                      ? 'border-zinc-900 bg-zinc-900 text-white'
                      : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100'
                  }`}
                >
                  只看已有覆盖
                </button>
              </div>

              <label className="block text-xs text-zinc-500">
                选择信源
                <select
                  value={selectedSourceId || ''}
                  onChange={(event) => setSelectedSource(Number(event.target.value))}
                  className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700"
                >
                  {filteredSources.length === 0 && <option value="">未找到信源</option>}
                  {filteredSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name} · {normalizeTier(source.sourceTier)} 档
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {selectedSource ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-[24px] border border-zinc-200 bg-zinc-50/80 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${tierTone(normalizeTier(selectedSource.sourceTier))}`}>
                      {normalizeTier(selectedSource.sourceTier)} 档
                    </span>
                    <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] text-zinc-600">
                      {selectedSource.category || '未分类'}
                    </span>
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-zinc-950">{selectedSource.name}</h3>
                  <p className="mt-2 text-xs leading-6 text-zinc-500">
                    当前跟随的分级策略：{policySummary(selectedSourceBaseline)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedSourceOverride ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] text-amber-700">已存在单源覆盖</span>
                    ) : (
                      <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] text-zinc-600">当前仍跟随分级默认</span>
                    )}
                    <Link
                      to={`/filtered?sourceId=${selectedSource.id}`}
                      className="inline-flex min-h-9 items-center rounded-full border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
                    >
                      查看该源过滤池
                    </Link>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {POLICY_PRESETS.map((preset) => {
                    const active = policyEquals(sourceDraft, preset.draft);
                    return (
                      <button
                        key={`source-${preset.key}`}
                        type="button"
                        onClick={() => applyPresetToSource(preset.draft)}
                        className={`min-h-9 rounded-full border px-3 py-2 text-xs transition-colors ${
                          active
                            ? 'border-zinc-900 bg-zinc-900 text-white'
                            : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <label className="block text-xs text-zinc-500">
                    质检模式
                    <select
                      value={sourceDraft.mode}
                      onChange={(event) => setSourceDraft((prev) => ({ ...prev, mode: event.target.value }))}
                      className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
                    >
                      {QUALITY_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-zinc-500">
                    命中过滤时
                    <select
                      value={sourceDraft.onFilter}
                      onChange={(event) => setSourceDraft((prev) => ({ ...prev, onFilter: event.target.value as PolicyDraft['onFilter'] }))}
                      className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
                    >
                      {FILTER_ACTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-zinc-500">
                    最低置信度
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={sourceDraft.minConfidence}
                      onChange={(event) => setSourceDraft((prev) => ({ ...prev, minConfidence: clampConfidence(Number(event.target.value)) }))}
                      className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
                    />
                  </label>
                </div>

                <div className="rounded-[24px] border border-zinc-200 bg-zinc-950 px-4 py-4 text-sm text-white">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-white/55">预览</div>
                  <div className="mt-2 text-white/90">{policySummary(sourceDraft)}</div>
                  {sourceDraftDirty && (
                    <div className="mt-2 text-xs text-white/65">当前草稿尚未保存，会覆盖该信源对分级策略的跟随关系。</div>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveSource()}
                    disabled={savingSource}
                    className="flex-1 rounded-2xl bg-zinc-900 px-4 py-2.5 text-sm text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingSource ? '保存中...' : '保存单源覆盖'}
                  </button>
                  <button
                    type="button"
                    onClick={resetSourceDraft}
                    disabled={!sourceDraftDirty}
                    className="rounded-2xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    回退草稿
                  </button>
                </div>
                {selectedSourceOverride && (
                  <button
                    type="button"
                    onClick={() => selectedSource && void handleDeleteSource(selectedSource.id)}
                    disabled={deletingSourceId === selectedSource.id}
                    className="text-xs text-zinc-500 hover:text-zinc-900 disabled:opacity-50"
                  >
                    删除单源覆盖，恢复分级默认
                  </button>
                )}
              </div>
            ) : (
              <div className="mt-5 rounded-[24px] border border-dashed border-zinc-200 bg-zinc-50 px-4 py-12 text-center text-sm text-zinc-500">
                当前没有可用信源。
              </div>
            )}
          </div>

          <div className="rounded-[30px] border border-zinc-200 bg-white p-5 shadow-[0_24px_64px_-56px_rgba(15,23,42,0.48)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-600">
                  <Shield size={12} />
                  Override Register
                </div>
                <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-zinc-950">已生效单源覆盖</h2>
                <p className="mt-2 text-sm leading-7 text-zinc-600">
                  用来查看哪些来源已经偏离默认分级策略，并快速跳转到某个源继续调整。
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {sourceOverrides.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-zinc-200 bg-zinc-50 px-4 py-12 text-center text-sm text-zinc-500">
                  还没有单源覆盖。默认所有源都跟随分级矩阵。
                </div>
              ) : (
                sourceOverrides.map((override: QualitySourceOverrideRecord) => (
                  <div key={override.id} className="rounded-[24px] border border-zinc-200 bg-zinc-50/80 p-4">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] ${tierTone(normalizeTier(override.sourceTier))}`}>
                            {normalizeTier(override.sourceTier)} 档
                          </span>
                          <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] text-zinc-600">
                            单源覆盖
                          </span>
                        </div>
                        <h3 className="mt-3 text-lg font-semibold text-zinc-950">{override.sourceName}</h3>
                        <p className="mt-2 text-sm leading-7 text-zinc-600">{policySummary(override.resolved)}</p>
                        <div className="mt-3">
                          <Link
                            to={`/filtered?sourceId=${override.sourceId}`}
                            className="inline-flex min-h-9 items-center rounded-full border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
                          >
                            查看该源过滤池
                          </Link>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedSource(override.sourceId, { scroll: true })}
                          className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteSource(override.sourceId)}
                          disabled={deletingSourceId === override.sourceId}
                          className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-zinc-200 bg-white p-5 shadow-[0_24px_64px_-56px_rgba(15,23,42,0.48)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-600">
                <Shield size={12} />
                Hard Rules
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-zinc-950">硬规则面板</h2>
              <p className="mt-2 text-sm leading-7 text-zinc-600">
                硬规则负责关键词、长度、语言、作者和 AI 分数门槛。它们先于 AI 质检执行，适合处理确定性噪音与明确偏好。
              </p>
            </div>

            <div className="flex items-center gap-2">
              {isAdmin && (
                <div className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] text-zinc-600">
                  当前查看：{activeScope === 'global' ? '全局硬规则' : '个人硬规则'}
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setShowAddRule((prev) => !prev);
                  setForm((prev) => ({ ...prev, scope }));
                }}
                className="inline-flex items-center rounded-2xl bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-800"
              >
                <Plus size={14} className="mr-2" />
                添加硬规则
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-[22px] border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">规则总数</div>
              <div className="mt-2 text-3xl font-semibold text-zinc-950">{ruleStats.total}</div>
            </div>
            <div className="rounded-[22px] border border-emerald-200 bg-emerald-50/80 p-4">
              <div className="text-[10px] uppercase tracking-[0.22em] text-emerald-700">启用中</div>
              <div className="mt-2 text-3xl font-semibold text-zinc-950">{ruleStats.enabled}</div>
            </div>
            <div className="rounded-[22px] border border-amber-200 bg-amber-50/80 p-4">
              <div className="text-[10px] uppercase tracking-[0.22em] text-amber-700">过滤型</div>
              <div className="mt-2 text-3xl font-semibold text-zinc-950">{ruleStats.filtered}</div>
            </div>
          </div>

          {showAddRule && (
            <form onSubmit={handleAddRule} className="mt-5 rounded-[28px] border border-zinc-200 bg-zinc-50/80 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-zinc-950">新建硬规则</h3>
                  <p className="mt-2 max-w-3xl text-sm leading-7 text-zinc-600">
                    硬规则做确定性过滤，AI 质检做可解释的质量判断。优先级数字越小越先执行。
                  </p>
                </div>
                {isAdmin && form.scope === 'global' && (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] text-amber-700">全局规则</span>
                )}
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <input
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="规则名称"
                  required
                  className="rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700"
                />
                <select
                  value={form.type}
                  onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))}
                  className="rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700"
                >
                  {RULE_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>

              {isAdmin && (
                <div className="mt-4 flex items-center gap-2">
                  <span className="text-xs text-zinc-500">作用域</span>
                  <div className="flex rounded-2xl border border-zinc-200 bg-white p-1">
                    {(['user', 'global'] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, scope: item }))}
                        className={`min-h-9 rounded-xl px-3 py-2 text-xs transition-colors ${
                          form.scope === item ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-900'
                        }`}
                      >
                        {item === 'user' ? '个人' : '全局'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {form.type.includes('keyword') && (
                <div className="mt-4 space-y-2">
                  <input
                    value={form.keywords}
                    onChange={(event) => setForm((prev) => ({ ...prev, keywords: event.target.value }))}
                    placeholder="关键词（逗号分隔）"
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700"
                  />
                  {form.type === 'keyword_blacklist' && (
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, keywords: NON_AI_NOISE_PRESET }))}
                      className="text-xs text-zinc-500 hover:text-zinc-900"
                    >
                      填入“过滤非 AI 噪音词”推荐预设
                    </button>
                  )}
                  {form.type === 'keyword_whitelist' && (
                    <label className="inline-flex items-center gap-2 text-xs text-zinc-500">
                      加分值
                      <input
                        type="number"
                        value={form.boost}
                        onChange={(event) => setForm((prev) => ({ ...prev, boost: Number(event.target.value || 0) }))}
                        className="w-24 rounded-xl border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700"
                      />
                    </label>
                  )}
                </div>
              )}

              {form.type === 'ai_score_filter' && (
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <label className="text-xs text-zinc-500">
                    最低 AI 分数
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={form.minAiScore}
                      onChange={(event) => setForm((prev) => ({ ...prev, minAiScore: Number(event.target.value || 0) }))}
                      className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
                    />
                  </label>
                  <label className="text-xs text-zinc-500">
                    最高 AI 分数
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={form.maxAiScore}
                      onChange={(event) => setForm((prev) => ({ ...prev, maxAiScore: Number(event.target.value || 100) }))}
                      className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
                    />
                  </label>
                  <label className="text-xs text-zinc-500">
                    额外加分
                    <input
                      type="number"
                      value={form.boost}
                      onChange={(event) => setForm((prev) => ({ ...prev, boost: Number(event.target.value || 0) }))}
                      className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
                    />
                  </label>
                </div>
              )}

              {form.type === 'length_filter' && (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="text-xs text-zinc-500">
                    最短长度
                    <input
                      type="number"
                      min={0}
                      value={form.minLength}
                      onChange={(event) => setForm((prev) => ({ ...prev, minLength: Number(event.target.value || 0) }))}
                      className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
                    />
                  </label>
                  <label className="text-xs text-zinc-500">
                    最长长度
                    <input
                      type="number"
                      min={0}
                      value={form.maxLength}
                      onChange={(event) => setForm((prev) => ({ ...prev, maxLength: Number(event.target.value || 0) }))}
                      className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
                    />
                  </label>
                </div>
              )}

              {form.type === 'language_filter' && (
                <div className="mt-4">
                  <input
                    value={form.languages}
                    onChange={(event) => setForm((prev) => ({ ...prev, languages: event.target.value }))}
                    placeholder="语言代码（逗号分隔，如：zh,en,ja）"
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700"
                  />
                </div>
              )}

              {form.type === 'author_filter' && (
                <div className="mt-4">
                  <input
                    value={form.authors}
                    onChange={(event) => setForm((prev) => ({ ...prev, authors: event.target.value }))}
                    placeholder="作者名（逗号分隔）"
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700"
                  />
                </div>
              )}

              <div className="mt-4 grid gap-3 md:max-w-md md:grid-cols-2">
                <label className="text-xs text-zinc-500">
                  优先级
                  <input
                    type="number"
                    value={form.priority}
                    onChange={(event) => setForm((prev) => ({ ...prev, priority: Number(event.target.value || 0) }))}
                    className="mt-1 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
                  />
                </label>
                <label className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
                  启用
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.checked }))}
                  />
                </label>
              </div>

              <div className="mt-5 flex gap-2">
                <button type="submit" className="rounded-2xl bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-800">
                  保存硬规则
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddRule(false)}
                  className="rounded-2xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
                >
                  取消
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-zinc-400">
              <Loader2 size={16} className="mr-2 animate-spin" />
              加载硬规则...
            </div>
          ) : rules.length === 0 ? (
            <div className="mt-5 rounded-[24px] border border-dashed border-zinc-200 bg-zinc-50 px-4 py-14 text-center text-sm text-zinc-500">
              当前没有{scope === 'global' ? '全局' : '个人'}硬规则。
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {rules.map((rule) => (
                <div key={rule.id} className="rounded-[24px] border border-zinc-200 bg-zinc-50/80 p-4">
                  <div className="flex items-start gap-3">
                    <button type="button" onClick={() => void handleToggleRule(rule)} className="mt-0.5 shrink-0">
                      {rule.enabled ? <ToggleRight size={20} className="text-emerald-500" /> : <ToggleLeft size={20} className="text-zinc-300" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-sm font-medium ${rule.enabled ? 'text-zinc-900' : 'text-zinc-400'}`}>{rule.name}</span>
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600">
                          {RULE_TYPES.find((item) => item.value === rule.type)?.label || rule.type}
                        </span>
                        {rule.scope === 'global' && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">全局</span>
                        )}
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500">优先级 {rule.priority}</span>
                      </div>

                      {rule.config?.keywords && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {(rule.config.keywords as string[]).slice(0, 12).map((keyword) => (
                            <span key={keyword} className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] text-zinc-600">
                              {keyword}
                            </span>
                          ))}
                        </div>
                      )}
                      {rule.type === 'ai_score_filter' && (
                        <p className="mt-3 text-xs text-zinc-500">
                          AI 分数范围：{rule.config.minAiScore ?? 0} - {rule.config.maxAiScore ?? 100}
                          {typeof rule.config.boost === 'number' && rule.config.boost !== 0 ? ` · 额外加分 ${rule.config.boost}` : ''}
                        </p>
                      )}
                      {rule.type === 'length_filter' && (
                        <p className="mt-3 text-xs text-zinc-500">长度范围：{rule.config.minLength ?? 0} - {rule.config.maxLength ?? '∞'}</p>
                      )}
                      {rule.type === 'language_filter' && Array.isArray(rule.config.languages) && (
                        <p className="mt-3 text-xs text-zinc-500">语言：{rule.config.languages.join(' / ')}</p>
                      )}
                      {rule.type === 'author_filter' && Array.isArray(rule.config.authors) && (
                        <p className="mt-3 text-xs text-zinc-500">作者：{rule.config.authors.join(' / ')}</p>
                      )}
                    </div>
                    <button type="button" onClick={() => void handleDeleteRule(rule)} className="rounded-xl p-1.5 hover:bg-red-50">
                      <Trash2 size={14} className="text-zinc-300 hover:text-red-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
