import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, type AiConfig, type AiConfigMeta, type AdminModelConfig, type AdminPromptTemplate, type PreferenceProfileRecord, type PreferenceProfileSummary } from '../../../lib/api';
import { useSettings } from '../SettingsContext';
import { normalizeAiForm, sectionTitle, type AiConfigType, type AiForm } from '../shared';

export function ReadingTab() {
  const { isAdmin, setError } = useSettings();
  const [loading, setLoading] = useState(true);
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
  const [aiConfigMeta, setAiConfigMeta] = useState<AiConfigMeta | null>(null);
  const [adminModelConfigs, setAdminModelConfigs] = useState<AdminModelConfig[]>([]);
  const [adminPromptTemplates, setAdminPromptTemplates] = useState<AdminPromptTemplate[]>([]);
  const [preferenceProfile, setPreferenceProfile] = useState<PreferenceProfileRecord | null>(null);
  const [preferenceSummary, setPreferenceSummary] = useState<PreferenceProfileSummary | null>(null);
  const [profileRebuilding, setProfileRebuilding] = useState(false);
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

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [aiResp, modelResp, promptResp, profileResp] = await Promise.all([
        api.aiConfigs.list(),
        isAdmin ? api.admin.listModelConfigs().catch(() => []) : Promise.resolve([]),
        isAdmin ? api.admin.listPromptTemplates().catch(() => []) : Promise.resolve([]),
        api.preferences.profile().catch(() => ({ data: null as PreferenceProfileRecord | null, summary: null as PreferenceProfileSummary | null })),
      ]);
      setAiConfigs(aiResp.data || []);
      setAiConfigMeta(aiResp.meta || null);
      setAdminModelConfigs(modelResp || []);
      setAdminPromptTemplates(promptResp || []);
      setPreferenceProfile(profileResp.data || null);
      setPreferenceSummary(profileResp.summary || null);
    } catch (err) {
      setError((err as Error).message || '加载阅读 AI 数据失败');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, setError]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    const configByType = new Map<AiConfigType, AiConfig>();
    for (const cfg of aiConfigs) {
      if (['quality_filter', 'scoring', 'summary', 'translation', 'daily_report', 'daily_report_cleaning', 'daily_report_decision', 'daily_report_research', 'daily_report_reading', 'daily_report_final'].includes(cfg.type)) {
        configByType.set(cfg.type as AiConfigType, cfg);
      }
    }
    const defaultModel = adminModelConfigs.find((m) => m.model_type === 'llm' && m.is_default) || adminModelConfigs.find((m) => m.model_type === 'llm') || null;
    const defaultModelId = defaultModel?.id;
    const pByType = {
      quality_filter: adminPromptTemplates.find((t) => t.category === 'quality_filter') || null,
      scoring: adminPromptTemplates.find((t) => t.category === 'feed_scoring') || null,
      summary: adminPromptTemplates.find((t) => t.category === 'feed_summary') || null,
      translation: adminPromptTemplates.find((t) => t.category === 'feed_translation') || null,
    };
    setAiForms({
      quality_filter: normalizeAiForm('quality_filter', configByType.get('quality_filter'), defaultModelId, pByType.quality_filter?.id),
      scoring: normalizeAiForm('scoring', configByType.get('scoring'), defaultModelId, pByType.scoring?.id),
      summary: normalizeAiForm('summary', configByType.get('summary'), defaultModelId, pByType.summary?.id),
      translation: normalizeAiForm('translation', configByType.get('translation'), defaultModelId, pByType.translation?.id),
      daily_report: normalizeAiForm('daily_report', configByType.get('daily_report'), defaultModelId),
      daily_report_cleaning: normalizeAiForm('daily_report_cleaning', configByType.get('daily_report_cleaning') || configByType.get('daily_report'), defaultModelId),
      daily_report_decision: normalizeAiForm('daily_report_decision', configByType.get('daily_report_decision') || configByType.get('daily_report'), defaultModelId),
      daily_report_research: normalizeAiForm('daily_report_research', configByType.get('daily_report_research') || configByType.get('daily_report'), defaultModelId),
      daily_report_reading: normalizeAiForm('daily_report_reading', configByType.get('daily_report_reading') || configByType.get('daily_report'), defaultModelId),
      daily_report_final: normalizeAiForm('daily_report_final', configByType.get('daily_report_final') || configByType.get('daily_report'), defaultModelId),
    });
  }, [aiConfigs, adminModelConfigs, adminPromptTemplates]);

  const handleRebuildProfile = async () => {
    setProfileRebuilding(true);
    setError(null);
    try {
      const resp = await api.preferences.rebuildProfile();
      setPreferenceProfile(resp.data || null);
      setPreferenceSummary(resp.summary || null);
    } catch (err) {
      setError((err as Error).message || '重建偏好画像失败');
    } finally {
      setProfileRebuilding(false);
    }
  };

  if (loading) {
    return <div className="py-10 text-sm text-zinc-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />加载中...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        {sectionTitle('阅读 AI 当前状态', '阅读评分、摘要、翻译现在都走管理员统一配置；普通用户只查看生效状态。')}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(['quality_filter', 'scoring', 'summary', 'translation'] as Array<AiConfigType>).map((type) => {
            const titles: Record<string, string> = { quality_filter: '阅读质检', scoring: '阅读评分', summary: '阅读摘要', translation: '阅读翻译' };
            const cfg = aiForms[type];
            return (
              <div key={type} className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-zinc-800">{titles[type]}</h3>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cfg.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-200 text-zinc-600'}`}>
                    {cfg.isActive ? '已启用' : '未启用'}
                  </span>
                </div>
                <div className="mt-2 text-xs text-zinc-500">场景名：{cfg.name || '未命名'}</div>
                <div className="mt-1 text-xs text-zinc-500">模型：{cfg.modelLabel || adminModelConfigs.find((m) => m.id === cfg.modelConfigId)?.model_name || cfg.model || '未绑定'}</div>
                <div className="mt-1 text-xs text-zinc-500">模板：{cfg.promptTemplateName || adminPromptTemplates.find((t) => t.id === cfg.promptTemplateId)?.name || '未绑定'}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-700">
          阅读翻译不是假的。后端真实执行链路是 <code className="rounded bg-sky-100 px-1">scoring → summary → translation</code>，当前只是把配置入口统一收敛到了"AI 管理中心"。
        </div>
        {aiConfigMeta && (
          <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            当前配置来源：<span className="font-medium text-zinc-800"> {aiConfigMeta.ownerLabel || '未解析'}</span>
            <span className="mx-1 text-zinc-300">·</span>作用域 <span className="font-medium text-zinc-800">{aiConfigMeta.scope}</span>
            <span className="mx-1 text-zinc-300">·</span>解析方式 <span className="font-medium text-zinc-800">{aiConfigMeta.resolvedFrom}</span>
            {aiConfigMeta.availableScenes && aiConfigMeta.availableScenes.length > 0 && (<><span className="mx-1 text-zinc-300">·</span>已启用场景 {aiConfigMeta.availableScenes.join(', ')}</>)}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        {sectionTitle('偏好画像', '从显式反馈中提炼你真正喜欢与想减少看到的资讯信号。')}
        <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4 space-y-3">
          <div className="text-sm text-zinc-700">{preferenceProfile?.profileSummary || '当前还没有偏好画像，先在 Feed 里点击"更想看 / 少给我看"积累反馈。'}</div>
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
          <button onClick={() => void handleRebuildProfile()} disabled={profileRebuilding} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-white disabled:opacity-50">
            {profileRebuilding ? '更新中...' : '手动重建偏好画像'}
          </button>
        </div>
      </div>
    </div>
  );
}
