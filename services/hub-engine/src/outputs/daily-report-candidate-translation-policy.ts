export function buildDailyReportTranslationJob(userId: string, itemId: string) {
  return {
    userId,
    itemId,
    mode: 'automatic',
    trigger: 'daily_report',
  } as const;
}

export async function waitForDailyReportTranslation(
  job: { getState(): Promise<string> },
  options: {
    deadlineAt: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<'completed' | 'failed' | 'pending'> {
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  while (true) {
    const state = await job.getState();
    if (state === 'completed' || state === 'failed') return state;
    if (state === 'unknown') return 'failed';
    const remaining = options.deadlineAt - now();
    if (remaining <= 0) return 'pending';
    await sleep(Math.min(1000, remaining));
  }
}
