export const FETCH_WORKER_POLICY = {
  lockDuration: 15 * 60 * 1000,
  stalledInterval: 60 * 1000,
  maxStalledCount: 3,
} as const;

// Docker DNS 短时抖动往往比 5-15 秒更长。延长两次重试间隔，避免同一波
// EAI_AGAIN 把所有来源同时标成失败，且不增加总尝试次数。
export const FETCH_JOB_RETRY_POLICY = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30 * 1000 },
} as const;

export const PROCESS_WORKER_POLICY = {
  concurrency: 3,
  lockDuration: 15 * 60 * 1000,
  stalledInterval: 60 * 1000,
  maxStalledCount: 3,
} as const;

export const DAILY_REPORT_WORKER_POLICY = {
  concurrency: 1,
  lockDuration: 60 * 60 * 1000,
  stalledInterval: 60 * 1000,
  maxStalledCount: 1,
} as const;
