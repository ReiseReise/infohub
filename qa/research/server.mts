// Dedicated, local acceptance server. Never imports the production scheduler/bootstrap.
import { serve } from "../../services/hub-engine/node_modules/@hono/node-server/dist/index.mjs";
import { Hono } from "../../services/hub-engine/node_modules/hono/dist/index.js";
import research from "../../services/hub-engine/src/routes/research.js";
import { startResearchWorker } from "../../services/hub-engine/src/research/queue.js";
import daily from "../../services/hub-engine/src/routes/daily.js";
import auth from "../../services/hub-engine/src/routes/auth.js";
import postgres from "../../services/hub-engine/node_modules/postgres/src/index.js";
import { hashPassword } from "../../services/hub-engine/src/lib/auth.js";
import { ResearchStore } from "../../services/hub-engine/src/research/store.js";
import { executeStep } from "../../services/hub-engine/src/research/runner.js";
const url = new URL(process.env.DATABASE_URL || "");
const redisUrl = new URL(process.env.REDIS_URL || "redis://invalid");
if (redisUrl.hostname !== "127.0.0.1" || redisUrl.port !== "55440")
  throw new Error("isolated_redis_required");
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "55439" ||
  url.pathname !== "/research_qa"
)
  throw new Error("isolated_database_required");
const sql = postgres(url.href, { max: 3 });
const store = new ResearchStore(sql as never);
const password = await hashPassword("Research-QA-local-only");
await sql`insert into auth.users(id,email,username,password_hash,role,is_active) values('00000000-0000-4000-8000-000000000010','research-qa@example.invalid','research-qa',${password},'admin',true) on conflict(email) do nothing`;
const userId = "00000000-0000-4000-8000-000000000010";
const [source] =
  await sql`insert into hub.sources(user_id,name,source_type,status,source_tier,category) values(${userId},'隔离合成验收来源','rss','active','S','AI') returning id`;
for (let i = 0; i < 3; i++)
  await sql`insert into hub.items(user_id,source_id,source_type,title,url,content,published_at,ai_score,ai_summary,summary_status) values(${userId},${source.id},'rss',${"隔离验收：研究材料 " + (i + 1)},${"https://example.org/research-" + i},${"这是一份合成测试原文。产品于2026年9月6日发布，作者为测试团队。它只用于页面和状态测试，不是实际新闻。".repeat(4)},now(),90,'合成资料用于研究页面验收。','ready') on conflict(user_id,url) do nothing`;
const app = new Hono();
app.route("/api/auth", auth);
app.route("/api/research", research);
app.route("/api/daily", daily);
app.get("/api/health", (c) =>
  c.json({ status: "ok", environment: "isolated-research-qa" }),
);
const worker = process.env.RESEARCH_QA_WORKER === "false" ? undefined : startResearchWorker();
serve({ fetch: app.fetch, port: 3309, hostname: "127.0.0.1" });
console.log("Isolated research QA listening on 127.0.0.1:3309");
process.on("SIGTERM", () => {
  void worker?.close();
  void sql.end().then(() => process.exit());
});
