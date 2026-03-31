import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { getAudioUploadState, resetAudioUploadState, subscribeAudioUpload, type AudioUploadState } from '../lib/audio-upload-manager';

export function GlobalUploadBanner() {
  const [uploadState, setUploadState] = useState<AudioUploadState>(getAudioUploadState());

  useEffect(() => subscribeAudioUpload(setUploadState), []);

  if (uploadState.status === 'idle') return null;

  return (
    <div className="fixed right-6 top-4 z-40 w-[340px] rounded-xl border border-zinc-200 bg-white/95 shadow-lg backdrop-blur">
      <div className="px-3 py-2 border-b border-zinc-100 flex items-center justify-between">
        <div className="text-xs font-medium text-zinc-700">音频上传任务</div>
        <button
          onClick={resetAudioUploadState}
          className="p-0.5 rounded hover:bg-zinc-100 text-zinc-400"
          title="关闭"
        >
          <X size={12} />
        </button>
      </div>
      <div className="px-3 py-3 text-xs text-zinc-600 space-y-2">
        {uploadState.status === 'uploading' && (
          <>
            <div className="flex items-center gap-2 text-blue-700">
              <Loader2 size={14} className="animate-spin" />
              文件正在上传，切换页面不会中断
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded bg-zinc-100">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${uploadState.progress}%` }} />
            </div>
            <div className="text-zinc-500">{uploadState.progress}%</div>
          </>
        )}

        {uploadState.status === 'success' && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 size={14} />
              上传完成，任务已创建
            </div>
            {uploadState.task?.id && (
              <Link to={`/audio?taskId=${uploadState.task.id}`} className="text-zinc-900 underline">
                打开任务详情
              </Link>
            )}
          </div>
        )}

        {uploadState.status === 'error' && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-red-700">
              <AlertCircle size={14} />
              上传失败
            </div>
            <div className="text-red-600">{uploadState.error || '未知错误'}</div>
          </div>
        )}
      </div>
    </div>
  );
}
