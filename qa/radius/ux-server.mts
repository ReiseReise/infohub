// Synthetic UX acceptance: real search/store/routes, deterministic fixture answer, zero model calls.
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import postgres from '../../services/hub-engine/node_modules/postgres/src/index.js';
import {serve} from '../../services/hub-engine/node_modules/@hono/node-server/dist/index.mjs';
import {Hono} from '../../services/hub-engine/node_modules/hono/dist/index.js';
import {createRadiusRoutes} from '../../services/hub-engine/src/routes/radius.js';
import {requireAuth} from '../../services/hub-engine/src/lib/auth.js';
import research from '../../services/hub-engine/src/routes/research.js';
import {renderDraft} from '../../services/hub-engine/src/research/contracts.js';
if(process.env.DATABASE_URL!=='postgres://postgres:radius-qa-only@127.0.0.1:58229/radius_qa'||process.env.NODE_ENV!=='test'||process.env.MEILI_URL!=='http://127.0.0.1:58230')throw Error('isolated_targets_required');
const sql=postgres(process.env.DATABASE_URL,{max:4});
await sql.unsafe(`alter table hub.sources add column if not exists source_kind text default 'rss';alter table hub.sources add column if not exists collector_type text default 'rss';alter table hub.sources add column if not exists source_tier text default 'A';alter table hub.sources add column if not exists category text default 'AI';alter table hub.sources add column if not exists config jsonb default '{}';alter table hub.items add column if not exists source_type text default 'rss';alter table hub.items add column if not exists ai_translation text;alter table hub.items add column if not exists ai_summary text;alter table hub.items add column if not exists summary_status text;alter table hub.items add column if not exists translation_status text;`);
const migration=await readFile(new URL('../../scripts/research/001-trusted-research.sql',import.meta.url),'utf8');
await sql.begin(tx=>tx.unsafe(migration.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')));

async function fixtureAnswer(id:string){
  const sources=await sql`select s.* from hub.research_sources s join hub.research_run_sources rs on rs.source_id=s.id where rs.run_id=${id}`;
  if(!sources.length)return;
  const s=sources[0],cid=randomUUID(),quote=s.body.slice(0,Math.min(80,s.body.length));
  await sql`insert into hub.research_citations(id,run_id,source_id,quote,start_offset,end_offset) values(${cid},${id},${s.id},${quote},0,${quote.length})`;
  const payload={title:'合成验收回答',analysis:[{text:'这些合成材料共同关注 AI 陪伴的具体使用体验。以下回答只用于验证问答、引用和阅读交互，不是真实研究结论。',citations:[cid]}],facts:[{text:'资料保留了来源、正文和发布时间，引用可以回到已保存的原文。',citations:[cid]}],unresolved:['本次为确定性合成回答，未调用真实模型。']};
  const markdown=renderDraft(payload,[{id:cid,source_id:s.id,quote,start_offset:0,end_offset:quote.length}],sources as never);
  await sql`insert into hub.research_drafts(id,run_id,version,origin,quality,payload,markdown) values(${randomUUID()},${id},1,'model','verified',${sql.json(payload)},${markdown})`;
  await sql`update hub.research_runs set state='completed' where id=${id}`;
}
const scheduled=new Set<string>();
const app=new Hono();
app.get('/api/auth/me',c=>{const u=requireAuth(c);return c.json({user:{id:u.userId,email:u.email,username:u.username,role:u.role}});});
app.get('/api/research/config',c=>{requireAuth(c);return c.json({data:{modelReady:true,model:'deepseek-flash',budgetCny:10}});});
app.use('/api/radius/ask',async(c,next)=>{await next();if(c.res.status===202){const data=await c.res.clone().json();const [{n}]=await sql`select count(*)::int as n from hub.research_drafts where run_id=${data.data.runId}`;if(!n&&!scheduled.has(data.data.runId)){scheduled.add(data.data.runId);setTimeout(()=>void fixtureAnswer(data.data.runId).catch(()=>console.error('fixture_answer_failed')),500);}}});
app.route('/api/radius',createRadiusRoutes(undefined,{checkModel:async()=>{}}));
app.route('/api/research',research);
serve({fetch:app.fetch,hostname:'127.0.0.1',port:58231});
console.log('Isolated UX server on 58231; model outputs are synthetic');
