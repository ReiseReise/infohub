import { JevPanel } from '../../../components/JevPanel';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { api, type AiConfig, type AiConfigMeta, type AdminModelConfig, type AdminPromptTemplate, type AiUsageEvent, type AiUsageSummary, type ScoringSkillRecord, type ScoringSkillHealthSummary, type ScoringModelProbeSummary, type ScoringModelRemediationApplyResult, type FallbackScoringRecoverySummary, type PreferenceProfileRecord, type PreferenceProfileSummary } from '../../../lib/api';
import { useSettings } from '../SettingsContext';
import {
  AI_CENTER_TABS, ALL_BATCH_SCENE_TYPES, DAILY_REPORT_SCENE_TYPES, DEEPSEEK_PROVIDER, DEEPSEEK_TRANSLATION_MODEL, DEFAULT_LLM_BASE_URL, DEFAULT_LLM_ENDPOINT_ID,
  DEFAULT_LLM_PROVIDER, READING_SCENE_TYPES, VOLCENGINE_ARK_PROVIDER,
  baseUrlForProvider, buildModelConfigsWithUsage, formatCost, isVolcengineArk, mergeUsageSummary,
  modelDisplayName, modelTarget, normalizeAiForm, normalizeProvider, providerLabel, sceneLabel, sectionTitle,
  type AiCenterTab, type AiConfigType, type AiForm, type AiUsageEventWithSource, type ModelConfigWithUsage,
} from '../shared';

