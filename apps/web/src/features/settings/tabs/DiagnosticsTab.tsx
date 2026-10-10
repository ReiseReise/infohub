import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { api, type AdminStorageStatus, type FetchQueueDiagnosticResponse, type NetworkDiagnosticResponse, type QueueJobDiagnostic, type RetentionRunRecord, type ServiceDiagnostic } from '../../../lib/api';
import { useSettings } from '../SettingsContext';
import { diagnosticStatusLabel, fetchOutcomeLabel, formatBytes, freshnessBadge, queueStateLabel, retentionModeLabel, sectionTitle, storageBackendLabel, syncModeLabel } from '../shared';
import { QueueStatusChart, FreshnessChart, ModelUsageChart, HealthScoreChart } from '../charts';

export function DiagnosticsTab() {
  const { isAdmin, setError, setNotice, fetchStatus } = useSettings();
  const [diagnosticLoading, setDiagnosticLoading] = useState(true);
  const [networkDiagnostics, setNetworkDiagnostics] = useState<NetworkDiagnosticResponse | null>(null);
  const [fetchQueueDiagnostics, setFetchQueueDiagnostics] = useState<FetchQueueDiagnosticResponse | null>(null);
  const [retentionStatus, setRetentionStatus] = useState<RetentionRunRecord | null>(null);
  const [storageStatus, setStorageStatus] = useState<AdminStorageStatus | null>(null);
  const [proxyTesting, setProxyTesting] = useState(false);
  const [proxyInput, setProxyInput] = useState('');
  const [proxyTarget, setProxyTarget] = useState('https://www.github.com');
  const [proxyResult, setProxyResult] = useState<{ ok: boolean; proxyUrl: string; targetUrl: string; statusCode?: number; latencyMs: number; error?: string } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const refreshDiagnostics = useCallback(async () => {
    setDiagnosticLoading(true);
    try {
      const [network, queue, retention, storage] = await Promise.all([
        api.diagnostics.network(),
        isAdmin ? api.diagnostics.fetchJobs({ limit: 20 }) : Promise.resolve(null),
        isAdmin ? api.admin.retentionStatus().catch(() => ({ data: null as RetentionRunRecord | null })) : Promise.resolve({ data: null as RetentionRunRecord | null }),
        isAdmin ? api.admin.storageStatus().catch(() => ({ data: null as AdminStorageStatus | null })) : Promise.resolve({ data: null as AdminStorageStatus | null }),
      ]);
      setNetworkDiagnostics(network);
      setFetchQueueDiagnostics(queue);
      setRetentionStatus(retention.data || null);
      setStorageStatus(storage.data || null);
    } catch (err) {
      setError((err as Error).message || '加载诊断信息失败');
    } finally {
      setDiagnosticLoading(false);
    }
  }, [isAdmin, setError]);

  useEffect(() => { void refreshDiagnostics(); }, [refreshDiagnostics]);

  const runProxyTest = async () => {
    if (!proxyInput.trim()) { setError('请输入代理地址'); return; }
    setProxyTesting(true); setError(null); setProxyResult(null);
    try {
      const result = await api.diagnostics.proxyTest({ proxyUrl: proxyInput.trim(), targetUrl: proxyTarget.trim() || undefined });
      setProxyResult(result);
      setNotice(result.ok ? '代理测试通过' : '代理可达但存在异常');
    } catch (err) { setProxyResult(null); setError((err as Error).message || '代理测试失败'); } finally { setProxyTesting(false); }
  };

  return (
    <div className="space-y-6">
      {/* 顶部关键指标卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <div className="text-[11px] text-zinc-500">服务连通</div>
          <div className="text-lg font-semibold text-zinc-800">{networkDiagnostics?.summary?.ok ?? '—'}<span className="text-sm font-normal text-zinc-400">/{networkDiagnostics?.summary?.total ?? '—'}</span></div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <div className="text-[11px] text-zinc-500">队列等待</div>
          <div className="text-lg font-semibold text-zinc-800">{fetchQueueDiagnostics?.queue?.waiting ?? '—'}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <div className="text-[11px] text-zinc-500">新鲜度</div>
          <div className="text-lg font-semibold text-zinc-800">{freshnessBadge(fetchStatus?.freshnessStatus).label}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <div className="text-[11px] text-zinc-500">运行态</div>
          <div className={`text-lg font-semibold ${fetchStatus?.runtimeOnline ? 'text-emerald-600' : 'text-red-600'}`}>{fetchStatus?.runtimeOnline ? '在线' : '离线'}</div>
        </div>
      </div>

      {/* 2x2 图表网格 — 桌面2列/移动1列 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <QueueStatusChart loading={diagnosticLoading} />
        <FreshnessChart loading={diagnosticLoading} />
        <ModelUsageChart loading={diagnosticLoading} />
        <HealthScoreChart loading={diagnosticLoading} />
      </div>

      {/* 可折叠的详细诊断信息 */}
      <div className="rounded-xl border border-zinc-200 bg-white">
        <button
          onClick={() => setDetailsOpen(!detailsOpen)}
          className="w-full flex items-center justify-between p-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 rounded-xl transition-colors"
        >
          <span>详细诊断信息</span>
          {detailsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        {detailsOpen && (
          <div className="px-4 pb-4 space-y-4">
            {/* 服务连通诊断 */}
            <div className="rounded-lg border border-zinc-100 p-3">
              {sectionTitle('服务连通诊断', '用于定位抓取失败、服务不可达、依赖中断')}
              {diagnosticLoading ? (
                <div className="py-6 text-sm text-zinc-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />正在加载诊断信息...</div>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs text-zinc-500">健康统计：{networkDiagnostics?.summary?.ok ?? 0}/{networkDiagnostics?.summary?.total ?? 0} 正常</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                    {(networkDiagnostics?.services || []).map((service: ServiceDiagnostic) => (
                      <div key={service.name} className="border border-zinc-100 rounded-lg px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-zinc-700">{service.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${service.status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{service.status}</span>
                        </div>
                        <div className="text-xs text-zinc-500 mt-1">{service.detail || '-'}</div>
                        <div className="text-[11px] text-zinc-400 mt-0.5">{service.latencyMs}ms</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 2列详细信息 */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="rounded-lg border border-zinc-100 p-3">
                {sectionTitle('抓取新鲜度', '判断当前数据为什么旧。')}
                <div className="space-y-2 text-xs text-zinc-600">
                  <div className="flex items-center justify-between"><span className="font-medium text-zinc-800">运行态</span><span className={`rounded px-2 py-0.5 ${fetchStatus?.runtimeOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{fetchStatus?.runtimeOnline ? '在线' : '离线'}</span></div>
                  <div>调度模式：{fetchStatus?.schedulerMode || fetchStatus?.user?.scheduleMode || 'hybrid'}</div>
                  <div>新鲜度：{freshnessBadge(fetchStatus?.freshnessStatus).label}</div>
                  <div>最近成功抓取：{fetchStatus?.lastSuccessfulFetchAt ? new Date(fetchStatus.lastSuccessfulFetchAt).toLocaleString('zh-CN') : '暂无'}</div>
                  <div>到期来源：{Number(fetchStatus?.user?.dueSources ?? 0)} · 过期来源：{Number(fetchStatus?.staleSources ?? fetchStatus?.user?.staleSources ?? 0)}</div>
                  <div>最老待抓取：{Number(fetchStatus?.oldestDueMinutes ?? fetchStatus?.user?.oldestDueMinutes ?? 0)} 分钟</div>
                  <div>原因：{String(fetchStatus?.staleReason || fetchStatus?.user?.staleReason || '暂无')}</div>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-100 p-3">
                {sectionTitle('Scrapling 抓取诊断', '动态网页抓取兜底层。')}
                {(() => {
                  const scraplingService = (networkDiagnostics?.services || []).find((s) => s.name.includes('scrapling'));
                  return (
                    <div className="space-y-2 text-xs text-zinc-600">
                      <div className="flex items-center justify-between"><span className="font-medium text-zinc-800">服务状态</span><span className={`rounded px-2 py-0.5 ${scraplingService?.status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{diagnosticStatusLabel(scraplingService?.status, '未知')}</span></div>
                      <div>最近健康明细：{scraplingService?.detail || '暂无'}</div>
                      <div>延迟：{scraplingService?.latencyMs ?? '-'} ms</div>
                    </div>
                  );
                })()}
              </div>

              <div className="rounded-lg border border-zinc-100 p-3">
                {sectionTitle('历史裁剪状态', '默认保留最近 30 天。')}
                <div className="space-y-2 text-xs text-zinc-600">
                  <div>最近一次运行：{retentionStatus?.createdAt ? new Date(retentionStatus.createdAt).toLocaleString('zh-CN') : '暂无'}</div>
                  <div>模式：{retentionModeLabel(retentionStatus?.mode)} · 状态：{diagnosticStatusLabel(retentionStatus?.status, '暂无')}</div>
                  <div>保留天数：{retentionStatus?.retentionDays ?? (retentionStatus?.summary as { retentionDays?: number } | undefined)?.retentionDays ?? 30}</div>
                  <div>预计/最近删除：条目 {(retentionStatus?.summary as { deleted?: { items?: number }; items?: number } | undefined)?.deleted?.items ?? (retentionStatus?.summary as { items?: number } | undefined)?.items ?? 0}</div>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-100 p-3">
                {sectionTitle('存储与备份', '确认哪些目录适合同步。')}
                {!isAdmin && <div className="text-xs text-zinc-500">仅管理员可查看完整存储与备份状态。</div>}
                {isAdmin && (
                  <div className="space-y-3 text-xs text-zinc-600">
                    <div className="flex items-center justify-between"><span className="font-medium text-zinc-800">音频存储</span><span className={`rounded px-2 py-0.5 ${storageStatus?.storage.audioStorageBackend === 'local' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{storageBackendLabel(storageStatus?.storage.audioStorageBackend)}</span></div>
                    <div>数据根目录：{storageStatus?.storage.hostDataRoot || '暂无'}</div>
                    <div>最近结果：{diagnosticStatusLabel(storageStatus?.backup.lastRun?.status, '暂无')} · {storageStatus?.backup.lastRun?.message || '未执行过备份'}</div>
                    <div>最近包：{storageStatus?.backup.lastRun?.bundle?.name || storageStatus?.backup.latestBundleName || '暂无'}{storageStatus?.backup.lastRun?.bundle?.sizeBytes ? ` · ${formatBytes(storageStatus.backup.lastRun.bundle.sizeBytes)}` : ''}</div>
                    <div>本地保留：{storageStatus?.backup.localRetention ?? 0} 份 · 当前可见：{storageStatus?.backup.localBundleCount ?? 0} 份</div>
                    {storageStatus?.storage.syncGuidance && storageStatus.storage.syncGuidance.length > 0 && (
                      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                        <div className="font-medium text-zinc-700 mb-1">同步建议</div>
                        {storageStatus.storage.syncGuidance.map((entry) => (
                          <div key={entry.path}><span className="font-medium text-zinc-800">{entry.path}</span><span className="ml-1 text-zinc-500">[{syncModeLabel(entry.mode)}]</span><span className="ml-1">· {entry.reason}</span></div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 代理测试 */}
            <div className="rounded-lg border border-zinc-100 p-3 space-y-3">
              {sectionTitle('代理测试', '快速确认代理是否可用')}
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                <input value={proxyInput} onChange={(e) => setProxyInput(e.target.value)} placeholder="代理地址，如 http://127.0.0.1:7890" className="px-3 py-2 text-sm border border-zinc-200 rounded-lg" />
                <input value={proxyTarget} onChange={(e) => setProxyTarget(e.target.value)} placeholder="测试目标 URL（可选）" className="px-3 py-2 text-sm border border-zinc-200 rounded-lg" />
                <button onClick={() => void runProxyTest()} disabled={proxyTesting} className="px-3 py-2 text-sm rounded-lg border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50">{proxyTesting ? '测试中...' : '测试代理'}</button>
              </div>
              {proxyResult && (
                <div className={`text-xs px-3 py-2 rounded-lg border ${proxyResult.ok ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
                  结果：{proxyResult.ok ? '可用' : '异常'} · HTTP {proxyResult.statusCode || '-'} · {proxyResult.latencyMs}ms{proxyResult.error ? ` · ${proxyResult.error}` : ''}
                </div>
              )}
            </div>

            {/* 抓取队列诊断 */}
            <div className="rounded-lg border border-zinc-100 p-3">
              {sectionTitle('抓取队列诊断', '查看等待/执行/失败任务')}
              {!isAdmin && <div className="text-xs text-zinc-500 mb-3">仅管理员可查看队列作业详情。</div>}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                <div className="text-xs border border-zinc-100 rounded px-2 py-1.5">等待：{fetchQueueDiagnostics?.queue?.waiting ?? 0}</div>
                <div className="text-xs border border-zinc-100 rounded px-2 py-1.5">执行中：{fetchQueueDiagnostics?.queue?.active ?? 0}</div>
                <div className="text-xs border border-zinc-100 rounded px-2 py-1.5">已完成：{fetchQueueDiagnostics?.queue?.completed ?? 0}</div>
                <div className="text-xs border border-zinc-100 rounded px-2 py-1.5">失败：{fetchQueueDiagnostics?.queue?.failed ?? 0}</div>
              </div>
              <div className="space-y-2 max-h-[320px] overflow-y-auto">
                {(fetchQueueDiagnostics?.jobs || []).length === 0 && <div className="text-xs text-zinc-400">暂无队列任务</div>}
                {(fetchQueueDiagnostics?.jobs || []).map((job: QueueJobDiagnostic) => (
                  <div key={job.id} className="border border-zinc-100 rounded px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-zinc-700 truncate">{job.sourceName || job.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${job.state === 'failed' ? 'bg-red-100 text-red-700' : 'bg-zinc-100 text-zinc-600'}`}>{queueStateLabel(job.state)}</span>
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">信源：{job.sourceId ?? '-'} · 尝试次数：{job.attemptsMade}</div>
                    {job.failedReason && <div className="text-xs text-red-600 mt-1 flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0" /><span className="line-clamp-2">{job.failedReason}</span></div>}
                  </div>
                ))}
              </div>
            </div>

            {/* 最近抓取结果 */}
            <div className="rounded-lg border border-zinc-100 p-3">
              {sectionTitle('最近抓取结果', '区分无新增、重复、被过滤和进入 AI 队列。')}
              <div className="space-y-2 max-h-[320px] overflow-y-auto">
                {!(fetchStatus?.user?.recentFetches as Array<Record<string, unknown>> | undefined)?.length && <div className="text-xs text-zinc-400">暂无抓取记录</div>}
                {((fetchStatus?.user?.recentFetches as Array<Record<string, unknown>> | undefined) || []).map((f, i) => (
                  <div key={String(f.id || i)} className="rounded-lg border border-zinc-100 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-zinc-700">{String(f.sourceName || `source-${f.sourceId || '-'}`)}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${f.status === 'success' ? 'bg-emerald-100 text-emerald-700' : f.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-zinc-100 text-zinc-600'}`}>{fetchOutcomeLabel(f.outcome, f.status)}</span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">发现 {Number(f.itemsFound || 0)} · 新增 {Number(f.itemsNew || 0)} · 过滤 {Number(f.itemsFiltered || 0)} · 重复 {Number(f.itemsDuplicate || 0)} · AI 队列 {Number(f.itemsQueuedAi || 0)}</div>
                    {f.error ? <div className="mt-1 text-xs text-red-600 line-clamp-2">{String(f.error)}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
