import { Queue, Worker, Job } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

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
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
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

export type FetchJobData = {
  sourceId: number;
  sourceName: string;
  sourceType: string;
  collectorType: string;
  config: Record<string, unknown>;
};

export type ProcessJobData = {
  itemId: string;
  stage: 'dedup' | 'filter' | 'score' | 'summarize';
};

export function createFetchWorker(handler: (job: Job<FetchJobData>) => Promise<void>) {
  const worker = new Worker<FetchJobData>('fetch', handler, {
    connection: connectionOpts,
    concurrency: config.fetch.concurrency,
    limiter: { max: 10, duration: 60000 },
  });

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, sourceId: job.data.sourceId }, 'Fetch job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, sourceId: job?.data.sourceId, error: err.message }, 'Fetch job failed');
  });

  return worker;
}

export function createProcessWorker(handler: (job: Job<ProcessJobData>) => Promise<void>) {
  const worker = new Worker<ProcessJobData>('process', handler, {
    connection: connectionOpts,
    concurrency: 3,
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, itemId: job?.data.itemId, error: err.message }, 'Process job failed');
  });

  return worker;
}

export { connectionOpts };
