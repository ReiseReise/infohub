import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const url=new URL(process.env.RESEARCH_TEST_DATABASE_URL||'');
if(url.hostname!=='127.0.0.1'||url.port!=='55439'||url.pathname!=='/research_qa')throw new Error('isolated_database_required');
process.env.DATABASE_URL=url.href;process.env.TRUSTED_RESEARCH_ENABLED='true';
const {Hono}=await import('../../services/hub-engine/node_modules/hono/dist/index.js');
const {generateTrustedDaily,rerunTrustedDaily,trustedDailyJob,latestTrustedDaily}=await import('../../services/hub-engine/src/research/daily-adapter.js');
const {researchStore,ResearchError}=await import('../../services/hub-engine/src/research/store.js');
const store=researchStore(),sql=store.sql,user=randomUUID();
const app=new Hono();
app.onError((e,c)=>c.json({error:e.message},e instanceof ResearchError?e.status as 400:500));
app.post('/generate',async c=>generateTrustedDaily(c,user,await c.req.json()));
app.post('/rerun/:stage',async c=>rerunTrustedDaily(c,user,c.req.param('stage'),await c.req.json()));
app.get('/jobs/:id',c=>trustedDailyJob(c,user,c.req.param('id')));
app.get('/latest',c=>latestTrustedDaily(c,user));
const post=(path:string,body:unknown,key=randomUUID())=>app.request(path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
try{
 const first=randomUUID(),second=randomUUID();
 for(const [id,sourceId] of [[first,123],[second,456]] as const){
  await sql`insert into hub.research_runs(id,request_key,requested_by,kind,question,state,input,policy) values(${id},${randomUUID()},${user},'daily','测试来源日报','review',${sql.json({date:'2026-09-06',sourceId})},'{}')`;
 }
 let response=await app.request('/latest?date=2026-09-06&sourceId=123');assert.equal(response.status,200);assert.equal((await response.json()).data.id,first);
 response=await app.request('/latest?date=2026-09-06&sourceId=456');assert.equal((await response.json()).data.id,second);
 response=await app.request('/jobs/research-'+first);assert.equal(response.status,200);assert.equal((await response.json()).data.runId,first);
 response=await post('/rerun/daily_report_cleaning',{runId:first});assert.equal(response.status,200);assert.equal((await response.json()).enqueued,false);
 response=await post('/rerun/daily_report_final',{runId:first});assert.equal(response.status,422);assert.equal((await response.json()).error,'no_verified_events');
 const one=randomUUID(),two=randomUUID();
 await sql`insert into hub.research_steps(id,run_id,step_key,stage,state,input) values(${one},${first},'event-00','research','done','{}'),(${two},${first},'event-01','research','pending','{}')`;
 response=await post('/rerun/daily_report_research',{runId:first,stepId:one});assert.equal(response.status,409);assert.equal((await response.json()).error,'unfinished_events_require_resume');
 const [untouched]=await sql`select state from hub.research_steps where id=${one}`;assert.equal(untouched.state,'done');
 response=await post('/generate',{date:'2026-09-06',sourceId:2147483000,network:false,async:false});assert.equal(response.status,403);assert.equal((await response.json()).error,'source_scope_denied');
 response=await post('/generate',{date:'2026-09-06',network:false,async:false});assert.equal(response.status,202);const created=await response.json();assert.match(created.jobId,/^research-/);assert.equal(created.data.input.network,false);
 await store.cancel(created.data.id,user);
 console.log('PASS: source-scoped latest, persistent jobs, cleaning-only recheck, no-verification refusal, foreign source rejection, synchronous caller enters same persistent task service');
}finally{await sql.end();}
