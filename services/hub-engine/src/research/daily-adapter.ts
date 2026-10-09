import type { Context } from "hono";
import { z } from "zod";
import { createRunSchema } from "./contracts.js";
import { researchStore, ResearchError } from "./store.js";
import { resolveDailyReportWindow } from "../outputs/daily-report-window.js";
import { randomUUID } from "node:crypto";

export async function generateTrustedDaily(
  c: Context,
  userId: string,
  body: Record<string, unknown>,
) {
  if (process.env.TRUSTED_RESEARCH_ENABLED !== "true")
    throw new ResearchError("research_not_enabled", 503);

  const { dateKey } = resolveDailyReportWindow(
    body.date ? String(body.date) : undefined,
  );
  const input = createRunSchema.parse({
    kind: "daily",
    question: `${dateKey} 每日精选：事实、证据与分析`,
    date: dateKey,
    sourceIds: [],
    ...(body.sourceId != null ? { sourceId: Number(body.sourceId) } : {}),
    network: body.network !== false,
    publicSearchTerms: Array.isArray(body.publicSearchTerms)
      ? body.publicSearchTerms
      : [],
  });
  const store = researchStore();
  const run = await store.create(
    userId,
    c.req.header("Idempotency-Key") ||
      `daily:${dateKey}:${body.sourceId || "all"}:trusted`,
    input,
  );
  return c.json(
    {
      data: run,
      jobId: "research-" + run.id,
      pollUrl: "/api/daily/generate/jobs/research-" + run.id,
      status: run.state,
      enqueued: run.state === "queued",
      reportUrl: "/research?run=" + run.id,
    },
    202,
  );
}
export async function trustedDailyJob(
  c: Context,
  userId: string,
  jobId: string,
) {
  const id = z
    .string()
    .uuid()
    .parse(jobId.replace(/^research-/, ""));
  const detail = await researchStore().detail(id, userId);
  const count = detail.steps.length,
    done = detail.steps.filter((s) => s.state === "done").length;
  return c.json({
    data: {
      jobId,
      state: detail.run.state,
      progress: {
        stage: detail.run.state,
        percent: count ? Math.round((done / count) * 100) : 0,
      },
      result: detail.drafts.find(d=>d.origin==="human" || detail.steps.some(s=>s.id===d.step_id && ["edit","final_verify"].includes(s.stage))) || null,
      runId: id,
      reportUrl: "/research?run=" + id,
      reason: detail.run.reason,
    },
  });
}
export async function rerunTrustedDaily(
  c: Context,
  userId: string,
  scene: string,
  body: Record<string, unknown>,
) {
  const store = researchStore(),
    runId = z.string().uuid().parse(body.runId);
  if (process.env.TRUSTED_RESEARCH_ENABLED !== "true")
    throw new ResearchError("research_not_enabled", 503);
  const parent = await store.get(runId, userId);
  if (parent.kind !== "daily")
    throw new ResearchError("daily_run_required", 422);
  const stage = scene.replace(/^daily_report_/, "");
  if (stage === 'cleaning') {
    const result = await store.recheckSelection(runId, userId, c.req.header('Idempotency-Key') || `selection:${parent.revision}`);
    return c.json({runId, ...result}, 200);
  }
  // Only downstream editorial reruns have no ambiguity about which event should be researched.
  const selected =
    stage === "research" ? z.string().uuid().parse(body.stepId) : null;
  if (!["final", "decision", "reading", "research"].includes(stage))
    throw new ResearchError("unsupported_daily_stage", 422);
  await store.sql.begin(async (transaction) => {
    const sql = transaction as unknown as typeof store.sql;
    const [run] =
      await sql`select * from hub.research_runs where id=${runId} for update`;
    if (["queued", "running"].includes(run.state))
      throw new ResearchError("run_already_active");
    if (
      Number(run.spent_micros) + Number(run.reserved_micros) >=
      Number(run.budget_micros)
    )
      throw new ResearchError("budget_exhausted");
    const target = selected ? (await sql`select step_key from hub.research_steps where id=${selected} and run_id=${runId} and stage='research'`)[0] : null;
    if (selected && !target) throw new ResearchError('event_step_not_found', 404);
    const [unfinished] = await sql`select count(*)::int as count from hub.research_steps where run_id=${runId} and stage in ('research','verify') and (state in ('pending','running','paused','cancelled') or error='waiting_new_candidate') and (${target?.step_key || null}::text is null or step_key not in (${target?.step_key || ''},${target ? target.step_key + '-verify' : ''}))`;
    if (unfinished.count) throw new ResearchError('unfinished_events_require_resume', 409);
    if (!selected) {
      const [verified] =
        await sql`select count(*)::int as count from hub.research_steps where run_id=${runId} and stage='verify' and state='done'`;
      if (!verified.count) throw new ResearchError("no_verified_events", 422);
    }
    if (selected) {
      const [step] =
        await sql`update hub.research_steps set state='pending',revision=revision+1,lease_token=null,lease_until=null,output=null where id=${selected} and run_id=${runId} and stage='research' returning step_key`;
      if (!step) throw new ResearchError("event_step_not_found", 404);
      // Dependent verifier is recreated only after the new candidate exists. Preserve old drafts.
      await sql`update hub.research_steps set state='review',input='{}',output=null,error='waiting_new_candidate',revision=revision+1 where run_id=${runId} and step_key=${step.step_key + "-verify"}`;
    }
    await sql`update hub.research_steps set state='pending',revision=revision+1,lease_token=null,lease_until=null,output=null where run_id=${runId} and stage='edit'`;
    await sql`update hub.research_steps set state='review',input='{}',output=null,error='waiting_new_candidate',revision=revision+1 where run_id=${runId} and stage='final_verify'`;
    const [editor] =
      await sql`select id from hub.research_steps where run_id=${runId} and stage='edit'`;
    if (!editor && !selected)
      await sql`insert into hub.research_steps(id,run_id,step_key,stage,input) values(${randomUUID()},${runId},'report-edit','edit','{}')`;
    await sql`update hub.research_runs set state='queued',reason=null,revision=revision+1,updated_at=now() where id=${runId}`;
    await store.log(runId, "stage_rerun", { stage, stepId: selected }, sql);
  });
  return c.json(
    {
      runId,
      status: "queued",
      message: selected
        ? "仅重跑指定事件及受影响的核对、编辑阶段"
        : "仅重跑整报编辑与最终核对，复用已有事件成果",
    },
    202,
  );
}

