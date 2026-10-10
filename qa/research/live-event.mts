// Explicit live acceptance entry. Never called by make gate; no background workers.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import postgres from '../../services/hub-engine/node_modules/postgres/src/index.js';
import {ResearchStore} from '../../services/hub-engine/src/research/store.js';
import {executeStep,reconcileRun} from '../../services/hub-engine/src/research/runner.js';
import {resolveResearchKey} from '../../services/hub-engine/src/research/model.js';
if(!process.argv.includes('--live'))throw new Error('explicit_live_flag_required');
const url=new URL(process.env.RESEARCH_TEST_DATABASE_URL||'');
if(url.hostname!=='127.0.0.1'||url.port!=='55439'||url.pathname!=='/research_qa')throw new Error('isolated_database_required');
const sql=postgres(url.href,{max:5});const store=new ResearchStore(sql as never);
const dir=resolve('output/research-live-20260914');await mkdir(dir,{recursive:true,mode:0o700});
try {
 const model=JSON.parse(await readFile('backups/trusted-research-20260914-baseline/deepseek-model.encrypted.json','utf8'));
 if(model.id!=='3d7e60b5-67eb-4c4f-bfe8-0e2f3d816940'||model.provider!=='deepseek')throw new Error('unexpected_model_config');
 await sql`insert into public.model_configs(id,provider,model_name,model_type,api_key_encrypted,base_url,is_active,is_default,test_status) values(${model.id},'deepseek','deepseek-flash','llm',${model.api_key_encrypted},'https://api.deepseek.com',true,false,'untested') on conflict(id) do update set model_name='deepseek-flash',api_key_encrypted=excluded.api_key_encrypted,base_url=excluded.base_url,is_active=true`;
 await resolveResearchKey(store);console.log('Configured credential decrypted; value not logged.');
 const [item]=await sql`select id,user_id,title from hub.items where id='3ae449ca-33a0-429d-9374-f8036d4dea9e'`;
 if(!item)throw new Error('frozen_sample_missing');
 const input={kind:'topic' as const,question:'基于这篇OpenAI原文，说明Perplexity具体采用了哪些能力、文中提供了什么证据，以及不能据此推出什么结论。明确区分厂商自述、可核实事实和你的分析，不将宣传主张当成独立证实。',sourceIds:[item.id],network:false,publicSearchTerms:[]};
 const run=await store.create(item.user_id,'live-deepseek-flash-event-20260914',input);
 console.log(JSON.stringify({runId:run.id,state:run.state,budgetCny:10,network:false}));
 if(['failed','paused','cancelled','review'].includes(run.state)&&process.argv.includes('--resume'))await store.resume(run.id,item.user_id);
 for(let i=0;i<6;i++){
  const r=await store.get(run.id,item.user_id);if(!['queued','running'].includes(r.state))break;
  const [step]=await sql`select id,stage from hub.research_steps where run_id=${run.id} and state='pending' order by step_key limit 1`;
  if(!step){await reconcileRun(store,run.id);break;}
  console.log(JSON.stringify({stage:step.stage,stepId:step.id}));await executeStep(store,run.id,step.id);
  const state=await store.get(run.id,item.user_id);console.log(JSON.stringify({state:state.state,reason:state.reason,spentCny:Number(state.spent_micros)/1e6,reservedCny:Number(state.reserved_micros)/1e6}));
 }
 const detail=await store.detail(run.id,item.user_id);
 const calls=await sql`select id,kind,state,reserved_micros,actual_micros,metadata from hub.research_calls where run_id=${run.id} order by created_at`;
 await writeFile(resolve(dir,'result.json'),JSON.stringify({detail,calls},null,2),{mode:0o600});
 if(detail.drafts[0])await writeFile(resolve(dir,'report.md'),detail.drafts[0].markdown,{mode:0o600});
 console.log(JSON.stringify({runId:run.id,state:detail.run.state,drafts:detail.drafts.length,citations:detail.citations.length,calls:calls.length,spentCny:Number(detail.run.spent_micros)/1e6,reservedCny:Number(detail.run.reserved_micros)/1e6}));
} finally {
 // A later synthetic worker must never inherit this explicitly live credential.
 try {await sql`update public.model_configs set is_active=false where id='3d7e60b5-67eb-4c4f-bfe8-0e2f3d816940'`;} finally {await sql.end();}
}
