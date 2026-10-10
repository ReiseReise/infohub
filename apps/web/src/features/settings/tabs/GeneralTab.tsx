import { useCallback, useEffect, useState } from 'react';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import { api, type FetchSettings } from '../../../lib/api';
import { useSettings } from '../SettingsContext';
import { GENERAL_KEY, freshnessBadge, readLocal, sectionTitle, writeLocal, type GeneralPrefs } from '../shared';

export function GeneralTab() {
  const { user, setError, setNotice, fetchStatus } = useSettings();
  const [saving, setSaving] = useState(false);
  const [fetchSettings, setFetchSettings] = useState<FetchSettings | null>(null);
  const [fetchSettingsLoading, setFetchSettingsLoading] = useState(true);

  const [generalPrefs, setGeneralPrefs] = useState<GeneralPrefs>(() => readLocal<GeneralPrefs>(GENERAL_KEY, {
    compactList: false,
    autoRefreshSeconds: 30,
    openExternalInNewTab: true,
    cardShowAbsoluteTime: true,
  }));

  const loadFetchSettings = useCallback(async () => {
    setFetchSettingsLoading(true);
    try {
      const resp = await api.settings.fetch().catch(() => ({
        data: { userId: user?.id || '', autoFetchEnabled: true, autoSummaryEnabled: true, autoTranslationEnabled: true },
      }));
      setFetchSettings(resp.data || null);
    } catch (err) {
      setError((err as Error).message || '加载抓取设置失败');
    } finally {
      setFetchSettingsLoading(false);
    }
  }, [setError, user?.id]);

  useEffect(() => { void loadFetchSettings(); }, [loadFetchSettings]);

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
        autoSummaryEnabled: fetchSettings.autoSummaryEnabled,
        autoTranslationEnabled: fetchSettings.autoTranslationEnabled,
      });
      setFetchSettings(resp.data || null);
      setNotice([
        fetchSettings.autoFetchEnabled ? '自动抓取已开启' : '自动抓取已关闭',
        fetchSettings.autoSummaryEnabled ? '自动摘要已开启' : '自动摘要已关闭',
        fetchSettings.autoTranslationEnabled ? '自动翻译已开启' : '自动翻译已关闭',
      ].join('；'));
    } catch (err) {
      setError((err as Error).message || '保存自动抓取设置失败');
    } finally {
      setSaving(false);
    }
  };

  if (fetchSettingsLoading) {
    return <div className="py-10 text-sm text-zinc-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />加载中...</div>;
  }

  return (
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
        <label htmlFor="settings-auto-refresh-seconds" className="flex items-center justify-between text-sm text-zinc-700">
          自动刷新秒数
          <input id="settings-auto-refresh-seconds" aria-label="自动刷新秒数" type="number" min={10} max={300} value={generalPrefs.autoRefreshSeconds} onChange={(e) => setGeneralPrefs((prev) => ({ ...prev, autoRefreshSeconds: Number(e.target.value || 30) }))} className="w-24 rounded border border-zinc-200 px-2 py-1" />
        </label>
        <button onClick={saveGeneralPrefs} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white">
          <SlidersHorizontal size={14} /> 保存通用偏好
        </button>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-4">
        {sectionTitle('自动抓取', '这里控制 cron 自动采集；手动抓取按钮始终可用。')}
        <label className="flex items-center justify-between text-sm text-zinc-700">
          全局自动抓取
          <input type="checkbox" checked={fetchSettings?.autoFetchEnabled ?? true} onChange={(e) => setFetchSettings((prev) => ({ userId: prev?.userId || user?.id || '', autoFetchEnabled: e.target.checked, autoSummaryEnabled: prev?.autoSummaryEnabled ?? true, autoTranslationEnabled: prev?.autoTranslationEnabled ?? true, createdAt: prev?.createdAt, updatedAt: prev?.updatedAt }))} />
        </label>
        <div className="grid gap-3 border-t border-zinc-100 pt-4 md:grid-cols-2">
          <label className="flex min-h-20 items-start justify-between gap-4 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3">
            <span>
              <span className="block text-sm font-medium text-zinc-800">抓取后自动生成摘要</span>
              <span className="mt-1 block text-xs leading-5 text-zinc-500">新文章完成评分后异步生成完整中文导读；失败会保留原因，不伪装成功。</span>
            </span>
            <input type="checkbox" className="mt-1" checked={fetchSettings?.autoSummaryEnabled ?? true} onChange={(e) => setFetchSettings((prev) => ({ userId: prev?.userId || user?.id || '', autoFetchEnabled: prev?.autoFetchEnabled ?? true, autoSummaryEnabled: e.target.checked, autoTranslationEnabled: prev?.autoTranslationEnabled ?? true, createdAt: prev?.createdAt, updatedAt: prev?.updatedAt }))} />
          </label>
          <label className="flex min-h-20 items-start justify-between gap-4 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3">
            <span>
              <span className="block text-sm font-medium text-zinc-800">抓取后自动翻译外文</span>
              <span className="mt-1 block text-xs leading-5 text-zinc-500">按来源预算异步翻译外文正文，并校验长度、段落、链接、图片和代码结构。</span>
            </span>
            <input type="checkbox" className="mt-1" checked={fetchSettings?.autoTranslationEnabled ?? true} onChange={(e) => setFetchSettings((prev) => ({ userId: prev?.userId || user?.id || '', autoFetchEnabled: prev?.autoFetchEnabled ?? true, autoSummaryEnabled: prev?.autoSummaryEnabled ?? true, autoTranslationEnabled: e.target.checked, createdAt: prev?.createdAt, updatedAt: prev?.updatedAt }))} />
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-zinc-500">
          <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">我的信源：<span className="font-medium text-zinc-800">{fetchStatus?.user?.sourceCount ?? 0}</span></div>
          <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">活跃信源：<span className="font-medium text-zinc-800">{fetchStatus?.user?.activeSources ?? 0}</span></div>
          <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">自动抓取中：<span className="font-medium text-zinc-800">{fetchStatus?.user?.autoFetchSourceCount ?? 0}</span></div>
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
  );
}
