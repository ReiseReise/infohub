import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileAudio,
  Link2,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  Wand2,
  XCircle,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api, type AudioTask } from '../lib/api';
import { startAudioUpload, subscribeAudioUpload } from '../lib/audio-upload-manager';
import { MarkdownContent } from '../components/MarkdownContent';

const STATUS_META: Record<string, { label: string; progress: number; tone: string; icon: ComponentType<{ size?: number; className?: string }> }> = {
  uploading: { label: '准备中', progress: 15, tone: 'text-blue-600', icon: Loader2 },
  preprocessing: { label: '预处理中', progress: 30, tone: 'text-sky-600', icon: Loader2 },
  transcribing: { label: '转写中', progress: 45, tone: 'text-cyan-600', icon: Loader2 },
  transcribing_fallback: { label: '转写兜底中', progress: 52, tone: 'text-teal-600', icon: Loader2 },
  summarizing: { label: '摘要中', progress: 70, tone: 'text-indigo-600', icon: Loader2 },
  generating: { label: '生成中', progress: 85, tone: 'text-purple-600', icon: Loader2 },
  post_processing: { label: '后处理中', progress: 92, tone: 'text-violet-600', icon: Loader2 },
  done: { label: '已完成', progress: 100, tone: 'text-emerald-600', icon: CheckCircle2 },
  timeout: { label: '超时', progress: 100, tone: 'text-amber-700', icon: Clock3 },
  error: { label: '失败', progress: 100, tone: 'text-red-600', icon: XCircle },
  failed: { label: '失败', progress: 100, tone: 'text-red-600', icon: XCircle },
};

const DOWNLOAD_STAGE_META: Record<string, { label: string; progress: number; tone: string }> = {
  queued: { label: '任务已创建', progress: 8, tone: 'text-sky-600' },
  resolving: { label: '解析链接中', progress: 15, tone: 'text-blue-600' },
  downloading: { label: '下载音频中', progress: 25, tone: 'text-blue-700' },
  finished: { label: '下载完成，准备转写', progress: 35, tone: 'text-cyan-700' },
};

function getStatusMeta(task?: AudioTask | null) {
  if (task?.task_integrity_status === 'repair_needed') {
    return {
      label: '历史结果异常',
      progress: 100,
      tone: 'text-amber-700',
      icon: AlertTriangle,
    };
  }
  const status = task?.status || '';

  if (status === 'uploading') {
    const stage = (task?.download_stage || '').toLowerCase();
    const stageMeta = stage ? DOWNLOAD_STAGE_META[stage] : null;
    if (stageMeta) {
      return {
        label: stageMeta.label,
        progress: stageMeta.progress,
        tone: stageMeta.tone,
        icon: Loader2,
      };
    }
  }

  return STATUS_META[status] || {
    label: status || '未知',
    progress: 10,
    tone: 'text-zinc-500',
    icon: Clock3,
  };
}

function fmtBytes(size?: number | null) {
  if (!size || size <= 0) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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
    if (typeof record.content === 'string') return record.content;
    return `\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\``;
  }

  return String(value);
}

function sourceKindLabel(kind?: string | null): string {
  const value = (kind || '').toLowerCase();
  if (value === 'podcast_page') return '播客页面';
  if (value === 'direct_audio') return '音频直链';
  if (value === 'youtube') return 'YouTube';
  return '未知来源';
}

function strategyLabel(strategy?: string | null): string {
  const value = (strategy || '').toLowerCase();
  if (value === 'yt_dlp') return 'yt-dlp';
  if (value === 'direct_http') return '直连下载';
  if (value === 'page_extract') return '页面抽取';
  if (value === 'xiaoyuzhou_extract') return '小宇宙抽取';
  return value || '—';
}

function asrModeLabel(mode?: string | null): string {
  const value = (mode || '').toLowerCase();
  if (value === 'sync' || value === 'realtime_sync') return '本地实时';
  if (value === 'async' || value === 'batch_async' || value === 'remote_batch') return '远程批量';
  return value || '—';
}

function providerLabel(provider?: string | null): string {
  const value = (provider || '').toLowerCase();
  if (value === 'paraformer') return 'DashScope Paraformer';
  if (value === 'tingwu') return '阿里听悟';
  return value || '—';
}

function storageBackendLabel(backend?: string | null): string {
  const value = (backend || '').toLowerCase();
  if (value === 'oss') return '阿里云 OSS';
  if (value === 'local') return '本地存储';
  return value || '—';
}

