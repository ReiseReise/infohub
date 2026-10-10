import { Loader2, MessageCircle, Sparkles, Wand2 } from 'lucide-react';
import type { AudioTask } from '../../lib/api';
import type { AudioWorkshopArtifacts } from '../../lib/audio-workshop';
import type { AudioDetailTab } from './result-panel';
import {
  asrModeLabel,
  providerLabel,
  sourceKindLabel,
  storageBackendLabel,
  strategyLabel,
} from './presentation';

interface AudioInsightRailProps {
  artifacts: AudioWorkshopArtifacts;
  selectedTask: AudioTask;
  mergedMarkdown: string;
  rawPayload: string;
  reprocessing: boolean;
  showTechnicalPanel: boolean;
  onDetailTabChange: (tab: AudioDetailTab) => void;
  onSeek: (seconds?: number | null) => void;
  onReprocess: () => void;
  onToggleTechnicalPanel: () => void;
}

export function AudioInsightRail({
  artifacts,
  selectedTask,
  mergedMarkdown,
  rawPayload,
  reprocessing,
  showTechnicalPanel,
  onDetailTabChange,
  onSeek,
  onReprocess,
  onToggleTechnicalPanel,
}: AudioInsightRailProps) {
  return (
    <aside className="space-y-4 2xl:sticky 2xl:top-4 2xl:self-start">
      <div className="rounded-[24px] border border-zinc-200 bg-white px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
          <Sparkles size={16} /> 快速洞察
        </div>
        <div className="mt-3 space-y-3 text-sm leading-6 text-zinc-600">
          {artifacts.highlights.slice(0, 3).map((moment) => (
            <button
              key={moment.id}
              type="button"
              onClick={() => {
                onDetailTabChange('highlights');
                onSeek(moment.startSeconds);
              }}
              className="block w-full rounded-2xl bg-zinc-50 px-3 py-2 text-left hover:bg-zinc-100"
            >
              <span className="text-xs text-zinc-400">{moment.timeLabel || '片段'}</span>
              <span className="mt-1 line-clamp-2 block text-zinc-700">{moment.text}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-[24px] border border-zinc-200 bg-white px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
          <MessageCircle size={16} /> 可问的问题
        </div>
        <div className="mt-3 space-y-2">
          {artifacts.qaSuggestions.slice(0, 4).map((suggestion) => (
            <button
              key={suggestion.kind}
              type="button"
              onClick={() => onDetailTabChange('qa')}
              className="w-full rounded-full border border-zinc-200 px-3 py-2 text-left text-xs text-zinc-600 hover:bg-zinc-50"
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      </div>

      <details className="rounded-[24px] border border-zinc-200 bg-white px-4 py-4">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-900">导出与工具</summary>
        <div className="mt-3 grid grid-cols-1 gap-2">
          <button
            onClick={() => navigator.clipboard?.writeText(mergedMarkdown).catch(() => undefined)}
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-zinc-200 px-3 py-2 text-xs hover:bg-zinc-50"
          >
            复制 Markdown
          </button>
          <button
            onClick={onReprocess}
            disabled={reprocessing}
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-zinc-200 px-3 py-2 text-xs hover:bg-zinc-50 disabled:opacity-40"
          >
            {reprocessing ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            {selectedTask.asr_status === 'ready' ? '按当前模型重做纪要' : '按当前配置重新转写'}
          </button>
          <button
            type="button"
            onClick={onToggleTechnicalPanel}
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-zinc-200 px-3 py-2 text-xs hover:bg-zinc-50"
          >
            {showTechnicalPanel ? '收起技术信息' : '查看技术信息'}
          </button>
        </div>
        {showTechnicalPanel && (
          <div className="mt-3 space-y-2 rounded-2xl bg-zinc-50 px-3 py-3 text-xs leading-5 text-zinc-600">
            <p>创建：{selectedTask.created_at ? new Date(selectedTask.created_at).toLocaleString('zh-CN') : '—'}</p>
            <p>来源：{sourceKindLabel(selectedTask.source_kind)} · {strategyLabel(selectedTask.download_strategy)}</p>
            <p>存储：{storageBackendLabel(selectedTask.storage_backend)}</p>
            <p>ASR：{providerLabel(selectedTask.effective_asr_model || selectedTask.requested_asr_model || selectedTask.asr_model)} · {asrModeLabel(selectedTask.asr_mode)}</p>
            <p>LLM：{selectedTask.llm_model || '默认'}</p>
            <p>失败码：{selectedTask.failure_code || '—'}</p>
            {selectedTask.source_url && <p className="break-all">原始链接：{selectedTask.source_url}</p>}
            <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-zinc-950 px-3 py-2 text-[11px] leading-5 text-zinc-100">{rawPayload}</pre>
          </div>
        )}
      </details>
    </aside>
  );
}
