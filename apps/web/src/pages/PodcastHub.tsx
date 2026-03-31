import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  Headphones,
  Loader2,
  Radio,
  RefreshCw,
  Wand2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, type AudioTask } from '../lib/api';
import type { FeedItemRecord } from '../lib/api/contracts';
import { MarkdownContent } from '../components/MarkdownContent';

type PodcastDetailTab = 'overview' | 'summary' | 'transcript' | 'markdown';

function isPodcastItem(item: FeedItemRecord): boolean {
  if (item.mediaType === 'audio') return true;
  if ((item.sourceType || '').toLowerCase().includes('podcast')) return true;
  const media = (item.mediaUrl || '').toLowerCase();
  return ['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac'].some((ext) => media.includes(ext));
}

function fmtTime(input?: string) {
  if (!input) return '未知时间';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '未知时间';
  return date.toLocaleString('zh-CN');
}

function fmtDuration(seconds?: number | null) {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function resultToMarkdown(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.summary === 'string') return record.summary;
    if (typeof record.markdown === 'string') return record.markdown;
    return `\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\``;
  }
  return String(value);
}

function statusBadge(task?: AudioTask | null, item?: FeedItemRecord | null) {
  if (task?.task_integrity_status === 'repair_needed') {
    return { label: '历史结果异常', className: 'bg-amber-100 text-amber-700' };
  }
  const status = task?.status || item?.audioStatus || '';
  switch (status) {
    case 'queued':
    case 'uploading':
      return { label: '排队中', className: 'bg-sky-100 text-sky-700' };
    case 'preprocessing':
    case 'transcribing':
    case 'summarizing':
    case 'generating':
    case 'processing':
      return { label: '处理中', className: 'bg-indigo-100 text-indigo-700' };
    case 'skipped':
      return { label: '自动跳过', className: 'bg-amber-100 text-amber-700' };
    case 'done':
      return { label: '已完成', className: 'bg-emerald-100 text-emerald-700' };
    case 'failed':
    case 'error':
      return { label: '失败', className: 'bg-rose-100 text-rose-700' };
    default:
      return { label: '未转写', className: 'bg-zinc-100 text-zinc-600' };
  }
}

function sourceKindLabel(kind?: string | null): string {
  const value = (kind || '').toLowerCase();
  if (value === 'podcast_page') return '播客页面';
  if (value === 'direct_audio') return '音频直链';
  if (value === 'youtube') return 'YouTube';
  return '未知来源';
}

function storageBackendLabel(backend?: string | null): string {
  const value = (backend || '').toLowerCase();
  if (value === 'oss') return '阿里云 OSS';
  if (value === 'local') return '本地存储';
  return value || '—';
}

function strategyLabel(strategy?: string | null): string {
  const value = (strategy || '').toLowerCase();
  if (value === 'yt_dlp') return 'yt-dlp';
  if (value === 'direct_http') return '直连下载';
  if (value === 'page_extract') return '页面抽取';
  if (value === 'xiaoyuzhou_extract') return '小宇宙抽取';
  return value || '—';
}

function matchTaskForItem(item: FeedItemRecord, tasks: AudioTask[]) {
  if (item.audioTaskId) {
    const exact = tasks.find((task) => task.id === item.audioTaskId);
    if (exact) return exact;
  }

  const candidates = [item.mediaUrl, item.url]
    .map((value) => (value || '').trim())
    .filter(Boolean);

  return tasks.find((task) => {
    const taskSource = (task.source_url || task.audio_url || '').trim();
    return candidates.some((candidate) => candidate === taskSource);
  }) || null;
}