type AudioDetailTab = 'overview' | 'summary' | 'transcript' | 'markdown' | 'raw';

export function AudioStudio() {
  const [searchParams] = useSearchParams();
  const taskIdFromQuery = (searchParams.get('taskId') || '').trim();
  const urlFromQuery = (searchParams.get('url') || '').trim();

  const [tasks, setTasks] = useState<AudioTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string>('');
  const [selectedTask, setSelectedTask] = useState<AudioTask | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<AudioDetailTab>('overview');

  const [statusFilter, setStatusFilter] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  const [promptTemplateId, setPromptTemplateId] = useState('');
  const [userInstruction, setUserInstruction] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [asrModel, setAsrModel] = useState('');

  const [templates, setTemplates] = useState<Array<{ id: string; name: string; description?: string }>>([]);
  const [llmModels, setLlmModels] = useState<Array<{ id: string; name: string; description?: string }>>([]);
  const [asrModels, setAsrModels] = useState<Array<{ id: string; name: string; description?: string }>>([]);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [creatingFromUrl, setCreatingFromUrl] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchTasks = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const resp = await api.audio.listTasks({ page: 1, page_size: 100, status: statusFilter || undefined });
      setTasks(resp.items || []);
      if (taskIdFromQuery) {
        setSelectedId(taskIdFromQuery);
      } else if (!selectedId && resp.items?.[0]?.id) {
        setSelectedId(resp.items[0].id);
      }
      if (selectedId && !resp.items.some((item) => item.id === selectedId)) {
        if (!taskIdFromQuery) {
          setSelectedId('');
          setSelectedTask(null);
        }
      }
    } catch (err) {
      setError((err as Error).message || '任务列表加载失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedId, statusFilter, taskIdFromQuery]);

  const fetchTaskDetail = useCallback(async (taskId: string) => {
    setDetailLoading(true);
    try {
      const resp = await api.audio.getTask(taskId);
      setSelectedTask(resp);
    } catch (err) {
      setError((err as Error).message || '任务详情加载失败');
      setSelectedTask(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const fetchConfigs = useCallback(async () => {
    try {
      const [tplRes, modelRes] = await Promise.all([
        api.audio.getTaskTemplates(),
        api.audio.getTaskModels(),
      ]);
      setTemplates(tplRes || []);
      setLlmModels(modelRes.llm_models || []);
      setAsrModels(modelRes.asr_models || []);
    } catch {
      // 配置读取失败不阻塞任务流程
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    const timer = setInterval(() => {
      void fetchTasks(true);
      if (selectedId) {
        void fetchTaskDetail(selectedId);
      }
    }, 10_000);
    return () => clearInterval(timer);
  }, [fetchTaskDetail, fetchTasks, selectedId]);

  useEffect(() => {
    void fetchConfigs();
  }, [fetchConfigs]);

  useEffect(() => {
    if (!urlFromQuery) return;
    setUrl(urlFromQuery);
  }, [urlFromQuery]);

  useEffect(() => {
    if (!taskIdFromQuery) return;
    setSelectedId(taskIdFromQuery);
    void fetchTaskDetail(taskIdFromQuery);
  }, [fetchTaskDetail, taskIdFromQuery]);

  useEffect(() => {
    if (selectedId) {
      void fetchTaskDetail(selectedId);
    } else {
      setSelectedTask(null);
    }
  }, [fetchTaskDetail, selectedId]);

  useEffect(() => {
    setDetailTab('overview');
  }, [selectedId]);

  useEffect(() => {
    return subscribeAudioUpload((uploadState) => {
      setUploading(uploadState.status === 'uploading');
      if (uploadState.status === 'uploading') {
        setUploadProgress(uploadState.progress || 1);
      }
      if (uploadState.status === 'success' && uploadState.task?.id) {
        setUploadProgress(null);
        setSelectedId(uploadState.task.id);
        setFile(null);
        setTitle('');
        void fetchTasks(true);
        void fetchTaskDetail(uploadState.task.id);
      }
      if (uploadState.status === 'error') {
        setUploadProgress(null);
        setError(uploadState.error || '音频上传失败');
      }
    });
  }, [fetchTaskDetail, fetchTasks]);

  const handleUpload = async () => {
    if (!file || uploading) return;
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    if (title.trim()) formData.append('title', title.trim());
    if (promptTemplateId) formData.append('prompt_template_id', promptTemplateId);
    if (userInstruction.trim()) formData.append('user_instruction', userInstruction.trim());
    if (llmModel) formData.append('llm_model', llmModel);
    if (asrModel) formData.append('asr_model', asrModel);

    try {
      const task = await startAudioUpload(formData);
      setSelectedId(task.id);
      setFile(null);
      setTitle('');
      setUploadProgress(null);
      await fetchTasks(true);
      await fetchTaskDetail(task.id);
    } catch (err) {
      setError((err as Error).message || '音频上传失败');
      setUploadProgress(null);
    }
  };

  const handleCreateFromUrl = async () => {
    if (!url.trim() || creatingFromUrl) return;
    setCreatingFromUrl(true);
    setError(null);
    try {
      const task = await api.audio.createFromUrl({
        url: url.trim(),
        prompt_template_id: promptTemplateId || undefined,
        user_instruction: userInstruction.trim() || undefined,
        llm_model: llmModel || undefined,
      });
      setSelectedId(task.id);
      setUrl('');
      await fetchTasks(true);
      await fetchTaskDetail(task.id);
    } catch (err) {
      setError((err as Error).message || '链接抓取失败');
    } finally {
      setCreatingFromUrl(false);
    }
  };

  const handleReprocess = async () => {
    if (!selectedTask || reprocessing) return;
    setReprocessing(true);
    setError(null);
    try {
      await api.audio.reprocessTask(selectedTask.id, {
        prompt_template_id: promptTemplateId || undefined,
        llm_model: llmModel || undefined,
      });
      await fetchTasks(true);
      await fetchTaskDetail(selectedTask.id);
    } catch (err) {
      setError((err as Error).message || '重跑任务失败');
    } finally {
      setReprocessing(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedTask || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await api.audio.deleteTask(selectedTask.id);
      setSelectedId('');
      setSelectedTask(null);
      await fetchTasks(true);
    } catch (err) {
      setError((err as Error).message || '删除任务失败');
    } finally {
      setDeleting(false);
    }
  };

  const selectedStatus = getStatusMeta(selectedTask);
  const SelectedStatusIcon = selectedStatus.icon;
  const summaryMarkdown = useMemo(() => resultToMarkdown(selectedTask?.summary_result), [selectedTask]);
  const transcriptMarkdown = useMemo(() => resultToMarkdown(selectedTask?.transcript_text), [selectedTask]);
  const mergedMarkdown = useMemo(() => {
    if (selectedTask?.export_markdown?.trim()) return selectedTask.export_markdown;
    const sections = [
      summaryMarkdown ? `# AI 总结\n\n${summaryMarkdown}` : '',
      transcriptMarkdown ? `# 转写稿\n\n${transcriptMarkdown}` : '',
    ].filter(Boolean);
    return sections.join('\n\n');
  }, [selectedTask?.export_markdown, summaryMarkdown, transcriptMarkdown]);
  const rawPayload = useMemo(() => JSON.stringify({
    summary_result: selectedTask?.summary_result ?? null,
    transcript_text: selectedTask?.transcript_text ?? null,
    multimodal_result: selectedTask?.multimodal_result ?? null,
  }, null, 2), [selectedTask]);
  const isActiveTask = ['uploading', 'preprocessing', 'transcribing', 'transcribing_fallback', 'summarizing', 'generating', 'post_processing'].includes(selectedTask?.status || '');

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">音频工坊</h1>
          <p className="text-sm text-zinc-500 mt-1">上传文件或输入链接，自动执行转写与 AI 总结</p>
        </div>
        <button
          onClick={() => {
            void fetchTasks();
            if (selectedId) void fetchTaskDetail(selectedId);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-zinc-200 hover:bg-zinc-50"
        >
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

              {error && (
                <div className="mb-4 px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
                  {error}
                </div>
              )}
              {selectedTask?.task_integrity_status === 'repair_needed' && (
                <div className="mb-4 px-3 py-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg">
                  {selectedTask.task_integrity_reason || '这是一条历史异常任务，建议点击“重跑”重新生成。'}
                </div>
              )}

      <div className="grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] gap-4 min-h-[560px]">
        <div className="flex flex-col gap-4 min-h-0">
          <div className="border border-zinc-200 rounded-xl bg-white p-4 space-y-3">
            <h2 className="text-sm font-semibold text-zinc-800 flex items-center gap-2">
              <Upload size={16} className="text-blue-600" /> 上传或抓取
            </h2>

            <input
              type="file"
              accept=".mp3,.m4a,.wav,.flac,.ogg,.mp4,.webm,.aac,.wma"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2"
            />

            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="任务标题（可选）"
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2"
            />

            <div className="grid grid-cols-2 gap-2">
              <select className="text-sm border border-zinc-200 rounded-lg px-2 py-2" value={asrModel} onChange={(e) => setAsrModel(e.target.value)}>
                <option value="">ASR 模型（默认）</option>
                {asrModels.map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>

              <select className="text-sm border border-zinc-200 rounded-lg px-2 py-2" value={llmModel} onChange={(e) => setLlmModel(e.target.value)}>
                <option value="">LLM 模型（默认）</option>
                {llmModels.map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
            </div>

            <select className="w-full text-sm border border-zinc-200 rounded-lg px-2 py-2" value={promptTemplateId} onChange={(e) => setPromptTemplateId(e.target.value)}>
              <option value="">Prompt 模板（默认）</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
              ))}
            </select>

            <textarea
              value={userInstruction}
              onChange={(e) => setUserInstruction(e.target.value)}
              placeholder="补充要求（可选）"
              className="w-full min-h-[90px] text-sm border border-zinc-200 rounded-lg px-3 py-2"
            />

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleUpload}
                disabled={!file || uploading}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white disabled:opacity-40"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploading ? `上传中${uploadProgress ? ` ${uploadProgress}%` : ''}` : '上传文件'}
              </button>

              <button
                onClick={handleCreateFromUrl}
                disabled={!url.trim() || creatingFromUrl}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-zinc-200 hover:bg-zinc-50 disabled:opacity-40"
              >
                {creatingFromUrl ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                链接抓取
              </button>
            </div>

            {uploading && (
              <div className="w-full h-2 rounded bg-zinc-100 overflow-hidden">
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.max(5, uploadProgress || 5)}%` }} />
              </div>
            )}

            {uploading && (
              <p className="text-[11px] text-zinc-500">切换到其他页面上传不会中断，可在右上角“音频上传任务”查看进度。</p>
            )}

            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="粘贴播客/音频链接（支持小宇宙、YouTube、直链）"
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2"
            />
          </div>

          <div className="border border-zinc-200 rounded-xl bg-white min-h-0 flex flex-col">
            <div className="p-3 border-b border-zinc-200 flex items-center gap-2">
              <select
                className="text-xs border border-zinc-200 rounded-md px-2 py-1"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">全部状态</option>
                <option value="uploading">上传中</option>
                <option value="transcribing">转写中</option>
                <option value="summarizing">摘要中</option>
                <option value="generating">生成中</option>
                <option value="done">已完成</option>
                <option value="failed">失败</option>
              </select>
              <span className="text-xs text-zinc-500 ml-auto">{tasks.length} 个任务</span>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[50vh] divide-y divide-zinc-100">
              {loading ? (
                <div className="p-4 text-sm text-zinc-500">加载中...</div>
              ) : tasks.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-400">暂无任务</div>
              ) : (
                tasks.map((task) => {
                  const meta = getStatusMeta(task);
                  const Icon = meta.icon;
                  const spinning = ['uploading', 'preprocessing', 'transcribing', 'transcribing_fallback', 'summarizing', 'generating', 'post_processing'].includes(task.status || '');
                  return (
                    <button
                      key={task.id}
                      onClick={() => setSelectedId(task.id)}
                      className={`w-full text-left p-3 hover:bg-zinc-50 ${selectedId === task.id ? 'bg-zinc-50' : ''}`}
                    >
                      <p className="text-sm text-zinc-900 line-clamp-1">{task.title}</p>
                      <p className={`text-xs mt-1 inline-flex items-center gap-1 ${meta.tone}`}>
                        <Icon size={12} className={spinning ? 'animate-spin' : ''} />
                        {meta.label} · {fmtDuration(task.audio_duration)} · {fmtBytes(task.audio_file_size)}
                      </p>
                      <div className="mt-2 w-full h-1.5 rounded bg-zinc-100 overflow-hidden">
                        <div
                          className={`h-full transition-all ${task.status === 'failed' ? 'bg-red-500' : task.status === 'done' ? 'bg-emerald-500' : 'bg-blue-500'}`}
                          style={{ width: `${meta.progress}%` }}
                        />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="border border-zinc-200 rounded-xl bg-white p-4 max-h-[76vh] overflow-y-auto">
          {detailLoading ? (
            <div className="text-center py-20 text-zinc-400">加载详情...</div>
          ) : selectedTask ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900">{selectedTask.title}</h2>
                  <p className={`mt-1 text-xs inline-flex items-center gap-1 ${selectedStatus.tone}`}>
                    <SelectedStatusIcon size={12} className={isActiveTask ? 'animate-spin' : ''} />
                    {selectedStatus.label} · 时长 {fmtDuration(selectedTask.audio_duration)} · {fmtBytes(selectedTask.audio_file_size)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleReprocess}
                    disabled={reprocessing}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border border-zinc-200 hover:bg-zinc-50 disabled:opacity-40"
                  >
                    {reprocessing ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                    重跑
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-40"
                  >
                    {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    删除
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 text-xs text-zinc-600">
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">创建时间：{selectedTask.created_at ? new Date(selectedTask.created_at).toLocaleString('zh-CN') : '—'}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">更新时间：{selectedTask.updated_at ? new Date(selectedTask.updated_at).toLocaleString('zh-CN') : '—'}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">来源类型：{sourceKindLabel(selectedTask.source_kind)}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">抓取策略：{strategyLabel(selectedTask.download_strategy)}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">存储后端：{storageBackendLabel(selectedTask.storage_backend)}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">转写状态：{selectedTask.asr_status || '—'}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">摘要状态：{selectedTask.summary_status || '—'}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">请求 ASR：{providerLabel(selectedTask.requested_asr_model || selectedTask.asr_model)}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">实际 ASR：{providerLabel(selectedTask.effective_asr_model || selectedTask.requested_asr_model || selectedTask.asr_model)}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">执行模式：{asrModeLabel(selectedTask.asr_mode)}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">选路原因：{selectedTask.asr_selection_reason || '—'}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">兜底提供方：{providerLabel(selectedTask.fallback_provider)}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">兜底原因：{selectedTask.fallback_reason || '—'}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100 md:col-span-2 xl:col-span-3 break-all">
                  原始链接：{selectedTask.source_url || '—'}
                </div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">失败码：{selectedTask.failure_code || '—'}</div>
                <div className="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">失败详情：{selectedTask.failure_detail || '—'}</div>
              </div>

              <div className="mt-5 flex gap-2 flex-wrap">
                {[
                  ['overview', '概览'],
                  ['summary', '摘要'],
                  ['transcript', '转写'],
                  ['markdown', 'Markdown'],
                  ['raw', '原始结果'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setDetailTab(key as AudioDetailTab)}
                    className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                      detailTab === key
                        ? 'bg-zinc-900 text-white'
                        : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-[24px] border border-zinc-100 bg-[#fffdfa] px-5 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                {detailTab === 'overview' && (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-4">
                      <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-400">AI 总结</div>
                      <div className="mt-3">
                        <MarkdownContent
                          content={summaryMarkdown}
                          empty={selectedTask.summary_status === 'failed' ? (selectedTask.failure_detail || selectedTask.error_message || '摘要未生成') : '暂无总结结果'}
                        />
                      </div>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-4">
                      <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-400">执行诊断</div>
                      <div className="mt-3 space-y-2 text-sm text-zinc-700">
                        <p>ASR 选路：{providerLabel(selectedTask.effective_asr_model || selectedTask.requested_asr_model || selectedTask.asr_model)}</p>
                        <p>执行模式：{asrModeLabel(selectedTask.asr_mode)}</p>
                        <p>存储后端：{storageBackendLabel(selectedTask.storage_backend)}</p>
                        <p>失败原因：{selectedTask.failure_detail || selectedTask.error_message || '—'}</p>
                        <p>结果渲染：{selectedTask.render_status || '—'}</p>
                      </div>
                    </div>
                  </div>
                )}

                {detailTab === 'summary' && (
                  <MarkdownContent
                    content={summaryMarkdown}
                    empty={selectedTask.summary_status === 'failed' ? (selectedTask.failure_detail || selectedTask.error_message || '摘要未生成') : '暂无总结结果'}
                  />
                )}

                {detailTab === 'transcript' && (
                  <MarkdownContent
                    content={transcriptMarkdown}
                    empty={selectedTask.asr_status === 'failed' ? (selectedTask.failure_detail || selectedTask.error_message || '转写失败') : '暂无转写内容'}
                  />
                )}

                {detailTab === 'markdown' && (
                  <MarkdownContent content={mergedMarkdown} empty="暂无 Markdown 视图" />
                )}

                {detailTab === 'raw' && (
                  <pre className="overflow-x-auto rounded-2xl border border-zinc-200 bg-zinc-950 px-4 py-4 text-xs leading-6 text-zinc-100">
                    {rawPayload}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <div className="text-zinc-400 h-full flex flex-col items-center justify-center text-center">
              <FileAudio size={28} />
              <p className="mt-2 text-sm">从左侧选择一个音频任务查看详情</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
