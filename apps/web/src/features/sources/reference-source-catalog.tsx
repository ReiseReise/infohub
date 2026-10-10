import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Eye,
  ExternalLink,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import {
  api,
  type ReferenceIntegrationCatalogItem,
  type ReferenceIntegrationCatalogPayload,
  type ReferenceIntegrationStatus,
  type ReferenceSourcePreviewPayload,
  type ReferenceSourceProvider,
} from '../../lib/api';
import {
  REFERENCE_PROVIDER_LABELS,
  referenceChannelLabel,
  referenceIntegrationState,
} from '../../lib/reference-source-catalog';

const INITIAL_VISIBLE_COUNT = 20;

const stateClasses = {
  available: 'bg-zinc-100 text-zinc-600',
  shadow: 'bg-amber-50 text-amber-700',
  active: 'bg-emerald-50 text-emerald-700',
  paused: 'bg-sky-50 text-sky-700',
  removed: 'bg-zinc-100 text-zinc-500',
} as const;

type Props = {
  onChanged?: () => void | Promise<void>;
};

function formatRate(value: number | null): string {
  return value === null ? '无记录' : `${Math.round(value * 100)}%`;
}

function readingTierLabel(value: ReferenceIntegrationCatalogItem['readingTier']): string {
  if (value === 'high_value') return '高价值';
  if (value === 'light_reading') return '浅阅读';
  if (value === 'paused') return '暂停候选';
  return '探索池';
}

