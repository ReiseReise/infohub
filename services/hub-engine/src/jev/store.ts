import postgres from 'postgres';
import { config } from '../config/index.js';
import { clip, diffText, hash, publicUrl, requestKey, MODEL, VERSION, type Scene } from './contracts.js';
export type Material={target:string;peer:string|null;state:Record<string,unknown>;revision:string;language:string;publicBasis:string;userId:string};
export class JevStore {
 constructor(public sql:postgres.Sql){}
 async control(){const [c]=await this.sql`select * from hub.jev_control where id=true`;return c;}
 async load(scene:Scene,target:string,peer?:string):Promise<Material>{
  const [i]=await this.sql`select i.*,s.config as source_config from hub.items i join hub.sources s on s.id=i.source_id where i.id::text=${target}`;
  if(!i)throw Error('item_not_found');
  const meta=i.curation_meta??{};const policy=i.source_config?.jevPublic;
  // Publicness is an explicit administrator attestation, never inferred from a URL.
  const itemPublic=meta.jevPublic?.confirmed===true;
  const privateKind=['email','upload','capture','webhook'].includes(i.source_type);
  if(meta.jevPublic?.confirmed===false||!publicUrl(i.original_url||i.url)||(!itemPublic && (privateKind||policy?.confirmed!==true)))throw Error('public_content_required');
  const body=clip(i.readability_status==='ready'?i.readability_content:i.content||i.snippet);
  let state:Record<string,unknown>={title:clip(i.title,500),text:body};
  if(scene==='preference')throw Error('privacy_blocked');
  if(scene==='transcribe')state={title:clip(i.title,500),shownotes:clip(i.content||i.snippet,4000)};
  if(scene==='transcript'){
   let transcript=i.transcript;
   if(i.audio_task_id){
    const [task]=await this.sql`select transcript_text from public.audio_tasks where id::text=${i.audio_task_id} and user_id=${i.user_id}`;
    transcript=task?.transcript_text||transcript;
   }
   if(!transcript)throw Error('transcript_missing');
   state={title:clip(i.title,500),transcript:clip(transcript,10000)};
  }
  if(scene==='same_event'){
   if(!peer||peer===target)throw Error('peer_required');
   const other=await this.load('feed',peer);
   const [p]=await this.sql`select cluster_id from hub.items where id::text=${peer}`;
   if(!i.cluster_id||p?.cluster_id!==i.cluster_id)throw Error('not_cluster_candidates');
   state={piece_a:{title:clip(i.title,500),opening:clip(body,3000)},piece_b:other.state};
  }
  if(scene==='monitor'){
   if(i.source_type!=='changedetection' && !String(i.guid||'').startsWith('changedetection:'))throw Error('not_monitor_item');
   const [before]=await this.sql`select content from hub.items where source_id=${i.source_id} and published_at<${i.published_at} order by published_at desc limit 1`;
   if(!before?.content||!i.content)throw Error('previous_snapshot_missing');
   const goal=i.source_config?.monitoringGoal;
   if(typeof goal!=='string'||!goal.trim())throw Error('monitoring_goal_required');
   state={monitoring_goal:clip(goal,500),...diffText(before.content,i.content)};
  }
  return {target,peer:peer||null,state,revision:hash(state),language:i.language||'unknown',publicBasis:itemPublic?'item_attestation':'source_attestation',userId:i.user_id};
 }
 async reserve(scene:Scene,m:Material,amount:number){
  const id=requestKey(scene,m.target,m.state);
  return this.sql.begin(async tx=>{
   const s=tx as unknown as postgres.Sql;
   const [budget]=await s`select * from hub.jev_budget where id='jev-20260922' for update`;
   const c=(await s`select * from hub.jev_control where id=true for update`)[0];
   if(!c||c.stopped||c.modes[scene]!=='shadow')throw Error('scene_disabled');
   if((await s`select id from hub.jev_decisions where id=${id}`).length)return null;
   if(!budget||Number(budget.spent_micros)+Number(budget.reserved_micros)+amount>Number(budget.limit_micros))throw Error('budget_exhausted');
   await s`update hub.jev_budget set reserved_micros=reserved_micros+${amount} where id='jev-20260922'`;
   await s`insert into hub.jev_decisions(id,scene,target_id,peer_id,revision,model,question_version,language,public_basis,status,reserved_micros) values(${id},${scene},${m.target},${m.peer},${m.revision},${MODEL},${VERSION},${m.language},${m.publicBasis},'reserved',${amount})`;
   return id;
  });
 }
 async settle(id:string,cost:number,tokens:number,latency:number,suggestion:unknown,stale:boolean){
  await this.sql.begin(async tx=>{
   const s=tx as unknown as postgres.Sql;
   await s`select id from hub.jev_budget where id='jev-20260922' for update`;
   const [d]=await s`select * from hub.jev_decisions where id=${id} for update`;
   if(!d||d.status!=='reserved')return;
   if(cost>Number(d.reserved_micros)){
    await s`update hub.jev_control set stopped=true where id=true`;
    await s`update hub.jev_decisions set status='unknown',reason='reservation_exceeded',finished_at=now() where id=${id}`;
    return;
   }
   await s`update hub.jev_budget set reserved_micros=reserved_micros-${Number(d.reserved_micros)},spent_micros=spent_micros+${cost} where id='jev-20260922'`;
   await s`update hub.jev_decisions set status=${stale?'stale':'suggested'},suggestion=${s.json(suggestion as postgres.JSONValue)},cost_micros=${cost},input_tokens=${tokens},latency_ms=${latency},finished_at=now() where id=${id}`;
  });
 }
 async fail(id:string,reason:string){await this.sql`update hub.jev_decisions set status='unknown',reason=${reason},finished_at=now() where id=${id} and status='reserved'`;}
 async skip(scene:Scene,target:string,reason:string){
  const id=hash(['skip',scene,target,reason,VERSION]);
  await this.sql`insert into hub.jev_decisions(id,scene,target_id,revision,model,question_version,language,public_basis,status,reason) values(${id},${scene},${target},'',${MODEL},${VERSION},'unknown','not_sent','skipped',${reason}) on conflict do nothing`;
 }
}
let instance:JevStore|undefined;
export function jevStore(){return instance??=new JevStore(postgres(config.database.url,{max:3}));}