export function PodcastHub() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<FeedItemRecord[]>([]);
  const [tasks, setTasks] = useState<AudioTask[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [selectedTask, setSelectedTask] = useState<AudioTask | null>(null);
  const [detailTab, setDetailTab] = useState<PodcastDetailTab>('overview');
  const [triggering, setTriggering] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);

  const fetchData = async (preserveSelection = true) => {
    setLoading(true);
    setError(null);
    try {
      const [itemResp, taskResp] = await Promise.all([
        api.items.list({ limit: '300', offset: '0' }),
        api.audio.listTasks({ page: 1, page_size: 100 }),
      ]);
      const nextItems = (itemResp.data || []).filter((item) => isPodcastItem(item));
      setItems(nextItems);
      setTasks(taskResp.items || []);

      if (!preserveSelection || !selectedId || !nextItems.some((item) => item.id === selectedId)) {
        setSelectedId(nextItems[0]?.id || '');
      }
    } catch (err) {
      setError((err as Error).message || '加载播客专栏失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData(false);
  }, []);

  useEffect(() => {
    setDetailTab('overview');
  }, [selectedId]);

  const podcastCards = useMemo(() => items.map((item) => ({
    item,
    linkedTask: matchTaskForItem(item, tasks),
  })), [items, tasks]);

  const selectedCard = useMemo(
    () => podcastCards.find((entry) => entry.item.id === selectedId) || podcastCards[0] || null,
    [podcastCards, selectedId],
  );

  const fallbackTask = useMemo(
    () => tasks.find((task) => {
      const hasReadableSummary = resultToMarkdown(task.summary_result).trim().length > 20;
      const hasReadableTranscript = (task.transcript_text || '').trim().length > 80;
      return task.task_integrity_status !== 'repair_needed' && (hasReadableSummary || hasReadableTranscript);
    }) || null,
    [tasks],
  );

  useEffect(() => {
    if (!selectedCard?.linkedTask?.id) {
      setSelectedTask(null);
      return;
    }

    let cancelled = false;
    void api.audio.getTask(selectedCard.linkedTask.id)
      .then((task) => {
        if (!cancelled) setSelectedTask(task);
      })
      .catch(() => {
        if (!cancelled) setSelectedTask(selectedCard.linkedTask || null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCard?.linkedTask?.id]);

  const displayTask = selectedTask || (!selectedCard?.linkedTask ? fallbackTask : null);

  const handleTriggerFetch = async () => {
    setTriggering(true);
    setError(null);
    try {
      await api.fetch.trigger();
      setTimeout(() => {
        void fetchData();
      }, 2500);
    } catch (err) {
      setError((err as Error).message || '触发采集失败');
    } finally {
      setTriggering(false);
    }
  };

  const handleStartAudio = async (item: FeedItemRecord) => {
    setStartingId(item.id);
    setError(null);
    try {
      await api.items.startAudio(item.id);
      await fetchData();
      setSelectedId(item.id);
    } catch (err) {
      setError((err as Error).message || '启动播客转写失败');
    } finally {
      setStartingId(null);
    }
  };

  const summaryMarkdown = resultToMarkdown(displayTask?.summary_result || selectedCard?.item.aiSummary || '');
  const transcriptMarkdown = resultToMarkdown(displayTask?.transcript_text || selectedCard?.item.transcript || '');
  const exportMarkdown = displayTask?.export_markdown?.trim()
    || [summaryMarkdown ? `# AI 摘要\n\n${summaryMarkdown}` : '', transcriptMarkdown ? `# 转写稿\n\n${transcriptMarkdown}` : '']
      .filter(Boolean)
      .join('\n\n');

  const repairedCount = tasks.filter((task) => task.task_integrity_status === 'repair_needed').length;
  const completedCount = tasks.filter((task) => task.status === 'done' && task.task_integrity_status !== 'repair_needed').length;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">播客专栏</h1>
          <p className="text-sm text-zinc-500 mt-1">独立查看播客条目、转写结果与导出稿，不再混在 Feed 主阅读流里。</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/audio')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-zinc-200 hover:bg-zinc-50"
          >
            <Radio size={14} />
            打开音频工坊
          </button>
          <button
            onClick={() => void fetchData()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-zinc-200 hover:bg-zinc-50"
          >
            <RefreshCw size={14} />
            刷新
          </button>
          <button
            onClick={() => void handleTriggerFetch()}
            disabled={triggering}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {triggering ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            立即拉取
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs text-zinc-500">播客条目</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">{items.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs text-zinc-500">可读结果</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">{completedCount}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs text-zinc-500">历史异常</p>
          <p className="mt-1 text-2xl font-semibold text-amber-700">{repairedCount}</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-4 min-h-[620px]">
        <div className="border border-zinc-200 rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 text-sm font-medium text-zinc-800">
            播客条目
          </div>
          <div className="max-h-[72vh] overflow-y-auto divide-y divide-zinc-100">
            {loading ? (
              <div className="p-6 text-sm text-zinc-500">加载中...</div>
            ) : podcastCards.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-400">暂无播客条目，请先添加播客信源或等待抓取。</div>
            ) : (
              podcastCards.map(({ item, linkedTask }) => {
                const badge = statusBadge(linkedTask, item);
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-zinc-50 ${selectedCard?.item.id === item.id ? 'bg-zinc-50' : ''}`}
                  >
                    <p className="text-sm font-medium text-zinc-900 line-clamp-2">{item.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                      <span>{item.sourceName || '未知来源'}</span>
                      <span>{fmtTime(item.publishedAt || item.fetchedAt)}</span>
                      <span className={`px-2 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="border border-zinc-200 rounded-xl bg-white p-4 max-h-[76vh] overflow-y-auto">
          {!selectedCard ? (
            <div className="text-center py-24 text-sm text-zinc-400">请选择一个播客条目</div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-zinc-900">{selectedCard.item.title}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span>{selectedCard.item.sourceName || '未知来源'}</span>
                    <span>{fmtTime(selectedCard.item.publishedAt || selectedCard.item.fetchedAt)}</span>
                    <span className={`px-2 py-0.5 rounded-full ${statusBadge(displayTask, selectedCard.item).className}`}>
                      {statusBadge(displayTask, selectedCard.item).label}
                    </span>
                    <span>时长 {fmtDuration(displayTask?.audio_duration || selectedCard.item.audioDuration)}</span>
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <button
                    onClick={() => void handleStartAudio(selectedCard.item)}
                    disabled={startingId === selectedCard.item.id}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {startingId === selectedCard.item.id ? <Loader2 size={13} className="animate-spin" /> : <Headphones size={13} />}
                    {selectedCard.item.audioTaskId ? '重新转写' : '开始转写'}
                  </button>
                  {displayTask?.id && (
                    <button
                      onClick={() => navigate(`/audio?taskId=${displayTask.id}`)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-zinc-200 hover:bg-zinc-50"
                    >
                      <Wand2 size={13} />
                      任务详情
                    </button>
                  )}
                  <a
                    href={selectedCard.item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-zinc-200 hover:bg-zinc-50"
                  >
                    原文 <ExternalLink size={13} />
                  </a>
                </div>
              </div>

              {displayTask?.task_integrity_status === 'repair_needed' && (
                <div className="mt-4 px-3 py-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>{displayTask.task_integrity_reason || '这是一条历史异常任务，建议重新转写。'}</span>
                </div>
              )}

              {!selectedCard.linkedTask && displayTask && (
                <div className="mt-4 px-3 py-2 text-sm text-sky-800 bg-sky-50 border border-sky-200 rounded-lg">
                  当前播客条目还没有专属转写结果，下面先展示最近一条可读音频任务《{displayTask.title}》作为独立工作台内容。
                </div>
              )}

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 text-xs text-zinc-600">
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">来源类型：{sourceKindLabel(displayTask?.source_kind)}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">抓取策略：{strategyLabel(displayTask?.download_strategy)}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">存储后端：{storageBackendLabel(displayTask?.storage_backend)}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">转写状态：{displayTask?.asr_status || selectedCard.item.audioStatus || '—'}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">摘要状态：{displayTask?.summary_status || selectedCard.item.summaryStatus || '—'}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100 md:col-span-2 xl:col-span-3 break-all">链接：{displayTask?.source_url || selectedCard.item.mediaUrl || selectedCard.item.url}</div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {[
                  { key: 'overview' as const, label: '概览' },
                  { key: 'summary' as const, label: '摘要' },
                  { key: 'transcript' as const, label: '转写' },
                  { key: 'markdown' as const, label: 'Markdown' },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setDetailTab(tab.key)}
                    className={`px-3 py-1.5 text-xs rounded-full border ${detailTab === tab.key ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="mt-5 min-w-0">
                {detailTab === 'overview' && (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                      <p className="text-xs uppercase tracking-wide text-zinc-500">专栏摘要</p>
                      <p className="mt-2 text-sm text-zinc-700 leading-6">
                        这里优先展示播客条目的独立阅读结果。没有转写任务时会提示你启动；有历史异常时会直接标记，不再假装是正常完成。
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded-xl border border-zinc-200 bg-white p-4">
                        <p className="text-xs text-zinc-500">摘要可读性</p>
                        <p className="mt-2 text-sm text-zinc-800">{summaryMarkdown.trim() ? '已有摘要结果' : '当前无摘要'}</p>
                      </div>
                      <div className="rounded-xl border border-zinc-200 bg-white p-4">
                        <p className="text-xs text-zinc-500">转写可读性</p>
                        <p className="mt-2 text-sm text-zinc-800">{transcriptMarkdown.trim() ? '已有转写结果' : '当前无转写'}</p>
                      </div>
                    </div>
                  </div>
                )}

                {detailTab === 'summary' && (
                  <MarkdownContent content={summaryMarkdown} empty="当前还没有可读摘要，请先转写或重跑任务。" />
                )}

                {detailTab === 'transcript' && (
                  <MarkdownContent content={transcriptMarkdown} empty="当前还没有可读转写。" />
                )}

                {detailTab === 'markdown' && (
                  <MarkdownContent content={exportMarkdown} empty="当前还没有可导出的 Markdown。" />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
