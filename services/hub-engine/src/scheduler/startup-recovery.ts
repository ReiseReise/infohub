export type QueueJobCounts = {
  waiting?: number;
  active?: number;
  delayed?: number;
  prioritized?: number;
};

export type StartupQueueReader = {
  getJobCounts: () => Promise<QueueJobCounts>;
};

type WaitForQueueQuiescenceOptions = {
  queue: StartupQueueReader;
  timeoutMs?: number;
  pollIntervalMs?: number;
  stableChecks?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

function pendingJobCount(counts: QueueJobCounts) {
  return ['waiting', 'active', 'delayed', 'prioritized']
    .reduce((total, key) => total + Math.max(0, Number(counts[key as keyof QueueJobCounts] || 0)), 0);
}

export async function waitForQueueQuiescence(options: WaitForQueueQuiescenceOptions) {
  const timeoutMs = Math.max(0, options.timeoutMs ?? 10 * 60 * 1000);
  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 2_000);
  const stableChecks = Math.max(1, options.stableChecks ?? 2);
  const now = options.now || Date.now;
  const sleep = options.sleep || ((milliseconds: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const startedAt = now();
  let quietChecks = 0;
  let checks = 0;
  let pending = 0;

  while (true) {
    const counts = await options.queue.getJobCounts();
    checks += 1;
    pending = pendingJobCount(counts);
    quietChecks = pending === 0 ? quietChecks + 1 : 0;
    if (quietChecks >= stableChecks) {
      return { settled: true, timedOut: false, checks, pending, elapsedMs: now() - startedAt };
    }
    if (now() - startedAt >= timeoutMs) {
      return { settled: false, timedOut: true, checks, pending, elapsedMs: now() - startedAt };
    }
    await sleep(pollIntervalMs);
  }
}
