import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { SettingsProvider, useSettings } from './SettingsContext';
import { TAB_LABELS, type SettingsMode, type SettingsTab } from './shared';

const GeneralTab = lazy(() => import('./tabs/GeneralTab').then((m) => ({ default: m.GeneralTab })));
const ReadingTab = lazy(() => import('./tabs/ReadingTab').then((m) => ({ default: m.ReadingTab })));
const IntegrationsTab = lazy(() => import('./tabs/IntegrationsTab').then((m) => ({ default: m.IntegrationsTab })));
const QuotaTab = lazy(() => import('./tabs/QuotaTab').then((m) => ({ default: m.QuotaTab })));
const AiCenterTab = lazy(() => import('./tabs/AiCenterTab').then((m) => ({ default: m.AiCenterTab })));
const DiagnosticsTab = lazy(() => import('./tabs/DiagnosticsTab').then((m) => ({ default: m.DiagnosticsTab })));
const AdminTab = lazy(() => import('./tabs/AdminTab').then((m) => ({ default: m.AdminTab })));

const USER_TABS: SettingsTab[] = ['general', 'reading', 'integrations', 'quota'];
const ADMIN_TABS: SettingsTab[] = ['models', 'diagnostics', 'admin'];

function TabSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-6 w-48 bg-zinc-200 rounded" />
      <div className="h-32 w-full bg-zinc-100 rounded-xl" />
      <div className="h-32 w-full bg-zinc-100 rounded-xl" />
    </div>
  );
}

function SettingsInner() {
  const { mode, loading, error, notice, setError, setNotice, fetchStatus, itemStats } = useSettings();
  const [searchParams, setSearchParams] = useSearchParams();

  const allowedTabs = mode === 'admin' ? ADMIN_TABS : USER_TABS;
  const defaultTab = mode === 'admin' ? 'models' : 'general';
  const initialTab = (searchParams.get('tab') || '').trim();

  const [activeTab, setActiveTab] = useState<SettingsTab>(
    allowedTabs.includes(initialTab as SettingsTab) ? (initialTab as SettingsTab) : defaultTab,
  );

  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
    setError(null);
    setNotice(null);
  };

  const visibleTabs = TAB_LABELS.filter((t) => allowedTabs.includes(t.key));

  return (
    <div className="mx-auto w-full max-w-[1480px] p-4 md:p-6 2xl:max-w-none">
      <div className="flex flex-col gap-1 mb-6">
        <h1 className="text-lg font-semibold text-zinc-900">
          {mode === 'admin' ? '管理后台' : '用户偏好'}
        </h1>
        <p className="text-sm text-zinc-500">
          {mode === 'admin' ? '系统管理与 AI 服务配置' : '个人设置与信息流偏好'}
        </p>
      </div>

      {/* Status cards (compact) */}
      {!loading && fetchStatus && itemStats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="p-3 rounded-xl border border-zinc-200 bg-white">
            <div className="text-lg font-bold text-zinc-900">{itemStats.total ?? 0}</div>
            <div className="text-xs text-zinc-500">条目总数</div>
          </div>
          <div className="p-3 rounded-xl border border-zinc-200 bg-white">
            <div className="text-lg font-bold text-zinc-900">{itemStats.unread ?? 0}</div>
            <div className="text-xs text-zinc-500">未读</div>
          </div>
          <div className="p-3 rounded-xl border border-zinc-200 bg-white">
            <div className="text-lg font-bold text-zinc-900">{itemStats.today ?? 0}</div>
            <div className="text-xs text-zinc-500">今日新增</div>
          </div>
          <div className="p-3 rounded-xl border border-zinc-200 bg-white">
            <div className={`text-lg font-bold ${fetchStatus.runtimeOnline ? 'text-emerald-600' : 'text-red-600'}`}>
              {fetchStatus.runtimeOnline ? '在线' : '离线'}
            </div>
            <div className="text-xs text-zinc-500">运行态</div>
          </div>
          <div className="p-3 rounded-xl border border-zinc-200 bg-white">
            <div className="text-lg font-bold text-zinc-900">{itemStats.favorites ?? 0}</div>
            <div className="text-xs text-zinc-500">收藏</div>
          </div>
        </div>
      )}

      {/* Notifications */}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={14} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-xs underline">关闭</button>
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
          <button onClick={() => setNotice(null)} className="ml-2 text-xs underline">关闭</button>
        </div>
      )}

      {/* Tab navigation */}
      <div className="flex gap-2 mb-6 flex-wrap border-b border-zinc-200 pb-3">
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`min-h-9 px-3 py-2 text-sm rounded-lg border transition-colors ${
              activeTab === tab.key
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div role="status" aria-busy="true" aria-label="正在加载设置" className="rounded-2xl border border-zinc-200 bg-white p-5">
          <TabSkeleton />
          <span className="sr-only">加载基础信息中...</span>
        </div>
      )}

      {/* Tab content */}
      {!loading && (
        <Suspense fallback={<TabSkeleton />}>
          {activeTab === 'general' && <GeneralTab />}
          {activeTab === 'reading' && <ReadingTab />}
          {activeTab === 'integrations' && <IntegrationsTab />}
          {activeTab === 'quota' && <QuotaTab />}
          {activeTab === 'models' && <AiCenterTab />}
          {activeTab === 'diagnostics' && <DiagnosticsTab />}
          {activeTab === 'admin' && <AdminTab />}
        </Suspense>
      )}
    </div>
  );
}

export function Settings({ mode = 'user' }: { mode?: SettingsMode } = {}) {
  return (
    <SettingsProvider mode={mode}>
      <SettingsInner />
    </SettingsProvider>
  );
}
