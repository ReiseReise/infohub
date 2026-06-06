import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Eye, Globe, Loader2, Plus, RefreshCw, Trash2, Waves } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, type FeedItemRecord, type SourceRecord } from '../lib/api';

type MonitorMode = 'webpage' | 'changedetection';
type RenderMode = 'auto' | 'native' | 'dynamic' | 'stealth';

const MODE_META: Record<MonitorMode, { label: string; desc: string; badge: string }> = {
  webpage: {
    label: '网页快照',
    desc: '定时抓取网页正文快照，和上一版比较后把变化结果回流到 Feed。',
    badge: 'bg-sky-100 text-sky-700',
  },
  changedetection: {
    label: '变更监控',
    desc: '持续对页面做变更检测，适合无 RSS 的公告页、价格页和 changelog。',
    badge: 'bg-amber-100 text-amber-700',
  },
};

function timeAgo(date?: string | null) {
  if (!date) return '从未';
  const diff = Date.now() - new Date(date).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return `${Math.max(1, Math.floor(diff / 60000))} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function renderModeLabel(mode?: string | null) {
  return (mode || 'auto').trim() || 'auto';
}

function fetchEngineLabel(value?: string | null) {
  switch ((value || '').trim()) {
    case 'native':
      return '原生提取';
    case 'scrapling-http':
      return 'Scrapling HTTP';
    case 'scrapling-dynamic':
      return 'Scrapling Dynamic';
    case 'scrapling-stealth':
      return 'Scrapling Stealth';
    case 'native-or-scrapling':
      return '原生 / Scrapling 自动';
    default:
      return value || '未知';
  }
}

function displayMonitorTitle(title?: string | null) {
  const value = title || '未命名变更';
  return value.replace(
    /(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)/g,
    (_, month: string, day: string, year: string, hour: string, minute: string, _second: string, meridiem: string) => {
      let hh = Number(hour);
      if (meridiem.toUpperCase() === 'PM' && hh < 12) hh += 12;
      if (meridiem.toUpperCase() === 'AM' && hh === 12) hh = 0;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${String(hh).padStart(2, '0')}:${minute}`;
    },
  );
}

function outcomeLabel(outcome?: string | null) {
  switch ((outcome || '').trim()) {
    case 'all_duplicate':
      return '无新增变化';
    case 'new_items':
      return '发现新结果';
    case 'ai_queued':
      return '已进入 AI 处理';
    case 'no_items':
      return '本次无结果';
    case 'error':
      return '抓取异常';
    case 'scheduled':
      return '已排入调度';
    case 'paused':
      return '已暂停';
    default:
      return outcome || '待执行';
  }
}