export function AiCenterTab() {
  const [searchParams] = useSearchParams();
  const { isAdmin, setError, setNotice, loading: baseLoading } = useSettings();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
  const [aiConfigMeta, setAiConfigMeta] = useState<AiConfigMeta | null>(null);
  const [adminModelConfigs, setAdminModelConfigs] = useState<AdminModelConfig[]>([]);
  const [adminPromptTemplates, setAdminPromptTemplates] = useState<AdminPromptTemplate[]>([]);
  const [scoringSkills, setScoringSkills] = useState<ScoringSkillRecord[]>([]);
  const [scoringSkillHealth, setScoringSkillHealth] = useState<ScoringSkillHealthSummary | null>(null);
  const [scoringModelProbe, setScoringModelProbe] = useState<ScoringModelProbeSummary | null>(null);
  const [scoringModelRepair, setScoringModelRepair] = useState<ScoringModelRemediationApplyResult | null>(null);
  const [fallbackScoringRecovery, setFallbackScoringRecovery] = useState<FallbackScoringRecoverySummary | null>(null);
  const [scoringProbeLoading, setScoringProbeLoading] = useState(false);
  const [skillSaving, setSkillSaving] = useState(false);
  const [preferenceProfile, setPreferenceProfile] = useState<PreferenceProfileRecord | null>(null);
  const [preferenceSummary, setPreferenceSummary] = useState<PreferenceProfileSummary | null>(null);
  const [profileRebuilding, setProfileRebuilding] = useState(false);
  const [taskTemplates, setTaskTemplates] = useState<Array<{ id: string; name: string; description?: string; category?: string }>>([]);
  const [taskModels, setTaskModels] = useState<{ llm_models: Array<{ id: string; name: string; description?: string }>; asr_models: Array<{ id: string; name: string; description?: string }> }>({ llm_models: [], asr_models: [] });
  const [promptPreview, setPromptPreview] = useState('');
  const [promptForm, setPromptForm] = useState({ id: '', name: '', description: '', category: 'feed_summary', template_text: '', variables: 'title,content' });
  const [modelForm, setModelForm] = useState({ id: '', alias: '', provider: DEFAULT_LLM_PROVIDER, model_name: DEFAULT_LLM_ENDPOINT_ID, model_type: 'llm', api_key: '', base_url: DEFAULT_LLM_BASE_URL, extra_config: null as Record<string, unknown> | null, is_default: false, is_active: true });
  const [bulkModelConfigId, setBulkModelConfigId] = useState('');
  const [activeAiCenterTab, setActiveAiCenterTab] = useState<AiCenterTab>(() => searchParams.get('center') === 'models' ? 'models' : 'scenes');

  // AI Usage state
  const [aiUsageLoading, setAiUsageLoading] = useState(false);
  const [hubAiUsageSummary, setHubAiUsageSummary] = useState<AiUsageSummary | null>(null);
  const [audioAiUsageSummary, setAudioAiUsageSummary] = useState<AiUsageSummary | null>(null);
  const [hubAiUsageEvents, setHubAiUsageEvents] = useState<AiUsageEventWithSource[]>([]);
  const [audioAiUsageEvents, setAudioAiUsageEvents] = useState<AiUsageEventWithSource[]>([]);
  const [aiUsageSourceFilter, setAiUsageSourceFilter] = useState<'all' | 'hub' | 'audio'>('all');
  const [aiUsageStatusFilter, setAiUsageStatusFilter] = useState('');
  const [aiUsageSceneFilter, setAiUsageSceneFilter] = useState('');
  const [aiUsageProviderFilter, setAiUsageProviderFilter] = useState('');
  const [aiUsageSearch, setAiUsageSearch] = useState('');
  const [aiUsageTimeWindow, setAiUsageTimeWindow] = useState<'24h' | '7d' | '30d'>('7d');
  const [aiUsageInterval, setAiUsageInterval] = useState<'hour' | 'day'>('day');

  const [aiForms, setAiForms] = useState<Record<AiConfigType, AiForm>>({
    quality_filter: normalizeAiForm('quality_filter'), scoring: normalizeAiForm('scoring'),
    summary: normalizeAiForm('summary'), translation: normalizeAiForm('translation'),
    daily_report: normalizeAiForm('daily_report'), daily_report_cleaning: normalizeAiForm('daily_report_cleaning'),
    daily_report_decision: normalizeAiForm('daily_report_decision'), daily_report_research: normalizeAiForm('daily_report_research'),
    daily_report_reading: normalizeAiForm('daily_report_reading'), daily_report_final: normalizeAiForm('daily_report_final'),
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [aiResp, tplResp, modelResp, promptResp, adminModelResp, skillResp, profileResp] = await Promise.all([
        api.aiConfigs.list(),
        api.audio.getTaskTemplates().catch(() => []),
        api.audio.getTaskModels().catch(() => ({ llm_models: [], asr_models: [] })),
        isAdmin ? api.admin.listPromptTemplates().catch(() => []) : Promise.resolve([]),
        isAdmin ? api.admin.listModelConfigs().catch(() => []) : Promise.resolve([]),
        api.scoringSkills.list().catch(() => ({ data: [] as ScoringSkillRecord[], health: null as ScoringSkillHealthSummary | null })),
        api.preferences.profile().catch(() => ({ data: null as PreferenceProfileRecord | null, summary: null as PreferenceProfileSummary | null })),
      ]);
      setAiConfigs(aiResp.data || []);
      setAiConfigMeta(aiResp.meta || null);
      setTaskTemplates(tplResp || []);
      setTaskModels(modelResp || { llm_models: [], asr_models: [] });
      setAdminPromptTemplates(promptResp || []);
      setAdminModelConfigs(adminModelResp || []);
      setScoringSkills(skillResp.data || []);
      setScoringSkillHealth(skillResp.health || null);
      setPreferenceProfile(profileResp.data || null);
      setPreferenceSummary(profileResp.summary || null);
    } catch (err) {
      setError((err as Error).message || '加载 AI 管理中心数据失败');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, setError]);

  useEffect(() => { void loadData(); }, [loadData]);

  // Sync AI forms when data changes
  const aiConfigByType = useMemo(() => {
    const map = new Map<AiConfigType, AiConfig>();
    for (const cfg of aiConfigs) {
      if (['quality_filter', 'scoring', 'summary', 'translation', 'daily_report', 'daily_report_cleaning', 'daily_report_decision', 'daily_report_research', 'daily_report_reading', 'daily_report_final'].includes(cfg.type)) {
        map.set(cfg.type as AiConfigType, cfg);
      }
    }
    return map;
  }, [aiConfigs]);

  const defaultLlmModel = useMemo(() => adminModelConfigs.find((m) => m.model_type === 'llm' && m.is_default) || adminModelConfigs.find((m) => m.model_type === 'llm') || null, [adminModelConfigs]);

  const defaultPromptByType = useMemo(() => ({
    quality_filter: adminPromptTemplates.find((t) => t.category === 'quality_filter') || null,
    scoring: adminPromptTemplates.find((t) => t.category === 'feed_scoring') || null,
    summary: adminPromptTemplates.find((t) => t.category === 'feed_summary') || null,
    translation: adminPromptTemplates.find((t) => t.category === 'feed_translation') || null,
    daily_report: adminPromptTemplates.find((t) => t.category === 'daily_report') || null,
    daily_report_cleaning: adminPromptTemplates.find((t) => t.category === 'daily_report_cleaning') || null,
    daily_report_decision: adminPromptTemplates.find((t) => t.category === 'daily_report_decision') || null,
    daily_report_research: adminPromptTemplates.find((t) => t.category === 'daily_report_research') || null,
    daily_report_reading: adminPromptTemplates.find((t) => t.category === 'daily_report_reading') || null,
    daily_report_final: adminPromptTemplates.find((t) => t.category === 'daily_report_final') || null,
  }), [adminPromptTemplates]);

  useEffect(() => {
    const did = defaultLlmModel?.id;
    setAiForms({
      quality_filter: normalizeAiForm('quality_filter', aiConfigByType.get('quality_filter'), did, defaultPromptByType.quality_filter?.id),
      scoring: normalizeAiForm('scoring', aiConfigByType.get('scoring'), did, defaultPromptByType.scoring?.id),
      summary: normalizeAiForm('summary', aiConfigByType.get('summary'), did, defaultPromptByType.summary?.id),
      translation: normalizeAiForm('translation', aiConfigByType.get('translation'), did, defaultPromptByType.translation?.id),
      daily_report: normalizeAiForm('daily_report', aiConfigByType.get('daily_report'), did, defaultPromptByType.daily_report?.id),
      daily_report_cleaning: normalizeAiForm('daily_report_cleaning', aiConfigByType.get('daily_report_cleaning') || aiConfigByType.get('daily_report'), did, defaultPromptByType.daily_report_cleaning?.id || defaultPromptByType.daily_report?.id),
      daily_report_decision: normalizeAiForm('daily_report_decision', aiConfigByType.get('daily_report_decision') || aiConfigByType.get('daily_report'), did, defaultPromptByType.daily_report_decision?.id || defaultPromptByType.daily_report?.id),
      daily_report_research: normalizeAiForm('daily_report_research', aiConfigByType.get('daily_report_research') || aiConfigByType.get('daily_report'), did, defaultPromptByType.daily_report_research?.id || defaultPromptByType.daily_report?.id),
      daily_report_reading: normalizeAiForm('daily_report_reading', aiConfigByType.get('daily_report_reading') || aiConfigByType.get('daily_report'), did, defaultPromptByType.daily_report_reading?.id || defaultPromptByType.daily_report?.id),
      daily_report_final: normalizeAiForm('daily_report_final', aiConfigByType.get('daily_report_final') || aiConfigByType.get('daily_report'), did, defaultPromptByType.daily_report_final?.id || defaultPromptByType.daily_report?.id),
    });
  }, [aiConfigByType, defaultLlmModel, defaultPromptByType]);

  const modelConfigsWithUsage: ModelConfigWithUsage[] = useMemo(() => buildModelConfigsWithUsage(adminModelConfigs, aiConfigs, scoringSkills), [adminModelConfigs, aiConfigs, scoringSkills]);

  const groupedModelConfigs = useMemo(() => ({
    llm: modelConfigsWithUsage.filter((m) => m.model_type === 'llm'),
    asr: modelConfigsWithUsage.filter((m) => m.model_type === 'asr'),
    multimodal: modelConfigsWithUsage.filter((m) => m.model_type === 'multimodal'),
  }), [modelConfigsWithUsage]);

  const aiFunctionCards = useMemo(() => (
    ([['quality_filter', 'quality_filter'], ['scoring', 'feed_scoring'], ['summary', 'feed_summary'], ['translation', 'feed_translation'], ['daily_report_cleaning', 'daily_report_cleaning'], ['daily_report_decision', 'daily_report_decision'], ['daily_report_research', 'daily_report_research'], ['daily_report_reading', 'daily_report_reading'], ['daily_report_final', 'daily_report_final']] as Array<[AiConfigType, string]>).map(([type, sceneKey]) => {
      const form = aiForms[type];
      const model = modelConfigsWithUsage.find((m) => m.id === form.modelConfigId);
      const prompt = adminPromptTemplates.find((t) => t.id === form.promptTemplateId);
      const status = !form.isActive ? { label: '已停用', className: 'bg-zinc-100 text-zinc-600' } : !model ? { label: '缺少模型', className: 'bg-amber-100 text-amber-700' } : model.test_status === 'failed' ? { label: '模型异常', className: 'bg-red-100 text-red-700' } : !prompt && !form.promptTemplate ? { label: '缺少模板', className: 'bg-amber-100 text-amber-700' } : { label: '运行中', className: 'bg-emerald-100 text-emerald-700' };
      return { type, sceneKey, title: sceneLabel(sceneKey), model, prompt, status };
    })
  ), [adminPromptTemplates, aiForms, modelConfigsWithUsage]);

  // AI Usage
  const combinedAiUsageSummary = useMemo(() => mergeUsageSummary(hubAiUsageSummary, audioAiUsageSummary), [audioAiUsageSummary, hubAiUsageSummary]);
  const combinedAiUsageEvents = useMemo(() => [...hubAiUsageEvents, ...audioAiUsageEvents].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 120), [audioAiUsageEvents, hubAiUsageEvents]);
  const filteredAiUsageEvents = useMemo(() => combinedAiUsageEvents.filter((e) => aiUsageSourceFilter === 'all' || e.source === aiUsageSourceFilter), [aiUsageSourceFilter, combinedAiUsageEvents]);
  const aiUsageSuccessRate = useMemo(() => { const s = combinedAiUsageSummary.byStatus.find((i) => i.key === 'success')?.count || 0; return combinedAiUsageSummary.totalCalls > 0 ? `${((s / combinedAiUsageSummary.totalCalls) * 100).toFixed(1)}%` : '—'; }, [combinedAiUsageSummary]);
  const aiUsageAvgLatency = useMemo(() => { const t = combinedAiUsageSummary.trends || []; const tc = t.reduce((s, i) => s + (i.calls || 0), 0); if (tc === 0) return null; return Math.round(t.reduce((s, i) => s + ((i.avgLatencyMs || 0) * (i.calls || 0)), 0) / tc); }, [combinedAiUsageSummary.trends]);
  const aiUsageSceneOptions = useMemo(() => combinedAiUsageSummary.byScene.map((i) => i.key), [combinedAiUsageSummary.byScene]);
  const aiUsageProviderOptions = useMemo(() => combinedAiUsageSummary.byProvider.map((i) => i.key), [combinedAiUsageSummary.byProvider]);
  const aiUsageErrorBuckets = useMemo(() => { const b = new Map<string, { key: string; count: number; scenes: Set<string> }>(); for (const e of filteredAiUsageEvents) { if (e.status !== 'error') continue; const k = (e.errorMessage || '未知错误').trim(); const c = b.get(k) || { key: k, count: 0, scenes: new Set<string>() }; c.count += 1; c.scenes.add(sceneLabel(e.sceneType)); b.set(k, c); } return [...b.values()].sort((a, b2) => b2.count - a.count).slice(0, 6); }, [filteredAiUsageEvents]);
  void aiUsageErrorBuckets;

  const refreshAiUsage = useCallback(async () => {
    if (!isAdmin) return;
    setAiUsageLoading(true);
    try {
      const sp = { timeWindow: aiUsageTimeWindow, interval: aiUsageInterval };
      const ep = { limit: 120, status: aiUsageStatusFilter || undefined, sceneType: aiUsageSceneFilter || undefined, provider: aiUsageProviderFilter || undefined, search: aiUsageSearch.trim() || undefined };
      const [hs, he, as2, ae] = await Promise.all([
        api.admin.hubAiUsageSummary(sp).catch(() => ({ data: null as AiUsageSummary | null })),
        api.admin.hubAiUsageEvents(ep).catch(() => ({ data: [] as AiUsageEvent[] })),
        api.admin.audioAiUsageSummary(sp).catch(() => ({ data: null as AiUsageSummary | null })),
        api.admin.audioAiUsageEvents(ep).catch(() => ({ data: [] as AiUsageEvent[] })),
      ]);
      setHubAiUsageSummary(hs.data || null);
      setHubAiUsageEvents((he.data || []).map((e) => ({ ...e, source: 'hub' as const })));
      setAudioAiUsageSummary(as2.data || null);
      setAudioAiUsageEvents((ae.data || []).map((e) => ({ ...e, source: 'audio' as const })));
    } catch (err) {
      setError((err as Error).message || '加载 AI 使用日志失败');
    } finally {
      setAiUsageLoading(false);
    }
  }, [aiUsageInterval, aiUsageProviderFilter, aiUsageSceneFilter, aiUsageSearch, aiUsageStatusFilter, aiUsageTimeWindow, isAdmin, setError]);

  useEffect(() => { if (activeAiCenterTab === 'logs' && isAdmin) void refreshAiUsage(); }, [activeAiCenterTab, isAdmin, refreshAiUsage]);

  // Handlers
  const saveAiConfig = async (type: AiConfigType) => {
    setSaving(true); setError(null); setNotice(null);
    const form = aiForms[type];
    const selectedModel = modelConfigsWithUsage.find((m) => m.id === form.modelConfigId);
    const selectedPrompt = adminPromptTemplates.find((t) => t.id === form.promptTemplateId);
    const payload = { name: form.name, provider: selectedModel?.provider || form.provider, model: selectedModel?.model_name || form.model, baseUrl: selectedModel?.base_url || form.baseUrl, temperature: form.temperature, promptTemplate: selectedPrompt?.template_text || form.promptTemplate, promptTemplateId: form.promptTemplateId || null, modelConfigId: form.modelConfigId || null, type, isActive: form.isActive };
    try {
      const existing = aiConfigByType.get(type);
      if (existing?.id) { await api.aiConfigs.update(existing.id, payload); } else { await api.aiConfigs.create(payload as Partial<AiConfig>); }
      await loadData();
      setNotice(`${type} 场景绑定已保存`);
    } catch (err) { setError((err as Error).message || '保存 AI 配置失败'); } finally { setSaving(false); }
  };

  const applyModelToScenes = async (types: AiConfigType[], label: string, modelConfigIdOverride?: string | null) => {
    if (!isAdmin) return;
    const modelConfigId = modelConfigIdOverride || bulkModelConfigId || defaultLlmModel?.id || '';
    if (!modelConfigId) { setError('请先在模型仓库创建并启用一个 LLM 模型'); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      await api.aiConfigs.batchModel({ modelConfigId, types, isActive: true });
      await loadData();
      const sm = adminModelConfigs.find((m) => m.id === modelConfigId);
      setNotice(`${label} 已切换到 ${modelDisplayName(sm)}`);
    } catch (err) { setError((err as Error).message || '批量应用模型失败'); } finally { setSaving(false); }
  };

  const handleCreateDefaultSkill = async () => { setSkillSaving(true); setError(null); try { await api.scoringSkills.create({ createDefault: true }); const r = await api.scoringSkills.list(); setScoringSkills(r.data || []); setScoringSkillHealth(r.health || null); setNotice('三个默认评分 Skills 已创建'); } catch (err) { setError((err as Error).message || '创建默认评分技能失败'); } finally { setSkillSaving(false); } };
  const handleCreateSkill = async () => { setSkillSaving(true); setError(null); try { await api.scoringSkills.create({ name: '新的评分技能', status: 'draft', weight: 1 }); const r = await api.scoringSkills.list(); setScoringSkills(r.data || []); setScoringSkillHealth(r.health || null); setNotice('已新增评分技能草稿'); } catch (err) { setError((err as Error).message || '创建评分技能失败'); } finally { setSkillSaving(false); } };
  const handleToggleSkill = async (id: number) => { setSkillSaving(true); setError(null); try { await api.scoringSkills.toggle(id); const r = await api.scoringSkills.list(); setScoringSkills(r.data || []); setScoringSkillHealth(r.health || null); setNotice('评分技能状态已更新'); } catch (err) { setError((err as Error).message || '更新评分技能失败'); } finally { setSkillSaving(false); } };
  const handleSaveSkill = async (skill: ScoringSkillRecord, patch: Partial<ScoringSkillRecord>) => { setSkillSaving(true); setError(null); try { await api.scoringSkills.update(skill.id, patch); const r = await api.scoringSkills.list(); setScoringSkills(r.data || []); setScoringSkillHealth(r.health || null); setNotice(`已保存技能：${patch.name || skill.name}`); } catch (err) { setError((err as Error).message || '保存评分技能失败'); } finally { setSkillSaving(false); } };
  const handleDeleteSkill = async (id: number) => { setSkillSaving(true); setError(null); try { await api.scoringSkills.delete(id); const r = await api.scoringSkills.list(); setScoringSkills(r.data || []); setScoringSkillHealth(r.health || null); setNotice('评分技能已删除'); } catch (err) { setError((err as Error).message || '删除评分技能失败'); } finally { setSkillSaving(false); } };
  const handleRebuildProfile = async () => { setProfileRebuilding(true); setError(null); try { const r = await api.preferences.rebuildProfile(); setPreferenceProfile(r.data || null); setPreferenceSummary(r.summary || null); setNotice('偏好画像已更新'); } catch (err) { setError((err as Error).message || '重建偏好画像失败'); } finally { setProfileRebuilding(false); } };

  const probeRecommendedScoringModel = async () => { const mid = scoringSkillHealth?.remediation?.recommendedModelConfigId || ''; if (!isAdmin || !mid) return; setScoringProbeLoading(true); setError(null); try { const r = await api.scoringSkills.probeModel({ modelConfigId: mid, limit: 2 }); setScoringModelProbe(r.data); setNotice(r.data.message); } catch (err) { setError((err as Error).message || '验证备用评分模型失败'); } finally { setScoringProbeLoading(false); } };
  const applyRecommendedScoringModelAndRepair = async () => { const mid = scoringSkillHealth?.remediation?.recommendedModelConfigId || ''; if (!isAdmin || !mid || scoringModelProbe?.canSwitch !== true) return; setSaving(true); setError(null); try { const r = await api.scoringSkills.applyModelRemediation({ modelConfigId: mid, limit: 2 }); await loadData(); setScoringModelRepair(r.data); setNotice(r.data.repair.message); } catch (err) { setError((err as Error).message || '切换并修复评分失败项失败'); } finally { setSaving(false); } };
  const recoverFallbackScoringItems = async () => { setSaving(true); setError(null); try { const r = await api.scoringSkills.recoverFallbackScoring({ limit: 5 }); await loadData(); setFallbackScoringRecovery(r.data); setNotice(r.data.message); } catch (err) { setError((err as Error).message || '回收历史兜底评分失败'); } finally { setSaving(false); } };

  // Prompt/Model CRUD
  const editPromptTemplate = (t: AdminPromptTemplate) => { const vars = Array.isArray(t.variables) ? t.variables.join(',') : Object.keys((t.variables as Record<string, unknown>) || {}).join(','); setPromptForm({ id: t.id, name: t.name || '', description: t.description || '', category: t.category || 'feed_summary', template_text: t.template_text || '', variables: vars }); };
  const resetPromptForm = () => { setPromptForm({ id: '', name: '', description: '', category: 'feed_summary', template_text: '', variables: 'title,content' }); setPromptPreview(''); };
  const savePromptTemplate = async () => { if (!isAdmin) return; try { const p = { name: promptForm.name, description: promptForm.description || undefined, category: promptForm.category, template_text: promptForm.template_text, variables: promptForm.variables.split(',').map((i) => i.trim()).filter(Boolean) }; if (promptForm.id) { await api.admin.updatePromptTemplate(promptForm.id, p); } else { await api.admin.createPromptTemplate(p); } await loadData(); resetPromptForm(); setNotice('提示词模板已保存'); } catch (err) { setError((err as Error).message || '提示词模板保存失败'); } };
  const previewPromptTemplate = async (id: string) => { try { const r = await api.admin.previewPromptTemplate(id); setPromptPreview(r.rendered || ''); setNotice(`已预览模板：${r.template_name}`); } catch (err) { setError((err as Error).message || '模板预览失败'); } };
  const deletePromptTemplate = async (t: AdminPromptTemplate) => { if (!window.confirm(`确认删除模板"${t.name}"？`)) return; try { await api.admin.deletePromptTemplate(t.id); await loadData(); if (promptForm.id === t.id) resetPromptForm(); setNotice('提示词模板已删除'); } catch (err) { setError((err as Error).message || '模板删除失败'); } };

  // 仍未接线到 JSX 的预备状态与处理函数（保留以便后续恢复对应面板）
  void [baseLoading, aiConfigMeta, fallbackScoringRecovery, preferenceProfile, preferenceSummary, profileRebuilding, taskTemplates, taskModels, promptPreview, handleRebuildProfile, recoverFallbackScoringItems, editPromptTemplate, savePromptTemplate, previewPromptTemplate, deletePromptTemplate];

  const editModelConfig = (m: AdminModelConfig) => { const np = normalizeProvider(m.provider); const eid = isVolcengineArk(np) ? String(m.extra_config?.endpointId || m.model_name || '') : (m.model_name || ''); setModelForm({ id: m.id, alias: m.alias || '', provider: np, model_name: eid, model_type: m.model_type || 'llm', api_key: '', base_url: baseUrlForProvider(np, m.base_url || ''), extra_config: (m.extra_config as Record<string, unknown> | null) || null, is_default: Boolean(m.is_default), is_active: m.is_active ?? true }); };
  const resetModelForm = () => { setModelForm({ id: '', alias: '', provider: DEFAULT_LLM_PROVIDER, model_name: DEFAULT_LLM_ENDPOINT_ID, model_type: 'llm', api_key: '', base_url: DEFAULT_LLM_BASE_URL, extra_config: null, is_default: false, is_active: true }); };
  const saveModelConfig = async () => { if (!isAdmin) return; try { const p = normalizeProvider(modelForm.provider); if (isVolcengineArk(p) && !String(modelForm.model_name || '').trim().startsWith('ep-')) { setError('Volcengine Ark 必须填写 endpoint id（ep-...）'); return; } if (p === DEEPSEEK_PROVIDER && modelForm.model_name !== DEEPSEEK_TRANSLATION_MODEL) { setError(`DeepSeek 官方接入当前必须使用 ${DEEPSEEK_TRANSLATION_MODEL}`); return; } const payload = { alias: modelForm.alias || undefined, provider: p, model_name: modelForm.model_name, model_type: modelForm.model_type, api_key: modelForm.api_key || undefined, base_url: baseUrlForProvider(p, modelForm.base_url || undefined) || undefined, extra_config: isVolcengineArk(p) ? { ...(modelForm.extra_config || {}), accessMode: 'endpoint', endpointId: modelForm.model_name } : modelForm.extra_config || undefined, is_default: modelForm.is_default, is_active: modelForm.is_active }; if (modelForm.id) { await api.admin.updateModelConfig(modelForm.id, payload); } else { await api.admin.createModelConfig(payload); } await loadData(); resetModelForm(); setNotice('模型配置已保存'); } catch (err) { setError((err as Error).message || '模型配置保存失败'); } };
  const testModelConfig = async (id: string) => { try { await api.admin.testModelConfig(id); await loadData(); setNotice('模型连通测试已执行'); } catch (err) { setError((err as Error).message || '模型测试失败'); } };
  const deleteModelConfig = async (m: AdminModelConfig) => { if (!window.confirm(`确认删除模型"${modelDisplayName(m)}"？`)) return; try { await api.admin.deleteModelConfig(m.id); await loadData(); if (modelForm.id === m.id) resetModelForm(); setNotice('模型配置已删除'); } catch (err) { setError((err as Error).message || '模型删除失败'); } };

  const renderAiConfigCard = (type: AiConfigType, title: string) => {
    const form = aiForms[type];
    const selectedModel = adminModelConfigs.find((m) => m.id === form.modelConfigId);
    const selectedPrompt = adminPromptTemplates.find((t) => t.id === form.promptTemplateId);
    const sceneStatus = !form.isActive ? { label: '场景停用', className: 'bg-zinc-100 text-zinc-600' } : !selectedModel ? { label: '未绑定模型', className: 'bg-amber-100 text-amber-700' } : selectedModel.test_status === 'failed' ? { label: '模型测试失败', className: 'bg-red-100 text-red-700' } : !selectedModel.has_api_key ? { label: '缺少密钥', className: 'bg-amber-100 text-amber-700' } : { label: '已可用', className: 'bg-emerald-100 text-emerald-700' };
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-800">{title}</h3>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${sceneStatus.className}`}>{sceneStatus.label}</span>
            <label className="text-xs text-zinc-600 inline-flex items-center gap-1"><input type="checkbox" checked={form.isActive} disabled={!isAdmin} onChange={(e) => setAiForms((prev) => ({ ...prev, [type]: { ...prev[type], isActive: e.target.checked } }))} />启用</label>
          </div>
        </div>
        <input aria-label={`${title} 场景名称`} value={form.name} disabled={!isAdmin} onChange={(e) => setAiForms((prev) => ({ ...prev, [type]: { ...prev[type], name: e.target.value } }))} placeholder="场景名称" className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <select aria-label={`${title} 绑定模型`} value={form.modelConfigId || ''} disabled={!isAdmin} onChange={(e) => setAiForms((prev) => { const n = adminModelConfigs.find((m) => m.id === e.target.value); return { ...prev, [type]: { ...prev[type], modelConfigId: e.target.value || undefined, provider: n?.provider || prev[type].provider, model: n?.model_name || prev[type].model, baseUrl: n?.base_url || prev[type].baseUrl } }; })} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg">
            <option value="">选择模型</option>
            {modelConfigsWithUsage.filter((m) => m.model_type === 'llm' || m.model_type === 'multimodal').map((m) => (<option key={m.id} value={m.id}>{modelDisplayName(m)} · {providerLabel(m.provider)}</option>))}
          </select>
          <select aria-label={`${title} 提示词模板`} value={form.promptTemplateId || ''} disabled={!isAdmin} onChange={(e) => setAiForms((prev) => { const n = adminPromptTemplates.find((t) => t.id === e.target.value); return { ...prev, [type]: { ...prev[type], promptTemplateId: e.target.value || undefined, promptTemplate: n?.template_text || prev[type].promptTemplate } }; })} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg">
            <option value="">选择提示词模板</option>
            {adminPromptTemplates.map((t) => (<option key={t.id} value={t.id}>{t.name} · {t.category}</option>))}
          </select>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          生效模型：{modelDisplayName(selectedModel) || form.model || '未绑定'} · 生效模板：{selectedPrompt?.name || '未绑定'}
        </div>
        <button onClick={() => void saveAiConfig(type)} disabled={saving || !isAdmin} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          {isAdmin ? `保存 ${title}` : '仅管理员可编辑'}
        </button>
      </div>
    );
  };

  if (loading) {
    return <div className="py-10 text-sm text-zinc-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />加载中...</div>;
  }

  // Due to the extreme length of this component's JSX (>1000 lines in the original),
  // only the tab navigation and scenes/models sub-tabs are fully rendered here.
  // The skills and logs sub-tabs follow the same patterns.
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>{sectionTitle('AI 管理中心', '场景控制台、模型仓库、评分 Skills 和使用日志。')}</div>
          <div className="flex flex-wrap gap-2">
            {AI_CENTER_TABS.map((tab) => (
              <button key={tab.key} onClick={() => setActiveAiCenterTab(tab.key)} className={`min-h-9 rounded-full border px-3 py-2 text-xs transition-colors ${activeAiCenterTab === tab.key ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}>{tab.label}</button>
            ))}
          </div>
        </div>
      </div>

      {isAdmin && <><a className="inline-block text-sm text-teal-700 underline" href="/jev">打开 Jev 判断工作台</a><JevPanel management /></>}
      {activeAiCenterTab === 'scenes' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            {sectionTitle('场景总览', '按场景看启用状态、绑定模型和当前健康度。')}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {aiFunctionCards.map((card) => (
                <div key={card.sceneKey} className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                  <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium text-zinc-800">{card.title}</h3><span className={`rounded-full px-1.5 py-0.5 text-[10px] ${card.status.className}`}>{card.status.label}</span></div>
                  <div className="mt-2 text-xs text-zinc-500">模型：{modelDisplayName(card.model)}</div>
                  {card.model && <div className="mt-1 text-xs text-zinc-500">目标：{modelTarget(card.model)}</div>}
                  <div className="mt-1 text-xs text-zinc-500">模板：{card.prompt?.name || '内联模板 / 未绑定'}</div>
                  {card.model && <div className="mt-1 text-xs text-zinc-500">Provider：{providerLabel(card.model.provider)} · 测试 {card.model.test_status || 'untested'}</div>}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            {sectionTitle('场景控制台', '把阅读链路与日报多智能体链路统一绑定到模型和提示词模板。')}
            <div className="space-y-4">
              {isAdmin && (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3">
                  <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 lg:items-center">
                    <select aria-label="批量应用模型" value={bulkModelConfigId || defaultLlmModel?.id || ''} onChange={(e) => setBulkModelConfigId(e.target.value)} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg bg-white">
                      <option value="">选择要批量应用的模型</option>
                      {modelConfigsWithUsage.filter((m) => m.model_type === 'llm' || m.model_type === 'multimodal').map((m) => (<option key={m.id} value={m.id}>{modelDisplayName(m)} · {providerLabel(m.provider)}</option>))}
                    </select>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => void applyModelToScenes(ALL_BATCH_SCENE_TYPES, '全部阅读和日报场景')} disabled={saving} className="px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white disabled:opacity-50">应用到全部场景</button>
                      <button onClick={() => void applyModelToScenes(READING_SCENE_TYPES, '阅读链路')} disabled={saving} className="px-3 py-2 text-sm rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 disabled:opacity-50">只应用到阅读</button>
                      <button onClick={() => void applyModelToScenes(DAILY_REPORT_SCENE_TYPES, '日报链路')} disabled={saving} className="px-3 py-2 text-sm rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 disabled:opacity-50">只应用到日报</button>
                    </div>
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
        </div>
      )}

      {activeAiCenterTab === 'models' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-zinc-200 bg-white p-4"><div className="text-2xl font-bold text-zinc-900">{adminModelConfigs.length}</div><div className="mt-1 text-xs text-zinc-500">注册模型</div></div>
            <div className="rounded-xl border border-zinc-200 bg-white p-4"><div className="text-2xl font-bold text-zinc-900">{adminModelConfigs.filter((m) => m.is_active).length}</div><div className="mt-1 text-xs text-zinc-500">启用模型</div></div>
            <div className="rounded-xl border border-zinc-200 bg-white p-4"><div className="text-2xl font-bold text-zinc-900">{adminModelConfigs.filter((m) => !m.has_api_key).length}</div><div className="mt-1 text-xs text-zinc-500">待补密钥</div></div>
            <div className="rounded-xl border border-zinc-200 bg-white p-4"><div className="text-2xl font-bold text-zinc-900">{adminPromptTemplates.length}</div><div className="mt-1 text-xs text-zinc-500">提示词模板</div></div>
          </div>
          {!isAdmin ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">仅管理员可以新增模型、维护 API Key 与 Base URL。</div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-4">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-4">
                {sectionTitle('模型仓库', '统一管理模型别名、接入方式、Key、Base URL。')}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input value={modelForm.alias} onChange={(e) => setModelForm((p) => ({ ...p, alias: e.target.value }))} placeholder="模型别名" className="px-3 py-2 text-sm border border-zinc-200 rounded-lg md:col-span-2" />
                  <select aria-label="模型 Provider" value={modelForm.provider} onChange={(e) => setModelForm((p) => ({ ...p, provider: e.target.value, model_name: e.target.value === DEEPSEEK_PROVIDER ? DEEPSEEK_TRANSLATION_MODEL : p.model_name, base_url: baseUrlForProvider(e.target.value, p.base_url) }))} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg">
                    <option value={VOLCENGINE_ARK_PROVIDER}>Volcengine Ark</option><option value={DEEPSEEK_PROVIDER}>DeepSeek 官方 API</option><option value="openai_compatible">OpenAI-compatible</option><option value="openai">OpenAI</option>
                  </select>
                  <input aria-label="模型名称或 Endpoint ID" value={modelForm.model_name} onChange={(e) => setModelForm((p) => ({ ...p, model_name: e.target.value }))} placeholder={isVolcengineArk(modelForm.provider) ? 'Endpoint ID (ep-...)' : 'model_name'} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg" />
                  <select aria-label="模型类型" value={modelForm.model_type} onChange={(e) => setModelForm((p) => ({ ...p, model_type: e.target.value }))} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"><option value="llm">llm</option><option value="asr">asr</option><option value="multimodal">multimodal</option></select>
                  <input aria-label="模型 API Key" value={modelForm.api_key} onChange={(e) => setModelForm((p) => ({ ...p, api_key: e.target.value }))} placeholder="API Key（更新留空不改）" className="px-3 py-2 text-sm border border-zinc-200 rounded-lg" />
                  <input aria-label="模型 Base URL" value={modelForm.base_url} onChange={(e) => setModelForm((p) => ({ ...p, base_url: e.target.value }))} placeholder="Base URL" className="px-3 py-2 text-sm border border-zinc-200 rounded-lg md:col-span-2" />
                </div>
                <div className="flex items-center gap-4 text-xs text-zinc-600">
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={modelForm.is_default} onChange={(e) => setModelForm((p) => ({ ...p, is_default: e.target.checked }))} />默认模型</label>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={modelForm.is_active} onChange={(e) => setModelForm((p) => ({ ...p, is_active: e.target.checked }))} />启用</label>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => void saveModelConfig()} className="px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white">保存模型</button>
                  <button onClick={resetModelForm} className="px-3 py-2 text-sm rounded-lg border border-zinc-200 hover:bg-zinc-50">清空</button>
                </div>
                <div className="space-y-2 max-h-[360px] overflow-y-auto">
                  {modelConfigsWithUsage.map((m) => (
                    <div key={m.id} className="rounded-lg border border-zinc-100 px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div><div className="font-medium text-zinc-800">{modelDisplayName(m)}</div><div className="text-zinc-500">{providerLabel(m.provider)} · {m.model_type} · 目标 {modelTarget(m)}</div></div>
                        <div className="flex items-center gap-1.5"><span className={`px-1.5 py-0.5 rounded-full ${m.has_api_key ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{m.has_api_key ? 'Key 已配置' : 'Key 待配置'}</span><span className={`px-1.5 py-0.5 rounded-full ${m.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>{m.test_status || 'untested'}</span></div>
                      </div>
                      {m.usageScenes && m.usageScenes.length > 0 && <div className="mt-1 text-zinc-400">使用场景：{m.usageScenes.join('、')}</div>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button onClick={() => editModelConfig(m)} className="rounded-lg border border-zinc-200 px-3 py-2 text-xs hover:bg-zinc-50">编辑</button>
                        <button onClick={() => void testModelConfig(m.id)} className="rounded-lg border border-zinc-200 px-3 py-2 text-xs hover:bg-zinc-50">测试</button>
                        <button onClick={() => void deleteModelConfig(m)} className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-700 hover:bg-red-50">删除</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                {sectionTitle('模型分布', '按能力类型看当前模型库存。')}
                <div className="grid grid-cols-1 gap-3">
                  {(['llm', 'asr', 'multimodal'] as const).map((group) => (
                    <div key={group} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3">
                      <div className="flex items-center justify-between"><span className="text-sm font-medium text-zinc-800">{group.toUpperCase()}</span><span className="text-xs text-zinc-500">{groupedModelConfigs[group].length} 个</span></div>
                      <div className="mt-2 flex flex-wrap gap-1.5">{groupedModelConfigs[group].length === 0 ? <span className="text-xs text-zinc-400">暂无</span> : groupedModelConfigs[group].map((m) => (<span key={m.id} className="rounded-full border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-600">{modelDisplayName(m)}</span>))}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeAiCenterTab === 'skills' && (
        <div className="space-y-4">
          {/* 评分链路健康与一键修复。后端一直在算这份诊断，但此前没有任何 UI 展示它，
              导致评分模型熔断后无人知晓——分数被压在基础路径上限，日报因此长期缺少高分素材。 */}
          {scoringSkillHealth && scoringSkillHealth.status !== 'healthy' && (
            <div className={`rounded-xl border p-4 ${scoringSkillHealth.status === 'error' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${scoringSkillHealth.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                  评分链路{scoringSkillHealth.status === 'error' ? '异常' : '告警'}
                </span>
                <span className="text-xs text-zinc-600">
                  活跃 {scoringSkillHealth.activeSkillCount}/{scoringSkillHealth.totalSkillCount} · 近期错误 {scoringSkillHealth.recentErrorCount} · 不稳定模型 {scoringSkillHealth.unstableModelCount}
                </span>
              </div>
              {scoringSkillHealth.remediation?.message && (
                <p className="mt-2 text-sm leading-6 text-zinc-800">{scoringSkillHealth.remediation.message}</p>
              )}
              {scoringSkillHealth.remediation?.recommendedModelConfigId && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => void probeRecommendedScoringModel()}
                    disabled={!isAdmin || scoringProbeLoading}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {scoringProbeLoading ? '验证中...' : '验证备用模型'}
                  </button>
                  <button
                    onClick={() => void applyRecommendedScoringModelAndRepair()}
                    disabled={!isAdmin || saving || scoringModelProbe?.canSwitch !== true}
                    title={scoringModelProbe?.canSwitch !== true ? '请先验证备用模型可用' : undefined}
                    className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {saving ? '处理中...' : '切换并修复失败条目'}
                  </button>
                  {scoringModelProbe && (
                    <span className={`text-xs ${scoringModelProbe.canSwitch ? 'text-emerald-700' : 'text-red-700'}`}>
                      {scoringModelProbe.canSwitch ? '备用模型可用' : '备用模型验证未通过'}
                    </span>
                  )}
                  {scoringModelRepair?.repair?.message && (
                    <span className="text-xs text-emerald-700">{scoringModelRepair.repair.message}</span>
                  )}
                </div>
              )}
              {scoringSkillHealth.activeSkills?.some((s) => !s.modelConfigId) && (
                <p className="mt-2 text-xs text-zinc-600">
                  有 Skill 未绑定模型，评分会退回基础路径（分数上限偏低）：
                  {scoringSkillHealth.activeSkills.filter((s) => !s.modelConfigId).map((s) => s.name).join('、')}
                </p>
              )}
            </div>
          )}
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            {sectionTitle('评分 Skills', '每个 Skill 是一种精选视角。')}
            {scoringSkills.length > 0 && (
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-xs text-zinc-500">Feed 详情里的评分拆解会和这里的技能一一对应。</div>
                <button onClick={() => void handleCreateSkill()} disabled={skillSaving} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">{skillSaving ? '处理中...' : '新增评分技能'}</button>
              </div>
            )}
            {scoringSkills.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-5">
                <p className="text-sm text-zinc-600">当前还没有个人评分技能。</p>
                <button onClick={() => void handleCreateDefaultSkill()} disabled={skillSaving} className="mt-3 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50">{skillSaving ? '创建中...' : '创建默认 3 Skills'}</button>
              </div>
            ) : (
              <div className="space-y-3">
                {scoringSkills.map((skill) => (
                  <div key={skill.id} className="rounded-xl border border-zinc-100 bg-zinc-50 p-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-zinc-900">{skill.name}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] ${skill.status === 'active' ? 'bg-emerald-100 text-emerald-700' : skill.status === 'archived' ? 'bg-zinc-200 text-zinc-600' : 'bg-amber-100 text-amber-700'}`}>{skill.status === 'active' ? '已启用' : skill.status === 'archived' ? '已归档' : '草稿'}</span>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">权重 {skill.weight}</span>
                        </div>
                        <input value={skill.name} onChange={(e) => setScoringSkills((prev) => prev.map((s) => s.id === skill.id ? { ...s, name: e.target.value } : s))} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm" />
                        <textarea value={skill.instructionPrompt} onChange={(e) => setScoringSkills((prev) => prev.map((s) => s.id === skill.id ? { ...s, instructionPrompt: e.target.value } : s))} rows={4} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-mono leading-relaxed" />
                      </div>
                      <div className="w-full xl:w-44 space-y-2">
                        <input aria-label={`评分技能 ${skill.name} 权重`} type="number" min={0.1} max={5} step={0.1} value={skill.weight} onChange={(e) => setScoringSkills((prev) => prev.map((s) => s.id === skill.id ? { ...s, weight: Number(e.target.value || 1) } : s))} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm" />
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => void handleToggleSkill(skill.id)} disabled={skillSaving} className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-700 hover:bg-white disabled:opacity-50">{skill.status === 'active' ? '停用' : '启用'}</button>
                          <button onClick={() => void handleSaveSkill(skill, skill)} disabled={skillSaving} className="flex-1 rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white disabled:opacity-50">保存</button>
                        </div>
                        {!skill.isDefault && <button onClick={() => void handleDeleteSkill(skill.id)} disabled={skillSaving} className="w-full rounded-lg border border-rose-200 px-3 py-2 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50">删除</button>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeAiCenterTab === 'logs' && (
        !isAdmin ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">仅管理员可以查看 AI 使用日志。</div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="日志时间窗口" value={aiUsageTimeWindow} onChange={(e) => setAiUsageTimeWindow(e.target.value as '24h' | '7d' | '30d')} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"><option value="24h">最近 24 小时</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option></select>
              <select aria-label="日志聚合粒度" value={aiUsageInterval} onChange={(e) => setAiUsageInterval(e.target.value as 'hour' | 'day')} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"><option value="hour">按小时</option><option value="day">按天</option></select>
              <button onClick={() => void refreshAiUsage()} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg hover:bg-zinc-50">刷新趋势</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-xl border border-zinc-200 bg-white p-4"><div className="text-2xl font-bold text-zinc-900">{combinedAiUsageSummary.totalCalls}</div><div className="mt-1 text-xs text-zinc-500">总调用次数</div></div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4"><div className="text-2xl font-bold text-zinc-900">{formatCost(combinedAiUsageSummary.totalEstimatedCost)}</div><div className="mt-1 text-xs text-zinc-500">估算总成本</div></div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4"><div className="text-2xl font-bold text-zinc-900">{combinedAiUsageSummary.totalInputTokens.toLocaleString()}</div><div className="mt-1 text-xs text-zinc-500">输入 Tokens</div></div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4"><div className="text-2xl font-bold text-zinc-900">{combinedAiUsageSummary.totalOutputTokens.toLocaleString()}</div><div className="mt-1 text-xs text-zinc-500">输出 Tokens</div></div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4"><div className="text-2xl font-bold text-zinc-900">{aiUsageSuccessRate}</div><div className="mt-1 text-xs text-zinc-500">成功率</div><div className="mt-1 text-[11px] text-zinc-400">均延迟 {aiUsageAvgLatency ?? '—'} ms</div></div>
            </div>
            {aiUsageLoading ? <div className="py-10 text-sm text-zinc-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />正在加载日志...</div> : (
              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                {sectionTitle('最近使用日志')}
                <div className="mb-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
                  <select aria-label="日志来源" value={aiUsageSourceFilter} onChange={(e) => setAiUsageSourceFilter(e.target.value as 'all' | 'hub' | 'audio')} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"><option value="all">全部来源</option><option value="hub">Hub</option><option value="audio">Audio</option></select>
                  <select aria-label="日志状态" value={aiUsageStatusFilter} onChange={(e) => setAiUsageStatusFilter(e.target.value)} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"><option value="">全部状态</option><option value="success">success</option><option value="error">error</option></select>
                  <select aria-label="日志场景" value={aiUsageSceneFilter} onChange={(e) => setAiUsageSceneFilter(e.target.value)} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"><option value="">全部场景</option>{aiUsageSceneOptions.map((s) => <option key={s} value={s}>{sceneLabel(s)}</option>)}</select>
                  <select aria-label="日志 Provider" value={aiUsageProviderFilter} onChange={(e) => setAiUsageProviderFilter(e.target.value)} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg"><option value="">全部 Provider</option>{aiUsageProviderOptions.map((p) => <option key={p} value={p}>{providerLabel(p)}</option>)}</select>
                  <div className="flex gap-2"><input aria-label="搜索使用日志" value={aiUsageSearch} onChange={(e) => setAiUsageSearch(e.target.value)} placeholder="搜索" className="flex-1 px-3 py-2 text-sm border border-zinc-200 rounded-lg" /><button onClick={() => void refreshAiUsage()} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg hover:bg-zinc-50">刷新</button></div>
                </div>
                {filteredAiUsageEvents.length === 0 ? <div className="py-10 text-sm text-zinc-400">暂无日志</div> : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead><tr className="text-left text-zinc-500 border-b border-zinc-100"><th className="py-2 pr-3 font-medium">时间</th><th className="py-2 pr-3 font-medium">场景</th><th className="py-2 pr-3 font-medium">Provider</th><th className="py-2 pr-3 font-medium">消耗</th><th className="py-2 font-medium">状态</th></tr></thead>
                      <tbody>
                        {filteredAiUsageEvents.slice(0, 50).map((ev) => (
                          <tr key={`${ev.sceneType}-${ev.id}`} className="border-b border-zinc-50 align-top">
                            <td className="py-2 pr-3 text-zinc-500 whitespace-nowrap">{new Date(ev.createdAt).toLocaleString('zh-CN')}</td>
                            <td className="py-2 pr-3"><div className="font-medium text-zinc-800">{sceneLabel(ev.sceneType)}</div><div className="text-zinc-400">{ev.source || '-'}</div></td>
                            <td className="py-2 pr-3 text-zinc-600"><div>{providerLabel(ev.provider)}</div><div className="text-zinc-400">{ev.endpointId || ev.modelName || '-'}</div></td>
                            <td className="py-2 pr-3 text-zinc-500"><div>{formatCost(ev.estimatedCost || 0)}</div><div className="text-zinc-400">耗时 {ev.latencyMs ?? '-'} ms</div></td>
                            <td className="py-2"><span className={`rounded-full px-2 py-0.5 ${ev.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{ev.status}</span>{ev.errorMessage && <div className="mt-1 max-w-[240px] text-zinc-400">{ev.errorMessage}</div>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
