import {materialFromRow} from '../radius/material.js';
import { observeJev } from '../jev/queue.js';
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { resolveSourceReadingTier } from "../lib/source-reading-tier.js";
import { prepareDailyReportCandidates } from "../outputs/daily-report-workflow.js";
import { config } from "../config/index.js";
import {
  fingerprint,
  type RunInput,
  type Draft,
  type Source,
  type Citation,
  validateDraft,
  renderDraft,
} from "./contracts.js";

export class ResearchError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
export type Lease = {
  runId: string;
  stepId: string;
  token: string;
  revision: number;
};
export class ResearchStore {
  constructor(public sql: postgres.Sql) {}
  async log(runId: string, type: string, data: unknown, sql = this.sql) {
    await sql`insert into hub.research_run_log(run_id,type,data) values(${runId},${type},${sql.json(data as postgres.JSONValue)})`;
  }
  async get(runId: string, userId: string) {
    const [r] = await this
      .sql`select * from hub.research_runs where id=${runId} and requested_by=${userId}`;
    if (!r) throw new ResearchError("run_not_found", 404);
    return r;
  }
  async detail(runId: string, userId: string) {
    const run = await this.get(runId, userId);
    const [steps, drafts, sources, citations, guidance] = await Promise.all([
      this
        .sql`select s.id,s.step_key,s.stage,s.state,s.attempt,s.revision,s.error,s.updated_at,coalesce(s.input->>'question',(select p.input->>'question' from hub.research_steps p where p.run_id=s.run_id and p.step_key=regexp_replace(s.step_key,'-verify$','')),(select question from hub.research_runs where id=s.run_id)) as label from hub.research_steps s where s.run_id=${runId} order by s.step_key`,
      this
        .sql`select * from hub.research_drafts where run_id=${runId} order by version desc`,
      this
        .sql`select s.id,s.title,s.url,s.author,s.published_at,s.captured_at,s.content_hash from hub.research_sources s join hub.research_run_sources rs on rs.source_id=s.id where rs.run_id=${runId}`,
      this.sql`select * from hub.research_citations where run_id=${runId}`,
      this
        .sql`select id,content,created_at from hub.research_guidance where run_id=${runId} order by created_at`,
    ]);
    return { run, steps, drafts, sources, citations, guidance };
  }
  async create(userId: string, key: string, input: RunInput) {
    if (!key || key.length > 160)
      throw new ResearchError("idempotency_key_required", 400);
    return this.sql.begin(async (tx) => {
      const sql = tx as unknown as postgres.Sql;
      const existing =
        await sql`select * from hub.research_runs where request_key=${userId + ":" + key}`;
      if (existing[0]) {
        if (fingerprint(existing[0].input) !== fingerprint(input))
          throw new ResearchError("idempotency_input_conflict");
        return existing[0];
      }
      const id = randomUUID();
      const [run] =
        await sql`insert into hub.research_runs(id,request_key,requested_by,kind,question,input,policy) values(${id},${userId + ":" + key},${userId},${input.kind},${input.question},${sql.json(input)},${sql.json({ network: input.network, publicSearchTerms: input.publicSearchTerms, model: "deepseek-flash", maxTurns: input.kind === "daily" ? 8 : 16, maxRevisions: 2 })}) on conflict(request_key) do nothing returning *`;
      if (!run) {
        const [r] =
          await sql`select * from hub.research_runs where request_key=${userId + ":" + key}`;
        if (fingerprint(r.input) !== fingerprint(input))
          throw new ResearchError("idempotency_input_conflict");
        return r;
      }
      if (input.sourceId) {
        const [source] =
          await sql`select id from hub.sources where id=${input.sourceId} and user_id=${userId}`;
        if (!source) throw new ResearchError("source_scope_denied", 403);
      }
      const automaticTopicScope =
        input.kind === "topic" &&
        input.scope === "all_collected" &&
        input.sourceIds.length === 0;
      let items = input.sourceIds.length
        ? await sql`select i.*,s.status as source_status,s.name as source_name,s.category as source_category,s.config as source_config,s.source_kind,s.collector_type as source_collector_type,s.source_tier as actual_source_tier from hub.items i join hub.sources s on s.id=i.source_id where i.user_id=${userId} and (${input.sourceId || null}::int is null or i.source_id=${input.sourceId || null}) and i.id in ${sql(input.sourceIds)} and s.user_id=${userId} and coalesce(s.status,'active')<>'removed' and (${input.corpus === 'radius'} or coalesce(i.is_filtered,false)=false)`
        : automaticTopicScope
        ? await sql`select i.*,s.status as source_status,s.name as source_name,s.category as source_category,s.config as source_config,s.source_kind,s.collector_type as source_collector_type,s.source_tier as actual_source_tier from hub.items i join hub.sources s on s.id=i.source_id where i.user_id=${userId} and (${input.sourceId || null}::int is null or i.source_id=${input.sourceId || null}) and coalesce(i.is_filtered,false)=false and s.status='active' and coalesce(s.source_role,'normal') not in ('radar','reference') order by i.priority_score desc nulls last,i.published_at desc nulls last,i.id`
        : await sql`select i.*,s.status as source_status,s.name as source_name,s.category as source_category,s.config as source_config,s.source_kind,s.collector_type as source_collector_type,s.source_tier as actual_source_tier from hub.items i join hub.sources s on s.id=i.source_id where i.user_id=${userId} and (${input.sourceId || null}::int is null or i.source_id=${input.sourceId || null}) and coalesce(i.is_filtered,false)=false and s.status='active' and coalesce(s.source_role,'normal') not in ('radar','reference') and ((${input.date || null}::date is not null and i.published_at >= ${input.date || null}::date - interval '8 hours' and i.published_at < ${input.date || null}::date + interval '16 hours') or (${input.date || null}::date is null and (i.title ilike ${"%" + input.question.slice(0, 80) + "%"}))) order by i.priority_score desc nulls last,i.id limit 60`;
      if (input.sourceIds.length && items.length !== input.sourceIds.length)
        throw new ResearchError("source_scope_denied", 403);
      if (input.kind === "daily") {
        const [settings] =
          await sql`select daily_report_workflow from hub.user_settings where user_id=${userId}`;
        const prepared = await prepareDailyReportCandidates(
          items.map((i) => ({
            id: i.id,
            sourceId: i.source_id,
            title: i.title,
            url: i.url,
            aiScore: i.ai_score,
            aiSummary: i.ai_summary,
            snippet: i.snippet,
            aiTranslation: i.ai_translation,
            language: i.language,
            translationStatus: i.translation_status,
            sourceName: i.source_name,
            category: i.source_category || "",
            sourceType: i.source_type,
            sourceTier: i.actual_source_tier,
            readingTier: resolveSourceReadingTier({
              name: i.source_name,
              config: i.source_config,
              sourceTier: i.actual_source_tier,
              collectorType: i.source_collector_type,
              sourceKind: i.source_kind,
              category: i.source_category,
              status: i.source_status,
            }).value,
            sourceKind: i.source_kind,
            clusterId: i.cluster_id,
            isFiltered: i.is_filtered,
            filterBucket: i.filter_bucket,
            qualityDecision: i.quality_decision,
            processingStatus: i.processing_status,
            publishedAt: i.published_at?.toISOString(),
            fetchedAt: i.fetched_at?.toISOString(),
            aiTags: i.ai_tags,
            contentLength: (i.readability_content || i.content || "").length,
          })),
          input.sourceId
            ? {
                ...settings?.daily_report_workflow,
                scope: {
                  ...settings?.daily_report_workflow?.scope,
                  sourceIds: [input.sourceId],
                },
              }
            : settings?.daily_report_workflow,
        );
        const byId = new Map(items.map((i) => [i.id, i]));
        items = prepared.finalCandidates
          .map((c) => byId.get(c.id)!)
          .filter(Boolean) as typeof items;
        await this.log(
          id,
          "selection_frozen",
          {
            funnel: prepared.funnel,
            excludedCount: prepared.excluded.length || 0,
          },
          sql,
        );
      }
      const events = new Map<
        string,
        { id: string; title: string; sources: string[] }
      >();
      for (const item of items) {
        const body = input.corpus === "radius" ? materialFromRow(item).content_text : item.readability_content || item.content || "";
        if (!body.trim()) continue;
        const eventKey =
          input.kind === "topic" ? "topic:" + id : item.cluster_id || item.id;
        let event = events.get(eventKey);
        if (!event) {
          if (input.kind === "daily" && events.size >= 12) continue;
          const eid = randomUUID();
          const [row] =
            await sql`insert into hub.research_events(id,event_key,title) values(${eid},${eventKey},${item.title}) on conflict(event_key) do update set event_key=excluded.event_key returning *`;
          event = {
            id: row.id,
            title: input.kind === "topic" ? input.question : item.title,
            sources: [],
          };
          events.set(eventKey, event);
        }
        if (input.kind === 'daily') observeJev('daily', item.id);
        const sid = await this.snapshot(
          {
            itemId: item.id,
            title: item.title,
            url: item.original_url || item.url,
            author: item.author,
            publishedAt: item.published_at,
            body,
            origin: "collected",
          },
          sql,
        );
        await sql`insert into hub.research_run_sources(run_id,source_id,event_id) values(${id},${sid},${event.id}) on conflict do nothing`;
        event.sources.push(sid);
      }
      if (input.kind === "topic" && !events.size)
        events.set("topic:" + id, {
          id: randomUUID(),
          title: input.question,
          sources: [],
        });
      for (const [i, e] of [...events.values()].entries()) {
        await sql`insert into hub.research_steps(id,run_id,step_key,stage,input) values(${randomUUID()},${id},${"event-" + String(i).padStart(2, "0")},'research',${sql.json({ question: e.title, sourceIds: e.sources })})`;
      }
      if (!events.size) {
        await sql`update hub.research_runs set state='review',reason='no_evidence' where id=${id}`;
        run.state = "review";
        run.reason = "no_evidence";
      }
      await this.log(
        id,
        "created",
        {
          events: events.size,
          sourceCount: items.length,
          scope: automaticTopicScope ? "all_collected" : input.sourceIds.length ? "selected" : "daily_date",
        },
        sql,
      );
      return run;
    });
  }
  async snapshot(
    source: {
      itemId?: string;
      title: string;
      url: string;
      author?: string;
      publishedAt?: string;
      body: string;
      origin: string;
    },
    sql = this.sql,
  ) {
    const hash = fingerprint([
      source.url,
      source.title,
      source.author || null,
      source.publishedAt || null,
      source.body,
    ]);
    await sql`insert into hub.research_sources(id,item_id,url,title,author,published_at,content_hash,body,origin) values(${randomUUID()},${source.itemId || null},${source.url},${source.title},${source.author || null},${source.publishedAt || null},${hash},${source.body},${source.origin}) on conflict(url,content_hash) do nothing`;
    const [r] =
      await sql`select id from hub.research_sources where url=${source.url} and content_hash=${hash}`;
    return r.id as string;
  }
  async recheckSelection(runId: string, userId: string, requestKey: string) {
    if (!requestKey || requestKey.length > 160) throw new ResearchError('idempotency_key_required', 400);
    return this.sql.begin(async tx => {
      const sql = tx as unknown as postgres.Sql;
      const [run] = await sql`select * from hub.research_runs where id=${runId} and requested_by=${userId} for update`;
      if (!run) throw new ResearchError('run_not_found', 404);
      if (run.kind !== 'daily') throw new ResearchError('daily_run_required', 422);
      const [old] = await sql`select data from hub.research_run_log where run_id=${runId} and type='selection_rechecked' and data->>'requestKey'=${requestKey} order by seq desc limit 1`;
      if (old) return old.data;
      if (['queued', 'running'].includes(run.state)) throw new ResearchError('run_already_active');
      const sources = await sql`select s.id,s.body from hub.research_sources s join hub.research_run_sources rs on rs.source_id=s.id where rs.run_id=${runId}`;
      const steps = await sql`select id,input from hub.research_steps where run_id=${runId} and stage='research' order by step_key`;
      const available = new Set(sources.filter(s => s.body.trim()).map(s => s.id));
      const invalidEvents = steps.filter(s => !Array.isArray(s.input.sourceIds) || !s.input.sourceIds.length || s.input.sourceIds.some((id: string) => !available.has(id))).map(s => s.id);
      const output = {requestKey, stage:'selection', status:invalidEvents.length || !steps.length ? 'review' : 'checked', eventCount:steps.length, sourceCount:sources.length, invalidEvents, enqueued:false, message:'已复核本次冻结选材；没有重新研究事件。新增或更换材料请新建任务。'};
      await this.log(runId, 'selection_rechecked', output, sql);
      return output;
    });
  }
  async sources(runId: string): Promise<Source[]> {
    return (await this
      .sql`select s.* from hub.research_sources s join hub.research_run_sources rs on s.id=rs.source_id where rs.run_id=${runId}`) as unknown as Source[];
  }
  async citations(runId: string): Promise<Citation[]> {
    return (await this
      .sql`select * from hub.research_citations where run_id=${runId}`) as unknown as Citation[];
  }
  async claim(runId: string, stepId: string): Promise<Lease | null> {
    return this.sql.begin(async (tx) => {
      const sql = tx as unknown as postgres.Sql;
      const [run] =
        await sql`select * from hub.research_runs where id=${runId} for update`;
      if (!run || !["queued", "running"].includes(run.state)) return null;
      const [candidate] =
        await sql`select * from hub.research_steps where id=${stepId} and run_id=${runId}`;
      if (!candidate) return null;
      if (
        ["verify", "final_verify"].includes(candidate.stage) &&
        !candidate.input?.draftId
      )
        return null;
      if (candidate.stage === "edit") {
        const [waiting] =
          await sql`select count(*)::int as count from hub.research_steps where run_id=${runId} and stage in ('research','verify') and (state in ('pending','running','paused','cancelled') or error='waiting_new_candidate')`;
        if (waiting.count) return null;
      }
      const token = randomUUID();
      const [step] =
        await sql`update hub.research_steps set state='running',lease_token=${token},lease_until=now()+interval '3 minutes',attempt=attempt+1 where id=${stepId} and run_id=${runId} and (state='pending' or (state='running' and lease_until<now())) returning *`;
      if (!step) return null;
      await sql`update hub.research_runs set state='running',updated_at=now() where id=${runId}`;
      await this.log(
        runId,
        "step_started",
        { stepKey: step.step_key, attempt: step.attempt },
        sql,
      );
      return { runId, stepId, token, revision: step.revision };
    });
  }
  async assertLease(lease: Lease, sql = this.sql) {
    const [r] =
      await sql`select r.state,s.lease_token,s.revision,s.lease_until from hub.research_runs r join hub.research_steps s on s.run_id=r.id where r.id=${lease.runId} and s.id=${lease.stepId}`;
    if (
      !r ||
      r.state !== "running" ||
      r.lease_token !== lease.token ||
      r.revision !== lease.revision ||
      new Date(r.lease_until).getTime() < Date.now()
    )
      throw new ResearchError("execution_revoked");
  }
  async heartbeat(lease: Lease) {
    await this.assertLease(lease);
    await this
      .sql`update hub.research_steps set lease_until=now()+interval '3 minutes' where id=${lease.stepId} and lease_token=${lease.token}`;
  }
  async locked<T>(
    lease: Lease,
    fn: (sql: postgres.Sql) => Promise<T>,
  ): Promise<T> {
    return this.sql.begin(async (tx) => {
      const sql = tx as unknown as postgres.Sql;
      await sql`select id from hub.research_runs where id=${lease.runId} for update`;
      await this.assertLease(lease, sql);
      return fn(sql);
    }) as Promise<T>;
  }
  async cite(
    lease: Lease,
    sourceId: string,
    quote: string,
    requestedOffset?: number,
  ): Promise<Citation> {
    return this.locked(lease, async (sql) => {
      const [s] =
        await sql`select s.* from hub.research_sources s join hub.research_run_sources rs on rs.source_id=s.id where rs.run_id=${lease.runId} and s.id=${sourceId}`;
      if (!s) throw new ResearchError("source_scope_denied", 403);
      const start = requestedOffset ?? s.body.indexOf(quote);
      if (
        !quote.trim() ||
        !Number.isSafeInteger(start) ||
        start < 0 ||
        s.body.slice(start, start + quote.length) !== quote
      )
        throw new ResearchError("quote_not_in_source", 422);
      await sql`insert into hub.research_citations(id,run_id,source_id,quote,start_offset,end_offset) values(${randomUUID()},${lease.runId},${sourceId},${quote},${start},${start + quote.length}) on conflict do nothing`;
      const [c] =
        await sql`select * from hub.research_citations where run_id=${lease.runId} and source_id=${sourceId} and start_offset=${start} and end_offset=${start + quote.length}`;
      return c as Citation;
    });
  }
  async reserve(lease: Lease, amount: number, kind: string, metadata: unknown) {
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new ResearchError("invalid_reservation");
    return this.locked(lease, async (sql) => {
      const [r] =
        await sql`update hub.research_runs set reserved_micros=reserved_micros+${amount} where id=${lease.runId} and spent_micros+reserved_micros+${amount}<=budget_micros-${kind === "research_model" ? 1500000 : 0} returning *`;
      if (!r) throw new ResearchError("budget_exhausted");
      const id = randomUUID();
      await sql`insert into hub.research_calls(id,run_id,step_id,revision,kind,reserved_micros,metadata) values(${id},${lease.runId},${lease.stepId},${lease.revision},${kind},${amount},${sql.json(metadata as postgres.JSONValue)})`;
      return id;
    });
  }
  async settle(callId: string, actual: number | null, metadata: unknown) {
    await this.sql.begin(async (tx) => {
      const sql = tx as unknown as postgres.Sql;
      const [call] =
        await sql`select * from hub.research_calls where id=${callId}`;
      if (!call) return;
      await sql`select id from hub.research_runs where id=${call.run_id} for update`;
      const [fresh] =
        await sql`select * from hub.research_calls where id=${callId} for update`;
      if (fresh.state === "settled") return;
      if (
        actual === null ||
        !Number.isSafeInteger(actual) ||
        actual < 0 ||
        actual > Number(fresh.reserved_micros)
      ) {
        await sql`update hub.research_calls set state='uncertain',metadata=${sql.json(metadata as postgres.JSONValue)} where id=${callId}`;
        await this.log(call.run_id, "cost_uncertain", { callId }, sql);
        return;
      }
      const [r] =
        await sql`update hub.research_runs set reserved_micros=reserved_micros-${fresh.reserved_micros},spent_micros=spent_micros+${actual} where id=${call.run_id} returning *`;
      await sql`update hub.research_calls set state='settled',actual_micros=${actual},metadata=${sql.json(metadata as postgres.JSONValue)} where id=${callId}`;
      for (const threshold of [0.5, 0.8])
        if (
          (Number(r.spent_micros) - actual) / Number(r.budget_micros) <
            threshold &&
          Number(r.spent_micros) / Number(r.budget_micros) >= threshold
        )
          await this.log(
            call.run_id,
            "budget_threshold",
            { threshold, spentMicros: Number(r.spent_micros) },
            sql,
          );
      await this.log(
        call.run_id,
        "usage",
        {
          callId,
          spentMicros: Number(r.spent_micros),
          reservedMicros: Number(r.reserved_micros),
          budgetMicros: Number(r.budget_micros),
        },
        sql,
      );
    });
  }
  async saveDraft(
    lease: Lease,
    draft: Draft,
    quality: "candidate" | "review" | "verified",
  ) {
    return this.locked(lease, async (sql) => {
      const sources = await this.sources(lease.runId),
        citations = await this.citations(lease.runId);
      const errors = validateDraft(draft, citations, sources);
      if (errors.length && quality === "verified")
        throw new ResearchError(errors.join(","), 422);
      const [v] =
        await sql`select coalesce(max(version),0)+1 as version from hub.research_drafts where run_id=${lease.runId}`;
      const [r] =
        await sql`insert into hub.research_drafts(id,run_id,step_id,version,origin,quality,payload,markdown) values(${randomUUID()},${lease.runId},${lease.stepId},${v.version},'model',${quality},${sql.json(draft)},${renderDraft(draft, citations, sources)}) returning *`;
      return r;
    });
  }
  async finish(
    lease: Lease,
    state: "done" | "review" | "failed",
    output: unknown,
    error?: string,
  ) {
    await this.locked(lease, async (sql) => {
      await sql`update hub.research_steps set state=${state},output=${sql.json(output as postgres.JSONValue)},error=${error || null},lease_until=null,lease_token=null,updated_at=now() where id=${lease.stepId}`;
      await this.log(
        lease.runId,
        "step_finished",
        { stepId: lease.stepId, state, error },
        sql,
      );
    });
  }
  async cancel(runId: string, userId: string) {
    await this.get(runId, userId);
    await this.sql.begin(async (tx) => {
      const sql = tx as unknown as postgres.Sql;
      const [current] =
        await sql`select state from hub.research_runs where id=${runId} for update`;
      if (current.state === "completed")
        throw new ResearchError("already_completed");
      if (current.state === "cancelled") return;
      await sql`update hub.research_runs set state='cancelled',reason='user_cancelled',revision=revision+1,updated_at=now() where id=${runId}`;
      await sql`update hub.research_steps set state='cancelled',revision=revision+1,lease_token=null,lease_until=null where run_id=${runId} and state in ('running','pending','paused')`;
      await this.log(runId, "cancelled", {}, sql);
    });
  }
  async resume(runId: string, userId: string) {
    await this.get(runId, userId);
    return this.sql.begin(async (tx) => {
      const sql = tx as unknown as postgres.Sql;
      const [r] =
        await sql`select * from hub.research_runs where id=${runId} for update`;
      if (["queued", "running"].includes(r.state)) return r;
      if (r.state === "completed") throw new ResearchError("already_completed");
      if (
        Number(r.spent_micros) + Number(r.reserved_micros) >=
        Number(r.budget_micros)
      )
        throw new ResearchError("budget_exhausted");
      await sql`update hub.research_steps set state='pending',revision=revision+1,lease_token=null,lease_until=null where run_id=${runId} and state<>'done'`;
      const [next] =
        await sql`update hub.research_runs set state='queued',reason=null,revision=revision+1,updated_at=now() where id=${runId} returning *`;
      await this.log(runId, "resumed", {}, sql);
      return next;
    });
  }
  async pause(runId: string, reason: string) {
    await this.sql.begin(async (tx) => {
      const sql = tx as unknown as postgres.Sql;
      const changed =
        await sql`update hub.research_runs set state='paused',reason=${reason},updated_at=now() where id=${runId} and state in ('queued','running') returning id`;
      if (!changed.length) return;
      await sql`update hub.research_steps set state='paused',error=${reason},revision=revision+1,lease_token=null,lease_until=null where run_id=${runId} and state='running' and exists(select 1 from hub.research_runs where id=${runId} and state='paused')`;
      await this.log(runId, "paused", { reason }, sql);
    });
  }
  async guidance(runId: string, userId: string, key: string, content: string) {
    await this.get(runId, userId);
    await this.sql.begin(async (tx) => {
      const sql = tx as unknown as postgres.Sql;
      await sql`select id from hub.research_runs where id=${runId} for update`;
      const [old] =
        await sql`select content from hub.research_guidance where run_id=${runId} and request_key=${key}`;
      if (old) {
        if (old.content !== content)
          throw new ResearchError("idempotency_input_conflict");
        return;
      }
      await sql`insert into hub.research_guidance(id,run_id,request_key,content) values(${randomUUID()},${runId},${key},${content})`;
      const [run] =
        await sql`select * from hub.research_runs where id=${runId}`;
      if (run.state === "completed") {
        if (
          Number(run.spent_micros) + Number(run.reserved_micros) >=
          Number(run.budget_micros)
        )
          throw new ResearchError("budget_exhausted");
        const materials =
          await sql`select source_id from hub.research_run_sources where run_id=${runId}`;
        const [previous] =
          await sql`select payload from hub.research_drafts where run_id=${runId} order by version desc limit 1`;
        await sql`insert into hub.research_steps(id,run_id,step_key,stage,input) values(${randomUUID()},${runId},${"followup-" + fingerprint(key).slice(0, 16)},'research',${sql.json({ question: run.question + "\n追加指导：" + content, sourceIds: materials.map((m) => m.source_id), previousDraft: previous?.payload || null })})`;
        if (run.kind === "daily") {
          await sql`update hub.research_steps set state='pending',revision=revision+1,output=null where run_id=${runId} and stage='edit'`;
          await sql`update hub.research_steps set state='review',error='waiting_new_candidate',input='{}',output=null,revision=revision+1 where run_id=${runId} and stage='final_verify'`;
        }
        await sql`update hub.research_runs set state='queued',revision=revision+1,reason=null,updated_at=now() where id=${runId}`;
      }

      await this.log(
        runId,
        "guidance_saved",
        { message: "下一研究轮读取指导；已完成稿件保持原样。" },
        sql,
      );
    });
  }
}
let singleton: ResearchStore | undefined;
export function researchStore() {
  return (singleton ??= new ResearchStore(
    postgres(config.database.url, { max: 5, idle_timeout: 10 }),
  ));
}
