import { JevPanel } from '../components/JevPanel';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileAudio,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api, type AudioModelOption, type AudioTask } from '../lib/api';
import { startAudioUpload, subscribeAudioUpload } from '../lib/audio-upload-manager';
import {
  buildAudioWorkshopArtifacts,
  formatAudioTime,
  getAudioTemplate,
  resolveAudioPlaybackSource,
} from '../lib/audio-workshop';
import { AudioTaskSidebar } from '../features/audio/task-sidebar';
import { AudioResultPanel, type AudioDetailTab } from '../features/audio/result-panel';
import { AudioTemplatePicker } from '../features/audio/template-picker';
import { AudioInsightRail } from '../features/audio/insight-rail';
import {
  audioFailureDiagnostic,
  fmtBytes,
  fmtDuration,
  getStatusMeta,
  resultToMarkdown,
  stageStatusLabel,
} from '../features/audio/presentation';

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
  const [detailTab, setDetailTab] = useState<AudioDetailTab>('minutes');
  const [showFailureDetail, setShowFailureDetail] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showTechnicalPanel, setShowTechnicalPanel] = useState(false);
  const [viewTemplateId, setViewTemplateId] = useState('meeting_minutes');
  const [audioPlaybackUrl, setAudioPlaybackUrl] = useState('');
  const [audioPlaybackLoading, setAudioPlaybackLoading] = useState(false);
  const [audioPlaybackError, setAudioPlaybackError] = useState('');
  const [pendingSeekSeconds, setPendingSeekSeconds] = useState<number | null>(null);
  const [lastSeekSeconds, setLastSeekSeconds] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingSeekRef = useRef<number | null>(null);

  const [statusFilter, setStatusFilter] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  const [promptTemplateId, setPromptTemplateId] = useState('');
  const [userInstruction, setUserInstruction] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [asrModel, setAsrModel] = useState('');

  const [templates, setTemplates] = useState<Array<{ id: string; name: string; description?: string }>>([]);
  const [llmModels, setLlmModels] = useState<AudioModelOption[]>([]);
  const [asrModels, setAsrModels] = useState<AudioModelOption[]>([]);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [creatingFromUrl, setCreatingFromUrl] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaLoadingKey, setQaLoadingKey] = useState('');
  const [qaError, setQaError] = useState('');

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
    setDetailTab('minutes');
    setShowFailureDetail(false);
    setShowTemplatePicker(false);
    setShowTechnicalPanel(false);
    pendingSeekRef.current = null;
    setPendingSeekSeconds(null);
    setLastSeekSeconds(null);
    setQaQuestion('');
    setQaLoadingKey('');
    setQaError('');
  }, [selectedId]);

  const refreshAudioPlaybackUrl = useCallback(async () => {
    if (!selectedTask?.id || !selectedTask.audio_url) return;
    const initial = resolveAudioPlaybackSource({
      taskId: selectedTask.id,
      audioUrl: selectedTask.audio_url,
      signedPlaybackUrl: '',
      loading: false,
      error: '',
    });
    if (initial.status === 'ready') return;

    setAudioPlaybackLoading(true);
    setAudioPlaybackError('');
    try {
      const resp = await api.audio.getTaskAudioUrl(selectedTask.id);
      setAudioPlaybackUrl(resp.url || '');
    } catch (err) {
      setAudioPlaybackUrl('');
      setAudioPlaybackError((err as Error).message || '播放地址获取失败');
    } finally {
      setAudioPlaybackLoading(false);
    }
  }, [selectedTask?.audio_url, selectedTask?.id]);

  useEffect(() => {
    setAudioPlaybackUrl('');
    setAudioPlaybackError('');
    setAudioPlaybackLoading(false);
    if (!selectedTask?.id || !selectedTask.audio_url) return;

    const initial = resolveAudioPlaybackSource({
      taskId: selectedTask.id,
      audioUrl: selectedTask.audio_url,
      signedPlaybackUrl: '',
      loading: false,
      error: '',
    });
    if (initial.status === 'needs_signed_url') {
      void refreshAudioPlaybackUrl();
    }
  }, [refreshAudioPlaybackUrl, selectedTask?.audio_url, selectedTask?.id]);

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

  const selectedLlmOption = useMemo(
    () => llmModels.find((model) => model.id === llmModel),
    [llmModel, llmModels],
  );
  const selectedLlmUnavailable = selectedLlmOption?.available === false;

  const ensureLlmReady = () => {
    if (!selectedLlmUnavailable) return true;
    setError(selectedLlmOption?.unavailable_reason || '所选音频总结模型当前不可用');
    return false;
  };

  const handleUpload = async () => {
    if (!file || uploading) return;
    if (!ensureLlmReady()) return;
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
    if (!ensureLlmReady()) return;
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
    if (!ensureLlmReady()) return;
    setReprocessing(true);
    setError(null);
    try {
      await api.audio.reprocessTask(selectedTask.id, {
        prompt_template_id: promptTemplateId || undefined,
        llm_model: llmModel || undefined,
        stage: 'auto',
      });
      await fetchTasks(true);
      await fetchTaskDetail(selectedTask.id);
    } catch (err) {
      setError((err as Error).message || '重跑任务失败');
    } finally {
      setReprocessing(false);
    }
  };

  const handleAskAudio = async (question: string, promptKey?: string) => {
    const normalizedQuestion = question.trim();
    if (!selectedTask || normalizedQuestion.length < 2 || qaLoadingKey) return;
    const requestKey = promptKey || 'custom';
    setQaLoadingKey(requestKey);
    setQaError('');
    try {
      const response = await api.audio.askTask(selectedTask.id, {
        question: normalizedQuestion,
        prompt_key: promptKey,
      });
      setSelectedTask(response.task);
      if (!promptKey) setQaQuestion('');
    } catch (err) {
      setQaError((err as Error).message || 'AI 问答生成失败');
    } finally {
      setQaLoadingKey('');
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
  const audioPlaybackSource = useMemo(() => resolveAudioPlaybackSource({
    taskId: selectedTask?.id,
    audioUrl: selectedTask?.audio_url,
    signedPlaybackUrl: audioPlaybackUrl,
    loading: audioPlaybackLoading,
    error: audioPlaybackError,
  }), [audioPlaybackError, audioPlaybackLoading, audioPlaybackUrl, selectedTask?.audio_url, selectedTask?.id]);
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
  const selectedTemplate = useMemo(() => getAudioTemplate(viewTemplateId), [viewTemplateId]);
  const persistedAudioArtifacts = useMemo(() => {
    const summaryResult = selectedTask?.summary_result;
    return summaryResult && typeof summaryResult === 'object' && !Array.isArray(summaryResult)
      ? summaryResult.artifacts
      : null;
  }, [selectedTask?.summary_result]);
  const workshopArtifacts = useMemo(() => buildAudioWorkshopArtifacts({
    title: selectedTask?.title || '录音工作坊',
    summaryMarkdown,
    transcriptMarkdown,
    templateId: viewTemplateId,
    durationSeconds: selectedTask?.audio_duration,
    persistedArtifacts: persistedAudioArtifacts,
  }), [persistedAudioArtifacts, selectedTask?.audio_duration, selectedTask?.title, summaryMarkdown, transcriptMarkdown, viewTemplateId]);

  const applyAudioSeek = useCallback((seconds: number) => {
    const player = audioRef.current;
    if (!player || player.readyState === 0 || !Number.isFinite(seconds) || seconds < 0) return false;
    try {
      const upperBound = Number.isFinite(player.duration) && player.duration > 0
        ? Math.max(0, player.duration - 0.1)
        : seconds;
      const target = Math.min(seconds, upperBound);
      player.currentTime = target;
      void player.play().catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleAudioSeek = useCallback((seconds?: number | null) => {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return;
    pendingSeekRef.current = seconds;
    setPendingSeekSeconds(seconds);
    if (applyAudioSeek(seconds)) return;
    audioRef.current?.load();
    if (audioPlaybackSource.status === 'needs_signed_url' || audioPlaybackSource.status === 'failed') {
      void refreshAudioPlaybackUrl();
    }
  }, [applyAudioSeek, audioPlaybackSource.status, refreshAudioPlaybackUrl]);

  const handleAudioMetadataReady = useCallback(() => {
    if (pendingSeekRef.current !== null) applyAudioSeek(pendingSeekRef.current);
  }, [applyAudioSeek]);

  const handleAudioSeeked = useCallback(() => {
    const target = pendingSeekRef.current;
    const player = audioRef.current;
    if (target === null || !player || Math.abs(player.currentTime - target) > 2) return;
    pendingSeekRef.current = null;
    setPendingSeekSeconds(null);
    setLastSeekSeconds(target);
  }, []);

  useEffect(() => {
    if (pendingSeekSeconds === null || !audioPlaybackSource.src) return;
    const timer = window.setTimeout(() => applyAudioSeek(pendingSeekSeconds), 0);
    return () => window.clearTimeout(timer);
  }, [applyAudioSeek, audioPlaybackSource.src, pendingSeekSeconds]);
  const isActiveTask = ['uploading', 'preprocessing', 'transcribing', 'transcribing_fallback', 'summarizing', 'generating', 'post_processing'].includes(selectedTask?.status || '');
  const selectedFailure = audioFailureDiagnostic(selectedTask);
  const failureEmptyText = selectedFailure ? `${selectedFailure.title}：${selectedFailure.message}` : '暂无结果';

  return (
    <div className="p-6">
      <JevPanel scene="transcribe" />
      <JevPanel scene="transcript" />
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-zinc-900">音频工坊</h1>
          <p className="text-sm text-zinc-500 mt-1">上传文件或输入链接，自动执行转写与 AI 总结</p>
        </div>
        <button
          onClick={() => {
            void fetchTasks();
            if (selectedId) void fetchTaskDetail(selectedId);
          }}
          className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm rounded-lg border border-zinc-200 hover:bg-zinc-50"
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
        <AudioTaskSidebar
          tasks={tasks}
          loading={loading}
          selectedId={selectedId}
          onSelectTask={setSelectedId}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          file={file}
          onFileChange={setFile}
          title={title}
          onTitleChange={setTitle}
          url={url}
          onUrlChange={setUrl}
          asrModel={asrModel}
          onAsrModelChange={setAsrModel}
          llmModel={llmModel}
          onLlmModelChange={setLlmModel}
          asrModels={asrModels}
          llmModels={llmModels}
          promptTemplateId={promptTemplateId}
          onPromptTemplateIdChange={setPromptTemplateId}
          templates={templates}
          userInstruction={userInstruction}
          onUserInstructionChange={setUserInstruction}
          selectedLlmUnavailable={selectedLlmUnavailable}
          selectedLlmUnavailableReason={selectedLlmOption?.unavailable_reason}
          uploading={uploading}
          uploadProgress={uploadProgress}
          creatingFromUrl={creatingFromUrl}
          onUpload={() => void handleUpload()}
          onCreateFromUrl={() => void handleCreateFromUrl()}
        />

        <div className="border border-zinc-200 rounded-xl bg-white xl:flex xl:max-h-[calc(100vh-2rem)] xl:min-h-0 xl:flex-col xl:overflow-hidden">
          {detailLoading ? (
            <div className="p-4 text-center py-20 text-zinc-400">加载详情...</div>
          ) : selectedTask ? (
            <>
              <div data-audio-detail-header className="border-b border-zinc-100 bg-white/95 px-4 py-4 backdrop-blur xl:shrink-0">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-zinc-900">{selectedTask.title}</h2>
                  <p className={`mt-1 text-xs inline-flex items-center gap-1 ${selectedStatus.tone}`}>
                    <SelectedStatusIcon size={12} className={isActiveTask ? 'animate-spin' : ''} />
                    {selectedStatus.label} · 时长 {fmtDuration(selectedTask.audio_duration)} · {fmtBytes(selectedTask.audio_file_size)}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    onClick={handleReprocess}
                    disabled={reprocessing}
                    className="inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-zinc-200 px-3 py-2 text-xs hover:bg-zinc-50 disabled:opacity-40"
                  >
                    {reprocessing ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                    {selectedTask.asr_status === 'ready' ? '重做纪要' : '重新转写'}
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-red-200 px-3 py-2 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40"
                  >
                    {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    删除
                  </button>
                </div>
              </div>
              </div>

              <div data-audio-detail-reader className="bg-[#fbfaf8] px-4 pb-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain xl:pr-4">
                <div className="mx-auto max-w-[1180px]">
                  <div className="mt-4 rounded-[28px] border border-zinc-200 bg-white px-4 py-4 shadow-sm">
                    {selectedTask.audio_url ? (
                      audioPlaybackSource.src ? (
                        <audio
                          key={audioPlaybackSource.src}
                          ref={audioRef}
                          controls
                          src={audioPlaybackSource.src}
                          preload="metadata"
                          className="w-full"
                          onLoadedMetadata={handleAudioMetadataReady}
                          onSeeked={handleAudioSeeked}
                        />
                      ) : (
                        <div className="flex min-h-14 flex-col gap-2 rounded-2xl bg-zinc-50 px-4 py-3 text-sm text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
                          <span>{audioPlaybackSource.message}</span>
                          {audioPlaybackSource.status === 'loading' ? (
                            <span className="inline-flex items-center gap-1 text-teal-700">
                              <Loader2 size={14} className="animate-spin" /> 获取播放地址
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void refreshAudioPlaybackUrl()}
                              className="inline-flex min-h-8 shrink-0 items-center justify-center gap-1 rounded-xl border border-zinc-200 bg-white px-3 text-xs hover:bg-zinc-50"
                            >
                              <RefreshCw size={12} /> 重新获取
                            </button>
                          )}
                        </div>
                      )
                    ) : (
                      <div className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-zinc-50 px-4 text-sm text-zinc-600">
                        <span>{audioPlaybackSource.message}</span>
                        <span className={selectedStatus.tone}>{selectedStatus.label}</span>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span className="rounded-full bg-zinc-100 px-3 py-1">转写：{stageStatusLabel(selectedTask.asr_status)}</span>
                      <span className="rounded-full bg-zinc-100 px-3 py-1">AI纪要：{stageStatusLabel(selectedTask.summary_status)}</span>
                      <span className="rounded-full bg-zinc-100 px-3 py-1">模板：{selectedTemplate.name}</span>
                      {lastSeekSeconds !== null && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-3 py-1 text-teal-700">
                          <Play size={11} /> 已定位 {formatAudioTime(lastSeekSeconds)}
                        </span>
                      )}
                      {pendingSeekSeconds !== null && lastSeekSeconds === null && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-amber-700">
                          <Loader2 size={11} className="animate-spin" /> 正在准备 {formatAudioTime(pendingSeekSeconds)}
                        </span>
                      )}
                    </div>
                  </div>

                  {selectedFailure && (
                    <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="font-semibold">{selectedFailure.title}</div>
                          <p className="mt-1 leading-6">{selectedFailure.message}</p>
                          <p className="mt-1 text-xs leading-5 text-red-700/80">{selectedFailure.action}</p>
                        </div>
                        {selectedFailure.technicalDetail && (
                          <button
                            type="button"
                            onClick={() => setShowFailureDetail((value) => !value)}
                            className="inline-flex min-h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            {showFailureDetail ? '收起技术详情' : '查看技术详情'}
                          </button>
                        )}
                      </div>
                      {showFailureDetail && selectedFailure.technicalDetail && (
                        <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-red-100 bg-white px-3 py-2 text-xs leading-5 text-red-700">
                          {selectedFailure.technicalDetail}
                        </pre>
                      )}
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
                    <main className="min-w-0 rounded-[28px] border border-zinc-200 bg-white">
                      <AudioTemplatePicker
                        open={showTemplatePicker}
                        selectedTemplate={selectedTemplate}
                        readingHint={workshopArtifacts.readingHint}
                        onToggle={() => setShowTemplatePicker((value) => !value)}
                        onSelect={(templateId) => {
                          setViewTemplateId(templateId);
                          setShowTemplatePicker(false);
                          setDetailTab('minutes');
                        }}
                      />

                      <AudioResultPanel
                        detailTab={detailTab}
                        onDetailTabChange={setDetailTab}
                        selectedTemplateName={selectedTemplate.name}
                        summaryMarkdown={summaryMarkdown}
                        transcriptMarkdown={transcriptMarkdown}
                        summaryFailed={selectedTask.summary_status === 'failed'}
                        transcriptFailed={selectedTask.asr_status === 'failed'}
                        failureEmptyText={failureEmptyText}
                        artifacts={workshopArtifacts}
                        onSeek={handleAudioSeek}
                        qaQuestion={qaQuestion}
                        onQaQuestionChange={setQaQuestion}
                        qaLoadingKey={qaLoadingKey}
                        qaError={qaError}
                        onAsk={(question, promptKey) => void handleAskAudio(question, promptKey)}
                      />
                    </main>

                    <AudioInsightRail
                      artifacts={workshopArtifacts}
                      selectedTask={selectedTask}
                      mergedMarkdown={mergedMarkdown}
                      rawPayload={rawPayload}
                      reprocessing={reprocessing}
                      showTechnicalPanel={showTechnicalPanel}
                      onDetailTabChange={setDetailTab}
                      onSeek={handleAudioSeek}
                      onReprocess={() => void handleReprocess()}
                      onToggleTechnicalPanel={() => setShowTechnicalPanel((value) => !value)}
                    />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-zinc-400 h-full flex flex-col items-center justify-center p-4 text-center">
              <FileAudio size={28} />
              <p className="mt-2 text-sm">从左侧选择一个音频任务查看详情</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
