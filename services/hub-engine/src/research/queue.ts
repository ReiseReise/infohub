import { Queue, Worker } from "bullmq";
import { config } from "../config/index.js";
import { researchStore } from "./store.js";
import { executeStep, reconcileRun } from "./runner.js";
import { logger } from "../lib/logger.js";
const u = new URL(config.redis.url);
const connection = {
  host: u.hostname,
  port: Number(u.port || 6379),
  password: u.password || undefined,
  maxRetriesPerRequest: null,
};
let queue: Queue | undefined;
export function researchQueue() {
  return (queue ??= new Queue("trusted-research", {
    connection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 100 },
    },
  }));
}
export async function dispatchResearch() {
  const store = researchStore();
  const runs =
    await store.sql`select id from hub.research_runs where state in ('queued','running') order by created_at limit 50`;
  for (const run of runs) {
    await reconcileRun(store, run.id);
    const steps =
      await store.sql`select s.id,s.revision,s.attempt from hub.research_steps s join hub.research_runs r on r.id=s.run_id where s.run_id=${run.id} and r.state in ('queued','running') and (s.state='pending' or (s.state='running' and s.lease_until<now())) and (s.stage not in ('verify','final_verify') or s.input ? 'draftId') and (s.stage <> 'edit' or not exists(select 1 from hub.research_steps dep where dep.run_id=s.run_id and dep.stage in ('research','verify') and (dep.state in ('pending','running','paused','cancelled') or dep.error='waiting_new_candidate'))) order by s.step_key`;
    for (const step of steps)
      await researchQueue().add(
        "step",
        { runId: run.id, stepId: step.id },
        { jobId: `${step.id}-${step.revision}-${step.attempt}` },
      );
  }
}
export function startResearchWorker() {
  if (process.env.TRUSTED_RESEARCH_ENABLED !== "true") return null;
  const worker = new Worker(
    "trusted-research",
    async (job) =>
      executeStep(researchStore(), job.data.runId, job.data.stepId),
    { connection, concurrency: 1, lockDuration: 180000, maxStalledCount: 1 },
  );
  let busy = false;
  const dispatch = async () => {
    if (busy) return;
    busy = true;
    try {
      await dispatchResearch();
    } catch {
      logger.error("Research dispatch failed; persisted tasks retained");
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void dispatch(), 5000);
  void dispatch();
  worker.on("error", () =>
    logger.error("Research worker error; persisted tasks retained"),
  );
  return {
    close: async () => {
      clearInterval(timer);
      await worker.close();
      if (queue) await queue.close();
    },
  };
}
