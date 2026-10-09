import type { ComponentType } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  XCircle,
} from 'lucide-react';
import type { AudioTask } from '../../lib/api';

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

export function getStatusMeta(task?: AudioTask | null) {
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

export function fmtBytes(size?: number | null) {
  if (!size || size <= 0) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function fmtDuration(seconds?: number | null) {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function resultToMarkdown(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.summary === 'string') return record.summary;
    if (typeof record.markdown === 'string') return record.markdown;
    if (typeof record.content === 'string') return record.content;
    return '';
  }

  return String(value);
}

export function sourceKindLabel(kind?: string | null): string {
  const value = (kind || '').toLowerCase();
  if (value === 'podcast_page') return '播客页面';
  if (value === 'direct_audio') return '音频直链';
  if (value === 'youtube') return 'YouTube';
  return '未知来源';
}

export function strategyLabel(strategy?: string | null): string {
  const value = (strategy || '').toLowerCase();
  if (value === 'yt_dlp') return 'yt-dlp';
  if (value === 'direct_http') return '直连下载';
  if (value === 'page_extract') return '页面抽取';
  if (value === 'xiaoyuzhou_extract') return '小宇宙抽取';
  return value || '—';
}

export function asrModeLabel(mode?: string | null): string {
  const value = (mode || '').toLowerCase();
  if (value === 'sync' || value === 'realtime_sync') return '本地实时';
  if (value === 'async' || value === 'batch_async' || value === 'remote_batch') return '远程批量';
  return value || '—';
}

export function providerLabel(provider?: string | null): string {
  const value = (provider || '').toLowerCase();
  if (value === 'auto') return '自动选择';
  if (value === 'paraformer') return 'DashScope Paraformer';
  if (value === 'tingwu') return '阿里听悟';
  return value || '—';
}

export function storageBackendLabel(backend?: string | null): string {
  const value = (backend || '').toLowerCase();
  if (value === 'oss') return '阿里云 OSS';
  if (value === 'local') return '本地存储';
  return value || '—';
}

export function stageStatusLabel(status?: string | null): string {
  const value = (status || '').toLowerCase();
  if (!value) return '—';
  if (value === 'ready') return '已就绪';
  if (value === 'pending' || value === 'queued') return '等待中';
  if (value === 'running' || value === 'processing' || value === 'in_progress') return '处理中';
  if (value === 'done' || value === 'completed' || value === 'success') return '已完成';
  if (value === 'failed' || value === 'error') return '失败';
  if (value === 'skipped') return '已跳过';
  return status || '—';
}

export function audioFailureDiagnostic(task?: AudioTask | null) {
  const detail = task?.failure_detail || task?.error_message || '';
  const normalized = detail.toLowerCase();
  if (!detail && task?.status !== 'failed' && task?.summary_status !== 'failed' && task?.asr_status !== 'failed') {
    return null;
  }

  let title = '处理失败';
  let message = '这条音频任务没有完成。可以先重跑；如果再次失败，再切换模型或检查音频链接。';
  let action = '建议：点击“重跑”，或在左侧换一个 LLM/ASR 模型后再重跑。';

  if (normalized.includes('llm provider not provided') || normalized.includes('model=') || normalized.includes('litellm')) {
    title = '模型配置不匹配';
    message = '当前 LLM 配置无法被供应商正确调用，所以摘要阶段失败。';
    action = '建议：到设置检查默认 LLM，或在左侧选择可用 LLM 后点击“重跑”。';
  } else if (normalized.includes('timeout') || normalized.includes('timed out')) {
    title = '处理超时';
    message = '音频下载、转写或总结等待时间过长，本次任务已停止。';
    action = '建议：稍后重跑；长音频可换成更短片段或使用远程批量转写。';
  } else if (normalized.includes('403') || normalized.includes('forbidden') || normalized.includes('unauthorized')) {
    title = '链接访问受限';
    message = '系统无法访问这个音频链接，通常是登录态、权限或防盗链限制。';
    action = '建议：换公开音频链接，或先下载文件后从本页上传。';
  } else if (normalized.includes('404') || normalized.includes('not found')) {
    title = '音频链接不可用';
    message = '目标音频不存在或地址已经失效。';
    action = '建议：检查链接后重新抓取，或直接上传本地文件。';
  }

  return {
    title,
    message,
    action,
    technicalDetail: detail,
  };
}
