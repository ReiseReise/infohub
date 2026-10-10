import { Link2, Loader2, Upload } from 'lucide-react';
import type { AudioModelOption, AudioTask } from '../../lib/api';
import { fmtBytes, fmtDuration, getStatusMeta } from './presentation';

interface AudioTaskSidebarProps {
  tasks: AudioTask[];
  loading: boolean;
  selectedId: string;
  onSelectTask: (taskId: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  file: File | null;
  onFileChange: (file: File | null) => void;
  title: string;
  onTitleChange: (value: string) => void;
  url: string;
  onUrlChange: (value: string) => void;
  asrModel: string;
  onAsrModelChange: (value: string) => void;
  llmModel: string;
  onLlmModelChange: (value: string) => void;
  asrModels: AudioModelOption[];
  llmModels: AudioModelOption[];
  promptTemplateId: string;
  onPromptTemplateIdChange: (value: string) => void;
  templates: Array<{ id: string; name: string; description?: string }>;
  userInstruction: string;
  onUserInstructionChange: (value: string) => void;
  selectedLlmUnavailable: boolean;
  selectedLlmUnavailableReason?: string | null;
  uploading: boolean;
  uploadProgress: number | null;
  creatingFromUrl: boolean;
  onUpload: () => void;
  onCreateFromUrl: () => void;
}

export function AudioTaskSidebar({
  tasks,
  loading,
  selectedId,
  onSelectTask,
  statusFilter,
  onStatusFilterChange,
  file,
  onFileChange,
  title,
  onTitleChange,
  url,
  onUrlChange,
  asrModel,
  onAsrModelChange,
  llmModel,
  onLlmModelChange,
  asrModels,
  llmModels,
  promptTemplateId,
  onPromptTemplateIdChange,
  templates,
  userInstruction,
  onUserInstructionChange,
  selectedLlmUnavailable,
  selectedLlmUnavailableReason,
  uploading,
  uploadProgress,
  creatingFromUrl,
  onUpload,
  onCreateFromUrl,
}: AudioTaskSidebarProps) {
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
          <Upload size={16} className="text-blue-600" /> 上传或抓取
        </h2>

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-white">
          <span className="min-w-0 truncate">{file?.name || '选择音频或视频文件'}</span>
          <span className="shrink-0 rounded-md bg-white px-2 py-1 text-xs font-medium text-zinc-700 shadow-sm">浏览</span>
          <input
            type="file"
            accept=".mp3,.m4a,.wav,.flac,.ogg,.mp4,.webm,.aac,.wma"
            onChange={(event) => onFileChange(event.target.files?.[0] || null)}
            className="sr-only"
          />
        </label>

        <input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="任务标题（可选）"
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
        />

        <div className="grid grid-cols-2 gap-2">
          <select aria-label="ASR 模型" className="rounded-lg border border-zinc-200 px-2 py-2 text-sm" value={asrModel} onChange={(event) => onAsrModelChange(event.target.value)}>
            <option value="">ASR 模型（默认）</option>
            {asrModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
          </select>
          <select aria-label="LLM 模型" className="rounded-lg border border-zinc-200 px-2 py-2 text-sm" value={llmModel} onChange={(event) => onLlmModelChange(event.target.value)}>
            <option value="">LLM 模型（默认）</option>
            {llmModels.map((model) => (
              <option key={model.id} value={model.id} disabled={model.available === false}>
                {model.name}{model.available === false ? '（不可用）' : ''}
              </option>
            ))}
          </select>
        </div>

        {selectedLlmUnavailable && (
          <p className="text-xs leading-5 text-amber-700">
            {selectedLlmUnavailableReason || '所选音频总结模型当前不可用'}
          </p>
        )}

        <select aria-label="Prompt 模板" className="w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm" value={promptTemplateId} onChange={(event) => onPromptTemplateIdChange(event.target.value)}>
          <option value="">Prompt 模板（默认）</option>
          {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>

        <textarea
          value={userInstruction}
          onChange={(event) => onUserInstructionChange(event.target.value)}
          placeholder="补充要求（可选）"
          className="min-h-[90px] w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
        />

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onUpload}
            disabled={!file || uploading || selectedLlmUnavailable}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? `上传中${uploadProgress ? ` ${uploadProgress}%` : ''}` : '上传文件'}
          </button>
          <button
            onClick={onCreateFromUrl}
            disabled={!url.trim() || creatingFromUrl || selectedLlmUnavailable}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-40"
          >
            {creatingFromUrl ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
            链接抓取
          </button>
        </div>

        {uploading && (
          <>
            <div className="h-2 w-full overflow-hidden rounded bg-zinc-100">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.max(5, uploadProgress || 5)}%` }} />
            </div>
            <p className="text-[11px] text-zinc-500">切换到其他页面上传不会中断，可在右上角“音频上传任务”查看进度。</p>
          </>
        )}

        <input
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="粘贴播客/音频链接（支持小宇宙、YouTube、直链）"
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex min-h-0 flex-col rounded-xl border border-zinc-200 bg-white">
        <div className="flex items-center gap-2 border-b border-zinc-200 p-3">
          <select
            aria-label="音频任务状态"
            className="rounded-md border border-zinc-200 px-2 py-1 text-xs"
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value)}
          >
            <option value="">全部状态</option>
            <option value="uploading">上传中</option>
            <option value="transcribing">转写中</option>
            <option value="summarizing">摘要中</option>
            <option value="generating">生成中</option>
            <option value="done">已完成</option>
            <option value="failed">失败</option>
          </select>
          <span className="ml-auto text-xs text-zinc-500">{tasks.length} 个任务</span>
        </div>

        <div className="max-h-[50vh] flex-1 divide-y divide-zinc-100 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-sm text-zinc-500">加载中...</div>
          ) : tasks.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-400">暂无任务</div>
          ) : tasks.map((task) => {
            const meta = getStatusMeta(task);
            const Icon = meta.icon;
            const spinning = ['uploading', 'preprocessing', 'transcribing', 'transcribing_fallback', 'summarizing', 'generating', 'post_processing'].includes(task.status || '');
            return (
              <button
                key={task.id}
                onClick={() => onSelectTask(task.id)}
                className={`w-full p-3 text-left hover:bg-zinc-50 ${selectedId === task.id ? 'bg-zinc-50' : ''}`}
              >
                <p className="line-clamp-1 text-sm text-zinc-900">{task.title}</p>
                <p className={`mt-1 inline-flex items-center gap-1 text-xs ${meta.tone}`}>
                  <Icon size={12} className={spinning ? 'animate-spin' : ''} />
                  {meta.label} · {fmtDuration(task.audio_duration)} · {fmtBytes(task.audio_file_size)}
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-zinc-100">
                  <div
                    className={`h-full transition-all ${task.status === 'failed' ? 'bg-red-500' : task.status === 'done' ? 'bg-emerald-500' : 'bg-blue-500'}`}
                    style={{ width: `${meta.progress}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
