import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, type UserQuota, type AudioQuotaSnapshot } from '../../../lib/api';
import { useSettings } from '../SettingsContext';
import { sectionTitle } from '../shared';

export function QuotaTab() {
  const { setError, setNotice } = useSettings();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hubQuota, setHubQuota] = useState<UserQuota | null>(null);
  const [audioQuota, setAudioQuota] = useState<AudioQuotaSnapshot | null>(null);
  const [plans, setPlans] = useState<Array<{ id: number; name: string; audioMinutesPerMonth: number; articlesPerDay: number; isPublic: boolean }>>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [quotaResp, audioQuotaResp, planResp] = await Promise.all([
        api.quota.me(),
        api.audio.getMyQuota().catch(() => null),
        api.quota.plans(),
      ]);
      setHubQuota(quotaResp.data || null);
      setAudioQuota(audioQuotaResp || null);
      setPlans(planResp.data || []);
    } catch (err) {
      setError((err as Error).message || '加载配额数据失败');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => { void loadData(); }, [loadData]);

  const saveQuota = async () => {
    if (!hubQuota) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.quota.update({ autoTranscribeEnabled: hubQuota.autoTranscribeEnabled, maxAutoPerDay: hubQuota.maxAutoPerDay });
      await loadData();
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
      await loadData();
      setNotice(`套餐已切换到 ${planName}`);
    } catch (err) {
      setError((err as Error).message || '切换套餐失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-10 text-sm text-zinc-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />加载中...</div>;
  }

  return (
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
          <input type="checkbox" checked={Boolean(hubQuota?.autoTranscribeEnabled)} onChange={(e) => setHubQuota((prev) => (prev ? { ...prev, autoTranscribeEnabled: e.target.checked } : prev))} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-zinc-500">
            每日自动上限
            <input type="number" value={hubQuota?.maxAutoPerDay ?? 3} onChange={(e) => setHubQuota((prev) => (prev ? { ...prev, maxAutoPerDay: Number(e.target.value || 0) } : prev))} className="mt-1 w-full px-2 py-1 text-sm border border-zinc-200 rounded" />
          </label>
          <label className="text-xs text-zinc-500">
            单集时长上限(分钟)
            <input type="number" value={hubQuota?.maxEpisodeMinutes ?? 90} onChange={(e) => setHubQuota((prev) => (prev ? { ...prev, maxEpisodeMinutes: Number(e.target.value || 0) } : prev))} className="mt-1 w-full px-2 py-1 text-sm border border-zinc-200 rounded" />
          </label>
        </div>
        <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-700">
          当前真实执行链路：`自动转写总开关`、`每日自动上限`、`单集时长上限`、`月预算上限`。其中时长上限依赖 RSS 已解析到的音频时长；若源站没有提供时长元数据，系统会继续放行并在后续音频链路里判定。
        </div>
        <button onClick={() => void saveQuota()} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white disabled:opacity-50">
          保存配额设置
        </button>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
        {sectionTitle('套餐切换 / 音频服务配额 / 预留策略')}
        <div className="space-y-2">
          {plans.map((plan) => (
            <button key={plan.id} onClick={() => void changePlan(plan.name)} disabled={saving} className="w-full text-left px-3 py-2 text-sm rounded-lg border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50">
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
  );
}
