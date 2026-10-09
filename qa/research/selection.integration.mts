import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import postgres from '../../services/hub-engine/node_modules/postgres/src/index.js';
import {ResearchStore} from '../../services/hub-engine/src/research/store.js';
const url=new URL(process.env.RESEARCH_TEST_DATABASE_URL||'');
if(url.hostname!=='127.0.0.1'||url.port!=='55439'||url.pathname!=='/research_qa')throw new Error('isolated_database_required');
const sql=postgres(url.href,{max:4}),store=new ResearchStore(sql as never);
try{
 const runId=randomUUID(),user=randomUUID(),stepId=randomUUID();
 await sql`insert into hub.research_runs(id,requested_by,request_key,kind,question,state,policy,spent_micros) values(${runId},${user},${randomUUID()},'daily','合成冻结选材复核','review','{}',10000000)`;
 const source=await store.snapshot({title:'合成来源',url:'https://example.org/'+runId,body:'这是合成公开事实。',origin:'fixture'});
 await sql`insert into hub.research_run_sources(run_id,source_id) values(${runId},${source})`;
 await sql`insert into hub.research_steps(id,run_id,step_key,stage,state,input,output) values(${stepId},${runId},'event-00','research','done',${sql.json({sourceIds:[source]})},' {"retained":true}')`;
 const before=await sql`select * from hub.research_steps where run_id=${runId}`;
 const outputs=await Promise.all([store.recheckSelection(runId,user,'same'),store.recheckSelection(runId,user,'same')]);
 assert.deepEqual(outputs[0],outputs[1]);assert.equal(outputs[0].status,'checked');assert.equal(outputs[0].enqueued,false);
 assert.deepEqual(await sql`select * from hub.research_steps where run_id=${runId}`,before);
 const [run]=await sql`select * from hub.research_runs where id=${runId}`;assert.equal(Number(run.spent_micros),10000000);assert.equal(run.state,'review');
 const [logs]=await sql`select count(*)::int as n from hub.research_run_log where run_id=${runId} and type='selection_rechecked'`;assert.equal(logs.n,1);
 await assert.rejects(()=>store.recheckSelection(runId,randomUUID(),'x'),/run_not_found/);
 await sql`update hub.research_steps set input=${sql.json({sourceIds:[randomUUID()]})} where id=${stepId}`;
 const invalid=await store.recheckSelection(runId,user,'invalid');assert.equal(invalid.status,'review');assert.deepEqual(invalid.invalidEvents,[stepId]);
 await sql`update hub.research_runs set state='running' where id=${runId}`;
 await assert.rejects(()=>store.recheckSelection(runId,user,'active'),/run_already_active/);
 await sql`update hub.research_runs set state='review' where id=${runId}`;
 console.log('PASS: frozen selection recheck, concurrent dedupe, zero paid calls at exhausted budget, preserve event output/state, missing evidence, ownership and active-run rejection');
}finally{await sql.end();}
