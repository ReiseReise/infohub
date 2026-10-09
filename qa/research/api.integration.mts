import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = "http://127.0.0.1:3309/api";
const login = await fetch(base + "/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: "research-qa@example.invalid",
    password: "Research-QA-local-only",
  }),
});
const data = await login.json();
const token =
  data.accessToken || data.token || data.data?.accessToken || data.data?.token;
assert.ok(token, "synthetic login works");
async function req(path: string, method = "GET", body?: unknown, key?: string) {
  const r = await fetch(base + path, {
    method,
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
}
const materials = await req("/research/materials");
assert.equal(materials.status, 200);
assert.ok(materials.body.data.length);
const input = {
  kind: "topic",
  question: "API验收：比较合成来源",
  sourceIds: [materials.body.data[0].id],
  network: false,
  publicSearchTerms: [],
};
const key = randomUUID();
const [a, b] = await Promise.all([
  req("/research/runs", "POST", input, key),
  req("/research/runs", "POST", input, key),
]);
assert.equal(a.status, 202);
assert.equal(a.body.data.id, b.body.data.id);
const id = a.body.data.id;
assert.equal(
  (
    await req(
      "/research/runs",
      "POST",
      { ...input, question: "另一个问题" },
      key,
    )
  ).status,
  409,
);
await req(`/research/runs/${id}/cancel`, "POST");
let details = await req(`/research/runs/${id}`);
assert.equal(details.body.data.run.state, "cancelled");
assert.ok(details.body.data.steps.every((s) => s.state !== "running"));
const [x, y] = await Promise.all([
  req(`/research/runs/${id}/resume`, "POST"),
  req(`/research/runs/${id}/resume`, "POST"),
]);
assert.equal(x.body.data.revision, y.body.data.revision);
const until = Date.now() + 12000;
while (Date.now() < until) {
  details = await req(`/research/runs/${id}`);
  if (details.body.data.run.state === "paused") break;
  await new Promise((r) => setTimeout(r, 400));
}
assert.equal(details.body.data.run.state, "paused");
assert.equal(details.body.data.run.reason, "deepseek_credential_missing");
assert.ok(details.body.data.steps.every((s) => s.state !== "running"));
assert.equal(Number(details.body.data.run.spent_micros), 0);
const guideKey = randomUUID();
await req(
  `/research/runs/${id}/guidance`,
  "POST",
  { content: "核对日期" },
  guideKey,
);
await req(
  `/research/runs/${id}/guidance`,
  "POST",
  { content: "核对日期" },
  guideKey,
);
assert.equal((await req(`/research/runs/${id}`)).body.data.guidance.length, 1);
const saved = await req(`/research/runs/${id}/drafts`, "POST", {
  markdown: "# 合成人工草稿",
  baseVersion: 0,
});
assert.equal(saved.status, 201);
assert.equal(
  (
    await req(`/research/runs/${id}/drafts`, "POST", {
      markdown: "# 不得覆盖",
      baseVersion: 0,
    })
  ).status,
  409,
);
const sourceId = details.body.data.sources[0].id;
assert.equal((await req("/research/evidence/" + sourceId)).status, 200);
// A topic without sourceIds uses the complete collected index. It should
// create one bounded topic research step, rather than guessing from title text
// or forcing the user to curate a list first.
const automaticTopic = await req(
  "/research/runs",
  "POST",
  {
    kind: "topic",
    question: "自动全库范围验收",
    sourceIds: [],
    scope: "all_collected",
    network: false,
    publicSearchTerms: [],
  },
  randomUUID(),
);
assert.equal(automaticTopic.status, 202);
const automaticDetail = await req(
  "/research/runs/" + automaticTopic.body.data.id,
);
assert.ok(automaticDetail.body.data.sources.length >= materials.body.data.length);
assert.equal(
  automaticDetail.body.data.steps.filter((s: { stage: string }) => s.stage === "research").length,
  1,
);
const events = await req(`/research/runs/${id}/events`);
assert.ok(events.body.data.length > 2);
const last = events.body.data.at(-1).seq;
assert.deepEqual(
  (await req(`/research/runs/${id}/events?after=${last}`)).body.data,
  [],
);
assert.equal((await fetch(base + "/research/runs")).status, 401);
const day = new Date().toLocaleDateString("en-CA", {
  timeZone: "Asia/Shanghai",
});
const daily = await req(
  "/daily/generate",
  "POST",
  { engine: "trusted", date: day, network: false },
  randomUUID(),
);
assert.equal(daily.status, 202);
assert.equal(
  (await req("/daily/generate/jobs/" + daily.body.jobId)).status,
  200,
);
const dailyRead = await req("/daily/reports/latest?engine=trusted&date=" + day);
assert.equal(dailyRead.status, 200);
assert.equal(dailyRead.body.data.publicationStatus, "draft");
console.log(
  "PASS: authenticated API + real BullMQ dispatch, duplicate create, cancel child status, concurrent resume, missing credentials pause, zero fees, guidance dedupe, draft optimistic lock, evidence and event cursor. No real model invoked.",
);
