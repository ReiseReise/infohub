import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { HTTPException } from "hono/http-exception";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth.js";
import { ResearchError, researchStore } from "../research/store.js";
import { createRunSchema } from "../research/contracts.js";
import {resolveResearchKey,MODEL,assertResearchPricing,RESEARCH_PRICING} from "../research/model.js";
const app = new Hono();
app.use("*", async (c, next) => {
  requireAuth(c);
  if (process.env.TRUSTED_RESEARCH_ENABLED !== "true")
    return c.json({ error: "research_not_enabled" }, 503);
  await next();
});
app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  if (error instanceof ResearchError)
    return c.json({ error: error.code }, error.status as 400);
  if (error instanceof z.ZodError)
    return c.json(
      {
        error: "invalid_request",
        issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
      },
      400,
    );
  return c.json({ error: "research_service_error" }, 500);
});
app.get('/config', async c => {
 let modelReady=false,modelError:string|null=null;
 try{assertResearchPricing();await resolveResearchKey(researchStore());modelReady=true;}catch(e){modelError=e instanceof ResearchError?e.code:'model_configuration_unavailable';}
 const price=Number(process.env.BRAVE_SEARCH_COST_MICROS);
 return c.json({data:{model:MODEL.id,modelReady,modelError,networkReady:Boolean(process.env.BRAVE_SEARCH_API_KEY)&&Number.isSafeInteger(price)&&price>0,budgetCny:10,concurrency:1,maxRevisions:2,priceReviewDate:RESEARCH_PRICING.reviewedAt,priceReviewExpiresAt:RESEARCH_PRICING.expiresAt,modelSettingsUrl:'/admin?tab=models&center=models'}});
});
app.get("/materials", async (c) => {
  const user = requireAuth(c),
    store = researchStore();
  const q = (c.req.query("q") || "").slice(0, 160);
  return c.json({
    data: await store.sql`select i.id,i.title,i.published_at,s.name as source_name from hub.items i join hub.sources s on s.id=i.source_id where i.user_id=${user.userId} and coalesce(i.is_filtered,false)=false and s.status='active' and i.title ilike ${"%" + q + "%"} order by i.published_at desc nulls last limit 60`,
  });
});
app.get("/runs", async (c) => {
  const user = requireAuth(c);
  const store = researchStore();
  return c.json({
    data: await store.sql`select id,kind,question,state,reason,spent_micros,reserved_micros,budget_micros,created_at,updated_at from hub.research_runs where requested_by=${user.userId} order by created_at desc limit 50`,
  });
});
app.post("/runs", async (c) => {
  const input = createRunSchema.parse(await c.req.json());
  const run = await researchStore().create(
    requireAuth(c).userId,
    c.req.header("Idempotency-Key") || "",
    input,
  );
  return c.json({ data: run }, 202);
});
app.get("/runs/:id", async (c) =>
  c.json({
    data: await researchStore().detail(
      z.string().uuid().parse(c.req.param("id")),
      requireAuth(c).userId,
    ),
  }),
);
app.post("/runs/:id/cancel", async (c) => {
  await researchStore().cancel(
    z.string().uuid().parse(c.req.param("id")),
    requireAuth(c).userId,
  );
  return c.json({ ok: true });
});
app.post("/runs/:id/resume", async (c) =>
  c.json(
    {
      data: await researchStore().resume(
        z.string().uuid().parse(c.req.param("id")),
        requireAuth(c).userId,
      ),
    },
    202,
  ),
);
app.post("/runs/:id/guidance", async (c) => {
  const { content } = z
    .object({ content: z.string().trim().min(1).max(4000) })
    .parse(await c.req.json());
  const key = z.string().min(1).max(160).parse(c.req.header("Idempotency-Key"));
  await researchStore().guidance(
    z.string().uuid().parse(c.req.param("id")),
    requireAuth(c).userId,
    key,
    content,
  );
  return c.json({ ok: true });
});
app.get("/runs/:id/events", async (c) => {
  const store = researchStore(),
    id = z.string().uuid().parse(c.req.param("id"));
  await store.get(id, requireAuth(c).userId);
  let seq = z.coerce
    .number()
    .int()
    .nonnegative()
    .parse(c.req.header("Last-Event-ID") || c.req.query("after") || 0);
  if (c.req.query("stream") !== "true")
    return c.json({
      data: await store.sql`select * from hub.research_run_log where run_id=${id} and seq>${seq} order by seq limit 200`,
    });
  return streamSSE(c, async (stream) => {
    while (!stream.aborted) {
      const rows =
        await store.sql`select * from hub.research_run_log where run_id=${id} and seq>${seq} order by seq limit 200`;
      for (const row of rows) {
        await stream.writeSSE({
          id: String(row.seq),
          event: row.type,
          data: JSON.stringify(row),
        });
        seq = Number(row.seq);
      }
      await stream.sleep(1000);
    }
  });
});
app.get("/evidence/:id", async (c) => {
  const store = researchStore(),
    user = requireAuth(c),
    id = z.string().uuid().parse(c.req.param("id"));
  const [source] =
    await store.sql`select s.* from hub.research_sources s where s.id=${id} and exists(select 1 from hub.research_run_sources rs join hub.research_runs r on r.id=rs.run_id where rs.source_id=s.id and r.requested_by=${user.userId})`;
  if (!source) throw new ResearchError("evidence_not_found", 404);
  return c.json({ data: source });
});
app.post("/runs/:id/drafts", async (c) => {
  const store = researchStore(),
    id = z.string().uuid().parse(c.req.param("id"));
  await store.get(id, requireAuth(c).userId);
  const body = z
    .object({
      markdown: z.string().min(1).max(200000),
      baseVersion: z.number().int().nonnegative(),
    })
    .parse(await c.req.json());
  const draft = await store.sql.begin(async (transaction) => {
    const tx = transaction as unknown as typeof store.sql;
    await tx`select id from hub.research_runs where id=${id} for update`;
    const [v] =
      await tx`select coalesce(max(version),0) as version from hub.research_drafts where run_id=${id}`;
    if (v.version !== body.baseVersion)
      throw new ResearchError("draft_version_conflict");
    const [d] =
      await tx`insert into hub.research_drafts(id,run_id,version,origin,quality,payload,markdown) values(${randomUUID()},${id},${v.version + 1},'human','review','{}',${body.markdown}) returning *`;
    return d;
  });
  return c.json({ data: draft }, 201);
});
export default app;