function previewDigest(content: string): string {
  return content
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function refreshLabel(minutes?: number): string | null {
  if (!minutes) return null;
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}

function evidenceLabel(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null;
  const contentKind = String(meta.contentKind || '');
  if (contentKind === 'abstract') return 'arXiv 摘要 · 非全文';
  if (contentKind === 'discovery_only') return '发现线索 · 待原始证据';
  if (contentKind === 'material_change_report') return '显著变化报告';
  if (contentKind === 'public_feed_summary') return '公开摘要 · 不含付费正文';
  if (contentKind === 'issue_index' || contentKind === 'weekly_issue') return '索引材料';
  return null;
}

export function ReferenceSourceCatalog({ onChanged }: Props) {
  const [catalog, setCatalog] = useState<ReferenceIntegrationCatalogPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<'all' | ReferenceSourceProvider>('all');
  const [channel, setChannel] = useState('all');
  const [status, setStatus] = useState<'all' | ReferenceIntegrationStatus>('all');
  const [recommendedOnly, setRecommendedOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [preview, setPreview] = useState<ReferenceSourcePreviewPayload | null>(null);

  const loadCatalog = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.integrations.referenceCatalog();
      setCatalog(response.data);
    } catch (err) {
      setError((err as Error).message || '候选源目录加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCatalog();
  }, []);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
  }, [query, provider, channel, status, recommendedOnly]);

  const providers = useMemo(() => (
    Array.from(new Set((catalog?.items || []).map((item) => item.provider)))
  ), [catalog?.items]);
  const channels = useMemo(() => (
    Array.from(new Set((catalog?.items || []).map((item) => item.channel))).sort()
  ), [catalog?.items]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
    return (catalog?.items || []).filter((item) => {
      if (provider !== 'all' && item.provider !== provider) return false;
      if (channel !== 'all' && item.channel !== channel) return false;
      if (status !== 'all' && item.integrationStatus !== status) return false;
      if (recommendedOnly && !item.recommended) return false;
      if (!normalizedQuery) return true;
      return [item.name, item.providerLabel, item.channel, item.description, item.notes]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('zh-CN')
        .includes(normalizedQuery);
    });
  }, [catalog?.items, channel, provider, query, recommendedOnly, status]);

  const runAction = async (key: string, action: () => Promise<{ message?: string }>) => {
    setWorkingKey(key);
    setError(null);
    setNotice(null);
    try {
      const response = await action();
      setNotice(response.message || '候选来源状态已更新');
      await loadCatalog();
      await onChanged?.();
    } catch (err) {
      setError((err as Error).message || '候选来源状态更新失败');
    } finally {
      setWorkingKey(null);
    }
  };

  const loadPreview = async (item: ReferenceIntegrationCatalogItem) => {
    setWorkingKey(item.key);
    setPreview(null);
    setError(null);
    try {
      const response = await api.integrations.referencePreview(item.key);
      setPreview(response.data);
      if (response.data.status !== 'ready') {
        setNotice(response.data.error || '该来源当前没有可预览的新内容');
      }
    } catch (err) {
      setError((err as Error).message || '候选来源预览失败');
    } finally {
      setWorkingKey(null);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white" aria-labelledby="reference-source-catalog-title">
      <div className="border-b border-zinc-200 px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] tracking-[0.18em] text-teal-700/75">来源档案</div>
            <h3 id="reference-source-catalog-title" className="mt-1 text-base font-semibold text-zinc-900">参考项目订阅源</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-600">
              QMReader、Follow Builders、AI HOT 与源头信息员的公开来源都保留在这里。默认不进入信息流；先预览，再由你决定是否开始影子观察。
            </p>
          </div>
          {catalog && (
            <div className="shrink-0 text-left text-xs leading-5 text-zinc-500 sm:text-right">
              <div>{catalog.total} 条档案 · {catalog.recommended} 个首批候选</div>
              <div>影子调度 {catalog.activeCounts.referenceShadow}/{catalog.limits.referenceShadow} · 正式采纳 {catalog.activeCounts.referenceFormal}/{catalog.limits.referenceFormal}</div>
              <div>总调度 {catalog.activeCounts.totalScheduled}/{catalog.limits.totalScheduled}</div>
            </div>
          )}
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <label className="relative block">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索来源、频道或说明"
              className="h-10 w-full rounded-lg border border-zinc-200 pl-9 pr-3 text-sm outline-none focus:border-teal-400"
            />
          </label>
          <select value={provider} onChange={(event) => setProvider(event.target.value as 'all' | ReferenceSourceProvider)} className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700" aria-label="按参考项目筛选">
            <option value="all">全部项目</option>
            {providers.map((value) => <option key={value} value={value}>{REFERENCE_PROVIDER_LABELS[value]}</option>)}
          </select>
          <select value={channel} onChange={(event) => setChannel(event.target.value)} className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700" aria-label="按渠道筛选">
            <option value="all">全部渠道</option>
            {channels.map((value) => <option key={value} value={value}>{referenceChannelLabel(value)}</option>)}
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value as 'all' | ReferenceIntegrationStatus)} className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700" aria-label="按维护状态筛选">
            <option value="all">全部状态</option>
            <option value="available">仅记录</option>
            <option value="shadow">影子观察</option>
            <option value="active">正式采纳</option>
            <option value="paused">已暂停</option>
            <option value="removed">已移出</option>
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex min-h-9 items-center gap-2 text-sm text-zinc-600">
            <input type="checkbox" checked={recommendedOnly} onChange={(event) => setRecommendedOnly(event.target.checked)} className="h-4 w-4 rounded border-zinc-300 text-teal-700" />
            只看首批候选
          </label>
          <span className="text-xs text-zinc-500">当前结果 {filtered.length} 个</span>
        </div>
      </div>

      {error && <div className="border-b border-red-100 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
      {notice && <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">{notice}</div>}

      {loading ? (
        <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-zinc-500"><LoaderCircle size={16} className="animate-spin" /> 加载候选目录</div>
      ) : filtered.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-zinc-500">没有符合当前条件的候选来源</div>
      ) : (
        <div className="divide-y divide-zinc-100">
          {filtered.slice(0, visibleCount).map((item) => {
            const state = referenceIntegrationState(item.integrationStatus);
            const busy = workingKey === item.key;
            const observed = item.integrationStatus !== 'available' && item.integrationStatus !== 'removed';
            return (
              <article key={item.key} className="px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-zinc-900">{item.name}</span>
                      {item.recommended && <span className="bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">首批候选</span>}
                      {item.observationStatus === 'historical' && <span className="bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">历史观测</span>}
                      <span className={`px-1.5 py-0.5 text-[10px] font-medium ${stateClasses[state.tone]}`}>{state.label}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-zinc-500">
                      <span>{item.providerLabel}</span>
                      <span>{referenceChannelLabel(item.channel)}</span>
                      <span>{item.sourceTier} 级</span>
                      <span>{readingTierLabel(item.readingTier)}</span>
                      {refreshLabel(item.refreshMinutes) && <span>每 {refreshLabel(item.refreshMinutes)} 检查</span>}
                    </div>
                    {item.logicalSites && item.logicalSites.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {item.logicalSites.map((site) => (
                          <a key={site.url} href={site.url} target="_blank" rel="noreferrer" className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-600 hover:border-teal-300 hover:text-teal-700">
                            {site.name}{site.required ? '' : '（可选）'}
                          </a>
                        ))}
                      </div>
                    )}
                    {(item.description || item.notes) && <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-zinc-600">{item.description || item.notes}</p>}
                    {item.observationStatus === 'historical' && (
                      <p className="mt-1 text-[11px] text-amber-700">最近一次观测：{new Date(item.lastObservedAt).toLocaleString('zh-CN')}；仅保留档案，不会自动接入。</p>
                    )}

                    {observed && (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                        <span>观察 {item.quality.observationDays}/7 天</span>
                        <span>抓取 {formatRate(item.quality.fetchSuccessRate)}</span>
                        <span>主题相关 {formatRate(item.quality.aiRelevanceRate)}</span>
                        <span title="处理进度受每日预算和模型状态影响，不参与来源质量门禁">
                          AI 处理进度 {formatRate(item.quality.aiProcessingRate)}
                        </span>
                        <span>原文链接 {formatRate(item.quality.originalLinkRate)}</span>
                        <span>噪音 {formatRate(item.quality.noiseRate)}</span>
                        <span>{item.quality.itemCount} 条样本</span>
                      </div>
                    )}
                    {observed && item.quality.componentHealth.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {item.quality.componentHealth.map((component) => (
                          <span
                            key={component.key}
                            title={component.lastError || `${component.successes7d}/${component.attempts7d} 次成功`}
                            className={`rounded px-1.5 py-0.5 text-[10px] ${component.eligible ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
                          >
                            {component.name} {formatRate(component.successRate)}
                          </span>
                        ))}
                      </div>
                    )}
                    {item.integrationStatus === 'shadow' && !item.quality.eligibleForActivation && (
                      <p className="mt-1.5 text-[11px] text-amber-700">{item.quality.activationReasons.join('；')}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {item.siteUrl && <a href={item.siteUrl} target="_blank" rel="noreferrer" title="打开原站" className="rounded-md p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"><ExternalLink size={15} /></a>}
                    {item.canPreview && (
                      <button type="button" onClick={() => void loadPreview(item)} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
                        {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Eye size={14} />} 预览
                      </button>
                    )}
                    {(item.integrationStatus === 'available' || item.integrationStatus === 'removed') && item.canPreview && (
                      <button type="button" onClick={() => void runAction(item.key, () => api.integrations.referenceEnable(item.key, 'shadow'))} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs text-white hover:bg-zinc-800 disabled:opacity-50">
                        {item.integrationStatus === 'removed' ? <RotateCcw size={14} /> : <Activity size={14} />} 开始影子观察
                      </button>
                    )}
                    {item.integrationStatus === 'shadow' && (
                      <>
                        <button type="button" onClick={() => void runAction(item.key, () => api.integrations.referenceEnable(item.key, 'active'))} disabled={busy || !item.quality.eligibleForActivation} title={item.quality.eligibleForActivation ? '正式采纳' : '请先达到 7 天质量门禁'} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-teal-700 px-3 text-xs text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-35">
                          <CheckCircle2 size={14} /> 正式采纳
                        </button>
                        <button type="button" onClick={() => void runAction(item.key, () => api.integrations.referenceDisable(item.key, 'paused'))} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"><Pause size={14} /> 暂停</button>
                      </>
                    )}
                    {item.integrationStatus === 'active' && (
                      <button type="button" onClick={() => void runAction(item.key, () => api.integrations.referenceDisable(item.key, 'paused'))} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"><Pause size={14} /> 暂停</button>
                    )}
                    {item.integrationStatus === 'paused' && (
                      <>
                        <button type="button" onClick={() => void runAction(item.key, () => api.integrations.referenceEnable(item.key, 'shadow'))} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs text-white hover:bg-zinc-800 disabled:opacity-50"><Play size={14} /> 恢复观察</button>
                        <button type="button" onClick={() => void runAction(item.key, () => api.integrations.referenceDisable(item.key, 'removed'))} disabled={busy} className="rounded-md p-2 text-zinc-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-50" title="移出候选"><Trash2 size={15} /></button>
                      </>
                    )}
                    {!item.canPreview && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500"><AlertTriangle size={13} /> 只记录，待适配</span>
                    )}
                  </div>
                </div>

                {preview?.key === item.key && (
                  <div className="mt-3 border-l-2 border-teal-500 bg-zinc-50 px-3 py-3">
                    <div className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-800">
                      <span>只读样例 · {preview.items.length} 条（不写入运行库）</span>
                      <span className="font-normal text-zinc-500">{new Date(preview.fetchedAt).toLocaleString('zh-CN')}</span>
                    </div>
                    {preview.error && <p className="mt-2 text-xs text-amber-700">{preview.error}</p>}
                    <div className="mt-2 grid gap-2 lg:grid-cols-2">
                      {preview.items.slice(0, 6).map((entry, index) => (
                        <a key={`${entry.url}-${index}`} href={entry.originalUrl || entry.url} target="_blank" rel="noreferrer" className="block border border-zinc-200 bg-white px-3 py-2 hover:border-teal-300">
                          <div className="line-clamp-2 text-xs font-medium leading-5 text-zinc-900">{entry.title}</div>
                          {evidenceLabel(entry.curationMeta) && <div className="mt-1 text-[10px] font-medium text-amber-700">{evidenceLabel(entry.curationMeta)}</div>}
                          {previewDigest(entry.content) && <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-zinc-500">{previewDigest(entry.content)}</p>}
                          <div className="mt-1 text-[10px] text-zinc-400">{entry.curationSource || item.providerLabel}</div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-zinc-200 bg-zinc-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-zinc-500">影子来源可抓取和统计，但不进入普通 Feed、日报或未读数。</div>
        {visibleCount < filtered.length && (
          <button type="button" onClick={() => setVisibleCount((count) => count + 20)} className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-100">加载更多</button>
        )}
      </div>
    </section>
  );
}
