import { Hono } from 'hono';
import IORedis from 'ioredis';
import { sql } from 'drizzle-orm';
import { ProxyAgent, request } from 'undici';
import { config } from '../config/index.js';
import { db } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { normalizeProxyUri } from '../lib/proxy-utils.js';
import { normalizeHttpUrl } from '../lib/source-normalization.js';
import { connectionOpts, fetchQueue } from '../scheduler/queue.js';

const app = new Hono();

type ServiceStatus = 'ok' | 'error';

type ServiceHealth = {
  name: string;
  status: ServiceStatus;
  latencyMs: number;
  detail?: string;
  statusCode?: number;
  target?: string;
};

async function checkHttpService(name: string, target: string): Promise<ServiceHealth> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const resp = await fetch(target, { method: 'GET', signal: controller.signal });
    return {
      name,
      status: resp.ok ? 'ok' : 'error',
      latencyMs: Date.now() - startedAt,
      detail: resp.ok ? 'reachable' : `HTTP ${resp.status}`,
      statusCode: resp.status,
      target,
    };
  } catch (err) {
    return {
      name,
      status: 'error',
      latencyMs: Date.now() - startedAt,
      detail: err instanceof Error ? err.message : String(err),
      target,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkDatabase(): Promise<ServiceHealth> {
  const startedAt = Date.now();
  try {
    await db.execute(sql`select 1 as ok`);
    return {
      name: 'postgres',
      status: 'ok',
      latencyMs: Date.now() - startedAt,
      detail: 'connected',
    };
  } catch (err) {
    return {
      name: 'postgres',
      status: 'error',
      latencyMs: Date.now() - startedAt,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkRedis(): Promise<ServiceHealth> {
  const startedAt = Date.now();
  const redis = new IORedis(connectionOpts);
  try {
    const ping = await redis.ping();
    return {
      name: 'redis',
      status: ping === 'PONG' ? 'ok' : 'error',
      latencyMs: Date.now() - startedAt,
      detail: ping,
    };
  } catch (err) {
    return {
      name: 'redis',
      status: 'error',
      latencyMs: Date.now() - startedAt,
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    redis.disconnect();
  }
}

// GET /api/diagnostics/network
app.get('/network', async (c) => {
  requireAuth(c);
  const checks = await Promise.all([
    checkHttpService('hub-engine', `http://127.0.0.1:${config.port}/`),
    checkHttpService('rsshub', `${config.rsshub.baseUrl}/`),
    checkHttpService('changedetection', config.changedetection.url),
    checkHttpService('scrapling-service', `${config.scrapling.url.replace(/\/+$/, '')}/health`),
    checkHttpService('ntfy', `${config.ntfy.url.replace(/\/+$/, '')}/v1/health`),
    checkDatabase(),
    checkRedis(),
  ]);

  const okCount = checks.filter((entry) => entry.status === 'ok').length;
  const errorCount = checks.length - okCount;

  return c.json({
    timestamp: new Date().toISOString(),
    summary: {
      total: checks.length,
      ok: okCount,
      error: errorCount,
    },
    services: checks,
  });
});

// POST /api/diagnostics/proxy-test
app.post('/proxy-test', async (c) => {
  requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const normalizedProxy = normalizeProxyUri(String(body.proxyUrl || ''));
  const normalizedTarget = normalizeHttpUrl(String(body.targetUrl || '')) || 'https://www.github.com/';

  if (!normalizedProxy) {
    return c.json({ error: 'Invalid proxy URL' }, 400);
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const proxyAgent = new ProxyAgent(normalizedProxy);

  try {
    const response = await request(normalizedTarget, {
      method: 'GET',
      signal: controller.signal,
      dispatcher: proxyAgent,
      headers: {
        'User-Agent': 'InfoHub/3.0 diagnostics',
      },
    });

    await response.body.dump();
    return c.json({
      ok: response.statusCode < 500,
      proxyUrl: normalizedProxy,
      targetUrl: normalizedTarget,
      statusCode: response.statusCode,
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    return c.json({
      ok: false,
      proxyUrl: normalizedProxy,
      targetUrl: normalizedTarget,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    }, 502);
  } finally {
    clearTimeout(timeout);
    await proxyAgent.close();
  }
});

// GET /api/diagnostics/fetch-jobs
app.get('/fetch-jobs', async (c) => {
  const authUser = requireAuth(c);
  if (authUser.role !== 'admin') {
    return c.json({ error: 'Forbidden: admin only' }, 403);
  }
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10), 1), 100);

  const [waiting, active, completed, failed] = await Promise.all([
    fetchQueue.getWaitingCount(),
    fetchQueue.getActiveCount(),
    fetchQueue.getCompletedCount(),
    fetchQueue.getFailedCount(),
  ]);

  const jobs = await fetchQueue.getJobs(['active', 'waiting', 'prioritized', 'failed', 'delayed'], 0, limit - 1, false);
  const jobDetails = await Promise.all(jobs.map(async (job) => ({
    id: String(job.id),
    name: job.name,
    state: await job.getState(),
    sourceId: job.data?.sourceId || null,
    sourceName: job.data?.sourceName || null,
    collectorType: job.data?.collectorType || null,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp || null,
    processedOn: job.processedOn || null,
    finishedOn: job.finishedOn || null,
    failedReason: job.failedReason || null,
  })));

  return c.json({
    queue: {
      waiting,
      active,
      completed,
      failed,
    },
    totalJobs: jobDetails.length,
    jobs: jobDetails,
  });
});

export default app;
