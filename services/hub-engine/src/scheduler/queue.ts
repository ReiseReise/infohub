import { Queue, Worker, Job } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import {
  DAILY_REPORT_WORKER_POLICY,
  FETCH_JOB_RETRY_POLICY,
  FETCH_WORKER_POLICY,
  PROCESS_WORKER_POLICY,
} from './process-worker-policy.js';

function parseRedisUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname || '127.0.0.1',
    port: parseInt(u.port || '6379', 10),
    password: u.password || undefined,
    maxRetriesPerRequest: null as null,
  };
}

const connectionOpts = parseRedisUrl(config.redis.url);

export const fetchQueue = new Queue('fetch', {
  connection: connectionOpts,
  defaultJobOptions: {
    ...FETCH_JOB_RETRY_POLICY,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
});

export const processQueue = new Queue('process', {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { count: 5000 },
    removeOnFail: { count: 1000 },
  },
});

export const dailyReportQueue = new Queue('daily-report', {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

export const itemTranslationQueue = new Queue('item-translation', {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: 'translation-retry' },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 300 },
  },
});

export type FetchJobData = {
  sourceId: number;
  sourceName: string;
  sourceType: string;
  collectorType: string;
  config: Record<string, unknown>;
};

export type ProcessJobData = {
  userId: string;
  itemId: string;
  stage: 'dedup' | 'filter' | 'score' | 'summarize' | 'ai_pipeline';
  autoSummaryEnabled?: boolean;
  autoTranslationEnabled?: boolean;
};

export type DailyReportJobData = {
  userId: string;
  date: string;
  mode: 'fast' | 'full';
  preset: 'full' | 'decision' | 'research' | 'reading';
  sourceId?: number | null;
  sourceName?: string | null;
  trigger?: 'manual' | 'cron' | 'startup_catchup';
  scheduledFor?: string | null;
  requestedAt: string;
};

export type ItemTranslationJobData = {
  userId: string;
  itemId: string;
  requestedAt: string;
  mode: 'manual' | 'automatic';
  trigger: 'manual' | 'pipeline' | 'cron' | 'debt' | 'daily_report';
  force?: boolean;
  revision?: string;
};

export function createFetchWorker(handler: (job: Job<FetchJobData>) => Promise<void>) {
  const worker = new Worker<FetchJobData>('fetch', handler, {
    connection: connectionOpts,
    concurrency: config.fetch.concurrency,
    limiter: { max: 10, duration: 60000 },
    ...FETCH_WORKER_POLICY,
  });

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, sourceId: job.data.sourceId }, 'Fetch job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, sourceId: job?.data.sourceId, error: err.message }, 'Fetch job failed');
  });

  return worker;
}

export function createDailyReportWorker(handler: (job: Job<DailyReportJobData>) => Promise<unknown>) {
  const worker = new Worker<DailyReportJobData>('daily-report', handler, {
    connection: connectionOpts,
    ...DAILY_REPORT_WORKER_POLICY,
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, date: job.data.date, mode: job.data.mode }, 'Daily report job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, date: job?.data.date, mode: job?.data.mode, error: err.message }, 'Daily report job failed');
  });

  return worker;
}

export function createItemTranslationWorker(handler: (job: Job<ItemTranslationJobData>) => Promise<unknown>) {
  const worker = new Worker<ItemTranslationJobData>('item-translation', handler, {
    connection: connectionOpts,
    concurrency: 1,
    lockDuration: 12 * 60 * 1000,
    stalledInterval: 60 * 1000,
    maxStalledCount: 1,
    settings: {
      backoffStrategy: (attemptsMade, type) => {
        if (type !== 'translation-retry') return -1;
        return [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000][attemptsMade - 1] ?? -1;
      },
    },
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, itemId: job.data.itemId }, 'Item translation job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, itemId: job?.data.itemId, error: err.message }, 'Item translation job failed');
  });

  return worker;
}

export function createProcessWorker(handler: (job: Job<ProcessJobData>) => Promise<void>) {
  const worker = new Worker<ProcessJobData>('process', handler, {
    connection: connectionOpts,
    ...PROCESS_WORKER_POLICY,
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, itemId: job?.data.itemId, error: err.message }, 'Process job failed');
  });

  return worker;
}

export { connectionOpts };
