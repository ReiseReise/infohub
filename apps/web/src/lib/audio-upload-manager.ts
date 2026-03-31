import { api, type AudioTask } from './api';

export type UploadLifecycle = 'idle' | 'uploading' | 'success' | 'error';

export interface AudioUploadState {
  status: UploadLifecycle;
  progress: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  task?: AudioTask;
}

type Listener = (state: AudioUploadState) => void;

const listeners = new Set<Listener>();

let state: AudioUploadState = {
  status: 'idle',
  progress: 0,
};

let inflight: Promise<AudioTask> | null = null;

function emit(next: AudioUploadState) {
  state = next;
  for (const listener of listeners) {
    listener(state);
  }
}

export function getAudioUploadState(): AudioUploadState {
  return state;
}

export function subscribeAudioUpload(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export async function startAudioUpload(formData: FormData): Promise<AudioTask> {
  if (inflight) {
    return inflight;
  }

  emit({
    status: 'uploading',
    progress: 1,
    startedAt: new Date().toISOString(),
  });

  inflight = api.audio.uploadTaskWithProgress(formData, (percent) => {
    emit({
      ...state,
      status: 'uploading',
      progress: Math.max(1, Math.min(99, percent)),
    });
  });

  try {
    const task = await inflight;
    emit({
      status: 'success',
      progress: 100,
      startedAt: state.startedAt,
      finishedAt: new Date().toISOString(),
      task,
    });
    return task;
  } catch (err) {
    emit({
      status: 'error',
      progress: state.progress || 0,
      startedAt: state.startedAt,
      finishedAt: new Date().toISOString(),
      error: (err as Error).message || '上传失败',
    });
    throw err;
  } finally {
    inflight = null;
  }
}

export function resetAudioUploadState() {
  emit({
    status: 'idle',
    progress: 0,
  });
}