export async function latestTrustedDaily(c: Context, userId: string) {
  if (process.env.TRUSTED_RESEARCH_ENABLED !== "true")
    throw new ResearchError("research_not_enabled", 503);
  const store = researchStore();
  const date = c.req.query("date") || null,
    sourceId = c.req.query("sourceId") || null;
  const [run] =
    await store.sql`select * from hub.research_runs where requested_by=${userId} and kind='daily' and (${date}::text is null or input->>'date'=${date}) and coalesce(input->>'sourceId','')=coalesce(${sourceId},'') order by created_at desc limit 1`;
  if (!run)
    return c.json({
      data: {
        missing: true,
        markdown: "",
        publicationStatus: "missing",
        qualityStatus: "degraded",
      },
    });
  const detail = await store.detail(run.id, userId);
  const draft =
    detail.drafts.find((d) => d.origin === "human") || detail.drafts.find(d=>detail.steps.some(s=>s.id===d.step_id && ["edit","final_verify"].includes(s.stage)));
  // Experimental engine results remain drafts until the production acceptance gate is passed.
  return c.json({
    data: {
      id: run.id,
      date: run.input.date,
      type: "daily_report",
      engine: "trusted",
      summary: draft?.markdown || "",
      markdown: draft?.markdown || "",
      generatedAt: draft?.created_at || null,
      itemCount: detail.steps.filter(
        (s) => s.stage === "verify" && s.state === "done",
      ).length,
      missing: false,
      publicationStatus: "draft",
      publishable: false,
      qualityStatus: "degraded",
      qualityReasons: [run.reason || "production_acceptance_pending"],
      payload: {
        researchRunId: run.id,
        final: { markdown: draft?.markdown || "" },
      },
      dateNavigation: {
        latestDate: run.input.date,
        previousDate: null,
        nextDate: null,
      },
      coverageItems: [],
      moduleSections: [],
      editorialMaterials: [],
      moreDynamics: [],
      deepReads: [],
      tableOfContents: [],
      reportUrl: "/research?run=" + run.id,
    },
  });
}