export function Monitor() {
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [timeline, setTimeline] = useState<FeedItemRecord[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [fetchingId, setFetchingId] = useState<number | null>(null);

  const [form, setForm] = useState({
    name: '',
    url: '',
    category: '监控',
    mode: 'webpage' as MonitorMode,
    renderMode: 'auto' as RenderMode,
  });

  const monitorSources = useMemo(
    () => sources.filter((source) => source.sourceRole === 'monitor'),
    [sources],
  );

  const loadSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.sources.list({ sourceRole: 'monitor' });
      setSources(res.data || []);
    } catch (err) {
      setError((err as Error).message || '监控源加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTimeline = useCallback(async (sourceId?: number | null) => {
    setTimelineLoading(true);
    try {
      const params: Record<string, string> = { limit: '40', monitorOnly: 'true' };
      if (sourceId) params.sourceId = String(sourceId);
      const res = await api.items.list(params);
      setTimeline(res.data || []);
    } catch (err) {
      setTimeline([]);
      setError((err as Error).message || '监控结果加载失败');
    } finally {
      setTimelineLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  useEffect(() => {
    void loadTimeline(selectedSourceId);
  }, [loadTimeline, selectedSourceId]);

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      await api.sources.create({
        name: form.name.trim(),
        sourceType: 'webpage',
        collectorType: form.mode,
        sourceRole: 'monitor',
        config: { url: form.url.trim(), renderMode: form.renderMode },
        category: form.category.trim() || '监控',
        status: 'active',
      });
      setForm({ name: '', url: '', category: '监控', mode: 'webpage', renderMode: 'auto' });
      setShowAdd(false);
      setNotice(form.mode === 'webpage' ? '网页快照监控已创建，默认会参与定时抓取。' : '变更监控已创建并已接入定时抓取。');
      await loadSources();
      await loadTimeline(selectedSourceId);
    } catch (err) {
      setError((err as Error).message || '监控源创建失败');
    } finally {
      setAdding(false);
    }
  };

  const handleFetch = async (source: SourceRecord) => {
    setFetchingId(source.id);
    setError(null);
    setNotice(null);
    try {
      const result = await api.fetch.triggerSource(source.id);
      setNotice(
        result.mode === 'sync'
          ? `“${source.name}” 抓取完成：found ${result.itemsFound ?? 0} · new ${result.itemsNew ?? 0} · filtered ${result.itemsFiltered ?? 0} · duplicate ${result.itemsDuplicate ?? 0}`
          : `“${source.name}” 已入队。`,
      );
      await loadSources();
      await loadTimeline(selectedSourceId ?? source.id);
    } catch (err) {
      setError((err as Error).message || '抓取失败');
    } finally {
      setFetchingId(null);
    }
  };

  const handleDelete = async (source: SourceRecord) => {
    if (!window.confirm(`确认删除监控源“${source.name}”？`)) return;
    try {
      await api.sources.delete(source.id);
      setNotice('监控源已删除');
      if (selectedSourceId === source.id) setSelectedSourceId(null);
      await loadSources();
      await loadTimeline(selectedSourceId === source.id ? null : selectedSourceId);
    } catch (err) {
      setError((err as Error).message || '删除失败');
    }
  };

  const collectorLabel = (collectorType?: string) => {
    if (collectorType === 'changedetection') return MODE_META.changedetection;
    return MODE_META.webpage;
  };

  return (
    <div className="p-6 max-w-7xl">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-zinc-900">网页监控</h1>
          <p className="text-sm text-zinc-500 mt-1">把一次性网页抓取和持续变更监控拆开看，采集管理与结果时间线也分开看。</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            onClick={() => {
              void loadSources();
              void loadTimeline(selectedSourceId);
            }}
            className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm border border-zinc-200 rounded-xl hover:bg-zinc-50"
          >
            <RefreshCw size={14} />
            刷新
          </button>
          <button
            onClick={() => setShowAdd((prev) => !prev)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm bg-zinc-900 text-white rounded-xl hover:bg-zinc-800"
          >
            <Plus size={14} />
            添加监控
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}

      {showAdd && (
        <form onSubmit={handleAdd} className="mb-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-5 space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-800">添加网页采集目标</h2>
              <p className="text-xs text-zinc-500 mt-1">两种模式都会参与定时调度：网页快照做正文比较，变更监控抓外部 diff。</p>
            </div>
            <div className="flex rounded-2xl bg-white border border-zinc-200 p-1">
              {(['webpage', 'changedetection'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, mode }))}
                  className={`px-3 py-1.5 text-xs rounded-xl transition-colors ${
                    form.mode === mode ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800'
                  }`}
                >
                  {MODE_META[mode].label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
            {MODE_META[form.mode].desc}
          </div>

          {form.mode === 'webpage' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs text-zinc-600">
                <span className="mb-1 block">渲染策略</span>
                <select
                  value={form.renderMode}
                  onChange={(e) => setForm((prev) => ({ ...prev, renderMode: e.target.value as RenderMode }))}
                  className="w-full px-3 py-2.5 border border-zinc-200 rounded-xl text-sm bg-white"
                >
                  <option value="auto">auto</option>
                  <option value="native">native</option>
                  <option value="dynamic">dynamic</option>
                  <option value="stealth">stealth</option>
                </select>
              </label>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="名称，如：OpenAI 发布日志"
              required
              className="px-3 py-2.5 border border-zinc-200 rounded-xl text-sm"
            />
            <input
              value={form.category}
              onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
              placeholder="分类（默认：监控）"
              className="px-3 py-2.5 border border-zinc-200 rounded-xl text-sm"
            />
          </div>

          <input
            value={form.url}
            onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
            placeholder="目标 URL"
            required
            className="w-full px-3 py-2.5 border border-zinc-200 rounded-xl text-sm"
          />

          <div className="flex gap-2">
            <button type="submit" disabled={adding} className="px-4 py-2 text-sm bg-zinc-900 text-white rounded-xl disabled:opacity-50">
              {adding ? '创建中...' : '确认创建'}
            </button>
            <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700">
              取消
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-5">
        <section className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
          <div className="border-b border-zinc-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-800">采集目标管理</h2>
            <p className="text-xs text-zinc-500 mt-1">左边管来源，右边看产出的变更结果。</p>
          </div>

          {loading ? (
            <div className="py-20 text-center text-zinc-400">加载中...</div>
          ) : monitorSources.length === 0 ? (
            <div className="py-20 text-center text-zinc-400">
              <Globe size={30} className="mx-auto mb-3 opacity-30" />
              暂无网页监控源
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {monitorSources.map((source) => {
                const meta = collectorLabel(source.collectorType);
                const selected = selectedSourceId === source.id;
                return (
                  <div
                    key={source.id}
                    className={`px-4 py-3 cursor-pointer transition-colors ${selected ? 'bg-zinc-50' : 'hover:bg-zinc-50'}`}
                    onClick={() => setSelectedSourceId((prev) => (prev === source.id ? null : source.id))}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-zinc-900 truncate">{source.name}</p>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
                          {source.renderMode && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-fuchsia-50 text-fuchsia-700">
                              渲染 {renderModeLabel(source.renderMode)}
                            </span>
                          )}
                          {source.lastFetchEngine && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">
                              {fetchEngineLabel(source.lastFetchEngine)}
                            </span>
                          )}
                          {source.status && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500">{source.status}</span>
                          )}
                        </div>
                        <a
                          href={String(source.config?.url || source.url || '#')}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-700 truncate"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {String(source.config?.url || source.url || '—')}
                          <ExternalLink size={10} />
                        </a>
                        <div className="mt-2 text-[11px] text-zinc-500">
                          最后检查：{timeAgo(source.lastFetchedAt)} · 下次抓取：{timeAgo(source.nextFetchAt || undefined)} · 结果：{outcomeLabel(source.lastOutcome)}
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-500">
                          最近变化：{displayMonitorTitle(source.lastChangeSummary || source.lastError || '暂无')}
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-500">
                          阻断原因：{source.blockedReason || '无'}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleFetch(source);
                          }}
                          disabled={fetchingId === source.id}
                          className="p-2 rounded-lg hover:bg-zinc-100 disabled:opacity-40"
                          title="立即抓取"
                        >
                          {fetchingId === source.id ? <Loader2 size={14} className="animate-spin text-zinc-400" /> : <Eye size={14} className="text-zinc-400" />}
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDelete(source);
                          }}
                          className="p-2 rounded-lg hover:bg-red-50"
                          title="删除"
                        >
                          <Trash2 size={14} className="text-red-400" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
          <div className="border-b border-zinc-100 px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-800">结果 / 变更时间线</h2>
              <p className="text-xs text-zinc-500 mt-1">
                {selectedSourceId ? '当前只看选中监控源的结果。' : '当前展示监控来源的最近结果。'}
              </p>
            </div>
            {selectedSourceId && (
              <button onClick={() => setSelectedSourceId(null)} className="text-xs text-zinc-500 hover:text-zinc-800">
                清除筛选
              </button>
            )}
          </div>

          {timelineLoading ? (
            <div className="py-20 text-center text-zinc-400">结果加载中...</div>
          ) : timeline.length === 0 ? (
            <div className="py-20 text-center text-zinc-400">
              <Waves size={28} className="mx-auto mb-3 opacity-30" />
              暂无监控结果，先触发一次抓取。
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {timeline.map((item) => {
                const meta = item.sourceCollectorType === 'changedetection' ? MODE_META.changedetection : MODE_META.webpage;
                return (
                  <div key={item.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
                          {item.renderMode && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-fuchsia-50 text-fuchsia-700">
                              渲染 {renderModeLabel(item.renderMode)}
                            </span>
                          )}
                          {item.fetchEngine && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">
                              {fetchEngineLabel(item.fetchEngine)}
                            </span>
                          )}
                          <span className="text-[10px] text-zinc-400">{timeAgo(item.publishedAt)}</span>
                        </div>
                        <h3 className="mt-1 text-sm font-medium text-zinc-900">{displayMonitorTitle(item.title)}</h3>
                        {item.aiSummary ? (
                          <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{item.aiSummary}</p>
                        ) : item.snippet ? (
                          <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{item.snippet}</p>
                        ) : null}
                        <div className="mt-2 text-[11px] text-zinc-400">
                          来源：{item.sourceName || '未知来源'}
                        </div>
                        {item.blockedReason && (
                          <div className="mt-1 text-[11px] text-zinc-400">
                            阻断：{item.blockedReason}
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <Link
                          to={`/feed?sourceId=${item.sourceId || ''}&category=${encodeURIComponent('监控')}`}
                          className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-200 hover:bg-zinc-50"
                        >
                          去 Feed
                        </Link>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 rounded-lg hover:bg-zinc-100"
                        >
                          <ExternalLink size={14} className="text-zinc-400" />
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
