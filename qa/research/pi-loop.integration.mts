import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "../../services/hub-engine/node_modules/postgres/src/index.js";
import { createAssistantMessageEventStream } from "../../services/hub-engine/node_modules/@earendil-works/pi-ai/dist/index.js";
import { ResearchStore } from "../../services/hub-engine/src/research/store.js";
import {
  executeStep,
  reconcileRun,
} from "../../services/hub-engine/src/research/runner.js";
const url = new URL(process.env.RESEARCH_TEST_DATABASE_URL || "");
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "55439" ||
  url.pathname !== "/research_qa"
)
  throw new Error("isolated_database_required");
const sql = postgres(url.href, { max: 8 });
const store = new ResearchStore(sql as never);
let requests = 0;
let openQuestions=false;
const fakeStream = (_model, context) => {
  requests++;
  const stream = createAssistantMessageEventStream();
  const tools = context.tools || [];
  let content: any[],
    stopReason = "stop";
  if (tools.some(t => t.name === 'submit_verification')) {
    content=[{type:'toolCall',id:randomUUID(),name:'submit_verification',arguments:{pass:true,issues:[]}}];
    stopReason='toolUse';
  } else if (tools.length) {
    const result = context.messages.findLast((m) => m.role === "toolResult");
    if (!result) {
      const userContent = context.messages.find(
        (m) => m.role === "user",
      ).content;
      const input = JSON.parse(
        typeof userContent === "string"
          ? userContent
          : userContent.map((c) => c.text || "").join(""),
      );
      if(input.eventDrafts) {
        content=[{type:'toolCall',id:randomUUID(),name:'submit_draft',arguments:{title:'合成日报',facts:input.eventDrafts.flatMap(d=>d.facts),analysis:[],unresolved:[]}}];
      } else content = [
        {
          type: "toolCall",
          id: randomUUID(),
          name: "read_source",
          arguments: { sourceId: input.materials[0].id, offset: 0 },
        },
      ];
    } else {
      const r = JSON.parse(result.content[0].text);
      content = [
        {
          type: "toolCall",
          id: randomUUID(),
          name: "submit_draft",
          arguments: {
            title: "合成流程验收",
            facts: [
              { text: "产品于2026年9月6日发布。", citations: [r.citationId] },
            ],
            analysis: [],
            unresolved: openQuestions ? ["缺少独立来源确认。"] : [],
          },
        },
      ];
    }
    stopReason = "toolUse";
  } else
    content = [
      { type: "text", text: JSON.stringify({ pass: true, issues: [] }) },
    ];
  const m: any = {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "test-only",
    model: "synthetic-test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
  stream.push({ type: "done", reason: stopReason as any, message: m });
  stream.end(m);
  return stream;
};
try {
  const userId = "00000000-0000-4000-8000-000000000010";
  const [item] =
    await sql`select id from hub.items where user_id=${userId} limit 1`;
  const run = await store.create(userId, randomUUID(), {
    kind: "topic",
    question: "验证产品发布日期",
    sourceIds: [item.id],
    network: false,
    publicSearchTerms: [],
  });
  const [first] =
    await sql`select id from hub.research_steps where run_id=${run.id}`;
  await executeStep(store, run.id, first.id, fakeStream);
  const [verify] =
    await sql`select * from hub.research_steps where run_id=${run.id} and stage='verify'`;
  assert.ok(verify, "research creates verification dependency");
  await executeStep(store, run.id, verify.id, fakeStream);
  await reconcileRun(store, run.id);
  const detail = await store.detail(run.id, userId);
  assert.equal(detail.run.state, "completed");
  assert.equal(detail.drafts[0].quality, "verified");
  assert.equal(requests, 3);
  assert.equal(Number(detail.run.spent_micros), 0);
  assert.ok(detail.drafts[0].markdown.includes("/research?evidence="));
  assert.ok(detail.citations.length > 0);
  const guideKey = randomUUID();
  await store.guidance(run.id, userId, guideKey, "追加核对作者");
  await store.guidance(run.id, userId, guideKey, "追加核对作者");
  const afterGuide = await store.detail(run.id, userId);
  assert.equal(afterGuide.run.state, "queued");
  assert.equal(afterGuide.guidance.length, 1);
  assert.equal(
    afterGuide.steps.filter((s) => s.stage === "research").length,
    2,
  );
  assert.equal(afterGuide.drafts.length, 2);
  await store.cancel(run.id, userId);
  openQuestions=true;
  const daily=await store.create(userId,randomUUID(),{kind:'daily',question:'合成整报验证',date:'2026-09-14',sourceIds:[item.id],network:false,publicSearchTerms:[]});
  for(let i=0;i<8;i++){
    const [step]=await sql`select id from hub.research_steps where run_id=${daily.id} and state='pending' order by step_key limit 1`;
    if(!step)break;
    await executeStep(store,daily.id,step.id,fakeStream);
  }
  const dailyDetail=await store.detail(daily.id,userId);
  assert.ok(dailyDetail.steps.some(s=>s.stage==='edit'&&s.state==='done'));
  assert.equal(dailyDetail.run.state,'completed');
  assert.equal(dailyDetail.drafts[0].quality,'review','open questions never get a verified manuscript label');
  assert.ok(dailyDetail.drafts[0].payload.unresolved.length);
  assert.ok(dailyDetail.steps.some(s=>s.stage==='final_verify'&&s.state==='done'));
  console.log(
    "PASS: actual Pi SDK tool loop -> persisted candidate -> separate verification stage -> immutable verified version -> completed. Synthetic model only, no live-content acceptance.",
  );
} finally {
  await sql.end();
}
