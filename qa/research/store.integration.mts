import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "../../services/hub-engine/node_modules/postgres/src/index.js";
import { ResearchStore } from "../../services/hub-engine/src/research/store.js";
const url = process.env.RESEARCH_TEST_DATABASE_URL || "";
const parsed = new URL(url);
if (
  parsed.hostname !== "127.0.0.1" ||
  parsed.port !== "55439" ||
  parsed.pathname !== "/research_qa"
)
  throw new Error("isolated_database_required");
const sql = postgres(url, { max: 8 });
const store = new ResearchStore(sql as never);
try {
  const [user] =
    await sql`select user_id from hub.items group by user_id order by count(*) desc limit 1`;
  const [item] =
    await sql`select id from hub.items where user_id=${user.user_id} and coalesce(is_filtered,false)=false and length(coalesce(readability_content,content,''))>100 limit 1`;
  const input = {
    kind: "topic" as const,
    question: "核对来源事实",
    sourceIds: [item.id],
    network: false,
    publicSearchTerms: [],
  };
  const key = randomUUID();
  const runs = await Promise.all(
    Array.from({ length: 4 }, () => store.create(user.user_id, key, input)),
  );
  assert.equal(new Set(runs.map((r) => r.id)).size, 1);
  const run = runs[0];
  await assert.rejects(
    () => store.create(user.user_id, key, { ...input, question: "改变了问题" }),
    /idempotency_input_conflict/,
  );
  const [step] =
    await sql`select * from hub.research_steps where run_id=${run.id}`;
  const claims = await Promise.all([
    store.claim(run.id, step.id),
    store.claim(run.id, step.id),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  const lease = claims.find(Boolean)!;
  const sources = await store.sources(run.id);
  const c = await store.cite(
    lease,
    sources[0].id,
    sources[0].body.slice(0, 80),
  );
  const draft = {
    title: "隔离验证",
    facts: [{ text: "原文有明确记载。", citations: [c.id] }],
    analysis: [],
    unresolved: [],
  };
  const call = await store.reserve(lease, 6000000, "test", {});
  await assert.rejects(
    () => store.reserve(lease, 5000000, "test", {}),
    /budget_exhausted/,
  );
  await store.settle(call, 1000000, {});
  await store.settle(call, 1000000, {});
  const before = await store.get(run.id, user.user_id);
  assert.equal(Number(before.spent_micros), 1000000);
  assert.equal(Number(before.reserved_micros), 0);
  await store.saveDraft(lease, draft, "candidate");
  await sql`update hub.research_steps set lease_until=now()-interval '1 second' where id=${step.id}`;
  const reclaimed = await store.claim(run.id, step.id);
  assert.ok(reclaimed, "expired worker lease is recoverable");
  await assert.rejects(
    () => store.saveDraft(lease, draft, "verified"),
    /execution_revoked/,
  );
  await store.cancel(run.id, user.user_id);
  await assert.rejects(
    () => store.saveDraft(lease, draft, "verified"),
    /execution_revoked/,
  );
  const resumed = await Promise.all([
    store.resume(run.id, user.user_id),
    store.resume(run.id, user.user_id),
  ]);
  assert.equal(resumed[0].revision, resumed[1].revision);
  assert.equal(
    Number((await store.get(run.id, user.user_id)).spent_micros),
    1000000,
  );
  await assert.rejects(() => store.get(run.id, randomUUID()), /run_not_found/);
  await assert.rejects(
    () =>
      sql`update hub.research_sources set body='altered' where id=${sources[0].id}`,
    /immutable/,
  );
  await assert.rejects(
    () => sql`delete from hub.research_drafts where run_id=${run.id}`,
    /immutable/,
  );
  console.log(
    "PASS: concurrent creation, key conflict, exclusive lease, quote, budget reservation/settlement, cancellation fencing, resume dedupe, ownership, immutable evidence/drafts",
  );
} finally {
  await sql.end();
}
