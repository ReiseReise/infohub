import { Queue } from 'bullmq';
import postgres from 'postgres';

function parseRedisUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || '127.0.0.1',
    port: Number.parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
    maxRetriesPerRequest: null as null,
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres:infohub_dev_2026@127.0.0.1:5432/infohub';
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const sql = postgres(databaseUrl, { max: 1 });
  const queue = new Queue('fetch', { connection: parseRedisUrl(redisUrl) });

  try {
    const jobs = await queue.getJobs(['active', 'waiting', 'prioritized', 'failed', 'delayed'], 0, 499, false);
    const sourceIds = Array.from(
      new Set(
        jobs
          .map((job) => Number(job.data?.sourceId))
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    );

    const existingRows = sourceIds.length > 0
      ? await sql<{ id: number }[]>`select id from hub.sources where id in ${sql(sourceIds)}`
      : [];
    const existingSourceIds = new Set(existingRows.map((row) => row.id));

    let removed = 0;
    let staleSourceJobs = 0;
    let foreignKeyFailures = 0;

    for (const job of jobs) {
      const sourceId = Number(job.data?.sourceId);
      const sourceMissing = Number.isInteger(sourceId) && sourceId > 0 && !existingSourceIds.has(sourceId);
      const failedReason = String(job.failedReason || '');
      const isForeignKeyFailure = failedReason.includes('fetch_logs_source_id_fkey');

      if (!sourceMissing && !isForeignKeyFailure) continue;

      await job.remove();
      removed += 1;
      if (sourceMissing) staleSourceJobs += 1;
      if (isForeignKeyFailure) foreignKeyFailures += 1;
    }

    console.log(JSON.stringify({
      inspected: jobs.length,
      removed,
      staleSourceJobs,
      foreignKeyFailures,
    }, null, 2));
  } finally {
    await queue.close();
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
