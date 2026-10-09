/** Authorized $1 public-only validation. Uses the SAME durable production budget as the worker. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import dotenv from '../../services/hub-engine/node_modules/dotenv/lib/main.js';
if(!process.argv.includes('--live'))throw Error('explicit_live_required');
dotenv.config({path:'.env',override:false});
const expanded=process.env.DATABASE_URL!.replace(/\$\{([A-Z_]+)\}/g,(_,name)=>{const value=process.env[name];if(!value)throw Error('database_variable_missing');return encodeURIComponent(value);});
const u=new URL(expanded);u.hostname='127.0.0.1';u.port='5432';process.env.DATABASE_URL=u.toString();
const {JevStore,jevStore}=await import('../../services/hub-engine/src/jev/store.js');
const {evaluate}=await import('../../services/hub-engine/src/jev/service.js');
const {hash,clip,publicUrl}=await import('../../services/hub-engine/src/jev/contracts.js');
const bytes=readFileSync('exports/jev-20260921/public-cases-v2.jsonl');
const dataset=createHash('sha256').update(bytes).digest('hex');
const rows=bytes.toString().trim().split('\n').map(line=>JSON.parse(line));
for(const row of rows){
 if(row.public_access?.status!=='verified'||!publicUrl(row.url)||createHash('sha256').update(row.text).digest('hex')!==row.content_sha256)throw Error('public_manifest_validation_failed');
}
const store=jevStore(),sql=store.sql;
const scenes=['feed','enrichment','injection','source','fetch','capture','daily'] as const;
const old=await store.control();
// Resume must not silently step over an unknown or failed paid attempt.
if((await sql`select id from hub.jev_decisions where public_basis like 'frozen_public:%' and status in ('reserved','unknown') limit 1`).length)throw Error('unsettled_attempt_requires_review');
if(!process.env.TYPESAFE_API_KEY)throw Error('missing_credential');
const modes={...old.modes};for(const scene of scenes)modes[scene]='shadow';
await sql`update hub.jev_control set stopped=false,modes=${sql.json(modes)} where id=true`;
class FrozenStore extends JevStore {
 async load(scene:any,target:string){
  const r=rows.find(x=>x.id===target);if(!r||!scenes.includes(scene))throw Error('public_content_required');
  const [owner]=await this.sql`select user_id from hub.items where id::text=${target}`;if(!owner)throw Error('item_not_found');
  const state={title:clip(r.title,500),text:clip(r.text,6000),dataset};
  return {target,peer:null,state,revision:hash(state),language:r.language,publicBasis:'frozen_public:'+dataset,userId:owner.user_id};
 }
}
const frozen=new FrozenStore(sql);const outcomes:any[]=[];
try{
 for(const scene of scenes){
  for(const row of rows){
   const result=await evaluate(frozen,scene,row.id);
   outcomes.push({scene,id:row.id,language:row.language,...result});
   console.log(scene,outcomes.length,result.status);
   if(result.status==='suggested'&&result.id)await sql`update hub.jev_decisions set status='experiment' where id=${result.id} and status='suggested'`;
   if(!['suggested','duplicate'].includes(result.status))throw Error('live_validation_stopped:'+('reason' in result?result.reason:result.status));
  }
 }
}finally{
 // Restore the prior stop/modes, even after a failure. No indefinite paid monitor.
 await sql`update hub.jev_control set stopped=${old.stopped},modes=${sql.json(old.modes)} where id=true`;
 mkdirSync('exports/jev-20260922',{recursive:true,mode:0o700});
 const result={dataset,at:new Date().toISOString(),outcomes,budget:(await sql`select * from hub.jev_budget`)[0],limitations:['Frozen public news samples only','No human labels','Monitor, audio and event-pair quality not measured','Costs are estimates, not invoice verification']};
 writeFileSync('exports/jev-20260922/live-public.json',JSON.stringify(result,null,2),{mode:0o600});
 await sql.end();
}
process.exit(0);
